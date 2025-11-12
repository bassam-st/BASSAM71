import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import Fuse from "fuse.js";
import fs from "fs";
import crypto from "crypto";
import {
  EXCHANGE_RATE_YER,
  CUSTOMS_FACTORS,
  SYNONYMS,
  ITEM_INTENTS,
  ROLLS_TYPES
} from "./config.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

/* ===================== تطبيع عربي قوي ===================== */
const AR_TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const AR_TATWEEL  = /\u0640/g;
function normalizeAR(s) {
  s = String(s || "").toLowerCase();
  s = s.replace(AR_TASHKEEL, "").replace(AR_TATWEEL, "");
  // توحيد الألفات والهمزات
  s = s.replace(/[أإآٱ]/g, "ا");
  s = s.replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ة/g, "ه").replace(/ى/g, "ي");
  // حذف رموز متباعدة
  s = s.replace(/[^\p{L}\p{N}\s%/]/gu, " ");
  // تطبيع أرقام عربية
  s = s.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
const norm = s => normalizeAR(s);

/* اشتقاقات بسيطة (جمع/مفرد وألفاظ قريبة) */
function variants(word) {
  const v = new Set([word]);
  const w = norm(word);
  v.add(w);
  if (w.endsWith("ات")) v.add(w.slice(0, -2)); // رولات -> رول
  if (w.endsWith("ون")) v.add(w.slice(0, -2)); // تلفزيون -> تلفزي
  if (w.endsWith("ه")) v.add(w.slice(0, -1) + "ة"); // شاشة/شاشه
  if (w.endsWith("ة")) v.add(w.slice(0, -1) + "ه");
  return Array.from(v);
}

/* توسعة المرادفات */
function expandWithSynonyms(q) {
  const toks = norm(q).split(" ").filter(Boolean);
  const out = [];
  for (const t of toks) {
    let bucket = new Set([t]);
    if (SYNONYMS[t]) SYNONYMS[t].split("|").forEach(x => bucket.add(norm(x)));
    variants(t).forEach(x => bucket.add(x));
    out.push(Array.from(bucket));
  }
  // نركّب أطياف من الكلمات (بدون انفجار كبير)
  const combos = new Set();
  function build(i, cur) {
    if (i === out.length) { combos.add(cur.join(" ")); return; }
    for (const cand of out[i].slice(0, 3)) build(i + 1, cur.concat([cand]));
  }
  build(0, []);
  return Array.from(combos);
}

/* 3-gram (جاكارد) */
function trigrams(s) {
  s = norm(s).replace(/\s+/g, " ");
  const arr = [];
  for (let i=0;i<s.length-2;i++) arr.push(s.slice(i,i+3));
  return new Set(arr);
}
function jaccard3(a, b) {
  const A = trigrams(a), B = trigrams(b);
  let inter=0; for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? inter/uni : 0;
}

/* ===================== تحميل الكتالوج ===================== */
const pricesPath = "./prices/fallback_prices_catalog.json";
let CATALOG = [];

