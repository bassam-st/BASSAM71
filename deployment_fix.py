"""
حلول مشاكل النشر لبسام الذكي
تشخيص وإصلاح المشاكل المحتملة عند النشر
"""

import os
import sys
import importlib

def check_environment():
    """فحص البيئة والمتطلبات"""
    print("🔍 فحص البيئة...")
    
    # فحص Python version
    print(f"🐍 إصدار Python: {sys.version}")
    
    # فحص متغيرات البيئة
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        print(f"✅ GEMINI_API_KEY: موجود (يبدأ بـ {gemini_key[:10]}...)")
    else:
        print("❌ GEMINI_API_KEY: غير موجود!")
    
    # فحص المكتبات المطلوبة
    required_packages = [
        'fastapi', 'uvicorn', 'google.generativeai', 
        'sympy', 'numpy', 'httpx', 'duckduckgo_search'
    ]
    
    for package in required_packages:
        try:
            importlib.import_module(package)
            print(f"✅ {package}: مثبت")
        except ImportError:
            print(f"❌ {package}: غير مثبت!")
    
    # فحص مجلدات المشروع
    core_files = ['core/ai_engine.py', 'core/math_engine.py', 'core/search.py', 'core/utils.py']
    for file in core_files:
        if os.path.exists(file):
            print(f"✅ {file}: موجود")
        else:
            print(f"❌ {file}: مفقود!")

def create_deployment_files():
    """إنشاء ملفات النشر المطلوبة"""
    
    # ملف runtime.txt لـ Heroku
    with open('runtime.txt', 'w') as f:
        f.write('python-3.11.7\n')
    
    # ملف .env.example للمطورين
    with open('.env.example', 'w') as f:
        f.write('GEMINI_API_KEY=your_gemini_api_key_here\n')
    
    # ملف app.yaml لـ Google Cloud
    with open('app.yaml', 'w') as f:
        f.write("""runtime: python311

env_variables:
  GEMINI_API_KEY: "your_gemini_api_key_here"

automatic_scaling:
  min_instances: 1
  max_instances: 10
""")
    
    print("✅ تم إنشاء ملفات النشر!")

if __name__ == "__main__":
    check_environment()
    create_deployment_files()