/* The Hitter's Notebook — single-page frontend (vanilla JS) */
const app = document.getElementById('app');
let currentUser = null;
let frequentTerms = [];

// ---------- helpers ----------
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
const get = (u) => api('GET', u);
const post = (u, b) => api('POST', u, b);
const put = (u, b) => api('PUT', u, b);
const del = (u) => api('DELETE', u);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'card';
  t.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99;background:var(--accent);color:var(--accent-text);font-weight:700;padding:12px 20px;border-radius:999px;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function typeLabel(t) {
  return { atbat: 'At-Bat', game: 'Game Reflection', practice: 'Team Practice', individual: 'Individual Hitting' }[t] || t;
}

// ---------- voice ----------
function wireVoice(btnId, areaId) {
  const btn = document.getElementById(btnId);
  const area = document.getElementById(areaId);
  if (!btn || !area) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.style.display = 'none';
    const hint = document.getElementById(btnId + '-hint');
    if (hint) hint.textContent = 'Voice input needs Chrome or Safari.';
    return;
  }
  let rec = null;
  btn.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    btn.classList.add('listening');
    btn.textContent = '⏹ Stop talking';
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join(' ');
      area.value = area.value ? area.value.trimEnd() + ' ' + text : text;
    };
    const done = () => {
      rec = null;
      btn.classList.remove('listening');
      btn.textContent = '🎤 Talk it out';
    };
    rec.onend = done;
    rec.onerror = (e) => { done(); if (e.error !== 'aborted') toast('Voice hiccup — try again.'); };
    try { rec.start(); } catch { done(); }
  });
}
function voiceRow(areaId, hintId) {
  return `<div class="voice-row">
    <button type="button" class="voice-btn" id="voice-${areaId}">🎤 Talk it out</button>
    <span class="voice-hint" id="voice-${areaId}-hint">Speak and it fills in below. You can edit after.</span>
  </div>`;
}

// ---------- scale input ----------
function scaleInput(name, value) {
  let btns = '';
  for (let i = 1; i <= 10; i++) {
    btns += `<button type="button" class="scale-btn${Number(value) === i ? ' selected' : ''}" data-scale="${name}" data-val="${i}">${i}</button>`;
  }
  return `<div class="scale-row" id="scale-${name}">${btns}</div>
    <input type="hidden" id="val-${name}" value="${value == null ? '' : esc(value)}">`;
}
function wireScales(root) {
  root.querySelectorAll('.scale-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const name = b.dataset.scale;
      root.querySelectorAll(`.scale-btn[data-scale="${name}"]`).forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      root.querySelector(`#val-${name}`).value = b.dataset.val;
    });
  });
}
function getScale(root, name) {
  const v = root.querySelector(`#val-${name}`).value;
  return v === '' ? null : Number(v);
}

// ---------- layout ----------
function tabbar(active) {
  const tabs = [
    ['#/home', '📝', 'Log', 'home'],
    ['#/library', '📚', 'Library', 'library'],
    ['#/routines', '🔁', 'Routines', 'routines'],
    ['#/blueprint', '✅', 'Checklist', 'blueprint'],
  ];
  return `<nav class="tabbar">${tabs.map(([h, ic, lb, k]) =>
    `<button data-nav="${h}" class="${active === k ? 'active' : ''}"><span class="ticon">${ic}</span>${lb}</button>`).join('')}</nav>`;
}
function wireNav(root) {
  root.querySelectorAll('[data-nav]').forEach((b) =>
    b.addEventListener('click', () => { location.hash = b.dataset.nav; }));
}
function topbar() {
  return `<div class="topbar">
    <div class="brand">The Hitter's Notebook<small>${esc(currentUser ? currentUser.email : '')}</small></div>
    <button class="linkbtn" id="logout-btn">Sign out</button>
  </div>`;
}
function wireLogout(root) {
  const b = root.querySelector('#logout-btn');
  if (b) b.addEventListener('click', async () => {
    await post('/api/logout', {});
    currentUser = null;
    location.hash = '#/login';
  });
}
function backBtn() {
  return `<button class="backbtn" id="back-to-menu">← Back to log menu</button>`;
}

