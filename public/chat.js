async function ask(){
  const q = document.getElementById('q').value.trim();
  if(!q) return;
  const log=document.getElementById('log');
  log.innerHTML += `<div class="msg user">${q}</div>`;
  document.getElementById('q').value='';

  const res = await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})});
  const data = await res.json();
  const link = data.link ? `<br><a href="${data.link}" target="_blank">فتح في الحاسبة</a>` : '';
  log.innerHTML += `<div class="msg bot">${data.answer}${link}</div>`;
  log.scrollTop = log.scrollHeight;
}
