const elChat = document.getElementById("chat");
const elQ = document.getElementById("q");
const elSend = document.getElementById("send");

let filled = {}; // ذاكرة الجلسة

function addMsg(text, cls="bot") {
  const d = document.createElement("div");
  d.className = `msg ${cls}`;
  d.textContent = text;
  elChat.appendChild(d);
  elChat.scrollTop = elChat.scrollHeight;
}

// تحويل “خيار = قيمة” إلى تحديث للذاكرة
function parseAssignment(s) {
  // أمثلة: "عدد الحبات = 24"  |  "الكراتين = 2 و الحبات/كرتون = 12"
  const parts = s.split("و").map(p => p.trim());
  for (const p of parts) {
    const m1 = p.match(/(عدد الحبات|الحبات|عدد) ?= ?(\d+)/);
    if (m1) { filled.count = Number(m1[2]); continue; }

    const m2 = p.match(/الكراتين ?= ?(\d+)/);
    if (m2) { filled.cartons = Number(m2[1]); continue; }

    const m3 = p.match(/الحبات\/كرتون ?= ?(\d+)/);
    if (m3) { filled.perCarton = Number(m3[1]); continue; }

    const m4 = p.match(/الدزن\/كرتون ?= ?(\d+)/);
    if (m4) { filled.dzPerCarton = Number(m4[1]); continue; }

    const m5 = p.match(/الحبات ?= ?(\d+)/);
    if (m5) { filled.pieces = Number(m5[1]); continue; }

    const m6 = p.match(/كجم ?= ?(\d+)/);
    if (m6) { filled.kg = Number(m6[1]); continue; }

    const m7 = p.match(/أطنان ?= ?(\d+)/);
    if (m7) { filled.tons = Number(m7[1]); continue; }

    const m8 = p.match(/أمبير ?= ?(\d+)/);
    if (m8) { filled.ah = Number(m8[1]); continue; }

    const m9 = p.match(/عدد ?= ?(\d+)/);
    if (m9) { filled.count = Number(m9[1]); continue; }

    // البوصة مجرد رقم مستقل
    const m10 = p.match(/^(\d{2})$/);
    if (m10) { filled.inches = Number(m10[1]); }
  }
}

async function send(q) {
  addMsg(q, "you");

  // محاولة فهم إدخال المستخدم كـ “قيم” لاستكمال الحساب
  parseAssignment(q);

  const r = await fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: q, filled })
  }).then(x => x.json());

  if (r.ask) {
    addMsg(r.ask);
    if (r.choices && r.choices.length) {
      // عرض الأزرار السريعة
      const wrap = document.createElement("div");
      wrap.className = "msg bot";
      r.choices.forEach(c => {
        const b = document.createElement("button");
        b.textContent = c;
        b.style.marginInlineEnd = "8px";
        b.onclick = () => {
          addMsg(c, "you");
          parseAssignment(c);
        };
        wrap.appendChild(b);
      });
      elChat.appendChild(wrap);
      elChat.scrollTop = elChat.scrollHeight;
    }
    return;
  }

  if (r.reply) {
    addMsg(r.reply);
    if (r.openCalcUrl) {
      const d = document.createElement("div");
      d.className = "msg bot";
      d.innerHTML = `<a href="${r.openCalcUrl}">فتح في الحاسبة</a>`;
      elChat.appendChild(d);
    }
  } else if (r.error) {
    addMsg("تعذر الاتصال بالخادم.");
  }
}

elSend.onclick = () => {
  if (!elQ.value.trim()) return;
  send(elQ.value.trim());
  elQ.value = "";
};
elQ.addEventListener("keydown", (e) => {
  if (e.key === "Enter") elSend.click();
});

// تحية أولى
addMsg("أهلًا! اسألني مثل: كم جمارك الملابس، كم جمارك شاشة 50 بوصة، كم جمارك الحديد، كم جمارك البطاريات.");