// ---------- auth views ----------
function renderLogin() {
  app.innerHTML = `<div class="topbar"><div class="brand">The Hitter's Notebook<small>Know your swing. Train your mind.</small></div></div>
    <h1>Sign in</h1>
    <div class="card">
      <div id="err"></div>
      <label class="field">Email</label>
      <input type="email" id="email" autocomplete="email" placeholder="you@example.com">
      <label class="field">Password</label>
      <input type="password" id="password" autocomplete="current-password" placeholder="••••••••">
      <button class="btn" id="go">Sign in</button>
      <p class="sub" style="text-align:center">New here? <a href="#/signup" style="color:var(--accent)">Create an account</a></p>
    </div>`;
  document.getElementById('go').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
      const r = await post('/api/login', { email, password });
      currentUser = { email: r.email };
      location.hash = '#/home';
    } catch (e) { document.getElementById('err').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  });
}
function renderSignup() {
  app.innerHTML = `<div class="topbar"><div class="brand">The Hitter's Notebook<small>Know your swing. Train your mind.</small></div></div>
    <h1>Create your account</h1>
    <p class="sub">Your journal is private to you. Only you can see your entries.</p>
    <div class="card">
      <div id="err"></div>
      <label class="field">Email</label>
      <input type="email" id="email" autocomplete="email" placeholder="you@example.com">
      <label class="field">Password (8+ characters)</label>
      <input type="password" id="password" autocomplete="new-password" placeholder="••••••••">
      <button class="btn" id="go">Create account</button>
      <p class="sub" style="text-align:center">Have an account? <a href="#/login" style="color:var(--accent)">Sign in</a></p>
    </div>`;
  document.getElementById('go').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
      const r = await post('/api/signup', { email, password });
      currentUser = { email: r.email };
      location.hash = '#/home';
    } catch (e) { document.getElementById('err').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  });
}

// ---------- home / log menu ----------
function renderHome() {
  app.innerHTML = `${topbar()}
    <h1>Log</h1>
    <p class="sub">What are you capturing?</p>
    <div class="menu-grid">
      <div class="menu-tile" data-nav="#/log/atbat"><span class="emoji">⚾</span><div class="label">At-Bat</div><div class="hint">Log pitch by pitch, at-bat by at-bat</div></div>
      <div class="menu-tile" data-nav="#/log/game"><span class="emoji">🎯</span><div class="label">Game Reflection</div><div class="hint">Reflect on the game as a whole</div></div>
      <div class="menu-tile" data-nav="#/log/practice"><span class="emoji">👥</span><div class="label">Team Practice</div><div class="hint">Reflect on practice</div></div>
      <div class="menu-tile" data-nav="#/log/individual"><span class="emoji">🥎</span><div class="label">Individual Hitting</div><div class="hint">Cage or solo session</div></div>
    </div>
    ${tabbar('home')}`;
  wireNav(app); wireLogout(app);
  app.querySelectorAll('.menu-tile').forEach((t) =>
    t.addEventListener('click', () => { location.hash = t.dataset.nav; }));
}

