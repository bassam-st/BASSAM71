// config.js — إعدادات قابلة للضبط من متغيّرات البيئة
export const EXCHANGE_RATE_YER = Number(process.env.FX_YER_PER_USD || 910);
export const CALCULATOR_URL = process.env.CALCULATOR_URL 
    || "https://bassam-customs-calculator.onrender.com/index.html";
export const PRICE_CATALOG_URL = process.env.PRICE_CATALOG_URL 
    || "https://bassam-customs-calculator.onrender.com/assets/prices_catalog.json";

// معاملات التحويل للجمارك (مثل تطبيقك الأساسي)
export const CUSTOMS_FACTORS = {
  "5": 0.1325,
  "10": 0.265
};

// مرادفات تساعد في البحث المرن
export const SYNONYMS = {
  "ملبس": "ملابس",
  "ثياب": "ملابس",
  "تي": "شاشات",
  "تلفزيون": "شاشات",
  "تلفزيونات": "شاشات",
  "شاشه": "شاشات",
  "موبايل": "جوال",
  "جوالات": "هواتف",
  "مودم": "مودمات",
  "مودمات": "مودمات",
  "رول": "رولات",
  "رولات": "رولات",
  "بطاريه": "بطاريات",
  "بطاري": "بطاريات"
};

// نوايا الأصناف الشائعة
export const ITEM_INTENTS = {
  "شاشات": { kind: "tv" },
  "ملابس": { kind: "dz" },
  "مودمات": { kind: "pcs" },
  "شاشات جوالات": { kind: "pcs" },
  "رولات": { kind: "rolls" },
  "حديد": { kind: "kgOrTon" },
  "بطاريات": { kind: "batteryTypeAh"}
};

// أنواع الرولات
export const ROLLS_TYPES = {
  "شفافة": ["شفافة", "شفاف"],
  "مطبوعه": ["مطبوعه", "مطبوعة", "طباعة"]
};
