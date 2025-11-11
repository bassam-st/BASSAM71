import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import Fuse from "fuse.js";
import {
  EXCHANGE_RATE_YER,
  CUSTOMS_FACTORS,
  SYNONYMS,
  ITEM_INTENTS
} from "./config.js";
import fs from "fs";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// تحميل الأسعار (الملف الرسمي + المحلي إن وجد)
const pricesPath = "./prices/fallback_prices_catalog.json";
let CATALOG = [];
try {
  const raw = fs.readFileSync(pricesPath, "utf8");
  CATALOG = JSON.parse(raw);
} catch (e) {
  CATALOG = [];
}

// أدوات مساعدة
const norm = s =>
  String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function applySynonyms(q) {
  const w = norm(q).split(" ");
  return w
    .map(t => (SYNONYMS[t] ? SYNONYMS[t] : t))
    .join(" ");
}

function parseRate(notes = "") {
  const s = notes.replace(/\s+/g, "");
  if (/الفئة?10%|10%/i.test(s)) return 10;
  if (/الفئة?5%|5%/i.test(s)) return 5;
  return 10; // افتراضي نفس الحاسبة
}

function usdToCustomsYer(usd, ratePct) {
  const factor = CUSTOMS_FACTORS[String(ratePct)] ?? 0.265;
  return Math.round(usd * EXCHANGE_RATE_YER * factor);
}

// فوزي (Fuzzy) بضبط محكم
const fuse = new Fuse(CATALOG, {
  keys: ["name", "notes"],
  includeScore: true,
  threshold: 0.32,            // أكثر صرامة من قبل
  distance: 80
});

// يحدد نية/أسئلة مطلوبة من اسم/وصف الصنف
function detectIntent(itemNameOrQuery) {
  const q = norm(itemNameOrQuery);
  for (const key of Object.keys(ITEM_INTENTS)) {
    if (q.includes(norm(key))) return ITEM_INTENTS[key];
  }
  return null;
}