// ---------- at-bat form ----------
let abSession = null; // { gameId, date, opponent, number }
function renderAtBat(existing) {
  const d = existing ? existing.data : {};
  const num = existing ? existing.at_bat_number : (abSession ? abSession.number : 1);
  const date = existing ? existing.date : (abSession ? abSession.date : todayStr());
  const opp = existing ? existing.opponent : (abSession ? abSession.opponent : '');
  app.innerHTML = `${backBtn()}
    <h1>${existing ? 'Edit At-Bat' : `At-Bat #${num}`}</h1>
    ${!existing && abSession ? `<p class="sub">Game flow: save &amp; log the next at-bat to keep rolling.</p>` : ''}
    <div class="card">
      <label class="field">Date</label>
      <input type="date" id="f-date" value="${esc(date || todayStr())}">
      <label class="field">Opponent (optional)</label>
      <input type="text" id="f-opp" value="${esc(opp || '')}" placeholder="Who did you face?">
      <label class="field">What was your plan?</label>
      ${voiceRow('f-plan')}
      <textarea id="f-plan">${esc(d.plan || '')}</textarea>
      <label class="field">How well did you execute it? (1–10)</label>
      ${scaleInput('exec', d.execution)}
      <label class="field">Result</label>
      <input type="text" id="f-result" value="${esc(d.result || '')}" placeholder="e.g. lineout to center, walk, home run">
      <label class="field">Contact quality</label>
      <input type="text" id="f-contact" value="${esc(d.contactQuality || '')}" placeholder="e.g. barreled, jammed, off the end">
      <label class="field">Mechanics / what your swing felt like</label>
      <textarea id="f-mech">${esc(d.mechanics || '')}</textarea>
      <label class="field">Mental state</label>
      <input type="text" id="f-mental" value="${esc(d.mentalState || '')}" placeholder="e.g. calm, rushed, locked in">
      <label class="field">Self-talk</label>
      <input type="text" id="f-selftalk" value="${esc(d.selfTalk || '')}" placeholder="What were you saying to yourself?">
      <label class="field">One cue</label>
      <input type="text" id="f-cue" value="${esc(d.cue || '')}" placeholder="The one thought you carried in">
      <label class="field">Pitcher notes</label>
      <textarea id="f-pnotes">${esc(d.pitcherNotes || '')}</textarea>
      <label class="field">Anything else to remember</label>
      ${voiceRow('f-notes')}
      <textarea id="f-notes">${esc(d.notes || '')}</textarea>
      ${existing
        ? `<button class="btn" id="save">Save changes</button>
           <button class="btn danger" id="del">Delete this at-bat</button>`
        : `<button class="btn" id="save-next">Save &amp; log next at-bat</button>
           <button class="btn secondary" id="save-done">Save &amp; finish</button>`}
    </div>
    ${tabbar('home')}`;
  wireNav(app);
  wireScales(app);
  wireVoice('voice-f-plan', 'f-plan');
  wireVoice('voice-f-notes', 'f-notes');
  document.getElementById('back-to-menu').addEventListener('click', () => { abSession = null; location.hash = '#/home'; });

  const collect = () => ({
    date: document.getElementById('f-date').value,
    opponent: document.getElementById('f-opp').value.trim(),
    data: {
      plan: document.getElementById('f-plan').value.trim(),
      execution: getScale(app, 'exec'),
      result: document.getElementById('f-result').value.trim(),
      contactQuality: document.getElementById('f-contact').value.trim(),
      mechanics: document.getElementById('f-mech').value.trim(),
      mentalState: document.getElementById('f-mental').value.trim(),
      selfTalk: document.getElementById('f-selftalk').value.trim(),
      cue: document.getElementById('f-cue').value.trim(),
      pitcherNotes: document.getElementById('f-pnotes').value.trim(),
      notes: document.getElementById('f-notes').value.trim(),
    },
  });

  if (existing) {
    document.getElementById('save').addEventListener('click', async () => {
      try { await put(`/api/entries/${existing.id}`, collect()); toast('Saved'); location.hash = '#/library'; }
      catch (e) { toast(e.message); }
    });
    document.getElementById('del').addEventListener('click', async () => {
      if (!confirm('Delete this at-bat?')) return;
      await del(`/api/entries/${existing.id}`);
      location.hash = '#/library';
    });
  } else {
    const saveFlow = async (next) => {
      const c = collect();
      if (!abSession) {
        abSession = { gameId: 'g-' + Date.now().toString(36), date: c.date, opponent: c.opponent, number: num };
      }
      try {
        await post('/api/entries', {
          type: 'atbat', game_id: abSession.gameId, at_bat_number: abSession.number, ...c,
        });
      } catch (e) { toast(e.message); return; }
      if (next) {
        abSession.number += 1;
        abSession.date = c.date; abSession.opponent = c.opponent;
        toast(`At-bat #${abSession.number - 1} saved`);
        renderAtBat(null);
      } else {
        abSession = null;
        toast('At-bats saved');
        location.hash = '#/library';
      }
    };
    document.getElementById('save-next').addEventListener('click', () => saveFlow(true));
    document.getElementById('save-done').addEventListener('click', () => saveFlow(false));
  }
}

