// server.js — نسخة مطوّرة

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import Fuse from "fuse.js";
import fs from "fs";

import {
  CALCULATOR_URL,
  EXCHANGE_RATE_YER,
  CUSTOMS_FACTORS,
  SYNONYMS,
  FILTER_KEYWORDS
} from "./config.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// ================== أدوات مساعدة عامة ==================

const toLatinDigits = (s) =>
  String(s).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

const norm = (s) =>
  toLatinDigits(String(s || ""))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function loadCatalogFile(path) {
  try {
    const raw = fs.readFileSync(path, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    console.error("Catalog JSON is not array");
    return [];
  } catch (e) {
    console.error("Cannot load prices catalog:", e.message);
    return [];
  }
}

// ================== تحميل قائمة الأسعار ==================

const pricesPath = "./prices/fallback_prices_catalog.json";
let CATALOG = loadCatalogFile(pricesPath);

console.log("Loaded catalog items:", CATALOG.length);

let fuse = new Fuse(CATALOG, {
  keys: ["name", "notes"],
  includeScore: true,
  threshold: 0.45,
  distance: 150
});

// ================== تحليل النص (مرادفات + فلاتر خاصة) ==================

function applySynonymsText(text) {
  const words = norm(text).split(" ");
  return words
    .map((w) => (SYNONYMS[w] ? SYNONYMS[w] : w))
    .join(" ");
}

function detectFilters(tokens) {
  const activeFilters = [];
  for (const fk of FILTER_KEYWORDS) {
    if (fk.words.some((w) => tokens.includes(norm(w)))) {
      activeFilters.push(fk.mustInclude.toLowerCase());
    }
  }
  return activeFilters;
}

// ================== تحليل الكمية والوحدة من سؤال المستخدم ==================

function parseQuantityFromQuery(query, itemUnit) {
  const s = norm(query);
  let mult = 1; // عدد الوحدات اللي بنضربها في السعر
  let note = "";
  const unit = (itemUnit || "").toLowerCase();

  // أرقام من السؤال
  const patterns = [
    { re: /(\d+)\s*(طن|اطنان|أطنان|طنن)/, type: "tons" },
    { re: /(\d+)\s*(كيلو|كجم|كغ|كج)/, type: "kg" },
    { re: /(\d+)\s*(درزن|دزن)/, type: "dz" },
    { re: /(\d+)\s*(كرتون|كراتين|كرتين)/, type: "carton" },
    { re: /(\d+)\s*(حبه|حبة|حبات)/, type: "pcs" },
    { re: /(\d+)\s*(ah|امبير|أمبير)/, type: "ah" }
  ];

  let matchType = null;
  let value = null;

  for (const p of patterns) {
    const m = s.match(p.re);
    if (m) {
      value = Number(m[1]);
      matchType = p.type;
      break;
    }
  }

  if (!matchType || !value) {
    note = "لم أتعرف على كمية واضحة في سؤالك، اعتبرت الكمية = 1 وحدة فقط.";
    return { mult: 1, note };
  }

  // منطق التحويل حسب وحدة السعر في القائمة
  switch (unit) {
    case "ton":
      if (matchType === "tons") {
        mult = value;
        note = `حسبت ${value} طن كما في سؤالك.`;
      } else if (matchType === "kg") {
        mult = value / 1000;
        note = `ذكرت ${value} كجم، وحولتها إلى ${mult} طن (١ طن = ١٠٠٠ كجم).`;
      } else {
        mult = value;
        note = `اعتبرت الكمية = ${value} طن (بناءً على سؤالك).`;
      }
      break;

    case "kg":
      if (matchType === "kg") {
        mult = value;
        note = `حسبت ${value} كجم كما في سؤالك.`;
      } else if (matchType === "tons") {
        mult = value * 1000;
        note = `ذكرت ${value} طن، وحولتها إلى ${mult} كجم (١ طن = ١٠٠٠ كجم).`;
      } else {
        mult = value;
        note = `اعتبرت الكمية = ${value} كجم (بناءً على سؤالك).`;
      }
      break;

    case "dz":
      if (matchType === "dz") {
        mult = value;
        note = `حسبت ${value} درزن كما في سؤالك.`;
      } else if (matchType === "carton") {
        mult = value; // نفترض كل كرتون = ١ درزن
        note =
          `ذكرت ${value} كرتون، وافترضت أن كل كرتون ≈ ١ درزن ` +
          "(عدّل من الحاسبة الأساسية إذا كان عدد الدرزن مختلف).";
      } else {
        mult = value;
        note = `اعتبرت الكمية = ${value} درزن.`;
      }
      break;

    case "pcs":
      if (matchType === "pcs") {
        mult = value;
        note = `حسبت ${value} حبة كما في سؤالك.`;
      } else if (matchType === "carton") {
        mult = value; // نفترض كرتون ≈ حبة واحدة إذا ما عرفنا غير كذا
        note =
          `ذكرت ${value} كرتون، ولم أعرف عدد الحبات/كرتون، ` +
          "لذلك اعتبرت الكرتون ≈ وحدة واحدة (عدّل من الحاسبة الأساسية إذا ترغب بدقة أعلى).";
      } else {
        mult = value;
        note = `اعتبرت الكمية = ${value} حبة.`;
      }
      break;

    case "ah":
      if (matchType === "ah") {
        mult = value;
        note = `حسبت ${value} أمبير-ساعة (Ah) كما في سؤالك.`;
      } else if (matchType === "pcs") {
        mult = value;
        note =
          `ذكرت ${value} بطارية بدون أمبير، فحسبتها ${value} وحدة ` +
          "(بافتراض أن السعر في القائمة لبطارية واحدة).";
      } else {
        mult = value;
        note = `اعتبرت الكمية = ${value} Ah أو بطارية.`;
      }
      break;

    default:
      mult = value;
      note = `وحدة السعر في القائمة (${unit || "غير معروفة"})، وحسبت الكمية = ${value}.`;
  }

  return { mult, note };
}

// ================== دوال الجمارك ==================

function parseRate(notes = "") {
  const s = String(notes).replace(/\s+/g, "");
  if (/الفئة?10%|10%/i.test(s)) return 10;
  if (/الفئة?5%|5%/i.test(s)) return 5;
  return 10;
}

function usdToCustomsYer(usd, ratePct) {
  const factor = CUSTOMS_FACTORS[String(ratePct)] ?? 0.265;
  return Math.round(usd * EXCHANGE_RATE_YER * factor);
}

// ================== البحث الذكي عن الصنف ==================

function smartFindItem(rawQuery) {
  if (!CATALOG.length) return null;

  const qSyn = applySynonymsText(rawQuery);
  const tokens = qSyn
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 1);

  // 1) فلترة حسب الكلمات الخاصة (ليثيوم، شفافة، مطبوعة، بلاستيك...)
  const activeFilters = detectFilters(tokens);
  let candidateCatalog = CATALOG;

  if (activeFilters.length) {
    candidateCatalog = CATALOG.filter((item) => {
      const name = norm(item.name);
      return activeFilters.every((f) => name.includes(f));
    });
    if (!candidateCatalog.length) {
      candidateCatalog = CATALOG; // لو ضاقت بشكل زائد نرجع للأصل
    }
  }

  let localFuse = new Fuse(candidateCatalog, {
    keys: ["name", "notes"],
    includeScore: true,
    threshold: 0.5,
    distance: 150
  });

  // 2) البحث بالنص كامل
  let results = localFuse.search(qSyn);
  if (results.length && results[0].score <= 0.7) {
    return results[0].item;
  }

  // 3) تطابق كل الكلمات داخل اسم الصنف
  if (tokens.length > 0) {
    const filtered = candidateCatalog.filter((it) => {
      const name = norm(it.name);
      return tokens.every((t) => name.includes(t));
    });
    if (filtered.length) {
      return filtered[0];
    }
  }

  // 4) نبحث بكل كلمة لوحدها ونأخذ أفضل نتيجة
  let best = null;
  for (const t of tokens) {
    const r = localFuse.search(t);
    if (r.length) {
      const cand = r[0];
      if (!best || cand.score < best.score) {
        best = cand;
      }
    }
  }
  if (best && best.score <= 0.8) return best.item;

  return null;
}

