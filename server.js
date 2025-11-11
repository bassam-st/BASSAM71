import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import Fuse from "fuse.js";
import fs from "fs";
import path from "path";
import {
  SIMPLE_MODE,
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

/* ===== تحميل الكاتالوج ===== */
const pricesPath = "./prices/fallback_prices_catalog.json";
let CATALOG = [];
try {
  const raw = fs.readFileSync(pricesPath, "utf8");
  CATALOG = JSON.parse(raw);
} catch { CATALOG = []; }

/* ===== أدوات مساعدة ===== */
const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

function applySynonyms(q) {
  const w = norm(q).split(" ");
  return w.map(t => (SYNONYMS[t] ? SYNONYMS[t] : t)).join(" ");
}

function parseRate(notes = "") {
  const s = String(notes || "").replace(/\s+/g, "");
  if (/الفئة?10%|10%/i.test(s)) return 10;
  if (/الفئة?5%|5%/i.test(s)) return 5;
  return 10;
}

function usdToCustomsYer(usd, ratePct) {
  const factor = CUSTOMS_FACTORS[String(ratePct)] ?? 0.265;
  return Math.round(usd * EXCHANGE_RATE_YER * factor);
}

let fuse = new Fuse(CATALOG, {
  keys: ["name", "notes"],
  includeScore: true,
  threshold: 0.32,
  distance: 80
});

function detectIntent(text) {
  const q = norm(text);
  for (const key of Object.keys(ITEM_INTENTS)) {
    if (q.includes(norm(key))) return ITEM_INTENTS[key];
  }
  return null;
}

function grabNumber(pattern, text){
  const m = text.match(pattern);
  return m ? Number(m[1].replace(/[^\d.]/g,'')) : null;
}

// يلتقط أرقامًا حرّة من نص السؤال
function autoFillFromFreeText(q, filled){
  const t = " " + q + " ";
  const cartons = grabNumber(/(\d+(?:\.\d+)?)\s*(?:كرتون|كراتين)/i, t);
  const pcs     = grabNumber(/(\d+(?:\.\d+)?)\s*(?:حبه|حبات|قطعه|قطع)/i, t);
  const kg      = grabNumber(/(\d+(?:\.\d+)?)\s*(?:كجم|كيلو|kg)/i, t);
  const tons    = grabNumber(/(\d+(?:\.\d+)?)\s*(?:طن|t|ton)/i, t);
  const inches  = grabNumber(/(\d+(?:\.\d+)?)\s*(?:بوصه|بوصة|inch|in)/i, t);
  const ah      = grabNumber(/(\d+(?:\.\d+)?)\s*(?:ah|أمبير)/i, t);

  if (cartons) filled.cartons = cartons;
  if (pcs)     filled.count   = pcs;
  if (kg)      filled.kg      = kg;
  if (tons)    filled.tons    = tons;
  if (inches)  filled.inches  = inches;
  if (ah)      filled.ah      = ah;

  if (/(شفاف|شفافة)/i.test(t)) filled.rollType = "transparent";
  if (/مطبوع/i.test(t))        filled.rollType = "printed";

  if (/ليثيوم/i.test(t)) filled.batteryType = "li-ion";
  if (/(رصاص|أسيد|اسيد|acid)/i.test(t)) filled.batteryType = "lead";

  return filled;
}

// اختيار صنف رولات أدقّ حسب النوع
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

function computeUSD(item, filled) {
  const unit  = item.unit || "pcs";
  const price = Number(item.price || 0);

  // شاشات: سعر/بوصة ديناميكي 3$ (<40) أو 4$ (>=40)
  if (filled.kind === "tv") {
    const inches = Number(filled.inches || 0);
    if (!(inches > 0)) return NaN;
    const ppi = inches < 40 ? 3 : 4;
    return inches * ppi;
  }

  if (filled.kind === "pcs") {
    if (filled.count && Number(filled.count) > 0) return Number(filled.count) * price;
    if (filled.cartons && filled.perCarton) {
      return Number(filled.cartons) * Number(filled.perCarton) * price;
    }
    return NaN;
  }

  if (unit === "dz" || filled.kind === "dz") {
    if (filled.cartons && filled.dzPerCarton) {
      const dozens = Number(filled.cartons) * Number(filled.dzPerCarton);
      return dozens * price;
    }
    if (filled.pieces) return (Number(filled.pieces) / 12) * price;
    return NaN;
  }

  // وزن (كجم/طن) — مثل الحديد/الرولات
  if (filled.kind === "kgOrTon" || unit === "kg" || unit === "ton" || filled.kind === "rolls") {
    if (unit === "ton") {
      if (filled.kg)   return (Number(filled.kg) / 1000) * price;
      if (filled.tons) return Number(filled.tons) * price;
    }
    if (unit === "kg") {
      if (filled.kg)   return Number(filled.kg) * price;
      if (filled.tons) return Number(filled.tons) * 1000 * price;
    }
    return NaN;
  }

  if (filled.kind === "batteryTypeAh") {
    if (!filled.batteryType || !(filled.ah > 0) && !(filled.count > 0)) return NaN;
    if (unit.toLowerCase() === "ah" && filled.ah) return Number(filled.ah) * price;
    const count = Number(filled.count || 1);
    return count * price;
  }

  if (filled.qty) return Number(filled.qty) * price;
  return NaN;
}

function buildNextStepOrResult({ item, query, filled }) {
  const intent = detectIntent(item?.name || query) || { kind: null };

  if (intent.kind === "tv" && !filled.inches) {
    return { ask: "كم بوصة للشاشة؟ (اكتب رقم مثل 32 أو 43)" };
  }

  if (intent.kind === "pcs") {
    if (SIMPLE_MODE){
      if (filled.cartons && !filled.perCarton) filled.perCarton = 12;
    }
    if (!filled.count && !(filled.cartons && filled.perCarton)) {
      return {
        ask: "أحسب بالحبة أم بالكرتون؟",
        choices: ["بالحبة — اكتب: عدد الحبات = 24", "بالكرتون — اكتب: الكراتين = 2 و الحبات/كرتون = 12"]
      };
    }
  }

  if (intent.kind === "dz") {
    if (SIMPLE_MODE && filled.cartons && !filled.dzPerCarton) filled.dzPerCarton = 10;
    if (!(filled.cartons && filled.dzPerCarton) && !filled.pieces) {
      return {
        ask: "أحسب بالدرزن أم بالحبات؟",
        choices: ["بالدرزن — اكتب: الكراتين = 3 و الدزن/كرتون = 10", "بالحبات — اكتب: الحبات = 120"]
      };
    }
  }

  if (intent.kind === "kgOrTon") {
    if (!filled.kg && !filled.tons) {
      return { ask: "بالكيلو أم بالطن؟ (اكتب: 500 كجم أو 2 طن)" };
    }
  }

  if (intent.kind === "rolls") {
    if (!filled.rollType) {
      return { ask: "نوع الرولات؟", choices: ["شفافة","مطبوعه"] };
    }
    if (!filled.kg && !filled.tons) {
      return { ask: "بالكيلو أم بالطن؟ (اكتب: 500 كجم أو 1 طن)" };
    }
  }

  if (intent.kind === "batteryTypeAh") {
    if (SIMPLE_MODE && !filled.batteryType && /ليثيوم/i.test(query)) filled.batteryType = "li-ion";
    if (!filled.batteryType) {
      return { ask: "نوع البطاريات؟", choices: ["ليثيوم","رصاص/أسيد"] };
    }
    if (!filled.ah && !filled.count) {
      return { ask: "اكتب السعة بالأمبير/ساعة (مثال 100Ah) أو عدد القطع." };
    }
  }

  const usd = computeUSD(item, { ...filled, kind: intent.kind });
  if (!(usd > 0)) return { ask: "أحتاج تفاصيل أكثر لإكمال الحساب." };

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

/* ===== API ===== */
app.get("/api/ping", (_req, res) => res.json({ ok: true, time: Date.now() }));

app.post("/api/ask", (req, res) => {
  try {
    let { query, filled = {} } = req.body || {};
    if (!query) return res.status(400).json({ error: "query required" });

    const qSyn = applySynonyms(query);
    filled = autoFillFromFreeText(qSyn, filled || {});

    let found = fuse.search(qSyn);
    if (!found.length || found[0].score > 0.45) {
      const cand = fuse.search(qSyn).slice(0,3).map(r=>r.item?.name).filter(Boolean);
      if (cand.length){
        return res.json({ reply: "اختر الأقرب مما يلي:", suggest: cand });
      }
      return res.json({ reply: "لم أجد هذا الصنف. افتح قائمة الأسعار أو جرّب اسمًا أقرب." });
    }

    let item = found[0].item;

    const intent = detectIntent(qSyn);
    if (intent?.kind === "rolls" && filled.rollType) {
      const refined = refineRollItem(qSyn, filled.rollType);
      if (refined) item = refined;
    }

    const step = buildNextStepOrResult({ item, query: qSyn, filled });
    if (step.ask) return res.json({ ask: step.ask, choices: step.choices || null, matched: item.name });

    const r = step.result;
    const text =
      `السعر التقديري: ${r.usd}$ ⇒ الرسوم التقريبية: ${r.yer.toLocaleString()} ريال يمني (فئة ${r.ratePct}%).\n` +
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

/* ===== تشغيل ===== */
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log("AI server on", PORT));
