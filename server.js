import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import Fuse from "fuse.js";
import fs from "fs";

import {
  EXCHANGE_RATE_YER,
  CUSTOMS_FACTORS,
  SYNONYMS,
  INTENTS,
} from "./config.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static("public"));

// ===== الكتالوج =====
const pricesPath = "./prices/fallback_prices_catalog.json";
let CATALOG = [];
try {
  CATALOG = JSON.parse(fs.readFileSync(pricesPath, "utf8"));
} catch (_) {
  CATALOG = [];
}

// ===== أدوات مساعدة =====
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

function applySynonyms(q) {
  const w = norm(q).split(" ");
  return w.map((t) => (SYNONYMS[t] ? SYNONYMS[t] : t)).join(" ");
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
  distance: 80,
});

// ===== جلسات =====
const sessions = new Map(); // clientId -> { item, intent, slots:{}, pending:[], lastAt }

function getClientId(req, res) {
  let cid = req.headers["x-client-id"] || req.cookies?.clientId;
  if (!cid) {
    cid = Math.random().toString(36).slice(2);
    res.setHeader("Set-Cookie", `clientId=${cid}; Path=/; HttpOnly; SameSite=Lax`);
  }
  if (!sessions.has(cid)) {
    sessions.set(cid, { item: null, intent: null, slots: {}, pending: [], lastAt: Date.now() });
  }
  return cid;
}

// تنظيف جلسات قديمة كل فترة (ساعة)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (now - v.lastAt > 60 * 60 * 1000) sessions.delete(k);
  }
}, 15 * 60 * 1000);

// ===== التقاط القيم من النص =====

// تحويل أرقام عربية إلى إنجليزية
const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
const toAsciiDigits = (s) =>
  String(s || "").replace(/[٠-٩]/g, (d) => arabicDigits.indexOf(d));

