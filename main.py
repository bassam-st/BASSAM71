# main.py — Bassam App (بحث مجاني + واجهة ويب + PWA)
import os, time, traceback
from typing import Optional, List, Dict

from fastapi import FastAPI, Request, Form, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from core.search import deep_search, people_search
from core.utils import ensure_dirs

# مسارات
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
CACHE_DIR = os.path.join(BASE_DIR, "cache")
ensure_dirs(TEMPLATES_DIR, STATIC_DIR, UPLOADS_DIR, CACHE_DIR)

app = FastAPI(title="Bassam — Deep Search (Free)")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

def _parse_bool(v) -> bool:
    if isinstance(v, bool): return v
    if v is None: return False
    return str(v).strip().lower() in {"1","true","yes","y","on","t"}

def _simple_summarize(text: str, max_sentences: int = 5) -> str:
    import re
    if not text: return ""
    sents = [s.strip() for s in re.split(r"(?<=[.!؟\?])\s+", text) if s.strip()]
    if len(sents) <= max_sentences: return " ".join(sents)
    def score(s: str) -> float:
        words = re.findall(r"\w+", s.lower())
        return 0.7*len(s) + 0.3*len(set(words))
    ranked = sorted(sents, key=score, reverse=True)[:max_sentences]
    ranked.sort(key=lambda s: sents.index(s))
    return " ".join(ranked)

def _sources_to_text(sources: List[Dict], limit: int = 12) -> str:
    return " ".join([(s.get("snippet") or "") for s in (sources or [])][:limit])

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/healthz")
def healthz(): return {"status":"ok"}

@app.post("/search")
async def search_api(request: Request, q: Optional[str] = Form(None), want_prices: Optional[bool] = Form(False)):
    t0 = time.time()
    try:
        if not q:
            try: body = await request.json()
            except Exception: body = {}
            q = (body.get("q") or "").strip()
            want_prices = _parse_bool(body.get("want_prices"))
        if not q: return JSONResponse({"ok":False,"error":"query_is_empty"}, 400)

        hits = deep_search(q, include_prices=_parse_bool(want_prices))
        text_blob = _sources_to_text(hits, limit=12)
        answer = _simple_summarize(text_blob, 5) or "تم العثور على نتائج — راجع الروابط."
        return {"ok":True,
                "latency_ms": int((time.time()-t0)*1000),
                "answer": answer,
                "sources": [{"title":h.get("title") or h.get("url"), "url":h.get("url")} for h in hits[:12]]}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"ok":False,"error":f"search_failed:{type(e).__name__}"}, 500)

@app.post("/people")
async def people_api(request: Request, name: Optional[str] = Form(None)):
    try:
        if not name:
            try: body = await request.json()
            except Exception: body = {}
            name = (body.get("name") or "").strip()
        if not name: return JSONResponse({"ok":False,"error":"name_is_empty"}, 400)
        hits = people_search(name) or []
        return {"ok":True, "sources":[{"title":h.get("title") or h.get("url"), "url":h.get("url")} for h in hits[:20]]}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"ok":False,"error":f"people_failed:{type(e).__name__}"}, 500)

@app.post("/upload_pdf")
async def upload_pdf(file: UploadFile = File(...)):
    try:
        fname = os.path.basename(file.filename)
        dest = os.path.join(UPLOADS_DIR, fname)
        with open(dest,"wb") as f: f.write(await file.read())
        return {"ok":True,"message":"تم الرفع.","filename":fname}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"ok":False,"error":f"pdf_failed:{type(e).__name__}"}, 500)

@app.post("/upload_image")
async def upload_image(file: UploadFile = File(...)):
    try:
        fname = os.path.basename(file.filename)
        dest = os.path.join(UPLOADS_DIR, fname)
        with open(dest,"wb") as f: f.write(await file.read())
        return {"ok":True,"message":"تم رفع الصورة.","filename":fname}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"ok":False,"error":f"img_failed:{type(e).__name__}"}, 500)
