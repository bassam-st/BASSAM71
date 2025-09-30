#!/usr/bin/env python3
"""
🔍 فحص شامل لحالة النشر - بسام الذكي
"""

import os
import sys
import importlib
import subprocess

def check_packages():
    """فحص المكتبات المطلوبة"""
    print("📦 فحص المكتبات...")
    
    packages = {
        'fastapi': 'FastAPI',
        'uvicorn': 'Uvicorn',
        'google.generativeai': 'Google AI',
        'sympy': 'SymPy',
        'numpy': 'NumPy',
        'matplotlib': 'Matplotlib',
        'httpx': 'HTTPX',
        'duckduckgo_search': 'DuckDuckGo Search'
    }
    
    for package, name in packages.items():
        try:
            module = importlib.import_module(package)
            version = getattr(module, '__version__', 'غير محدد')
            print(f"✅ {name}: مثبت (إصدار {version})")
        except ImportError:
            print(f"❌ {name}: غير مثبت!")
        except Exception as e:
            print(f"⚠️ {name}: خطأ ({e})")

def check_environment():
    """فحص متغيرات البيئة"""
    print("\n🌍 فحص متغيرات البيئة...")
    
    required_vars = ['GEMINI_API_KEY']
    optional_vars = ['PORT', 'PYTHONPATH']
    
    for var in required_vars:
        value = os.getenv(var)
        if value:
            masked = value[:10] + '***' if len(value) > 10 else '***'
            print(f"✅ {var}: موجود ({masked})")
        else:
            print(f"❌ {var}: غير موجود!")
    
    for var in optional_vars:
        value = os.getenv(var)
        if value:
            print(f"ℹ️ {var}: {value}")
        else:
            print(f"⚪ {var}: غير محدد")

def check_files():
    """فحص ملفات المشروع"""
    print("\n📁 فحص ملفات المشروع...")
    
    required_files = [
        'main.py',
        'requirements.txt',
        'core/ai_engine.py',
        'core/math_engine.py',
        'core/search.py',
        'core/utils.py',
        'core/advanced_intelligence.py'
    ]
    
    optional_files = [
        'Procfile',
        'render.yaml',
        'runtime.txt',
        'service-worker.js',
        'manifest.json'
    ]
    
    for file in required_files:
        if os.path.exists(file):
            size = os.path.getsize(file)
            print(f"✅ {file}: موجود ({size} بايت)")
        else:
            print(f"❌ {file}: مفقود!")
    
    for file in optional_files:
        if os.path.exists(file):
            size = os.path.getsize(file)
            print(f"ℹ️ {file}: موجود ({size} بايت)")

def test_ai_engine():
    """اختبار محرك الذكاء الاصطناعي"""
    print("\n🤖 اختبار محرك الذكاء الاصطناعي...")
    
    try:
        sys.path.append('.')
        from core.ai_engine import ai_engine
        
        if ai_engine.is_gemini_available():
            print("✅ محرك الذكاء الاصطناعي: يعمل")
            
            # اختبار بسيط
            result = ai_engine.answer_question("مرحبا")
            if result:
                print("✅ اختبار الإجابة: نجح")
            else:
                print("⚠️ اختبار الإجابة: فشل")
        else:
            print("❌ محرك الذكاء الاصطناعي: لا يعمل")
            
    except Exception as e:
        print(f"❌ خطأ في محرك الذكاء الاصطناعي: {e}")

def test_math_engine():
    """اختبار محرك الرياضيات"""
    print("\n🔢 اختبار محرك الرياضيات...")
    
    try:
        from core.math_engine import math_engine
        
        # اختبار بسيط
        result = math_engine.solve_math_problem("2+2")
        if result and 'result' in result:
            print("✅ محرك الرياضيات: يعمل")
            print(f"   نتيجة 2+2: {result.get('result', 'غير محدد')}")
        else:
            print("❌ محرك الرياضيات: لا يعمل")
            
    except Exception as e:
        print(f"❌ خطأ في محرك الرياضيات: {e}")

def generate_deployment_guide():
    """إنشاء دليل النشر"""
    print("\n📋 إنشاء دليل النشر...")
    
    guide = """
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
"""
    
    with open('DEPLOYMENT_GUIDE.md', 'w', encoding='utf-8') as f:
        f.write(guide)
    
    print("✅ تم إنشاء دليل النشر: DEPLOYMENT_GUIDE.md")

if __name__ == "__main__":
    print("🔍 فحص شامل لحالة النشر - بسام الذكي\n")
    
    check_packages()
    check_environment() 
    check_files()
    test_ai_engine()
    test_math_engine()
    generate_deployment_guide()
    
    print("\n" + "="*50)
    print("🎯 انتهى الفحص! راجع النتائج أعلاه")
    print("="*50)