// ---------- reflection form (game + practice) ----------
function renderReflection(kind, existing) {
  const isGame = kind === 'game';
  const d = existing ? existing.data : {};
  const ratings = (d && d.ratings) || {};
  const title = existing ? `Edit ${isGame ? 'Game Reflection' : 'Practice Reflection'}` : (isGame ? 'Game Reflection' : 'Team Practice');
  app.innerHTML = `${backBtn()}
    <h1>${title}</h1>
    <p class="sub">${isGame ? 'How did you compete today — the game as a whole.' : 'How did practice go — the session as a whole.'}</p>
    <div class="card">
      <label class="field">Date</label>
      <input type="date" id="f-date" value="${esc(existing ? existing.date : todayStr())}">
      <label class="field">${isGame ? 'Opponent' : 'Practice context'}</label>
      <input type="text" id="f-opp" value="${esc(isGame ? (existing ? existing.opponent : '') : (existing ? existing.context : ''))}"
        placeholder="${isGame ? 'Who did you play?' : 'e.g. Tuesday team BP, intrasquad'}">
      <label class="field">How well did you compete? (1–10)</label>
      ${scaleInput('competed', ratings.competed)}
      <label class="field">How well did you stay present? (1–10)</label>
      ${scaleInput('present', ratings.present)}
      <label class="field">How well did you respond to adversity? (1–10)</label>
      ${scaleInput('adversity', ratings.adversity)}
      <label class="field">Open reflection</label>
      ${voiceRow('f-refl')}
      <textarea class="big" id="f-refl" placeholder="How did the ${isGame ? 'game' : 'practice'} feel overall? What worked, what didn't, what did you learn?">${esc(existing ? existing.reflection : '')}</textarea>
      ${existing
        ? `<button class="btn" id="save">Save changes</button>
           <button class="btn danger" id="del">Delete</button>`
        : `<button class="btn" id="save">Save reflection</button>`}
    </div>
    ${tabbar('home')}`;
  wireNav(app);
  wireScales(app);
  wireVoice('voice-f-refl', 'f-refl');
  document.getElementById('back-to-menu').addEventListener('click', () => { location.hash = '#/home'; });

  const collect = () => {
    const oppVal = document.getElementById('f-opp').value.trim();
    return {
      date: document.getElementById('f-date').value,
      opponent: isGame ? oppVal : null,
      context: isGame ? null : oppVal,
      reflection: document.getElementById('f-refl').value.trim(),
      data: {
        ratings: {
          competed: getScale(app, 'competed'),
          present: getScale(app, 'present'),
          adversity: getScale(app, 'adversity'),
        },
      },
    };
  };
  document.getElementById('save').addEventListener('click', async () => {
    try {
      if (existing) {
        await put(`/api/entries/${existing.id}`, collect());
        toast('Saved');
        location.hash = `#/entry/${existing.id}`;
      } else {
        const saved = await post('/api/entries', { type: kind, ...collect() });
        location.hash = `#/entry/${saved.id}`;
      }
    } catch (e) { toast(e.message); }
  });
  if (existing) {
    document.getElementById('del').addEventListener('click', async () => {
      if (!confirm('Delete this reflection?')) return;
      await del(`/api/entries/${existing.id}`);
      location.hash = '#/library';
    });
  }
}

// ---------- individual hitting form ----------
function renderIndividual(existing) {
  const d = existing ? existing.data : {};
  app.innerHTML = `${backBtn()}
    <h1>${existing ? 'Edit Hitting Session' : 'Individual Hitting'}</h1>
    <div class="card">
      <label class="field">Date</label>
      <input type="date" id="f-date" value="${esc(existing ? existing.date : todayStr())}">
      <label class="field">How well did you execute? (1–10)</label>
      ${scaleInput('exec', d.execution)}
      <label class="field">Focus / plan for the session</label>
      ${voiceRow('f-focus')}
      <textarea id="f-focus">${esc(d.focus || '')}</textarea>
      <label class="field">Mechanics / what your swing felt like</label>
      <textarea id="f-mech">${esc(d.mechanics || '')}</textarea>
      <label class="field">Self-talk</label>
      <input type="text" id="f-selftalk" value="${esc(d.selfTalk || '')}" placeholder="What were you saying to yourself?">
      <label class="field">Approach</label>
      <textarea id="f-approach">${esc(d.approach || '')}</textarea>
      <label class="field">Notes</label>
      ${voiceRow('f-notes')}
      <textarea id="f-notes">${esc(d.notes || '')}</textarea>
      ${existing
        ? `<button class="btn" id="save">Save changes</button>
           <button class="btn danger" id="del">Delete</button>`
        : `<button class="btn" id="save">Save session</button>`}
    </div>
    ${tabbar('home')}`;
  wireNav(app);
  wireScales(app);
  wireVoice('voice-f-focus', 'f-focus');
  wireVoice('voice-f-notes', 'f-notes');
  document.getElementById('back-to-menu').addEventListener('click', () => { location.hash = '#/home'; });

  const collect = () => ({
    date: document.getElementById('f-date').value,
    data: {
      execution: getScale(app, 'exec'),
      focus: document.getElementById('f-focus').value.trim(),
      mechanics: document.getElementById('f-mech').value.trim(),
      selfTalk: document.getElementById('f-selftalk').value.trim(),
      approach: document.getElementById('f-approach').value.trim(),
      notes: document.getElementById('f-notes').value.trim(),
    },
  });
  document.getElementById('save').addEventListener('click', async () => {
    try {
      if (existing) {
        await put(`/api/entries/${existing.id}`, collect());
        toast('Saved');
      } else {
        await post('/api/entries', { type: 'individual', ...collect() });
        toast('Session saved');
      }
      location.hash = '#/library';
    } catch (e) { toast(e.message); }
  });
  if (existing) {
    document.getElementById('del').addEventListener('click', async () => {
      if (!confirm('Delete this session?')) return;
      await del(`/api/entries/${existing.id}`);
      location.hash = '#/library';
    });
  }
}

