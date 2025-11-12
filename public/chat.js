const chat = document.getElementById("chat");
const form = document.getElementById("f");
const qEl  = document.getElementById("q");

// عرض رسالة
function push(text, who="bot"){
  const div = document.createElement("div");
  div.className = `msg ${who==="you"?"you":"bot"}`;
  div.innerText = text;
  chat.appendChild(div);
  div.scrollIntoView({behavior:"smooth", block:"end"});
}

// بداية
push("أهلًا! اسألني مثل: كم جمارك الملابس، كم جمارك شاشة 50 بوصة، كم جمارك الحديد، كم جمارك البطاريات.");

let filled = {}; // حالة الجلسة

form.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const query = (qEl.value||"").trim();
  if(!query) return;
  push(query,"you");
  qEl.value = "";

  try{
    const r = await fetch("/api/ask", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ query, filled })
    });
    const data = await r.json();

    if(data.ask){
      push(data.ask);
      if(data.choices && Array.isArray(data.choices)){
        push("خيارات: " + data.choices.join(" • "));
      }
      // حفظ سياق بسيط لو احتجنا
      if(data.context) filled = {...filled, ...data.context};
      return;
    }

    if(data.reply){
      push(data.reply);
      if(data.openCalcUrl){
        const a = document.createElement("a");
        a.href = data.openCalcUrl;
        a.innerText = "فتح في الحاسبة";
        a.target = "_blank";
        const div = document.createElement("div");
        div.className = "msg bot";
        div.appendChild(a);
        chat.appendChild(div);
      }
      filled = {}; // ننهي الجلسة
      return;
    }

    if(data.suggestions){
      push(`لم أجد هذا الصنف في القائمة. أقرب نتائج: ${data.suggestions.join("، ")}`);
      if(data.taught){ push("✔ تم حفظ الاسم الذي كتبته كمرادف للصنف الأقرب للمرة القادمة."); }
      return;
    }

    if(data.error){ push("تعذّر الاتصال بالخادم."); }
  }catch(err){
    push("تعذّر الاتصال بالخادم.");
  }
});
