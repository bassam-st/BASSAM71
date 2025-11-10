import express from "express";
import cors from "cors";
import axios from "axios";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import config from "./config.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const fallbackPath = path.join("prices", "fallback_prices_catalog.json");

// تحميل الأسعار من الشبكة أو من النسخة المحلية الاحتياطية
async function loadPrices() {
  try {
    const { data } = await axios.get(config.PRICE_CATALOG_URL, { timeout: 8000 });
    return Array.isArray(data) ? data : JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
  } catch {
    return JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
  }
}

// تحديد فئة الرسوم (5% أو 10%)
function extractRate(notes = "") {
  const s = String(notes).replace(/\s+/g, "");
  if (/5%|الفئة5/.test(s)) return 0.05;
  if (/10%|الفئة10/.test(s)) return 0.10;
  return 0.05;
}

// المعالجة الذكية للسؤال
app.post("/api/ask", async (req, res) => {
  const { question } = req.body;
  if (!question) return res.json({ answer: "يرجى كتابة السؤال." });

  const prices = await loadPrices();
  const q = question.toLowerCase();

  const found = prices.find(x => q.includes(x.name.toLowerCase().split(" ")[0]));
  if (!found)
    return res.json({ answer: "لم أجد هذا الصنف في القائمة. تأكد من الاسم أو أضفه كمُدخل جديد." });

  const rate = extractRate(found.notes);
  const priceUSD = found.price;
  const priceYER = priceUSD * (1 + rate) * config.FX_YER_PER_USD;

  // رد ذكي حسب نوع السلعة
  let answer = "";
  if (q.includes("قطع غيار")) {
    answer = `هل القطع جديدة أم مستخدمة؟ السعر الأساسي: ${priceUSD}$ (${Math.round(priceYER)} ريال).`;
  } else if (q.includes("ملابس")) {
    answer = `هل تريد الحساب بالدرزن أم بالكرتون؟ السعر للدرزن: ${priceUSD}$ (${Math.round(priceYER)} ريال).`;
  } else if (q.includes("تلفزيون") || q.includes("شاشة")) {
    answer = `ما مقاس الشاشة بالبوصة؟ أقل من 40 بوصة = 3$/بوصة، فوق 40 = 4$/بوصة.`;
  } else {
    answer = `السعر التقريبي: ${priceUSD}$ (${Math.round(priceYER)} ريال يمني، فئة ${rate * 100}%).`;
  }

  // إضافة رابط فتح الحاسبة بنفس السعر
  const calcLink = `${config.CALCULATOR_URL}?price=${encodeURIComponent(priceUSD)}&ratePct=${rate * 100}`;
  res.json({ answer, link: calcLink });
});

// واجهة اختبار سريعة
app.get("/api/test", async (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.listen(config.PORT, () => console.log(`✅ AI Assistant running on port ${config.PORT}`));
