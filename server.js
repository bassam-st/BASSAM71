// server.js
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
  UNIT_INTENT_FALLBACK,
  ROLLS_TYPES
} from "./config.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

/* ======== تحميل الكتالوج ======== */
const pricesPath = "./prices/fallback_prices_catalog.json";
let CATALOG = [];
try {
  const raw = fs.readFileSync(pricesPath, "utf8");
  CATALOG = JSON.parse(raw);
} catch (e) {
  CATALOG = [];
}

/* ======== أدوات نصية ======== */
const norm = s => String(s||"").toLowerCase().replace(/[^\p{L}\p{N}\s.%/-]/gu," ").replace(/\s+/g," ").trim();

function applySynonyms(q){
  const w = norm(q).split(" ");
  return w.map(t => SYNONYMS[t] ? SYNONYMS[t] : t).join(" ");
}

function parseRate(notes=""){
  const s = String(notes).replace(/\s+/g,"");
  if (/الفئة?10%|10%/i.test(s)) return 10;
  if (/الفئة?5%|5%/i.test(s))  return 5;
  return 10;
}

function usdToCustomsYer(usd, ratePct){
  const factor = CUSTOMS_FACTORS[String(ratePct)] ?? 0.265;
  return Math.round(Number(usd) * EXCHANGE_RATE_YER * factor);
}

/* ======== فوزي للبحث الذكي ======== */
let fuse = new Fuse(CATALOG, {
  keys: ["name","notes","unit"],
  includeScore: true,
  threshold: 0.38,   // أوسع قليلًا لكن ما زال دقيق
  distance: 100
});

/* ======== كشف النية ======== */
function detectIntentFromText(text){
  const q = norm(text);
  for (const key of Object.keys(ITEM_INTENTS)){
    if (q.includes(norm(key))) return ITEM_INTENTS[key];
  }
  return null;
}
function detectIntent({item, query}){
  // 1) من الاسم
  const byName = detectIntentFromText(item?.name || "");
  if (byName) return byName;
  // 2) من الاستعلام
  const byQuery = detectIntentFromText(query || "");
  if (byQuery) return byQuery;
  // 3) من الوحدة fallback
  const unit = String(item?.unit||"").trim();
  if (unit && UNIT_INTENT_FALLBACK[unit]) return UNIT_INTENT_FALLBACK[unit];
  return { kind: "pcs" }; // افتراضي
}

/* ======== استخراج الخانات تلقائيًا من نص المستخدم ======== */
function parseFilledFromText(text){
  const s = norm(text);

  // أرقام عامة
  const num = re => {
    const m = s.match(re);
    return m ? Number(m[1].replace(",", ".")) : undefined;
  };

  // أنماط عربية شائعة
  const cartons     = num(/\b(?:كراتين|كرتون|طرد|طرود)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);
  const perCarton   = num(/\b(?:حبات\/?كرتون|حبه\/?كرتون|حبات لكل كرتون|حبات للكرتون|داخل الكرتون)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);
  const countPieces = num(/\b(?:عدد|حبات|قطع|قطعه)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);
  const piecesOnly  = num(/\b(?:الحبات|القطع)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);

  const dozensCart  = num(/\b(?:الدزن\/?كرتون|درزن\/?كرتون|dz\/?carton)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);
  const dzPieces    = num(/\b(?:حبات)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);

  const kg          = num(/\b(?:كجم|كيلو|kg)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);
  const tons        = num(/\b(?:طن|ton)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);

  const inches      = num(/\b(?:بوصة|بوصه|inch|in)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);
  const ah          = num(/\b(?:ah|امبير|أمبير)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);
  const watts       = num(/\b(?:w|واط|وات)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);
  const kw          = num(/\b(?:kw|كيلوواط|كيلو وات)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);
  const liters      = num(/\b(?:l|لتر)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);
  const ml          = num(/\b(?:ml|مليلتر|مل)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/);

  // نوع رولات
  let rollType = null;
  if (/\bشفاف(?:ه)?\b/.test(s)) rollType = "شفافة";
  if (/\bمطبوعة?\b/.test(s))   rollType = "مطبوعه";

  // نوع بطارية
  let batteryType = null;
  if (/\bليثيوم\b/.test(s)) batteryType = "ليثيوم";
  if (/\bأسيد|اسيد|حمض\b/.test(s)) batteryType = "أسيد";

  return {
    cartons,
    perCarton,
    count: countPieces || piecesOnly,
    dzPerCarton: dozensCart,
    pieces: dzPieces,
    kg,
    tons,
    inches,
    ah,
    w: watts,
    kw,
    ltr: liters,
    ml,
    rollType,
    batteryType
  };
}