// ================== مسارات الـ API ==================

app.get("/api/ping", (req, res) => {
  res.json({ ok: true, items: CATALOG.length });
});

app.post("/api/ask", (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: "query required" });
    }

    if (!CATALOG.length) {
      return res.json({
        reply:
          "قائمة الأسعار غير محمّلة على الخادم. تأكد من رفع ملف الأسعار إلى prices/fallback_prices_catalog.json في المشروع ثم أعد النشر."
      });
    }

    const item = smartFindItem(query);
    if (!item) {
      return res.json({
        reply:
          "لم أجد هذا الصنف في قائمة الأسعار، جرّب صيغة أخرى للاسم أو افتح قائمة الأسعار في التطبيق الأساسي."
      });
    }

    const usdPrice = Number(item.price || 0);
    if (!(usdPrice > 0)) {
      return res.json({
        reply:
          `وجدت الصنف "${item.name}" لكن سعره في القائمة يساوي 0 أو غير معروف. عدّل السعر من الحاسبة الأساسية ثم أعد المحاولة.`
      });
    }

    const ratePct = parseRate(item.notes);
    const { mult, note: qtyNote } = parseQuantityFromQuery(query, item.unit || "");

    const usdTotal = usdPrice * mult;
    const yer = usdToCustomsYer(usdTotal, ratePct);

    const text =
      `📦 الصنف الأقرب لطلبك:\n` +
      `• ${item.name}\n` +
      `• وحدة السعر في القائمة: ${item.unit || "وحدة"}\n` +
      `• السعر للوحدة: ${usdPrice}$\n` +
      `• الكمية المحتسبة: x${mult}\n` +
      `• إجمالي القيمة بالدولار: ${usdTotal.toFixed(2)}$\n\n` +
      `الرسوم الجمركية التقديرية:\n` +
      `• الفئة الجمركية: ${ratePct}% (معامل ${CUSTOMS_FACTORS[String(ratePct)]})\n` +
      `• رسوم تقريبية: ${yer.toLocaleString()} ريال يمني.\n\n` +
      `ℹ️ ملاحظة عن الكمية: ${qtyNote}\n\n` +
      `🔢 إذا تريد حساب أدق (عدد كراتين/درزن/كجم بالضبط)، افتح الحاسبة الأساسية واضبط كل التفاصيل هناك:\n` +
      `${CALCULATOR_URL}`;

    return res.json({
      reply: text,
      matchedItem: {
        name: item.name,
        price: item.price,
        unit: item.unit,
        notes: item.notes
      },
      usd: usdTotal,
      yer,
      ratePct
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// ================== تشغيل الخادم ==================

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("AI customs assistant server running on port", PORT);
});
