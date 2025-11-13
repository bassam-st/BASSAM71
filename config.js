// config.js

export const CALCULATOR_URL =
  process.env.CALCULATOR_URL ||
  "https://bassam-customs-calculator.onrender.com/index.html";

// سعر الصرف (ريال يمني لكل 1 دولار)
export const EXCHANGE_RATE_YER = Number(process.env.FX_YER_PER_USD || 910);

// معامل تحويل الجمارك (مثل تطبيقك الأساسي)
export const CUSTOMS_FACTORS = {
  "5": 0.1325,
  "10": 0.265
};

// مرادفات بسيطة للأصناف (لتسهيل البحث حتى لو كتب المستخدم كلمة مختلفة قليلاً)
export const SYNONYMS = {
  "ملابس": "ملابس",
  "ثياب": "ملابس",
  "هدوم": "ملابس",

  "شاشة": "شاشة",
  "شاشه": "شاشة",
  "شاشات": "شاشة",
  "تلفزيون": "شاشة",
  "تلفزيونات": "شاشة",

  "مودم": "مودمات",
  "مودمات": "مودمات",
  "راوتر": "مودمات",

  "بطاريات": "بطاريات",
  "بطاريه": "بطاريات",
  "بطاري": "بطاريات",

  "رولات": "رولات",
  "رول": "رولات"
};
