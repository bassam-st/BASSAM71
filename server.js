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

// قراءة الأسعار من ملف داخلي
const pricesPath = "./prices/prices_catalog.json";

let CATALOG = [];
try {
  const raw = fs.readFileSync(pricesPath, "utf8");
  CATALOG = JSON.parse(raw);
  console.log("Loaded Prices:", CATALOG.length);
} catch (err) {
  console.error("Error loading prices:", err);
}

// تجهيز محرك البحث FUSE
const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

function applySynonyms(q) {
  const words = norm(q).split(" ");
  return words.map(w => SYNONYMS[w] || w).join(" ");
}

let fuse = new Fuse(CATALOG, {
  keys: ["name", "notes"],
  includeScore: true,
  threshold: 0.35,
  distance: 100
});

// تحليل نية المستخدم
function detectIntent(q) {
  q = norm(q);
  for (const k of Object.keys(ITEM_INTENTS)) {
    if (q.includes(norm(k))) return ITEM_INTENTS[k];
  }
  return null;
}

// حساب السعر
function parseRate(notes = "") {
  const s = notes.replace(/\s+/g, "");
  if (/10%|الفئة10%/i.test(s)) return 10;
  if (/5%|الفئة5%/i.test(s)) return 5;
  return 10;
}

function usdToYer(usd, pct) {
  const factor = CUSTOMS_FACTORS[String(pct)] || 0.265;
  return Math.round(usd * EXCHANGE_RATE_YER * factor);
}

// الحساب حسب نوع الصنف
function computeUSD(item, filled, kind) {
  const price = Number(item.price || 0);

  if (kind === "tv") {
    if (!filled.inches) return NaN;
    return price * filled.inches;
  }

  if (kind === "pcs") {
    if (!filled.count) return NaN;
    return filled.count * price;
  }

  if (kind === "dz") {
    if (!filled.cartons || !filled.dzPerCarton) return NaN;
    const dozens = filled.cartons * filled.dzPerCarton;
    return dozens * price;
  }

  if (kind === "kgOrTon") {
    if (!filled.kg) return NaN;
    return (filled.kg / 1000) * price;
  }

  return NaN;
}

app.post("/api/ask", (req, res) => {
  try {
    const { query, filled = {} } = req.body;
    if (!query) return res.json({ reply: "اكتب السؤال من فضلك." });

    let q = applySynonyms(query);
    const results = fuse.search(q);

    if (!results.length || results[0].score > 0.5) {
      return res.json({
        reply: "لم أجد هذا الصنف في القائمة. افتح قائمة الأسعار في التطبيق الأساسي."
      });
    }

    const item = results[0].item;
    const intent = detectIntent(q);

    if (!intent) {
      return res.json({ reply: "اكتب اسم الصنف بشكل أوضح." });
    }

    // أسئلة توضيحية قبل الحساب
    if (intent.kind === "tv" && !filled.inches) {
      return res.json({ ask: "كم بوصة للشاشة؟ مثال: 32 أو 43" });
    }

    if (intent.kind === "pcs" && !filled.count) {
      return res.json({ ask: "اكتب عدد الحبات. مثال: الحبات = 24" });
    }

    if (intent.kind === "dz" && (!filled.cartons || !filled.dzPerCarton)) {
      return res.json({
        ask: "أحسب بالحبة أم بالكرتون؟",
        choices: [
          "بالحبات — اكتب: الحبات = 120",
          "بالكراتين — اكتب: الكراتين = 3 و الدزن/كرتون = 10"
        ]
      });
    }

    if (intent.kind === "kgOrTon" && !filled.kg) {
      return res.json({ ask: "اكتب الوزن بالكيلو. مثال: كجم = 500" });
    }

    // حساب
    const usd = computeUSD(item, filled, intent.kind);
    if (!usd || usd <= 0) return res.json({ reply: "أحتاج تفاصيل أكثر لإكمال الحساب." });

    const pct = parseRate(item.notes);
    const yer = usdToYer(usd, pct);

    return res.json({
      reply:
        `السعر التقديري: ${usd}$ — الرسوم: ${yer} ريال يمني (فئة ${pct}%).\n` +
        `الصنف: ${item.name} — الوحدة: ${item.unit}.`
    });
  } catch (err) {
    console.error(err);
    res.json({ reply: "حدث خطأ في الخادم." });
  }
});

app.get("/api/ping", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("AI running on", PORT));