// يمسك "40", "40 بوصة", "٢ طن", "كجم 500"… إلخ
function pickNumberAfter(text, kwds = []) {
  const t = toAsciiDigits(text);
  const joined = kwds.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(?:${joined})\\s*[:=]??\\s*([0-9]+(?:\\.[0-9]+)?)`, "i");
  const m1 = t.match(re);
  if (m1) return Number(m1[1]);

  const m2 = t.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (m2) return Number(m2[1]);
  return null;
}

function parseSlotsFromMessage(text) {
  const t = norm(text);
  const slots = {};

  // عام
  const num = (xs) => pickNumberAfter(t, xs);

  // بالحبة/كرتون
  if (/(حبة|حبات|قطعة|قطع|بالحبة|بالحبه)/.test(t)) {
    const n = num(["عدد", "حبات", "حبة", "عدد الحبات", "عدد="]);
    if (n) slots.count = n;
  }
  if (/(كرتون|كرتونات|كراتين)/.test(t)) {
    const c = num(["كراتين", "كرتون", "عدد الكراتين", "كراتين="]);
    if (c) slots.cartons = c;
  }
  if (/(حبات\/كرتون|حبة\/كرتون|في الكرتون|داخل الكرتون)/.test(t) || /كرتون\s*=\s*[0-9]/.test(t)) {
    const p = num(["حبات/كرتون", "حبة/كرتون", "في الكرتون", "داخل الكرتون"]);
    if (p) slots.perCarton = p;
  }

  // درزن
  if (/درزن/.test(t)) {
    const dpc = num(["درزن/كرتون", "الدزن/كرتون", "درزن في الكرتون"]);
    if (dpc) slots.dzPerCarton = dpc;
    const pcs = num(["حبات", "حبة", "الحبات"]);
    if (pcs) slots.pieces = pcs;
  }

  // وزن
  if (/(طن|أطنان|الطن)/.test(t)) {
    const tn = num(["طن", "أطنان", "الطن", "أطنان="]);
    if (tn) slots.tons = tn;
  }
  if (/(كجم|كغ|كيلو|الكيلو)/.test(t)) {
    const kg = num(["كجم", "كغ", "كيلو", "الكيلو", "كجم="]);
    if (kg) slots.kg = kg;
  }

  // بوصة
  if (/(بوصه|بوصة|inch|انش|\"|\bin\b)/.test(t)) {
    const inc = num(["بوصه", "بوصة", "inch", "انش"]);
    if (inc) slots.inches = inc;
  }

  // بطاريات
  if (/ليثيوم/.test(t)) slots.batteryType = "ليثيوم";
  if (/(أسيد|اسيد|قابلة للصيانة|رطب)/.test(t)) slots.batteryType = "أسيد";
  if (/(امبير|أمبير|Ah|ah)/i.test(t)) {
    const ah = num(["أمبير", "امبير", "Ah", "AH"]);
    if (ah) slots.ah = ah;
  }
  if (/عدد/.test(t) && !slots.count) {
    const c = num(["عدد"]);
    if (c) slots.count = c;
  }

  // رولات
  if (/شفافة/.test(t)) slots.rollType = "شفافة";
  if (/مطبوعه|مطبوع/.test(t)) slots.rollType = "مطبوعه";

  return slots;
}

// ===== اختيار النية =====
function detectIntentFromNameOrText(itemName, userText) {
  const source = `${itemName || ""} ${userText || ""}`.trim();
  const txt = norm(source);
  // جرّب ترتيب النيات حسب التعريف
  for (const [kind, def] of Object.entries(INTENTS)) {
    if ((def.match || []).some((kw) => txt.includes(norm(kw)))) {
      return { kind, def };
    }
  }
  return { kind: null, def: null };
}

// ===== المعادلات =====
function computeUSD(item, slots, intentKind) {
  const unit = item.unit || "pcs";
  const price = Number(item.price || 0);
  if (!(price > 0)) return 0;

  switch (intentKind) {
    case "tv":
      if (slots.inches) return Number(slots.inches) * price;
      return NaN;

    case "pcs":
      if (slots.count) return Number(slots.count) * price;
      if (slots.cartons && slots.perCarton) {
        return Number(slots.cartons) * Number(slots.perCarton) * price;
      }
      return NaN;

    case "dz":
      if (slots.cartons && slots.dzPerCarton) {
        const dz = Number(slots.cartons) * Number(slots.dzPerCarton);
        return dz * price;
      }
      if (slots.pieces) return (Number(slots.pieces) / 12) * price;
      return NaN;

    case "kgOrTon":
    case "rolls":
      if (unit === "ton") {
        if (slots.kg) return (Number(slots.kg) / 1000) * price;
        if (slots.tons) return Number(slots.tons) * price;
      }
      if (unit === "kg") {
        if (slots.kg) return Number(slots.kg) * price;
        if (slots.tons) return Number(slots.tons) * 1000 * price;
      }
      // لو الكتالوج كتب الوحدة خطأ، اعمل محاولة ذكية:
      if (slots.kg) return (Number(slots.kg) / 1000) * price;
      if (slots.tons) return Number(slots.tons) * price;
      return NaN;

    case "battery":
      if (unit.toLowerCase() === "ah" && slots.ah) return Number(slots.ah) * price;
      if (slots.count) return Number(slots.count) * price;
      return NaN;

    default:
      // fallback عام: qty × price
      if (slots.qty) return Number(slots.qty) * price;
      if (slots.count) return Number(slots.count) * price;
      return NaN;
  }
}

// يكوّن رسالة سؤال بناءً على الخانات الناقصة
function buildPendingQuestions(intentKind, missing) {
  const def = INTENTS[intentKind];
  if (!def) return { ask: "أحتاج تفاصيل أكثر لإكمال الحساب." };

  // ترتيب الأسئلة حسب requiredSlots
  for (const slot of def.requiredSlots) {
    if (missing.includes(slot)) {
      return { ask: def.prompts[slot] || "أكمل البيانات المطلوبة." };
    }
  }
  return { ask: "أكمل البيانات المطلوبة." };
}

// ===== API =====

app.get("/api/ping", (_req, res) => res.json({ ok: true }));

app.post("/api/ask", (req, res) => {
  try {
    const cid = getClientId(req, res);
    const S = sessions.get(cid);
    S.lastAt = Date.now();

    let { query, filled = {} } = req.body || {};
    if (!query) return res.status(400).json({ error: "query required" });

    // 1) طبّق المرادفات وملّك القيم من النص
    const qSyn = applySynonyms(query);
    const autoSlots = parseSlotsFromMessage(qSyn);
    filled = { ...filled, ...autoSlots };

    // 2) لو عندنا عنصر سابق في الجلسة أكمل عليه، وإلا ابحث من جديد
    let item = S.item;
    if (!item) {
      let found = fuse.search(qSyn);
      if (!found.length || found[0].score > 0.45) {
        return res.json({ reply: "لم أجد هذا الصنف في القائمة. جرّب اسمًا أقرب أو افتح قائمة الأسعار." });
      }
      item = found[0].item;
      S.item = item;
    }

    // 3) حدّد النية (من اسم الصنف + نص المستخدم)
    let intentKind = S.intent?.kind;
    if (!intentKind) {
      const det = detectIntentFromNameOrText(item?.name, qSyn);
      intentKind = det.kind || "pcs"; // افتراضي بسيط
      S.intent = det;
    }

    // 4) حدّد الخانات المطلوبة وادمج المكتمل
    const def = INTENTS[intentKind] || { requiredSlots: [] };
    S.slots = { ...S.slots, ...filled };

    // 5) تحقق من النواقص
    const have = S.slots;
    const missing = def.requiredSlots.filter((slot) => {
      if (slot === "countOrCarton") return !(have.count || (have.cartons && have.perCarton));
      if (slot === "dzMode") return !((have.cartons && have.dzPerCarton) || have.pieces);
      if (slot === "weight") return !(have.kg || have.tons);
      if (slot === "capacityOrCount") return !!(have.ah || have.count) ? false : true;
      return !have[slot];
    });

    if (missing.length) {
      const q = buildPendingQuestions(intentKind, missing);
      sessions.set(cid, S);
      return res.json({ ask: q.ask, matched: item.name });
    }

    // 6) احسب
    const usd = computeUSD(item, S.slots, intentKind);
    if (!(usd > 0)) {
      sessions.set(cid, S);
      return res.json({ ask: "أحتاج تفاصيل أكثر لإكمال الحساب." });
    }

    const ratePct = parseRate(item.notes);
    const yer = usdToCustomsYer(usd, ratePct);

    // 7) صفّـر الجلسة بعد الحساب (أو احتفظ بها لو تريد حوارًا تسلسليًا)
    const name = item.name;
    sessions.set(cid, { item: null, intent: null, slots: {}, pending: [], lastAt: Date.now() });

    const reply =
      `السعر التقديري: ${usd.toFixed(2)}$ ⇒ رسوم تقريبية: ${yer.toLocaleString()} ريال يمني (فئة ${ratePct}%).\n` +
      `الصنف: ${name}.\n` +
      `سعر الصرف ${EXCHANGE_RATE_YER} × معامل ${(CUSTOMS_FACTORS[String(ratePct)] ?? 0.265)}.`;

    return res.json({
      reply,
      openCalcUrl: `/index.html?price=${encodeURIComponent(usd)}&qty=1&ratePct=${ratePct}`,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("AI server on", PORT));