async function loadCatalog() {
  try {
    const url = process.env.PRICE_CATALOG_URL;
    if (url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${url} failed`);
      CATALOG = await r.json();
      console.log("Loaded remote catalog:", url, "items:", CATALOG.length);
    } else {
      const raw = fs.readFileSync(pricesPath, "utf8");
      CATALOG = JSON.parse(raw);
      console.log("Loaded local catalog items:", CATALOG.length);
    }
  } catch (e) {
    console.warn("Catalog load error:", e.message);
    try {
      const raw = fs.readFileSync(pricesPath, "utf8");
      CATALOG = JSON.parse(raw);
    } catch { CATALOG = []; }
  }
}
await loadCatalog();

/* ===================== Fuse إعداد ===================== */
let fuse = new Fuse(CATALOG, {
  keys: ["name","notes","unit"],
  includeScore: true,
  threshold: 0.42,
  distance: 120,
  ignoreLocation: true,
  minMatchCharLength: 2
});

/* ===================== أدوات الرسوم ===================== */
function parseRate(notes="") {
  const s = (notes||"").replace(/\s+/g,"");
  if (/الفئة?10%|10%/i.test(s)) return 10;
  if (/الفئة?5%|5%/i.test(s))  return 5;
  return 10;
}
function usdToCustomsYer(usd, ratePct) {
  const factor = CUSTOMS_FACTORS[String(ratePct)] ?? 0.265;
  return Math.round(usd * EXCHANGE_RATE_YER * factor);
}

/* ===================== كشف النية العام ===================== */
function detectIntent(text) {
  const q = norm(text);
  for (const key of Object.keys(ITEM_INTENTS)) {
    if (q.includes(norm(key))) return ITEM_INTENTS[key];
  }
  // إن لم نجد، استنتج من وحدة الصنف الأقرب لاحقاً
  return null;
}

/* اختيار صنف رولات حسب النوع */
function refineRollItem(baseQuery, rollType) {
  if (!rollType) return null;
  const tokens = ROLLS_TYPES[rollType] || [];
  const q = `${baseQuery} ${tokens.join(" ")}`.trim();
  const found = fuse.search(q);
  if (!found.length) return null;
  for (const r of found) {
    const name = norm(r.item.name);
    if (tokens.some(t => name.includes(norm(t)))) return r.item;
  }
  return found[0].item;
}

/* ===================== البحث الذكي ===================== */
function smartFindItem(userQuery) {
  const q = norm(userQuery);

  // 0) فلترة سريعة: تطابق شبه مباشر
  let r0 = fuse.search(q);
  if (r0.length && r0[0].score <= 0.35) return r0[0].item;

  // 1) توسعة مرادفات + اشتقاقات
  const expanded = expandWithSynonyms(q).slice(0, 10);
  let best = null;
  for (const cand of expanded) {
    const rr = fuse.search(cand);
    if (rr.length) {
      const hit = rr[0];
      // نستخدم جاكارد 3-gram لتحسين القرار
      const j = jaccard3(cand, hit.item.name);
      const score = (1 - Math.min(hit.score ?? 1, 1)) * 0.7 + j * 0.3;
      if (!best || score > best._score) best = { item: hit.item, _score: score };
    }
  }
  if (best && best._score >= 0.45) return best.item;

  // 2) جاكارد مباشر على أسماء الكتالوج (ثقيل لكن آمن على قوائم متوسطة)
  let top = null;
  for (const it of CATALOG) {
    const j = jaccard3(q, it.name + " " + (it.notes||""));
    if (!top || j > top.j) top = { item: it, j };
  }
  if (top && top.j >= 0.36) return top.item;

  return null;
}

/* ===================== الحساب حسب الـ Slots ===================== */
function computeUSD(item, filled) {
  const unit = (item.unit || "pcs").toLowerCase();
  const price = Number(item.price || 0);
  if (!(price > 0)) return 0;

  if (filled.kind === "tv") {
    const inches = Number(filled.inches || 0);
    if (!(inches > 0)) return NaN;
    // لو السعر في الكتالوج للبوصة (سعر/بوصة) يستعمل price مباشرة
    return price ? inches * price : inches * (inches < 40 ? 3 : 4);
  }

  if (filled.kind === "pcs" || unit === "pcs") {
    if (filled.count && Number(filled.count) > 0) return Number(filled.count) * price;
    if (filled.cartons && filled.perCarton) return Number(filled.cartons) * Number(filled.perCarton) * price;
    return NaN;
  }

  if (filled.kind === "dz" || unit === "dz") {
    if (filled.cartons && filled.dzPerCarton) {
      const dozens = Number(filled.cartons) * Number(filled.dzPerCarton);
      return dozens * price;
    }
    if (filled.pieces) return (Number(filled.pieces) / 12) * price;
    return NaN;
  }

  if (filled.kind === "kgOrTon" || unit === "kg" || unit === "ton" || filled.kind === "rolls") {
    if (unit === "ton") {
      if (filled.kg)   return (Number(filled.kg)   / 1000) * price;
      if (filled.tons) return  Number(filled.tons)          * price;
    }
    if (unit === "kg") {
      if (filled.kg)   return  Number(filled.kg)            * price;
      if (filled.tons) return (Number(filled.tons) * 1000)  * price;
    }
    return NaN;
  }

  if (filled.kind === "batteryTypeAh" || unit === "ah") {
    if (!filled.batteryType) return NaN;
    if (unit === "ah" && filled.ah) return Number(filled.ah) * price;
    const count = Number(filled.count || 1);
    return count * price;
  }

  if (filled.qty) return Number(filled.qty) * price;
  return NaN;
}

function buildNextStepOrResult({ item, query, filled }) {
  let intent = detectIntent(item?.name || query);
  // محاولة استنتاج من الوحدة لو ما وُجد intent
  if (!intent) {
    const u = (item.unit||"").toLowerCase();
    if (u === "pcs") intent = { kind:"pcs" };
    else if (u === "dz") intent = { kind:"dz" };
    else if (u === "kg" || u === "ton") intent = { kind:"kgOrTon" };
  }

  if (intent?.kind === "tv" && !filled.inches) {
    return { ask: "كم بوصة للشاشة؟ (اكتب رقم مثل 32 أو 43)" };
  }

  if (intent?.kind === "pcs") {
    if (!filled.count && !(filled.cartons && filled.perCarton)) {
      return {
        ask: "أحسب بالحبة مباشرة أم بالكرتون؟",
        choices: [
          "بالحبة — اكتب: عدد = 24",
          "بالكرتون — اكتب: كراتين = 2 و حبات/كرتون = 12"
        ]
      };
    }
  }

  if (intent?.kind === "dz") {
    if (!(filled.cartons && filled.dzPerCarton) && !filled.pieces) {
      return {
        ask: "أحسب بالدرزن أم بالحبات؟",
        choices: [
          "درزن/كرتون — اكتب: كراتين = 3 و دزن/كرتون = 10",
          "بالحبات — اكتب: حبات = 120"
        ]
      };
    }
  }

  if (intent?.kind === "kgOrTon") {
    if (!filled.kg && !filled.tons) {
      return { ask: "تحب أحسب لك بالكيلو أم بالطن؟ (اكتب: كجم = 500 أو أطنان = 2)" };
    }
  }

  if (intent?.kind === "rolls") {
    if (!filled.rollType) {
      return { ask: "نوع الرولات؟ (شفافة أم مطبوعة)", choices: ["شفافة","مطبوعه"] };
    }
    if (!filled.kg && !filled.tons) {
      return { ask: "تحب أحسب لك بالكيلو أم بالطن؟ (اكتب: كجم = 500 أو أطنان = 2)" };
    }
  }

  const usd = computeUSD(item, { ...filled, kind: intent?.kind });
  if (!(usd > 0)) return { ask: "أحتاج تفاصيل أكثر لإكمال الحساب (أعد إدخال القيم بالنمط الموضح)." };

  const ratePct = parseRate(item.notes);
  const yer = usdToCustomsYer(usd, ratePct);
  return {
    result: {
      usd: Number(usd.toFixed(2)),
      ratePct,
      yer,
      exchange: EXCHANGE_RATE_YER,
      factor: CUSTOMS_FACTORS[String(ratePct)] ?? 0.265,
      item: { name: item.name, unit: item.unit, notes: item.notes, price: item.price }
    }
  };
}

/* ===================== API ===================== */

app.get("/api/ping", (_req,res)=>res.json({ok:true, ts:Date.now(), items:CATALOG.length}));

app.post("/api/ask", async (req, res) => {
  try {
    let { query, filled = {} } = req.body || {};
    if (!query) return res.status(400).json({ error: "query required" });

    const item0 = smartFindItem(query);

    // fallback خاص بالشاشات لو ما وُجد صنف بالكتالوج
    if (!item0) {
      const intent0 = detectIntent(query);
      if (intent0?.kind === "tv") {
        const tvItem = { name: "شاشات (سعر/بوصة ديناميكي)", unit: "inch", price: 0, notes: "الفئة5%" };
        const step = buildNextStepOrResult({ item: tvItem, query, filled });
        if (step.ask) return res.json({ ask: step.ask, choices: step.choices || null, matched: tvItem.name });
        const r = step.result;
        const text =
          `السعر التقديري: ${r.usd}$ ⇒ رسوم تقريبية: ${r.yer.toLocaleString()} ريال يمني (فئة ${r.ratePct}%).\n` +
          `استخدمت: سعر الصرف ${r.exchange} × معامل ${r.factor}.\n` +
          `الصنف: ${r.item.name} — الوحدة: ${r.item.unit}.`;
        return res.json({ reply: text, openCalcUrl: `/index.html?price=${encodeURIComponent(r.usd)}&qty=1&ratePct=${r.ratePct}` });
      }
      // اقتراحات إن أمكن
      const sugg = fuse.search(norm(query)).slice(0,3).map(r=>r.item?.name).filter(Boolean);
      if (sugg.length) return res.json({ reply:"اختر الأقرب:", suggest: sugg });
      return res.json({ reply:"لم أجد هذا الصنف في القائمة. افتح قائمة الأسعار أو جرّب اسمًا أقرب." });
    }

    let item = item0;
    // تخصيص الرولات حسب النوع
    const intent = detectIntent(query);
    if (intent?.kind === "rolls" && filled.rollType) {
      const refined = refineRollItem(query, filled.rollType);
      if (refined) item = refined;
    }

    const step = buildNextStepOrResult({ item, query, filled });
    if (step.ask) return res.json({ ask: step.ask, choices: step.choices || null, matched: item.name });

    const r = step.result;
    const text =
      `السعر التقديري: ${r.usd}$ ⇒ رسوم تقريبية: ${r.yer.toLocaleString()} ريال يمني (فئة ${r.ratePct}%).\n` +
      `استخدمت: سعر الصرف ${r.exchange} × معامل ${r.factor}.\n` +
      `الصنف: ${r.item.name} — الوحدة: ${r.item.unit}.`;

    return res.json({
      reply: text,
      openCalcUrl: `/index.html?price=${encodeURIComponent(r.usd)}&qty=1&ratePct=${r.ratePct}`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("AI server on", PORT));
