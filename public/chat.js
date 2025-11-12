const log = document.getElementById("log");
const form = document.getElementById("f");
const q = document.getElementById("q");

function bubble(text, who="ai"){
  const div = document.createElement("div");
  div.className = "bubble " + (who==="me"?"me":"ai");
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

form.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const text = q.value.trim();
  if(!text) return;
  bubble(text, "me");
  q.value = "";
  try{
    const r = await fetch("/api/ask", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ query: text })
    });
    const data = await r.json();
    if(data.ask){
      bubble(data.ask + (data.choices? ("\nخيارات: " + data.choices.join(" | ")) : ""));
    } else if (data.reply){
      bubble(data.reply + (data.openCalcUrl? ("\nفتح في الحاسبة: " + data.openCalcUrl) : ""));
    } else if (data.error){
      bubble("خطأ: " + data.error);
    } else {
      bubble("تعذّر فهم الرد.");
    }
  }catch(err){
    bubble("تعذر الاتصال بالخادم.");
  }
});
