// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import Fuse from "fuse.js";
import fs from "fs";
import fetch from "node-fetch";
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

// ===== تحميل كتالوج الأسعار من تطبيقك الأساسي =====
const REMOTE_URL =
  process.env.PRICE_CATALOG_URL ||
  "https://bassam-customs-calculator.onrender.com/assets/prices_catalog.json";

const LOCAL_FALLBACK = "./prices/fallback_prices_catalog.json";

let CATALOG = [];
let fuse = null;

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[ًٌٍَُِّْٰ]/g, "")       // إزالة التشكيل
    .replace(/\s+/g, " ")
    .trim();
}

function applySynonyms(q) {
  const words = norm(q).split(" ");
  return words.map(w => SYNONYMS[w] || w).join(" ");
}

function buildFuse() {
  fuse = new Fuse(CATALOG, {
    keys: ["name", "notes", "unit"],
    includeScore: true,
    threshold: 0.32,
    distance: 80,
    ignoreLocation: true
  });
}

async function loadCatalog() {
  try {
    const r = await fetch(REMOTE_URL, { timeout: 15000 });
    if (!r.ok) throw new Error(`remote ${r.status}`);
    CATALOG = await r.json();
  } catch (e) {
    // رجوع للنسخة المحلية
    try {
      CATALOG = JSON.parse(fs.readFileSync(LOCAL_FALLBACK, "utf8"));
    } catch {
      CATALOG = [];
    }
  }
  buildFuse();
  console.log(`[catalog] loaded: ${CATALOG.length} items`);
}

// تحميل أولي + تحديث دوري
await loadCatalog();
setInterval(loadCatalog, 10 * 60 * 1000);

// ===== أدوات الحساب =====
function parseRate(notes = "") {
  const s = notes.replace(/\s+/g, "");
  if (/الفئة?10%|10%/i.test(s)) return 10;
  if (/الفئة?5%|5%/i.test(s)) return 5;
  return 10; // افتراضي
}

function usdToCustomsYer(usd, ratePct) {
  const factor = CUSTOMS_FACTORS[String(ratePct)] ?? 0.265;
  return Math.round(Number(usd || 0) * EXCHANGE_RATE_YER * factor);
}

function detectIntent(text) {
  const q = norm(text);
  for (const key of Object.keys(ITEM_INTENTS)) {
    if (q.includes(norm(key))) return ITEM_INTENTS[key];
  }
  return null;
}

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
  const unit = (item.unit || "").toLowerCase();
  const price = Number(item.price || 0);
  if (!(price > 0)) return 0;

  // تلفزيونات بالبوصة
  if (filled.kind === "tv") {
    const inches = Number(filled.inches || 0);
    if (!(inches > 0)) return NaN;
    return inches * price;
  }

  // قطع/كراتين
  if (filled.kind === "pcs") {
    if (filled.count && Number(filled.count) > 0) return Number(filled.count) * price;
    if (filled.cartons && filled.perCarton) {
      return Number(filled.cartons) * Number(filled.perCarton) * price;
    }
    return NaN;
  }

  // ملابس: درزن/حبات
  if (filled.kind === "dz" || unit === "dz") {
    if (filled.cartons && filled.dzPerCarton) {
      const dozens = Number(filled.cartons) * Number(filled.dzPerCarton);
      return dozens * price;
    }
    if (filled.pieces) return (Number(filled.pieces) / 12) * price;
    return NaN;
  }

  // وزن
  if (filled.kind === "kgOrTon" || unit === "kg" || unit === "ton" || filled.kind === "rolls") {
    if (unit === "ton") {
      if (filled.kg) return (Number(filled.kg) / 1000) * price;
      if (filled.tons) return Number(filled.tons) * price;
    }
    if (unit === "kg") {
      if (filled.kg) return Number(filled.kg) * price;
      if (filled.tons) return Number(filled.tons) * 1000 * price;
    }
    // لو وحدة الكتالوج غير محددة لكن النية وزن
    if (!unit) {
      if (filled.kg) return Number(filled.kg) * price;
      if (filled.tons) return Number(filled.tons) * 1000 * price;
    }
    return NaN;
  }

  // بطاريات (Ah)
  if (filled.kind === "batteryTypeAh") {
    if (!filled.batteryType) return NaN;
    if (unit === "ah") {
      if (filled.ah > 0) return Number(filled.ah) * price;
      return NaN;
    }
    const count = Number(filled.count || 1);
    return count * price;
  }

  // افتراضي
  if (filled.qty) return Number(filled.qty) * price;
  return NaN;
}

