# bassam_brain.py
import os
from pathlib import Path

# مكان النواة
MODEL_PATH = os.getenv("BASSAM_MODEL", "models/tinyllama-1.1b-chat.gguf")

def load_model():
    if not Path(MODEL_PATH).exists():
        raise FileNotFoundError(
            f"⚠️ النموذج غير موجود في {MODEL_PATH}. "
            "نزّل النموذج وضعه في المجلد models أو عدّل الرابط."
        )
    print(f"✅ تم تحميل النموذج من: {MODEL_PATH}")
    # هنا تضيف كود تشغيل النموذج (مثلاً باستخدام llama.cpp أو مكتبة أخرى)

def ask_brain(prompt: str) -> str:
    # حالياً مجرد رد تجريبي
    return f"🤖 (تجريبي) استلمت سؤالك: {prompt}"