// ---------- library ----------
async function renderLibrary() {
  app.innerHTML = `${topbar()}
    <h1>Library</h1>
    <div class="card">
      <input type="text" id="q" placeholder="Search: home run, strike out, fastball…" autocomplete="off">
      <div class="chips" id="chips"><span class="chip-label">Try:</span></div>
    </div>
    <div id="results"></div>
    ${tabbar('library')}`;
  wireNav(app); wireLogout(app);

  const loadFrequent = async () => {
    try { frequentTerms = await get('/api/searches/frequent'); } catch { frequentTerms = []; }
    const box = document.getElementById('chips');
    const starters = ['home run', 'strike out', 'fastball'];
    let html = '<span class="chip-label">Try:</span>';
    if (frequentTerms.length) {
      html += '<span class="chip-label">Frequent:</span>' +
        frequentTerms.map((t) => `<button class="chip frequent" data-term="${esc(t.term)}">${esc(t.term)}</button>`).join('');
    } else {
      html += starters.map((t) => `<button class="chip" data-term="${esc(t)}">${esc(t)}</button>`).join('');
    }
    box.innerHTML = html;
    box.querySelectorAll('[data-term]').forEach((c) =>
      c.addEventListener('click', () => {
        document.getElementById('q').value = c.dataset.term;
        doSearch(c.dataset.term);
      }));
  };

  const doSearch = async (q) => {
    const box = document.getElementById('results');
    box.innerHTML = '<p class="sub">Searching…</p>';
    try {
      const entries = await get('/api/entries' + (q ? `?q=${encodeURIComponent(q)}` : ''));
      if (!entries.length) {
        box.innerHTML = `<div class="empty">${q ? 'No entries match. Try another word.' : 'No entries yet. Go log something.'}</div>`;
      } else {
        box.innerHTML = entries.map(entryCard).join('');
        box.querySelectorAll('[data-entry]').forEach((el) =>
          el.addEventListener('click', () => { location.hash = `#/entry/${el.dataset.entry}`; }));
      }
      loadFrequent(); // refresh chips so new searches show up
    } catch (e) { box.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };

  let debounce = null;
  document.getElementById('q').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => doSearch(e.target.value.trim()), 500);
  });
  loadFrequent();
  doSearch('');
}
function entryCard(e) {
  const d = e.data || {};
  const meta = [e.date, e.opponent || e.context, e.at_bat_number ? `At-bat #${e.at_bat_number}` : null]
    .filter(Boolean).join(' · ');
  let preview = e.reflection || d.plan || d.notes || d.focus || '';
  if (preview.length > 120) preview = preview.slice(0, 120) + '…';
  return `<div class="entry-item" data-entry="${e.id}">
    <span class="etype">${typeLabel(e.type)}</span>
    <div class="emeta">${esc(meta)}</div>
    ${preview ? `<div class="epreview">${esc(preview)}</div>` : ''}
    ${e.takeaways && e.takeaways.length ? `<div class="epreview sub">💡 ${esc(e.takeaways[0])}</div>` : ''}
  </div>`;
}

