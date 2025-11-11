import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import Fuse from "fuse.js";
import fs from "fs";
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

const pricesPath = "./prices/fallback_prices_catalog.json";
let CATALOG = [];
try {
  const raw = fs.readFileSync(pricesPath, "utf8");
  CATALOG = JSON.parse(raw);
} catch (e) {
  CATALOG = [];
}

const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

function applySynonyms(q) {
  const w = norm(q).split(" ");
  return w.map(t => (SYNONYMS[t] ? SYNONYMS[t] : t)).join(" ");
}

function parseRate(notes = "") {
  const s = notes.replace(/\s+/g, "");
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

// -- NEW: اختيار صنف الرولات حسب النوع (شفافة/مطبوعه)
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
  const unit = item.unit || "pcs";
  const price = Number(item.price || 0);
  if (!(price > 0)) return 0;

  if (filled.kind === "tv") {
    const inches = Number(filled.inches || 0);
    if (!(inches > 0)) return NaN;
    return inches * price;
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

  // وزن (كجم/طن) — الرولات في قائمتك عادة للطن
  if (filled.kind === "kgOrTon" || unit === "kg" || unit === "ton" || filled.kind === "rolls") {
    if (unit === "ton") {
      if (filled.kg) return (Number(filled.kg) / 1000) * price;
      if (filled.tons) return Number(filled.tons) * price;
    }
    if (unit === "kg") {
      if (filled.kg) return Number(filled.kg) * price;
      if (filled.tons) return Number(filled.tons) * 1000 * price;
    }
    return NaN;
  }

  if (filled.kind === "batteryTypeAh") {
    if (!filled.batteryType || !(filled.ah > 0)) return NaN;
    if (unit.toLowerCase() === "ah") return Number(filled.ah) * price;
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
      return { ask: "تحب أحسب لك بالكيلو أم بالطن؟ (اكتب: كجم = 500 أو أطنان = 2)" };
    }
  }

  // NEW: رولات — نحتاج النوع أولاً، ثم الوزن
  if (intent.kind === "rolls") {
    if (!filled.rollType) {
      return {
        ask: "نوع الرولات؟ (شفافة أم مطبوعة)",
        choices: ["شفافة", "مطبوعه"]
      };
    }
    if (!filled.kg && !filled.tons) {
      return { ask: "تحب أحسب لك بالكيلو أم بالطن؟ (اكتب: كجم = 500 أو أطنان = 2)" };
    }
  }

  // نحسب
  const usd = computeUSD(item, { ...filled, kind: intent.kind });
  if (!(usd > 0)) {
    return { ask: "أحتاج تفاصيل أكثر لإكمال الحساب (أعد كتابة القيم بالنمط الموضح)." };
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

app.post("/api/ask", (req, res) => {
  try {
    let { query, filled = {} } = req.body || {};
    if (!query) return res.status(400).json({ error: "query required" });

    const qSyn = applySynonyms(query);
    let found = fuse.search(qSyn);
    if (!found.length || found[0].score > 0.45) {
      return res.json({ reply: "لم أجد هذا الصنف في القائمة. جرّب اسمًا أقرب أو افتح قائمة الأسعار." });
    }

    let item = found[0].item;

    // NEW: لو السؤال عن "رولات" ومعك rollType، نعيد الاختيار لصنف مطابق (شفافة/مطبوعه)
    const intent = detectIntent(qSyn);
    if (intent?.kind === "rolls" && filled.rollType) {
      const refined = refineRollItem(qSyn, filled.rollType);
      if (refined) item = refined;
    }

    const step = buildNextStepOrResult({ item, query: qSyn, filled });
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

/* ==== الإضافات المطلوبة ==== */
// فحص الصحة/إيقاظ الخدمة
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// مُعالج أخطاء عام
app.use((err, req, res, next) => {
  console.error("ERR:", err);
  res.status(500).json({ error: "server error" });
});

// تشغيل الخادم (يحترم PORT من Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("AI server on", PORT));
