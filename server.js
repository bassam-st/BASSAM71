import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import Fuse from "fuse.js";
import fs from "fs";
import path from "path";
import {
  EXCHANGE_RATE_YER,
  CUSTOMS_FACTORS,
  SYNONYMS as BASE_SYNS,
  ITEM_INTENTS,
  ROLLS_TYPES
} from "./config.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// مسارات البيانات
const dataDir = "./data";
const pricesPath = "./prices/fallback_prices_catalog.json";
const learnedSynonymsPath = path.join(dataDir, "aliases.json");
const unknownPath = path.join(dataDir, "unknown_queries.json");

// تأكد من المجلدات
if(!fs.existsSync("./prices")) fs.mkdirSync("./prices",{recursive:true});
if(!fs.existsSync(dataDir)) fs.mkdirSync(dataDir,{recursive:true});
if(!fs.existsSync(learnedSynonymsPath)) fs.writeFileSync(learnedSynonymsPath,"{}", "utf8");
if(!fs.existsSync(unknownPath)) fs.writeFileSync(unknownPath,"[]","utf8");

// تحميل القائمة
let CATALOG = [];
try{
  CATALOG = JSON.parse(fs.readFileSync(pricesPath,"utf8"));
}catch{ CATALOG = []; }

// تحميل المرادفات المتعلمة
function loadLearned(){
  try{ return JSON.parse(fs.readFileSync(learnedSynonymsPath,"utf8")); }
  catch{ return {}; }
}
function saveLearned(obj){
  try{ fs.writeFileSync(learnedSynonymsPath, JSON.stringify(obj, null, 2), "utf8"); } catch{}
}
let LEARNED = loadLearned();

// أدوات
const norm = s => String(s||"").toLowerCase().trim().replace(/\s+/g," ");

function applySynonyms(q){
  const map = {...BASE_SYNS, ...LEARNED};
  const words = norm(q).split(" ");
  return words.map(w => map[w] ? map[w] : w).join(" ");
}

function parseRate(notes=""){
  const s = notes.replace(/\s+/g,"");
  if(/الفئة?10%|10%/i.test(s)) return 10;
  if(/الفئة?5%|5%/i.test(s)) return 5;
  return 10;
}

function usdToCustomsYer(usd, ratePct){
  const factor = CUSTOMS_FACTORS[String(ratePct)] ?? 0.265;
  return Math.round(usd * EXCHANGE_RATE_YER * factor);
}

// محرّك البحث
let fuse = new Fuse(CATALOG, {
  keys: ["name", "notes"],
  includeScore: true,
  threshold: 0.36,
  distance: 100,
  useExtendedSearch: true
});

function detectIntent(text){
  const q = norm(text);
  for(const key of Object.keys(ITEM_INTENTS)){
    if(q.includes(norm(key))) return ITEM_INTENTS[key];
  }
  return null;
}

function refineRollItem(baseQuery, rollType){
  if(!rollType) return null;
  const tokens = ROLLS_TYPES[rollType] || [];
  const q = `${baseQuery} ${tokens.join(" ")}`.trim();
  const found = fuse.search(q);
  if(!found.length) return null;
  for(const r of found){
    const name = norm(r.item.name);
    if(tokens.some(t => name.includes(norm(t)))) return r.item;
  }
  return found[0].item;
}

function computeUSD(item, filled){
  const unit = (item.unit||"").toLowerCase();
  const price = Number(item.price||0);
  if(!(price>0)) return 0;

  if(filled.kind === "tv"){
    const inches = Number(filled.inches||0);
    if(!(inches>0)) return NaN;
    return inches * price;
  }

  if(filled.kind === "pcs"){
    if(filled.count && Number(filled.count)>0) return Number(filled.count)*price;
    if(filled.cartons && filled.perCarton) return Number(filled.cartons)*Number(filled.perCarton)*price;
    return NaN;
  }

  if(unit==="dz" || filled.kind==="dz"){
    if(filled.cartons && filled.dzPerCarton){
      const dozens = Number(filled.cartons)*Number(filled.dzPerCarton);
      return dozens*price;
    }
    if(filled.pieces) return (Number(filled.pieces)/12)*price;
    return NaN;
  }

  if(filled.kind==="kgOrTon" || unit==="kg" || unit==="ton" || filled.kind==="rolls"){
    if(unit==="ton"){
      if(filled.kg) return (Number(filled.kg)/1000)*price;
      if(filled.tons) return Number(filled.tons)*price;
    }
    if(unit==="kg"){
      if(filled.kg) return Number(filled.kg)*price;
      if(filled.tons) return Number(filled.tons)*1000*price;
    }
    return NaN;
  }

  if(filled.kind==="batteryTypeAh"){
    if(!filled.batteryType) return NaN;
    if(unit==="ah" && filled.ah) return Number(filled.ah)*price;
    const count = Number(filled.count||1);
    return count*price;
  }

  if(filled.qty) return Number(filled.qty)*price;
  return NaN;
}

