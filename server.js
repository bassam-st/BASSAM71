// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import Fuse from "fuse.js";
import fs from "fs";

import {
  CALCULATOR_URL,
  EXCHANGE_RATE_YER,
  CUSTOMS_FACTORS,
  SYNONYMS
} from "./config.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// ==== تحميل ملف الأسعار المحلي ====

const pricesPath = "./prices/fallback_prices_catalog.json";
let CATALOG = [];

function loadCatalog() {
  try {
    const raw = fs.readFileSync(pricesPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      CATALOG = parsed;
      console.log("Loaded prices catalog:", CATALOG.length, "items");
    } else {
      console.error("Catalog JSON is not an array");
    }
  } catch (e) {
    console.error("Failed to load catalog file:", e.message);
    CATALOG = [];
  }
}

loadCatalog();

// إعداد Fuse للبحث التقريبي
const fuse = new Fuse(CATALOG, {
  keys: ["name", "notes"],
  includeScore: true,
  threshold: 0.4,   // يسمح بأخطاء بسيطة في الاسم
  distance: 100
});

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// تطبيق المرادفات على نص السؤال
function applySynonyms(text) {
  const words = norm(text).split(" ");
  return words
    .map((w) => (SYNONYMS[w] ? SYNONYMS[w] : w))
    .join(" ");
}

// التقاط الفئة الجمركية من الملاحظات
function parseRate(notes = "") {
  const s = notes.replace(/\s+/g, "");
  if (/الفئة?10%|10%/i.test(s)) return 10;
  if (/الفئة?5%|5%/i.test(s)) return 5;
  return 10; // افتراضيًا 10%
}

// تحويل سعر بالدولار إلى رسوم تقريبية بالريال اليمني
function usdToCustomsYer(usd, ratePct) {
  const factor = CUSTOMS_FACTORS[String(ratePct)] ?? 0.265;
  const yer = usd * EXCHANGE_RATE_YER * factor;
  return Math.round(yer);
}

// ========== مسارات API ==========

// لفحص أن الخادم شغال
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, items: CATALOG.length });
});

// سؤال الذكاء الاصطناعي
app.post("/api/ask", (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: "query required" });
    }

    if (!CATALOG.length) {
      return res.json({
        reply:
          "قائمة الأسعار غير محمّلة على الخادم. تأكد أن ملف الأسعار موجود ثم أعد المحاولة."
      });
    }

    // نطبّق المرادفات ثم نبحث
    const qSyn = applySynonyms(query);
    const found = fuse.search(qSyn);

    if (!found.length || found[0].score > 0.55) {
      return res.json({
        reply:
          "لم أجد هذا الصنف في القائمة. جرّب اسمًا أقرب أو افتح قائمة الأسعار في التطبيق الأساسي."
      });
    }

    const item = found[0].item;
    const ratePct = parseRate(item.notes);
    const usd = Number(item.price || 0);
    if (!(usd > 0)) {
      return res.json({
        reply:
          "وجدت الصنف في القائمة لكن سعره غير معروف. عدّل السعر من التطبيق الأساسي ثم أعد المحاولة."
      });
    }

    const yer = usdToCustomsYer(usd, ratePct);

    const text =
      `الصنف الأقرب لطلبك: ${item.name}\n` +
      `السعر المسجّل: ${usd}$ للوحدة (${item.unit || "وحدة"}).\n` +
      `الفئة الجمركية: ${ratePct}% (معامل ${CUSTOMS_FACTORS[String(ratePct)]}).\n` +
      `الرسوم التقريبية لوحدة واحدة: ${yer.toLocaleString()} ريال يمني.\n\n` +
      `🔢 إذا تريد تحسب عدة كراتين أو درازن أو أطنان، افتح الحاسبة الأصلية واضبط الكمية هناك.\n` +
      `رابط الحاسبة: ${CALCULATOR_URL}`;

    return res.json({
      reply: text,
      matchedItem: {
        name: item.name,
        price: item.price,
        unit: item.unit,
        notes: item.notes
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// تشغيل الخادم
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("AI customs assistant server running on port", PORT);
});
