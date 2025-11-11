const log = document.getElementById('log');
const form = document.getElementById('chatForm');
const input = document.getElementById('msg');
const sendBtn = document.getElementById('sendBtn');

function addBubble(text, who = 'bot') {
  const div = document.createElement('div');
  div.className = 'bubble ' + (who === 'me' ? 'me' : 'bot');
  div.innerHTML = text.replace(/\n/g, '<br>');
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// رسالة ترحيب خفيفة
addBubble('أهلاً! اسألني مثل: كم جمارك الملابس، كم جمارك شاشة 50 بوصة، كم جمارك الحديد، كم جمارك البطاريات.');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = (input.value || '').trim();
  if (!q) return;
  addBubble(q, 'me');
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  try {
    // نفس الدومين/المسار الذي يقدمه الخادم (server.js)
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q })
    });

    if (!r.ok) {
      const txt = await r.text().catch(()=>'');
      addBubble('تعذّر الاتصال بالخادم.\n' + (txt || (`HTTP ${r.status}`)));
    } else {
      const data = await r.json();
      if (data.reply) addBubble(data.reply);
      else if (data.ask) {
        let t = data.ask;
        if (data.choices && Array.isArray(data.choices)) {
          t += '<br><br>خيارات: • ' + data.choices.join(' • ');
        }
        addBubble(t);
      } else {
        addBubble('لم أتلقَّ ردًا مفهومًا.');
      }

      if (data.openCalcUrl) {
        addBubble(`<a href="${data.openCalcUrl}">فتح في الحاسبة</a>`);
      }
    }
  } catch (err) {
    addBubble('تعذّر الاتصال بالخادم.');
    console.error(err);
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
});
