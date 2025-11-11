(function(){
  const chat = document.getElementById('chat');
  const msg  = document.getElementById('msg');
  const send = document.getElementById('send');

  const sessionId = (() => {
    const k = "ai_bassam_session_id";
    let v = localStorage.getItem(k);
    if (!v) { v = crypto.randomUUID(); localStorage.setItem(k, v); }
    return v;
  })();

  function addBubble(text, who="ai", open_calc=null, quick=[]) {
    const div = document.createElement('div');
    div.className = "m " + (who === "me" ? "me" : "ai");
    div.innerHTML = text.replace(/\n/g,"<br>");
    chat.appendChild(div);

    if (open_calc) {
      const link = document.createElement('a');
      link.href = open_calc;
      link.textContent = "فتح في الحاسبة";
      link.style.display = "inline-block";
      link.style.marginTop = "6px";
      div.appendChild(document.createElement('br'));
      div.appendChild(link);
    }

    if (quick && quick.length) {
      const q = document.createElement('div');
      q.className = "quick";
      quick.forEach(txt=>{
        const b = document.createElement('button');
        b.textContent = txt;
        b.onclick = ()=>{ msg.value = txt; send.click(); };
        q.appendChild(b);
      });
      chat.appendChild(q);
    }

    chat.scrollTop = chat.scrollHeight;
  }

  async function ask(text){
    addBubble(text, "me");
    msg.value = "";
    try{
      const r = await fetch("/api/assist", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({sessionId, text})
      });
      const data = await r.json();
      addBubble(data.reply || "—", "ai", data.open_calc, data.quick);
    }catch(e){
      addBubble("تعذر الاتصال بالخادم.", "ai");
    }
  }

  send.addEventListener("click", ()=>{
    const t = msg.value.trim();
    if (!t) return;
    ask(t);
  });
  msg.addEventListener("keydown", e=>{
    if(e.key==="Enter"){ e.preventDefault(); send.click(); }
  });

  // رسالة ترحيب
  addBubble("أهلًا! اسألني مثل: <b>كم جمارك الملابس</b>، <b>كم جمارك شاشه 50 بوصه</b>، <b>كم جمارك الحديد</b>، <b>كم جمارك البطاريات</b>.");
})();
