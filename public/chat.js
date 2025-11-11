const chat = document.getElementById("chat");
const q    = document.getElementById("q");
const sendBtn = document.getElementById("send");

function addBubble(who, text){
  const d = document.createElement("div");
  d.className = "bub " + (who === "user" ? "user" : "bot");
  d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}
function addChip(text){
  const b = document.createElement("button");
  b.className = "chip";
  b.textContent = text;
  b.onclick = ()=> send(text);
  chat.appendChild(b);
  chat.scrollTop = chat.scrollHeight;
}
function addLink(title, href){
  const a = document.createElement("a");
  a.className = "calc";
  a.href = href; a.target = "_blank"; a.textContent = title;
  chat.appendChild(a);
  chat.scrollTop = chat.scrollHeight;
}

async function send(text=null){
  const query = (text ?? q.value).trim();
  if (!query) return;
  addBubble("user", query);
  q.value = ""; q.focus();

  try{
    const r = await fetch("/api/ask", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ query })
    });
    const data = await r.json();

    if (data.reply) addBubble("bot", data.reply);
    if (data.ask && !data.reply) addBubble("bot", data.ask);

    if (Array.isArray(data.choices)) data.choices.forEach(addChip);
    if (Array.isArray(data.suggest)) data.suggest.forEach(addChip);

    if (data.openCalcUrl) addLink("فتح في الحاسبة", data.openCalcUrl);
  }catch(e){
    addBubble("bot","تعذر الاتصال بالخادم.");
  }
}

sendBtn.onclick = ()=> send();
q.addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ e.preventDefault(); send(); } });

// ترحيب أولي
addBubble("bot","أهلاً! اسألني مثل: كم جمارك الملابس، كم جمارك شاشة 50 بوصة، كم جمارك الحديد، كم جمارك البطاريات.");