// ---------- entry detail ----------
async function renderEntry(id) {
  let e;
  try { e = await get(`/api/entries/${id}`); }
  catch { location.hash = '#/library'; return; }
  const d = e.data || {};
  const r = d.ratings || {};
  const rows = [];
  const kv = (k, v) => { if (v !== null && v !== undefined && v !== '') rows.push(`<div class="kv"><span>${k}</span><span>${esc(v)}</span></div>`); };
  kv('Type', typeLabel(e.type));
  kv('Date', e.date);
  if (e.opponent) kv('Opponent', e.opponent);
  if (e.context) kv('Context', e.context);
  if (e.at_bat_number) kv('At-bat', '#' + e.at_bat_number);
  if (d.execution != null) kv('Execution', d.execution + '/10');
  if (r.competed != null) kv('Competed', r.competed + '/10');
  if (r.present != null) kv('Stayed present', r.present + '/10');
  if (r.adversity != null) kv('Responded to adversity', r.adversity + '/10');
  const textFields = [
    ['Plan', d.plan], ['Result', d.result], ['Contact quality', d.contactQuality],
    ['Mechanics', d.mechanics], ['Mental state', d.mentalState], ['Self-talk', d.selfTalk],
    ['Cue', d.cue], ['Pitcher notes', d.pitcherNotes], ['Focus', d.focus],
    ['Approach', d.approach], ['Notes', d.notes],
  ];
  app.innerHTML = `${topbar()}
    <button class="backbtn" id="back">← Back to library</button>
    <h1>${typeLabel(e.type)}</h1>
    <div class="card">${rows.join('')}</div>
    ${textFields.map(([k, v]) => v ? `<div class="card"><strong>${k}</strong><p>${esc(v)}</p></div>` : '').join('')}
    ${e.reflection ? `<div class="card"><strong>Reflection</strong><p>${esc(e.reflection)}</p></div>` : ''}
    ${e.takeaways && e.takeaways.length ? `<h2>Takeaways</h2>${e.takeaways.map((t) =>
      `<div class="takeaway"><strong>💡</strong> ${esc(t)}</div>`).join('')}` : ''}
    <button class="btn secondary" id="edit">Edit this entry</button>
    ${tabbar('library')}`;
  wireNav(app); wireLogout(app);
  document.getElementById('back').addEventListener('click', () => { location.hash = '#/library'; });
  document.getElementById('edit').addEventListener('click', () => {
    if (e.type === 'atbat') renderAtBat(e);
    else if (e.type === 'game') renderReflection('game', e);
    else if (e.type === 'practice') renderReflection('practice', e);
    else renderIndividual(e);
    window.scrollTo(0, 0);
  });
}