function buildNextStepOrResult({ item, query, filled }) {
  const intent = detectIntent(item?.name || query) || { kind: null };

  // أسئلة تكميلية حسب النية:
  if (intent.kind === "tv" && !filled.inches) {
    return { ask: "كم بوصة للشاشة؟ (اكتب رقم مثل 32 أو 43)" };
  }

  if (intent.kind === "pcs") {
    if (!filled.count && !(filled.cartons && filled.perCarton)) {
      return {
        ask: "أحسب بالحبة مباشرة أم بالكرتون؟",
        choices: [
          "بالحبة — اكتب: عدد الحبات = 24",
          "بالكرتون — اكتب: الكراتين = 2 و الحبات/كرتون = 12"
        ]
      };
    }
  }

  if (intent.kind === "dz") {
    if (!(filled.cartons && filled.dzPerCarton) && !filled.pieces) {
      return {
        ask: "أحسب بالدرزن أم بالحبات؟",
        choices: [
          "بالكرتون/درزن — اكتب: الكراتين = 3 و الدزن/كرتون = 10",
          "بالحبات — اكتب: الحبات = 120"
        ]
      };
    }
  }

  if (intent.kind === "kgOrTon") {
    if (!filled.kg && !filled.tons) {
      return { ask: "أحسب لك بالكيلو أم بالطن؟ (اكتب: كجم = 500 أو أطنان = 2)" };
    }
  }

  if (intent.kind === "rolls") {
    if (!filled.rollType) {
      return {
        ask: "نوع الرولات؟ (شفافة أم مطبوعة)",
        choices: ["شفافة", "مطبوعه"]
      };
    }
    if (!filled.kg && !filled.tons) {
      return { ask: "أحسب بالكيلو أم بالطن؟ (اكتب: كجم = 500 أو أطنان = 2)" };
    }
  }

  if (intent.kind === "batteryTypeAh") {
    if (!filled.batteryType) {
      return { ask: "نوع البطاريات؟ (ليثيوم أم رصاص/أسيد قابلة للصيانة)" };
    }
    if (!(filled.ah > 0) && !filled.count) {
      return {
        ask: "كم سعة البطارية بالأمبير/ساعة (Ah) أو كم عدد الحبات؟",
        choices: ["Ah — اكتب: أمبير = 200", "عدد — اكتب: عدد = 4"]
      };
    }
  }

  // الحساب
  const usd = computeUSD(item, { ...filled, kind: intent.kind });
  if (!(usd > 0)) {
    return { ask: "أحتاج تفاصيل أكثر لإكمال الحساب (أعد إدخال القيم بالنمط الموضح)." };
  }
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

// ===== API =====
app.get("/api/ping", (req, res) =>
  res.json({ ok: true, catalog: CATALOG.length, fx: EXCHANGE_RATE_YER })
);

app.post("/api/ask", (req, res) => {
  try {
    let { query, filled = {} } = req.body || {};
    if (!query) return res.status(400).json({ error: "query required" });

    const qSyn = applySynonyms(query);
    const results = fuse.search(qSyn);
    if (!results.length || results[0].score > 0.45) {
      return res.json({
        reply:
          "لم أجد هذا الصنف في القائمة. جرّب اسمًا أقرب أو افتح قائمة الأسعار في التطبيق الأساسي.",
        nearest: results.slice(0, 3).map(r => r.item.name)
      });
    }

    let item = results[0].item;

    // تخصيص للرولات
    const intent = detectIntent(qSyn);
    if (intent?.kind === "rolls" && filled.rollType) {
      const refined = refineRollItem(qSyn, filled.rollType);
      if (refined) item = refined;
    }

    const step = buildNextStepOrResult({ item, query: qSyn, filled });
    if (step.ask) {
      return res.json({ ask: step.ask, choices: step.choices || null, matched: item.name });
    }

    const r = step.result;
    const text =
      `السعر التقديري: ${r.usd}$ ⇒ رسوم تقريبية: ${r.yer.toLocaleString()} ريال يمني (فئة ${r.ratePct}%).\n` +
      `استخدمت: سعر الصرف ${r.exchange} × معامل ${r.factor}.\n` +
      `الصنف: ${r.item.name} — الوحدة: ${r.item.unit || "-"} (السعر: ${r.item.price} USD).`;

    return res.json({
      reply: text,
      openCalcUrl:
        `${process.env.CALCULATOR_URL || "https://bassam-customs-calculator.onrender.com"}` +
        `/index.html?price=${encodeURIComponent(r.usd)}&qty=1&ratePct=${r.ratePct}`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("AI server on", PORT));
