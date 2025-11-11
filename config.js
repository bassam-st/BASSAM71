// config.js
export const EXCHANGE_RATE_YER = 750;               // سعر الصرف
export const CUSTOMS_FACTORS = { "5": 0.2075, "10": 0.265 }; // نفس الحاسبة

// مرادفات لتطابق لغوي أفضل
export const SYNONYMS = {
  "شاشات": "تلفزيون",
  "شاشة": "تلفزيون",
  "تلفزيونات": "تلفزيون",
  "مودمات": "مودم",
  "راوتر": "مودم",
  "راوترات": "مودم",
  "حديد": "حديد",
  "بطاريات": "بطارية",
  "البطاريه": "بطارية",
  "ملابس": "ملابس"
};

// كلمات مفتاحية تُحدد نوع الأسئلة المطلوبة لكل صنف
export const ITEM_INTENTS = {
  "تلفزيون": { kind: "tv", needs: ["inches"] },
  "مودم":     { kind: "pcs", needs: ["countOrCarton"] },
  "ملابس":    { kind: "dz",  needs: ["cartons","dzPerCarton"] },
  "حديد":     { kind: "kgOrTon" },
  "بطارية":   { kind: "batteryTypeAh" } // يحدد النوع ثم الأمبير/ساعة
};