/* ======== تحسين اختيار صنف الرولات (شفافة/مطبوعه) ======== */
function refineRollItem(baseQuery, rollType){
  if (!rollType) return null;
  const tokens = ROLLS_TYPES[rollType] || [];
  const q = `${baseQuery} ${tokens.join(" ")}`.trim();
  const found = fuse.search(q);
  if (!found.length) return null;
  for (const r of found){
    const name = norm(r.item.name);
    if (tokens.some(t => name.includes(norm(t)))) return r.item;
  }
  return found[0].item;
}

/* ======== الحساب بالدولار حسب الخانات ======== */
function computeUSD(item, filled, intentKind){
  const unit  = String(item.unit||"pcs");
  const price = Number(item.price||0);
  if (!(price>0)) return NaN;

  // تلفزيون
  if (intentKind === "tv"){
    const inches = Number(filled.inches||0);
    if (!(inches>0)) return NaN;
    return inches * price;
  }

  // بالحبة/الكرتون
  if (intentKind === "pcs" || unit === "pcs"){
    if (filled.count && Number(filled.count)>0) return Number(filled.count) * price;
    if (filled.cartons && filled.perCarton)     return Number(filled.cartons) * Number(filled.perCarton) * price;
    return NaN;
  }

  // بالدرزن
  if (intentKind === "dz" || unit === "dz"){
    if (filled.cartons && filled.dzPerCarton){
      const dozens = Number(filled.cartons) * Number(filled.dzPerCarton);
      return dozens * price;
    }
    if (filled.pieces) return (Number(filled.pieces)/12) * price;
    return NaN;
  }

  // وزن (كجم/طن) — أيضًا يُستخدم للرولات إن كانت بالطن في قائمتك
  if (intentKind === "kgOrTon" || unit==="kg" || unit==="ton" || intentKind==="rolls"){
    if (unit==="ton"){
      if (filled.kg)  return (Number(filled.kg)/1000) * price;
      if (filled.tons) return Number(filled.tons) * price;
    }
    if (unit==="kg"){
      if (filled.kg)   return Number(filled.kg) * price;
      if (filled.tons) return Number(filled.tons) * 1000 * price;
    }
    // لو في قائمتك الرول سعره للطن — عالجناه أعلاه
    return NaN;
  }

  // بطاريات بالأمبير/ساعة
  if (intentKind === "batteryTypeAh"){
    if (!filled.batteryType) return NaN; // لازم يحدد النوع
    if (String(unit).toLowerCase()==="ah"){
      if (!(filled.ah>0)) return NaN;
      return Number(filled.ah) * price;
    }
    // بعض الأصناف سعرها/حبة بغض النظر عن Ah
    const count = Number(filled.count||1);
    return count * price;
  }

  // مقادير قياسية (W, kW, L, ml...) — إن كانت التسعيرة للوحدة منها
  if (intentKind==="powerW" && filled.w)   return Number(filled.w) * price;
  if (intentKind==="powerkW" && filled.kw) return Number(filled.kw) * price;
  if (intentKind==="liquidL" && filled.ltr) return Number(filled.ltr) * price;
  if (intentKind==="liquidMl" && filled.ml) return Number(filled.ml) * price;

  // افتراضي: كمية عامة
  if (filled.qty) return Number(filled.qty) * price;

  return NaN;
}

