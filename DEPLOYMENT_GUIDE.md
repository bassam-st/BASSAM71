
# 🚀 دليل نشر بسام الذكي

## متطلبات النشر:

### 1. متغيرات البيئة:
```
GEMINI_API_KEY=your_api_key_here
```

### 2. ملفات مطلوبة:
- main.py (نقطة الدخول)
- requirements.txt (المكتبات)
- core/ (ملفات المحرك)

### 3. أوامر النشر:

#### Render:
```bash
git add .
git commit -m "نشر بسام الذكي"
git push origin main
```

#### Heroku:
```bash
heroku create bassam-smart-app
heroku config:set GEMINI_API_KEY=your_key
git push heroku main
```

### 4. اختبار النشر:
```bash
curl https://your-app.com/health
```

## حل المشاكل الشائعة:

### مشكلة: التطبيق لا يجيب
- تأكد من وجود GEMINI_API_KEY
- فحص logs للأخطاء
- تأكد من تثبيت جميع المكتبات

### مشكلة: أخطاء استيراد
- تأكد من وجود ملفات core/
- فحص requirements.txt
- إعادة تشغيل الخدمة
