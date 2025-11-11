import express from "express";
import cors from "cors";
import Fuse from "fuse.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* ===== مسارات أساسية ===== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const CATALOG_PATH = path.join(__dirname, "prices", "fallback_prices_catalog.json");

/* ===== تحميل كتالوج الأسعار ===== */
let catalog = [];
try {
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  catalog = Array.isArray(raw) ? raw : [];
} catch (e) {
  console.error("Catalog load error:", e.message);
  catalog = [];
}

/* ===== تطبيع عربي مبسّط ===== */
function normalizeArabic(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, "") // تشكيل
    .replace(/ـ/g, "")               // مط
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^0-9\u0621-\u064A\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ===== مرادفات ===== */
const SYNONYMS = {
  "تلفزيون": ["تلفزيون","تلفز","شاشه","شاشة","شاشات","tv"],
  "مودم": ["مودم","مودمات","راوتر","راوترات","mifi","مي فاي","مي فاي"],
  "ملابس": ["ملابس","ثياب","تيشرت","قميص"],
  "حديد": ["حديد","حديد تسليح","حديد بناء","مسامير حديد"],
  "بطاريه": ["بطاريه","بطارية","بطاريات","بطاريـات"],
  "ليثيوم": ["ليثيوم","lithium"],
  "رصاص": ["رصاص","حمض","اسيد","lead acid","acid"]
};

/* enrich */
const enriched = catalog.map((it) => {
  const n = normalizeArabic(it.name || "");
  let syn = [];
  for (const arr of Object.values(SYNONYMS)) {
    if (arr.some(x => n.includes(normalizeArabic(x)))) syn = syn.concat(arr);
  }
  return { ...it, _normName: n, synonyms: syn };
});

/* ===== فهرس Fuzzy ===== */
const fuse = new Fuse(enriched, {
  includeScore: true,
  threshold: 0.39,
  distance: 120,
  ignoreLocation: true,
  keys: ["name", "_normName", "synonyms"]
});

function fuzzyFindItem(text) {
  const q = normalizeArabic(text);
  const exact = enriched.find(x => x._normName.includes(q));
  if (exact) return exact;
  const res = fuse.search(q);
  return res.length ? res[0].item : null;
}

/* ===== كشف النية ===== */
function detectIntent(text) {
  const t = normalizeArabic(text);
  if (/(تلفز|شاشه|شاشة|شاشات|tv)/.test(t)) return "TV";
  if (/(مودم|راوتر|mifi)/.test(t)) return "MODEM";
  if (/(حديد)/.test(t)) return "IRON";
  if (/(بطاريه|بطارية|بطاريات)/.test(t)) return "BATTERY";
  if (/(ملابس|درزن|دزن)/.test(t)) return "CLOTHES";
  return "CATALOG";
}

/* ===== أسئلة المتابعة حسب النية ===== */
function followUp(intent, ctx = {}) {
  switch (intent) {
    case "TV":
      if (!ctx.inches) return { ask: "كم بوصه للشاشه؟ (مثال: 32)", expect: "inches" };
      return null;
    case "MODEM":
      if (!ctx.mode) return { ask: "أحسب لك (حبه) أم (كرتون)؟", expect: "mode", quick: ["حبه","كرتون"] };
      if (ctx.mode === "كرتون" && !ctx.perCarton) return { ask: "كم حبه في الكرتون؟", expect: "perCarton" };
      if (!ctx.count) return { ask: ctx.mode === "كرتون" ? "كم عدد الكراتين؟" : "كم عدد الحبات؟", expect: "count" };
      return null;
    case "IRON":
      if (!ctx.kg) return { ask: "كم الوزن بالكيلو جرام؟", expect: "kg" };
      return null;
    case "BATTERY":
      if (!ctx.chem) return { ask: "نوع البطاريه؟ (ليثيوم) أم (رصاص/اسيد)؟", expect: "chem", quick: ["ليثيوم","رصاص"] };
      if (!ctx.ah) return { ask: "كم سعة كل بطاريه بالأمبير/ساعة (Ah)؟", expect: "ah" };
      if (!ctx.count) return { ask: "كم عدد البطاريات؟", expect: "count" };
      return null;
    case "CLOTHES":
      if (!ctx.mode) return { ask: "أحسب لك (بالدرزن) أم (بالكرتون)؟", expect: "mode", quick: ["درزن","كرتون"] };
      if (ctx.mode === "كرتون" && !ctx.perCarton) return { ask: "كم درزن في الكرتون؟", expect: "perCarton" };
      if (!ctx.count) return { ask: ctx.mode === "كرتون" ? "كم عدد الكراتين؟" : "كم عدد الدزن؟", expect: "count" };
      return null;
    default:
      return null;
  }
}

/* ===== حساب الرسوم ===== */
function computeDutyYER({ usd, ratePct = 5, fx = 955.6 }) {
  const duty = usd * (ratePct / 100) * fx;
  return Math.round(duty);
}

/* ===== خادم ===== */
const app = express();
app.use(cors());
app.use(express.json());

/* جلسات بسيطة بالذاكرة */
const SESS = new Map(); // sessionId -> {intent, ctx, lastItem}