// يحسب قيمة السلعة بالدولار حسب الوحدة المطلوبة
function computeUSD(item, filled) {
  // item.price هو "السعر لِـ الوحدة" (مثلاً للطن، للدرزن، للحبة...)
  const unit = item.unit || "pcs";
  const price = Number(item.price || 0);
  if (!(price > 0)) return 0;

  // التلفزيون: بوصة × سعر/بوصة موجود في الكتالوج (سعر الحبة = سعر/بوصة)
  if (filled.kind === "tv") {
    const inches = Number(filled.inches || 0);
    if (!(inches > 0)) return NaN;
    return inches * price;
  }

  // بالحبة أو بالكرتون
  if (filled.kind === "pcs") {
    // إذا أرسل مباشر عدد حبات
    if (filled.count && Number(filled.count) > 0) return Number(filled.count) * price;

    // بالكرتون: cartons × perCarton × price
    if (filled.cartons && filled.perCarton) {
      return Number(filled.cartons) * Number(filled.perCarton) * price;
    }
    return NaN;
  }

  // درزن
  if (unit === "dz" || filled.kind === "dz") {
    if (filled.cartons && filled.dzPerCarton) {
      const dozens = Number(filled.cartons) * Number(filled.dzPerCarton);
      return dozens * price;
    }
    if (filled.pieces) {
      return (Number(filled.pieces) / 12) * price;
    }
    return NaN;
  }

  // وزن: كجم/طن
  if (filled.kind === "kgOrTon" || unit === "kg" || unit === "ton") {
    // في الكتالوج سعر/طن — إن أرسل كجم نحوله إلى طن
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

  // بطارية: النوع + الأمبير/ساعة × السعر لكل Ah (إن سجلته كذلك)
  if (filled.kind === "batteryTypeAh") {
    if (!filled.batteryType) return NaN;
    if (!(filled.ah > 0)) return NaN;
    // السعر في الكتالوج يجب أن يكون "سعر لكل Ah" أو "سعر للبطارية" (في الحالة الثانية multiply by count)
    if (unit === "Ah" || norm(item.unit) === "ah") {
      return Number(filled.ah) * price;
    }
    if (unit === "pcs") {
      // بطارية/حبة — لو عنده عدد حبات
      const count = Number(filled.count || 1);
      return count * price;
    }
    return NaN;
  }

  // افتراضي: كمية بسيطة
  if (filled.qty) return Number(filled.qty) * price;

  return NaN;
}

// تُرجع إما سؤال متابعة أو نتيجة
function buildNextStepOrResult({ item, query, filled }) {
  // لو ما عندنا “نية” واضحة، نحاول الاستنتاج من اسم الصنف نفسه
  const intent = detectIntent(item?.name || query) || { kind: null };

  // أسئلة مطلوبة حسب النية
  if (intent.kind === "tv") {
    if (!filled.inches) {
      return { ask: "كم بوصة للشاشة؟ (اكتب رقم مثل 32 أو 43)" };
    }
  } else if (intent.kind === "pcs") {
    if (!filled.count && !(filled.cartons && filled.perCarton)) {
      return {
        ask: "أحسب بالحبة مباشرة أم بالكرتون؟",
        choices: [
          "بالحبة — اكتب: عدد الحبات = 24",
          "بالكرتون — اكتب: الكراتين = 2 و الحبات/كرتون = 12"
        ]
      };
    }
  } else if (intent.kind === "dz") {
    if (!(filled.cartons && filled.dzPerCarton) && !filled.pieces) {
      return {
        ask: "أحسب بالدرزن أم بالحبات؟",
        choices: [
          "بالكرتون/درزن — اكتب: الكراتين = 3 و الدزن/كرتون = 10",
          "بالحبات — اكتب: الحبات = 120"
        ]
      };
    }
  } else if (intent.kind === "kgOrTon") {
    if (!filled.kg && !filled.tons) {
      return { ask: "تحب أحسب لك بالكيلو أم بالطن؟ (اكتب: كجم = 500 أو أطنان = 2)" };
    }
  } else if (intent.kind === "batteryTypeAh") {
    if (!filled.batteryType) {
      return { ask: "نوع البطارية؟ (ليثيوم أم أسيد قابلة للصيانة)" };
    }
    if (!filled.ah) {
      return { ask: "كم الأمبير/ساعة للبطارية؟ (اكتب: Ah = 120 مثلًا)" };
    }
  }

  // جميع الحقول الأساسية أصبحت موجودة — نحسب
  const usd = computeUSD(item, { ...filled, kind: intent.kind });
  if (!(usd > 0)) {
    return { ask: "أحتاج تفاصيل أكثر لإكمال الحساب (أعد صياغة الإجابة فوق بنمط الحقول)." };
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

// نقطة نهاية المحادثة
app.post("/api/ask", (req, res) => {
  try {
    let { query, filled = {} } = req.body || {};
    if (!query) return res.status(400).json({ error: "query required" });

    const q = applySynonyms(query);
    const found = fuse.search(q);
    if (!found.length || found[0].score > 0.45) {
      return res.json({ reply: "لم أجد هذا الصنف في القائمة. جرّب اسمًا أقرب أو افتح قائمة الأسعار." });
    }

    const item = found[0].item;

    const step = buildNextStepOrResult({ item, query: q, filled });
    if (step.ask) {
      return res.json({ ask: step.ask, choices: step.choices || null, matched: item.name });
    }

    const r = step.result;
    const text =
      `السعر التقديري: ${r.usd}$ ⇒ رسوم تقريبية: ${r.yer.toLocaleString()} ريال يمني (فئة ${r.ratePct}%).\n` +
      `استخدمت: سعر الصرف ${r.exchange} × معامل ${r.factor} من الفئة.\n` +
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