function nextStepOrResult({item,query,filled}){
  const intent = detectIntent(item?.name || query) || {kind:null};

  if(intent.kind==="tv" && !filled.inches){
    return { ask:"كم بوصة للشاشة؟ (اكتب رقم مثل 32 أو 43)" , context:{kind:"tv"} };
  }
  if(intent.kind==="pcs"){
    if(!filled.count && !(filled.cartons && filled.perCarton)){
      return { ask:"أحسب بالحبة مباشرة أم بالكرتون؟", choices:["بالحبة — اكتب: عدد الحبات = 24","بالكرتون — اكتب: الكراتين = 2 و الحبات/كرتون = 12"], context:{kind:"pcs"} };
    }
  }
  if(intent.kind==="dz"){
    if(!(filled.cartons && filled.dzPerCarton) && !filled.pieces){
      return { ask:"أحسب بالدرزن أم بالحبات؟", choices:["بالكرتون/درزن — اكتب: الكراتين = 3 و الدزن/كرتون = 10","بالحبات — اكتب: الحبات = 120"], context:{kind:"dz"} };
    }
  }
  if(intent.kind==="kgOrTon" && !filled.kg && !filled.tons){
    return { ask:"تحب أحسب لك بالكيلو أم بالطن؟ (اكتب: كجم = 500 أو أطنان = 2)" , context:{kind:"kgOrTon"} };
  }
  if(intent.kind==="rolls"){
    if(!filled.rollType){
      return { ask:"نوع الرولات؟ (شفافة أم مطبوعة)", choices:["شفافة","مطبوعه"], context:{kind:"rolls"} };
    }
    if(!filled.kg && !filled.tons){
      return { ask:"تحب أحسب لك بالكيلو أم بالطن؟ (اكتب: كجم = 500 أو أطنان = 2)", context:{kind:"rolls"} };
    }
  }

  const usd = computeUSD(item, {...filled, kind:intent.kind});
  if(!(usd>0)) return { ask:"أحتاج تفاصيل أكثر لإكمال الحساب (أعد كتابة القيم بالنمط الموضح)." };

  const ratePct = parseRate(item.notes);
  const yer = usdToCustomsYer(usd, ratePct);
  return {
    result:{
      usd:Number(usd.toFixed(2)),
      ratePct,
      yer,
      exchange:EXCHANGE_RATE_YER,
      factor:CUSTOMS_FACTORS[String(ratePct)] ?? 0.265,
      item:{ name:item.name, unit:item.unit, notes:item.notes, price:item.price }
    }
  };
}

// تعلّم مرادف جديد: يسجّل ما كتبه المستخدم لأقرب صنف
function learnAlias(userQuery, bestItemName){
  const uq = norm(userQuery);
  const base = {...BASE_SYNS, ...LEARNED};
  // لا تُسجل لو الكلمة أصلاً مرادف أو مثل الاسم تمامًا
  if(base[uq] || norm(bestItemName)===uq) return false;
  LEARNED[uq] = bestItemName;
  saveLearned(LEARNED);
  return true;
}

app.get("/api/ping/", (_req,res)=> res.json({ok:true, at:new Date().toISOString()}));

app.post("/api/ask", (req,res)=>{
  try{
    let { query, filled = {} } = req.body || {};
    if(!query) return res.status(400).json({error:"query required"});

    // طبّق المرادفات (الثابتة + المتعلمة)
    const qSyn = applySynonyms(query);

    // ابحث
    let results = fuse.search(qSyn);

    // لو لم نجد، اقترح أقرب 3 أصناف وتعلّم المرادف تلقائي
    if(!results.length || results[0].score > 0.55){
      // اقترح من دون مرادفات (جرّب خام)
      const alt = fuse.search(query).slice(0,3).map(x=>x.item.name);
      // حفظ “الاستعلام غير المعروف”
      try{
        const arr = JSON.parse(fs.readFileSync(unknownPath,"utf8"));
        arr.push({ q: query, ts: Date.now() });
        fs.writeFileSync(unknownPath, JSON.stringify(arr,null,2), "utf8");
      }catch{}
      let taught = false;
      if(alt.length){
        taught = learnAlias(query, alt[0]); // اربط أول اقتراح بالاسم الذي كتبه المستخدم
      }
      return res.json({ suggestions: alt, taught });
    }

    // أفضل نتيجة
    let item = results[0].item;

    // لو كانت رولات ونوع محدد
    const intent = detectIntent(qSyn);
    if(intent?.kind==="rolls" && filled.rollType){
      const refined = refineRollItem(qSyn, filled.rollType);
      if(refined) item = refined;
    }

    const step = nextStepOrResult({ item, query:qSyn, filled });

    if(step.ask) return res.json({ ask: step.ask, choices: step.choices||null, context: step.context||null, matched:item.name });

    const r = step.result;
    const text =
      `السعر التقديري: ${r.usd}$ ⇒ رسوم تقريبية: ${r.yer.toLocaleString()} ريال يمني (فئة ${r.ratePct}%).\n`+
      `استخدمت: سعر الصرف ${r.exchange} × معامل ${r.factor}.\n`+
      `الصنف: ${r.item.name} — الوحدة: ${r.item.unit}.`;

    res.json({
      reply: text,
      openCalcUrl: `/index.html?price=${encodeURIComponent(r.usd)}&qty=1&ratePct=${r.ratePct}`
    });

  }catch(e){
    console.error(e);
    res.status(500).json({error:"server error"});
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log("AI server on", PORT));