/* ======== منطق طرح الأسئلة أو إعطاء النتيجة ======== */
function buildNextStepOrResult({ item, query, userText, filledInput }){
  const intent = detectIntent({item, query});
  const autoFilled = parseFilledFromText(userText || "");
  const filled = { ...(filledInput||{}), ...autoFilled };

  // أسئلة موجّهة بحسب النية
  if (intent.kind==="tv" && !filled.inches){
    return { ask: "كم بوصة للشاشة؟ اكتب: بوصة = 43" };
  }

  if (intent.kind==="pcs"){
    if (!filled.count && !(filled.cartons && filled.perCarton)){
      return {
        ask: "أحسب بالحبة أم بالكرتون؟",
        choices: [
          "بالحبة — اكتب: عدد = 24",
          "بالكرتون — اكتب: كرتون = 2 و حبات/كرتون = 12"
        ]
      };
    }
  }

  if (intent.kind==="dz"){
    if (!(filled.cartons && filled.dzPerCarton) && !filled.pieces){
      return {
        ask: "أحسب بالدرزن أم بالحبات؟",
        choices: [
          "بالدرزن/كرتون — اكتب: كراتين = 3 و الدزن/كرتون = 10",
          "بالحبات — اكتب: الحبات = 120"
        ]
      };
    }
  }

  if (intent.kind==="kgOrTon"){
    if (!filled.kg && !filled.tons){
      return { ask: "تحب أحسب لك بالكيلو أم بالطن؟ (اكتب: كجم = 500 أو طن = 2)" };
    }
  }

  if (intent.kind==="rolls"){
    if (!filled.rollType){
      return { ask: "نوع الرولات؟ (شفافة أم مطبوعه)", choices: ["شفافة","مطبوعه"] };
    }
    if (!filled.kg && !filled.tons){
      return { ask: "تحب أحسب لك بالكيلو أم بالطن؟ (اكتب: كجم = 500 أو طن = 2)" };
    }
  }

  if (intent.kind==="batteryTypeAh"){
    if (!filled.batteryType){
      return { ask: "نوع البطارية؟ (ليثيوم أم أسيد)" , choices:["ليثيوم","أسيد"]};
    }
    if (!filled.ah && !filled.count){
      return { ask: "كم سعة البطارية بالأمبير/ساعة؟ اكتب: أمبير = 100 (أو اكتب: عدد = 2 لو التسعير بالحبة)" };
    }
  }

  // لو رولات ومعنا نوعها، نحسّن اختيار الصنف
  let chosenItem = item;
  if (intent.kind==="rolls" && filled.rollType){
    const refined = refineRollItem(query, filled.rollType);
    if (refined) chosenItem = refined;
  }

  // حساب
  const usd = computeUSD(chosenItem, filled, intent.kind);
  if (!(usd>0)){
    return { ask: "أحتاج تفاصيل أكثر لإكمال الحساب. اكتب القيم بالشكل: كراتين = 2، حبات/كرتون = 12 — أو كجم = 500/طن = 2 …" };
  }

  const ratePct = parseRate(chosenItem.notes);
  const yer     = usdToCustomsYer(usd, ratePct);

  return {
    result: {
      usd: Number(usd.toFixed(2)),
      yer,
      ratePct,
      exchange: EXCHANGE_RATE_YER,
      factor: CUSTOMS_FACTORS[String(ratePct)] ?? 0.265,
      item: { name: chosenItem.name, unit: chosenItem.unit, notes: chosenItem.notes, price: chosenItem.price }
    }
  };
}

/* ======== API: اسأل ======== */
app.post("/api/ask", (req,res)=>{
  try{
    let { query, filled = {} } = req.body || {};
    if (!query) return res.status(400).json({ error: "query required" });

    const qSyn = applySynonyms(query);
    const results = fuse.search(qSyn);

    if (!results.length || results[0].score > 0.48){
      return res.json({ reply: "لم أجد هذا الصنف في القائمة. جرّب اسمًا أقرب أو افتح قائمة الأسعار." });
    }

    const best = results[0].item;
    const step = buildNextStepOrResult({ item: best, query: qSyn, userText: query, filledInput: filled });

    if (step.ask){
      return res.json({ ask: step.ask, choices: step.choices || null, matched: best.name });
    }

    const r = step.result;
    const text =
      `السعر التقديري: ${r.usd}$ ⇒ الرسوم التقريبية: ${r.yer.toLocaleString()} ريال (فئة ${r.ratePct}%).\n` +
      `استخدمت: سعر الصرف ${r.exchange} × معامل ${r.factor}.\n` +
      `الصنف: ${r.item.name} — الوحدة: ${r.item.unit}.`;

    return res.json({
      reply: text,
      matched: r.item.name,
      openCalcUrl: `/index.html?price=${encodeURIComponent(r.usd)}&qty=1&ratePct=${r.ratePct}`
    });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

/* ======== تشغيل ======== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log("AI server on", PORT));