// ---------- routines ----------
async function renderRoutines() {
  let routines = [];
  try { routines = await get('/api/routines'); } catch { /* ignore */ }
  app.innerHTML = `${topbar()}
    <h1>Routines</h1>
    <p class="sub">Your pre-game, between-pitch, and reset routines — in your own words.</p>
    <div id="list">${routines.length ? routines.map((r) => `
      <div class="card">
        <strong>${esc(r.title)}</strong>
        ${r.steps && r.steps.length ? `<ol class="routine-steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p class="sub">No steps yet.</p>'}
        <button class="btn small secondary" data-edit="${r.id}">Edit</button>
        <button class="btn small danger" data-del="${r.id}">Delete</button>
      </div>`).join('') : '<div class="empty">No routines yet. Build your first one below.</div>'}
    </div>
    <h2>New routine</h2>
    <div class="card">
      <label class="field">Title</label>
      <input type="text" id="r-title" placeholder="e.g. Pre-game lock-in">
      <label class="field">Steps (one per line)</label>
      <textarea id="r-steps" placeholder="Breathe and clear the last pitch&#10;See one pitch up in the zone&#10;One cue: be on time"></textarea>
      <button class="btn" id="r-save">Save routine</button>
    </div>
    ${tabbar('routines')}`;
  wireNav(app); wireLogout(app);
  document.getElementById('r-save').addEventListener('click', async () => {
    const title = document.getElementById('r-title').value;
    const steps = document.getElementById('r-steps').value.split('\n').map((s) => s.trim()).filter(Boolean);
    try { await post('/api/routines', { title, steps }); toast('Routine saved'); renderRoutines(); }
    catch (e) { toast(e.message); }
  });
  app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this routine?')) return;
    await del(`/api/routines/${b.dataset.del}`);
    renderRoutines();
  }));
  app.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => renderRoutineEdit(
    routines.find((r) => r.id === b.dataset.edit))));
}
function renderRoutineEdit(r) {
  app.innerHTML = `${topbar()}
    <button class="backbtn" id="back">← Back to routines</button>
    <h1>Edit routine</h1>
    <div class="card">
      <label class="field">Title</label>
      <input type="text" id="r-title" value="${esc(r.title)}">
      <label class="field">Steps (one per line)</label>
      <textarea id="r-steps">${esc((r.steps || []).join('\n'))}</textarea>
      <button class="btn" id="r-save">Save changes</button>
    </div>
    ${tabbar('routines')}`;
  wireNav(app); wireLogout(app);
  document.getElementById('back').addEventListener('click', () => { location.hash = '#/routines'; });
  document.getElementById('r-save').addEventListener('click', async () => {
    const title = document.getElementById('r-title').value;
    const steps = document.getElementById('r-steps').value.split('\n').map((s) => s.trim()).filter(Boolean);
    try { await put(`/api/routines/${r.id}`, { title, steps }); toast('Saved'); location.hash = '#/routines'; }
    catch (e) { toast(e.message); }
  });
}

// ---------- blueprint checklist ----------
async function renderBlueprint() {
  let items = [];
  try { items = await get('/api/blueprint'); } catch { /* ignore */ }
  app.innerHTML = `${topbar()}
    <h1>Success Blueprint</h1>
    <div class="card note-card">
      <p><strong>Hitting is hard.</strong></p>
      <p>Success isn't defined by whether you get a hit or not. Define what success is for <em>you</em>:</p>
      <p>Were you on time? Did you stick to your plan? Did you swing at the right pitches?</p>
      <p class="sub">This checklist is everything that led to your best days. Check items off as you live them.</p>
    </div>
    <div id="list">
      ${items.length ? items.map((it) => `
        <div class="check-item">
          <input type="checkbox" data-check="${it.id}" ${it.done ? 'checked' : ''}>
          <span class="ctext${it.done ? ' done' : ''}">${esc(it.text)}</span>
          <button class="cdel" data-del="${it.id}" aria-label="Delete">×</button>
        </div>`).join('') : '<div class="empty">Your blueprint is empty. Add the first thing that makes you successful.</div>'}
    </div>
    <div class="card">
      <label class="field">Add to your blueprint</label>
      <input type="text" id="b-text" placeholder="e.g. See the ball up, be on time">
      <button class="btn" id="b-add">Add item</button>
    </div>
    ${tabbar('blueprint')}`;
  wireNav(app); wireLogout(app);
  document.getElementById('b-add').addEventListener('click', async () => {
    const text = document.getElementById('b-text').value;
    try { await post('/api/blueprint', { text }); renderBlueprint(); }
    catch (e) { toast(e.message); }
  });
  app.querySelectorAll('[data-check]').forEach((c) => c.addEventListener('change', async () => {
    const item = items.find((i) => i.id === c.dataset.check);
    await put(`/api/blueprint/${c.dataset.check}`, { text: item.text, done: c.checked });
    c.closest('.check-item').querySelector('.ctext').classList.toggle('done', c.checked);
  }));
  app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this item?')) return;
    await del(`/api/blueprint/${b.dataset.del}`);
    renderBlueprint();
  }));
}

// ---------- router ----------
async function ensureUser() {
  if (currentUser) return true;
  try {
    const me = await get('/api/me');
    currentUser = { email: me.email };
    return true;
  } catch { return false; }
}
async function route() {
  const hash = location.hash || '#/home';
  const authed = await ensureUser();
  if (!authed) {
    if (hash === '#/signup') renderSignup(); else renderLogin();
    window.scrollTo(0, 0);
    return;
  }
  if (hash === '#/login' || hash === '#/signup') { location.hash = '#/home'; return; }
  if (hash === '#/home') renderHome();
  else if (hash === '#/log/atbat') { abSession = null; renderAtBat(null); }
  else if (hash === '#/log/game') renderReflection('game', null);
  else if (hash === '#/log/practice') renderReflection('practice', null);
  else if (hash === '#/log/individual') renderIndividual(null);
  else if (hash === '#/library') renderLibrary();
  else if (hash.startsWith('#/entry/')) renderEntry(hash.slice(8));
  else if (hash === '#/routines') renderRoutines();
  else if (hash === '#/blueprint') renderBlueprint();
  else location.hash = '#/home';
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
