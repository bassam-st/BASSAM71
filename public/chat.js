/* public/chat.js — نسخة نهائية مع إعادة المحاولة و /api/ping */

const form = document.querySelector("#chat-form");
const input = document.querySelector("#chat-input");
const box  = document.querySelector("#chat-box");

// رسالة فورية في الواجهة
function pushBubble(text, kind = "bot") {
  const li = document.createElement("div");
  li.className = "bubble " + kind;
  li.innerHTML = text;
  box.appendChild(li);
  box.scrollTop = box.scrollHeight;
}

// إيقاظ الخادم عند فتح الصفحة
fetch("/api/ping").catch(()=>{});

// إرسال السؤال إلى الخادم مع إعادة المحاولة
async function askServer(text, filled = {}) {
  const url = "/api/ask";
  const payload = { query: text, filled };

  // Render قد يحتاج 1-10 ثواني ليصحو من النوم.
  // نحاول ثلاث مرات: الآن، بعد 1.5ث، بعد 3.5ث. مهلة كل محاولة 12ث.
  const tries = [0, 1500, 3500];
  let lastErr;

  for (const waitMs of tries) {
    if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("network");
}

// رندر رسالة النظام الترحيبية مرة واحدة
(function greetOnce(){
  const greeted = sessionStorage.getItem("ai_greeted");
  if (!greeted) {
    pushBubble("أهلًا! اسألني مثل: كم جمارك الملابس، كم جمارك شاشة 50 بوصة، كم جمارك الحديد، كم جمارك البطاريات.");
    sessionStorage.setItem("ai_greeted", "1");
  }
})();

// التعامل مع الإرسال
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = (input.value || "").trim();
  if (!text) return;
  pushBubble(text, "user");
  input.value = "";

  // مؤشر انتظار
  const thinking = document.createElement("div");
  thinking.className = "bubble bot";
  thinking.textContent = "⏳ جاري المعالجة…";
  box.appendChild(thinking);
  box.scrollTop = box.scrollHeight;

  try {
    const res = await askServer(text);
    // الخادم يعيد { replyHtml: "...", openCalcUrl?: "..." }
    thinking.remove();
    if (res && res.replyHtml) {
      pushBubble(res.replyHtml, "bot");
    } else if (res && res.reply) {
      pushBubble(String(res.reply), "bot");
    } else {
      pushBubble("لم أفهم الرد من الخادم.", "bot");
    }
  } catch (err) {
    thinking.remove();
    pushBubble("تعذّر الاتصال بالخادم.", "bot");
  }
});