/* واجهة المحادثة الذكية */
app.post("/api/assist", (req, res) => {
  const { sessionId = "default", text = "" } = req.body || {};
  const session = SESS.get(sessionId) || { intent: null, ctx: {} };

  if (!session.intent) session.intent = detectIntent(text);

  // استخراج أرقام من النص
  const norm = normalizeArabic(text);
  const numberInText = (re) => {
    const m = norm.match(re);
    return m ? Number(m[1]) : null;
  };
  if (/بوصه|بوصة|inch|in/.test(norm)) session.ctx.inches = numberInText(/(\d+(?:\.\d+)?)/);
  if (/(كيلو|كجم|وزن)/.test(norm)) session.ctx.kg = numberInText(/(\d+(?:\.\d+)?)/);
  if (/(ah|امبير)/.test(norm)) session.ctx.ah = numberInText(/(\d+(?:\.\d+)?)/);
  if (/(عدد|حبه|حبات|كرتون)/.test(norm)) session.ctx.count = numberInText(/(\d+(?:\.\d+)?)/);
  if (/(درزن\/?كرتون|حبه\/?كرتون|بالكرتون)/.test(norm)) session.ctx.perCarton = numberInText(/(\d+(?:\.\d+)?)/);

  if (/حبه|بالحبه/.test(norm)) session.ctx.mode = "حبه";
  if (/كرتون|بالكرتون/.test(norm)) session.ctx.mode = "كرتون";
  if (/ليثيوم/.test(norm)) session.ctx.chem = "ليثيوم";
  if (/(رصاص|اسيد|حمض)/.test(norm)) session.ctx.chem = "رصاص";

  // ابحث عن الصنف (تقريبي)
  const item = fuzzyFindItem(text) || session.lastItem;
  if (item) session.lastItem = item;

  // أسئلة متابعة
  const need = followUp(session.intent, session.ctx);
  if (need) {
    SESS.set(sessionId, session);
    return res.json({ reply: need.ask, quick: need.quick || [] });
  }

  // حسابات
  const fx = 955.6; // غيّره إن أردت
  let usd = 0, ratePct = 5, explain = "";

  switch (session.intent) {
    case "TV": {
      const inches = Number(session.ctx.inches);
      const pricePer = inches < 40 ? 3 : 4;  // منطق الشاشات
      usd = inches * pricePer;
      ratePct = 5;
      explain = `شاشه ${inches}" بسعر ${pricePer}$/بوصه.`;
      break;
    }
    case "MODEM": {
      if (!item) return res.json({ reply: "لم أجد الصنف في قائمتك. أضفه بقائمة الأسعار (وحدة: الحبة)." });
      const unitPrice = Number(item.price || 0);
      ratePct = (/10%/.test(item.notes||"")) ? 10 : 5;
      if (session.ctx.mode === "كرتون") {
        const per = Number(session.ctx.perCarton);
        const cartons = Number(session.ctx.count);
        usd = cartons * per * unitPrice;
        explain = `حبه × ${per}/كرتون × ${cartons} كرتون.`;
      } else {
        const pcs = Number(session.ctx.count);
        usd = pcs * unitPrice;
        explain = `حبه × ${pcs}.`;
      }
      break;
    }
    case "IRON": {
      if (!item) return res.json({ reply: "اكتب نوع الحديد الموجود في قائمتك (وحدة: kg) أو أضفه في الأسعار." });
      const kg = Number(session.ctx.kg);
      const pricePerKg = Number(item.price || 0);
      usd = kg * pricePerKg;
      ratePct = (/10%/.test(item.notes||"")) ? 10 : 5;
      explain = `سعر/كجم × ${kg} كجم.`;
      break;
    }
    case "BATTERY": {
      if (!item || !(item.unit === "Ah" || /ah/i.test(item.unit||""))) {
        return res.json({ reply: "أضف صنفًا في قائمتك لوحدة (Ah) وسعرها/لكل Ah للبطاريات، ثم أعد السؤال." });
      }
      const perAhUSD = Number(item.price || 0);
      const ah = Number(session.ctx.ah);
      const count = Number(session.ctx.count || 1);
      usd = perAhUSD * ah * count;
      ratePct = (/10%/.test(item.notes||"")) ? 10 : 5;
      explain = `سعر/Ah × ${ah}Ah × ${count} (${session.ctx.chem}).`;
      break;
    }
    case "CLOTHES": {
      if (!item) return res.json({ reply: "أضف صنف الملابس (وحدة: الدرزن) في قائمتك ثم أعد السؤال." });
      const pricePerDz = Number(item.price || 0);
      ratePct = (/10%/.test(item.notes||"")) ? 10 : 5;
      if (session.ctx.mode === "كرتون") {
        const perDz = Number(session.ctx.perCarton);
        const cartons = Number(session.ctx.count);
        usd = cartons * perDz * pricePerDz;
        explain = `سعر/درزن × ${perDz} درزن/كرتون × ${cartons} كرتون.`;
      } else {
        const dz = Number(session.ctx.count);
        usd = dz * pricePerDz;
        explain = `سعر/درزن × ${dz} درزن.`;
      }
      break;
    }
    default: {
      if (!item) {
        return res.json({ reply: "لم أجد هذا الصنف في القائمة. اكتب الاسم أو أضفه كمدخل جديد في الأسعار." });
      }
      usd = Number(item.price || 0);
      ratePct = (/10%/.test(item.notes||"")) ? 10 : 5;
      explain = `استخدمت السعر المسجل: ${item.name}.`;
    }
  }

  const yer = computeDutyYER({ usd, ratePct, fx });
  SESS.set(sessionId, { intent: null, ctx: {}, lastItem: item });

  res.json({
    reply: `السعر التقريبي: $${usd.toFixed(2)} ⇒ رسوم تقريبية: ${yer} ريال يمني (فئة ${ratePct}%).\n${explain}`,
    open_calc: `./index.html?price=${encodeURIComponent(usd)}&qty=1&ratePct=${ratePct}`
  });
});

/* ملفات الواجهة */
app.use(express.static(PUBLIC_DIR));
app.get("/", (_, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("AI Assistant running on :" + PORT));
