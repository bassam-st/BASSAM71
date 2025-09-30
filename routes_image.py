# routes_image.py
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import HTMLResponse
from core.ocr import ocr_image_with_hf
from core.math_engine import math_engine

router = APIRouter(tags=["image-solver"])

@router.get("/upload", response_class=HTMLResponse)
async def upload_page():
    return """
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>📷 حل مسألة من صورة - بسام</title>
      <style>
        body{font-family:Tahoma,Arial;direction:rtl;background:#f6f7fb;margin:0;padding:20px}
        .card{max-width:700px;margin:0 auto;background:#fff;border-radius:14px;padding:20px;box-shadow:0 10px 25px rgba(0,0,0,.06)}
        h1{margin:0 0 10px}
        .f{display:flex;gap:10px;align-items:center;margin:12px 0}
        .btn{background:#5b76f7;color:#fff;border:none;border-radius:10px;padding:12px 16px;cursor:pointer;font-weight:bold}
        .inp{padding:10px;border:2px solid #e1e5e9;border-radius:10px;width:100%}
        small{color:#666}
        a{color:#5b76f7;text-decoration:none}
      </style>
    </head>
    <body>
      <div class="card">
        <h1>📷 حل من صورة</h1>
        <p>ارفع صورة للمسألة (مطبوع أو خط يد واضح). سيتم التعرف على النص ثم حلّه.</p>
        <form method="post" action="/solve-image" enctype="multipart/form-data">
          <div class="f">
            <input class="inp" type="file" accept="image/*" name="image" id="image" capture="environment" required>
          </div>
          <button class="btn" type="submit">حلّ الآن</button>
        </form>
        <p style="margin-top:12px"><a href="/">↩ العودة للصفحة الرئيسية</a></p>
      </div>
    </body>
    </html>
    """

@router.post("/solve-image", response_class=HTMLResponse)
async def solve_image(image: UploadFile = File(...)):
    """
    يستقبل صورة، يجري OCR عبر HF، ثم يمرر النص لمحرك الرياضيات الحالي.
    يعرض صفحة نتائج بسيطة.
    """
    try:
        img_bytes = await image.read()
        text = await ocr_image_with_hf(img_bytes)
        if not text:
            return HTMLResponse("""
            <div style="font-family:Tahoma,Arial;direction:rtl;padding:20px">
              <h3>❌ تعذر قراءة النص من الصورة</h3>
              <p>جرّب صورة أوضح/أعلى دقة، أو نص مطبوع.</p>
              <p><a href="/upload">↩ الرجوع</a></p>
            </div>
            """, status_code=200)

        # مرّر النص كما هو إلى محركك الحالي
        result = math_engine.solve_math_problem(text)

        def esc(s: str) -> str:
            return (s or "").replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")

        body = f"""
        <div style="font-family:Tahoma,Arial;direction:rtl;padding:20px">
          <h2>📄 النص المستخرج</h2>
          <pre style="background:#f7f7f7;padding:12px;border-radius:8px">{esc(text)}</pre>
          <h2>📐 نتيجة الحل</h2>
          <pre style="background:#eef7ff;padding:12px;border-radius:8px">{esc(str(result))}</pre>
          <p><a href="/upload">↩ حل صورة أخرى</a> | <a href="/">الصفحة الرئيسية</a></p>
        </div>
        """
        return HTMLResponse(body)

    except Exception as e:
        return HTMLResponse(f"<h3>خطأ: {e}</h3><p><a href='/upload'>↩ العودة</a></p>", status_code=500)
