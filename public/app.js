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
  t.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99;background:#8FBC8F;color:#0B1526;font-weight:700;padding:12px 20px;border-radius:999px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function typeLabel(t) {
  return { atbat: 'At-Bat', game: 'Game Reflection', practice: 'Team Practice', individual: 'Individual Hitting' }[t] || t;
}

// ---------- icons ----------
const MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';

// ---------- voice ----------
function setVoiceBtn(btn, listening) {
  btn.innerHTML = listening
    ? STOP_SVG + '<span>Stop talking</span>'
    : MIC_SVG + '<span>Start talking</span>';
}
function wireVoice(btnId, areaId) {
  const btn = document.getElementById(btnId);
  const area = document.getElementById(areaId);
  if (!btn || !area) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.style.display = 'none';
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
    setVoiceBtn(btn, true);
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join(' ');
      area.value = area.value ? area.value.trimEnd() + ' ' + text : text;
    };
    const done = () => {
      rec = null;
      btn.classList.remove('listening');
      setVoiceBtn(btn, false);
    };
    rec.onend = done;
    rec.onerror = (e) => { done(); if (e.error !== 'aborted') toast('Voice hiccup — try again.'); };
    try { rec.start(); } catch { done(); }
  });
}
function voiceCard(areaId, copy) {
  return `<div class="voice-card">
    <div class="voice-top">
      <span class="mic-circle">${MIC_SVG}</span>
      <div>
        <div class="voice-title">Talk it out</div>
        <p class="voice-copy">${copy}</p>
      </div>
    </div>
    <button type="button" class="voice-btn" id="voice-${areaId}">${MIC_SVG}<span>Start talking</span></button>
    <p class="voice-caption">Nothing saves until you tap save. Every filled field stays editable.</p>
  </div>`;
}

// ---------- scale input ----------
function scaleInput(name, value, anchors) {
  anchors = anchors || {};
  let cells = '';
  for (let i = 1; i <= 10; i++) {
    const cap = anchors[i] ? `<span class="scale-cap">${anchors[i]}</span>` : '<span class="scale-cap"></span>';
    cells += `<button type="button" class="scale-btn${Number(value) === i ? ' selected' : ''}" data-scale="${name}" data-val="${i}"><span class="scale-num">${i}</span>${cap}</button>`;
  }
  return `<div class="scale-grid" id="scale-${name}">${cells}</div>
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

// ---------- video attachments ----------
async function apiUpload(url, formData) {
  const res = await fetch(url, { method: 'POST', body: formData });
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || 'Upload failed.');
  return data;
}
function fmtSize(b) {
  if (b == null) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
// "Add video" section for log forms. entryId null => brand-new entry:
// chosen files are held pending and uploaded after the entry is created.
// Returns a controller with uploadPending(entryId).
function videoSectionHTML() {
  return `<div class="kicker" style="margin-top:24px">Video</div>
    <h2 class="sect" style="margin-top:4px">Attach video.</h2>
    <p class="sub">Add clips from your camera roll as a visual reference — your swing, the cage, the round. They stay private to your account.</p>
    <div id="video-list"></div>
    <label class="btn secondary" for="video-input" style="text-align:center;cursor:pointer">Add video</label>
    <input type="file" id="video-input" accept="video/*" multiple hidden>`;
}
async function wireVideoSection(entryId) {
  const list = document.getElementById('video-list');
  const input = document.getElementById('video-input');
  let pending = [];
  const renderPending = () => {
    list.innerHTML = pending.map((f, i) =>
      `<div class="video-item"><span class="video-name">${esc(f.name)} <span class="sub">${fmtSize(f.size)}</span></span><button class="vid-remove" data-rm="${i}" aria-label="Remove">×</button></div>`).join('');
    list.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      pending.splice(Number(b.dataset.rm), 1);
      renderPending();
    }));
  };
  const renderExisting = async () => {
    let vids = [];
    try { vids = await get(`/api/entries/${entryId}/videos`); } catch { vids = []; }
    list.innerHTML = vids.length
      ? vids.map((v) =>
        `<div class="video-item"><span class="video-name">${esc(v.original_name)} <span class="sub">${fmtSize(v.size_bytes)}</span></span><button class="vid-remove" data-delvid="${v.id}" aria-label="Remove">×</button></div>`).join('')
      : '<p class="sub">No videos attached yet.</p>';
    list.querySelectorAll('[data-delvid]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this video?')) return;
      try { await del(`/api/videos/${b.dataset.delvid}`); toast('Video removed'); renderExisting(); }
      catch (e) { toast(e.message); }
    }));
  };
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    if (entryId) {
      const fd = new FormData();
      files.forEach((f) => fd.append('videos', f));
      try {
        toast('Uploading video…');
        await apiUpload(`/api/entries/${entryId}/videos`, fd);
        toast('Video attached');
        renderExisting();
      } catch (e) { toast(e.message); }
    } else {
      pending = pending.concat(files);
      renderPending();
    }
  });
  if (entryId) await renderExisting();
  return {
    uploadPending: async (newEntryId) => {
      if (!pending.length) return;
      const fd = new FormData();
      pending.forEach((f) => fd.append('videos', f));
      toast('Uploading video…');
      await apiUpload(`/api/entries/${newEntryId}/videos`, fd);
      pending = [];
      toast('Video attached');
    },
  };
}

// ---------- layout ----------
function tabbar(active) {
  const tabs = [
    ['#/home', '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>', 'Log', 'home'],
    ['#/library', '<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>', 'Library', 'library'],
    ['#/routines', '<svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>', 'Routines', 'routines'],
    ['#/blueprint', '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>', 'Checklist', 'blueprint'],
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
function entryTypeGrid(selected) {
  const types = [
    ['atbat', 'AB', 'At-bat', '#/log/atbat'],
    ['game', 'GAME', 'Game reflection', '#/log/game'],
    ['practice', 'TEAM', 'Team practice', '#/log/practice'],
    ['individual', 'SOLO', 'Individual hitting', '#/log/individual'],
  ];
  return `<div class="kicker gray" style="margin-top:18px">Entry type</div><div class="type-grid">` + types.map(([k, kick, label, h]) =>
    `<button type="button" class="type-card${k === selected ? ' selected' : ''}" data-thash="${h}">
      <span class="type-kicker">${kick}</span><span class="type-label">${label}</span>
    </button>`).join('') + `</div>`;
}
function wireTypeGrid(root) {
  root.querySelectorAll('[data-thash]').forEach((b) => b.addEventListener('click', () => {
    abSession = null;
    location.hash = b.dataset.thash;
  }));
}

// ---------- auth views ----------
function renderLogin() {
  app.innerHTML = `<div class="auth-wrap">
    <div class="brand">The Hitter's Notebook<small>Know your swing. Train your mind.</small></div>
    <h1 class="display" style="margin-top:26px">Sign in.</h1>
    <div class="card">
      <div id="err"></div>
      <label class="field">Email</label>
      <input type="email" id="email" autocomplete="email" placeholder="you@example.com">
      <label class="field">Password</label>
      <input type="password" id="password" autocomplete="current-password" placeholder="••••••••">
      <button class="btn" id="go">Sign in</button>
      <p class="sub center">New here? <a href="#/signup">Create an account</a></p>
    </div></div>`;
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
  app.innerHTML = `<div class="auth-wrap">
    <div class="brand">The Hitter's Notebook<small>Know your swing. Train your mind.</small></div>
    <h1 class="display" style="margin-top:26px">Create your account.</h1>
    <p class="lede">Your journal is private to you. Only you can see your entries.</p>
    <div class="card">
      <div id="err"></div>
      <label class="field">Email</label>
      <input type="email" id="email" autocomplete="email" placeholder="you@example.com">
      <label class="field">Password <span style="color:var(--muted);font-weight:400;font-size:13px">(8+ characters)</span></label>
      <input type="password" id="password" autocomplete="new-password" placeholder="••••••••">
      <button class="btn" id="go">Create account</button>
      <p class="sub center">Have an account? <a href="#/login">Sign in</a></p>
    </div></div>`;
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
  const rows = [
    ['01', 'At-bat', 'Log one plate appearance and rate the execution.', '#/log/atbat'],
    ['02', 'Game reflection', 'Step back from each at-bat and reflect on the game as a whole.', '#/log/game'],
    ['03', 'Team practice', 'Capture the drills, pressure reps, and what transferred.', '#/log/practice'],
    ['04', 'Individual hitting', 'Track your purpose, adjustments, and next test.', '#/log/individual'],
  ];
  app.innerHTML = `${topbar()}
    <div class="kicker" style="margin-top:18px">Choose a log</div>
    <h1 class="display">What did you just <em>work through?</em></h1>
    <p class="lede">Start with the rep that is freshest. You can add the deeper details after the main lesson is down.</p>
    <div class="logrows">
      ${rows.map(([n, t, d, h]) => `
        <button class="logrow" data-nav="${h}">
          <span class="lognum">${n}</span>
          <span class="logtext"><span class="logtitle">${t}</span><span class="logdesc">${d}</span></span>
          <span class="logarrow">→</span>
        </button>`).join('')}
    </div>
    ${tabbar('home')}`;
  wireNav(app); wireLogout(app);
}

// ---------- at-bat form ----------
let abSession = null; // { gameId, date, opponent, number }
function renderAtBat(existing) {
  const d = existing ? existing.data : {};
  const num = existing ? existing.at_bat_number : (abSession ? abSession.number : 1);
  const date = existing ? existing.date : (abSession ? abSession.date : todayStr());
  const opp = existing ? existing.opponent : (abSession ? abSession.opponent : '');
  const anchors = { 1: 'Missed', 5: 'Mixed', 10: 'Owned' };
  app.innerHTML = `${backBtn()}
    <div class="kicker" style="margin-top:14px">New entry</div>
    <h1 class="display">${existing ? 'Edit at-bat.' : 'Log this at-bat.'}</h1>
    <p class="lede">Capture one plate appearance at a time, then keep going until the game is over.</p>
    ${voiceCard('f-plan', 'Describe what happened, your approach, result, thoughts, mechanics, and lesson. Your words will fill the fields below.')}
    ${!existing ? entryTypeGrid('atbat') : ''}
    <label class="field">Date</label>
    <input type="date" id="f-date" value="${esc(date || todayStr())}">
    <label class="field">At-bat #</label>
    <input type="text" id="f-abnum" value="${esc(num)}" inputmode="numeric" disabled style="opacity:.75">
    <label class="field">Game / opponent</label>
    <span class="opt">Optional</span>
    <input type="text" id="f-opp" value="${esc(opp || '')}" placeholder="vs. Davidson">
    <div class="card tinted-green">
      <h3>What was the pitcher like?</h3>
      <p class="hint">Capture what you saw before you write your approach.</p>
      <label class="field" style="margin-top:6px">Pitcher description</label>
      <span class="opt">Optional</span>
      <textarea id="f-pnotes" placeholder="Velocity, release, pitch mix, shapes, tempo, patterns...">${esc(d.pitcherNotes || '')}</textarea>
    </div>
    <label class="field">What was your approach?</label>
    <textarea id="f-plan" placeholder="Hunt a fastball up, stay through the middle...">${esc(d.plan || '')}</textarea>
    <label class="field">How well did you execute the plan?</label>
    ${scaleInput('exec', d.execution, anchors)}
    <label class="field">What do you want to remember from this at-bat?</label>
    <textarea id="f-notes" placeholder="The lesson you want available next time...">${esc(d.notes || '')}</textarea>
    <button type="button" class="details-toggle" id="details-toggle" aria-expanded="${existing ? 'true' : 'false'}">
      <span id="details-label">${existing ? 'Hide details' : 'Add result, mental game, mechanics & self-talk'}</span>
      <span class="details-icon" id="details-icon">${existing ? '−' : '+'}</span>
    </button>
    <div class="details-body" id="details-body"${existing ? '' : ' hidden'}>
      <label class="field">Result</label>
      <span class="opt">Optional</span>
      <input type="text" id="f-result" value="${esc(d.result || '')}" placeholder="e.g. lineout to center, walk, home run">
      <label class="field">Contact quality</label>
      <span class="opt">Optional</span>
      <input type="text" id="f-contact" value="${esc(d.contactQuality || '')}" placeholder="e.g. barreled, jammed, off the end">
      <label class="field">Mental state</label>
      <span class="opt">Optional</span>
      <input type="text" id="f-mental" value="${esc(d.mentalState || '')}" placeholder="e.g. calm, rushed, locked in">
      <label class="field">Body and mechanics</label>
      <span class="opt">Optional</span>
      <textarea id="f-mech" placeholder="Timing, posture, barrel path, what the body felt...">${esc(d.mechanics || '')}</textarea>
      <label class="field">Self-talk</label>
      <span class="opt">Optional</span>
      <input type="text" id="f-selftalk" value="${esc(d.selfTalk || '')}" placeholder="What did you say to yourself? Was it believable and useful?">
      <label class="field">One cue</label>
      <span class="opt">Optional</span>
      <input type="text" id="f-cue" value="${esc(d.cue || '')}" placeholder="See it up">
    </div>
    ${videoSectionHTML()}
    ${existing
      ? `<div class="btn-row"><button class="btn secondary" id="cancel-btn">Cancel</button><button class="btn" id="save">Save changes</button></div>
         <button class="btn danger" id="del">Delete this at-bat</button>`
      : `<div class="btn-row"><button class="btn secondary" id="cancel-btn">Cancel</button><button class="btn" id="save-done">Save entry</button></div>
         <button class="btn muted-full" id="save-next">Save &amp; log next at-bat</button>`}
    ${tabbar('home')}`;
  wireNav(app);
  wireScales(app);
  wireVoice('voice-f-plan', 'f-plan');
  if (!existing) wireTypeGrid(app);
  const vidReady = wireVideoSection(existing ? existing.id : null);
  document.getElementById('back-to-menu').addEventListener('click', () => { abSession = null; location.hash = '#/home'; });
  document.getElementById('cancel-btn').addEventListener('click', () => {
    if (existing) { location.hash = '#/library'; } else { abSession = null; location.hash = '#/home'; }
  });

  // expandable details
  const dt = document.getElementById('details-toggle');
  const db = document.getElementById('details-body');
  const dl = document.getElementById('details-label');
  const di = document.getElementById('details-icon');
  const setDetails = (open) => {
    db.hidden = !open;
    dt.setAttribute('aria-expanded', String(open));
    dl.textContent = open ? 'Hide details' : 'Add result, mental game, mechanics & self-talk';
    di.textContent = open ? '−' : '+';
  };
  dt.addEventListener('click', () => setDetails(db.hidden));

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
      let saved;
      try {
        saved = await post('/api/entries', {
          type: 'atbat', game_id: abSession.gameId, at_bat_number: abSession.number, ...c,
        });
      } catch (e) { toast(e.message); return; }
      try { await (await vidReady).uploadPending(saved.id); } catch (e) { toast(e.message); }
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
  const anchors = { 1: 'Low', 5: 'Middle', 10: 'High' };
  const heading = existing
    ? (isGame ? 'Edit game reflection.' : 'Edit practice reflection.')
    : (isGame ? 'Reflect on the whole game.' : 'Reflect on the whole practice.');
  const lede = isGame
    ? 'This space is only for the big picture—how you competed, adjusted, and responded from the first pitch to the last.'
    : 'This space is only for the big picture—how you competed, adjusted, and responded from the first rep to the last.';
  const voiceCopy = isGame
    ? 'Talk through the game as a whole — how you competed, where you were locked in, and how you handled the hard moments. Your words will fill the reflection below.'
    : 'Talk through the session as a whole — the drills, the pressure reps, and what transferred. Your words will fill the reflection below.';
  app.innerHTML = `${backBtn()}
    <div class="kicker" style="margin-top:14px">New entry</div>
    <h1 class="display">${heading}</h1>
    <p class="lede">${lede}</p>
    ${voiceCard('f-refl', voiceCopy)}
    ${!existing ? entryTypeGrid(kind) : ''}
    <label class="field">Date</label>
    <input type="date" id="f-date" value="${esc(existing ? existing.date : todayStr())}">
    <label class="field">${isGame ? 'Opponent' : 'Practice context'}</label>
    <span class="opt">Optional</span>
    <input type="text" id="f-opp" value="${esc(isGame ? (existing ? existing.opponent : '') : (existing ? existing.context : ''))}"
      placeholder="${isGame ? 'Who did you play?' : 'e.g. Tuesday team BP, intrasquad'}">
    <label class="field">How well did you compete?</label>
    ${scaleInput('competed', ratings.competed, anchors)}
    <label class="field">How well did you stay present?</label>
    ${scaleInput('present', ratings.present, anchors)}
    <label class="field">How well did you respond to adversity?</label>
    ${scaleInput('adversity', ratings.adversity, anchors)}
    <label class="field">Open reflection</label>
    <span class="opt">Type here or use 'Start talking' above</span>
    <textarea class="big" id="f-refl" placeholder="Talk or type through the ${isGame ? 'game' : 'practice'} as a whole. What stood out? Where were you locked in? When did your mindset shift? How did you handle the hard moments?">${esc(existing ? existing.reflection : '')}</textarea>
    <h2 class="sect">What happens next</h2>
    <p class="sub">Save your reflection and the app will respond with a few general takeaways from what you wrote.</p>
    ${videoSectionHTML()}
    ${existing
      ? `<div class="btn-row"><button class="btn secondary" id="cancel-btn">Cancel</button><button class="btn" id="save">Save changes</button></div>
         <button class="btn danger" id="del">Delete</button>`
      : `<div class="btn-row"><button class="btn secondary" id="cancel-btn">Cancel</button><button class="btn" id="save">Save &amp; get takeaways</button></div>`}
    ${tabbar('home')}`;
  wireNav(app);
  wireScales(app);
  wireVoice('voice-f-refl', 'f-refl');
  if (!existing) wireTypeGrid(app);
  const vidReady = wireVideoSection(existing ? existing.id : null);
  document.getElementById('back-to-menu').addEventListener('click', () => { location.hash = '#/home'; });
  document.getElementById('cancel-btn').addEventListener('click', () => {
    location.hash = existing ? `#/entry/${existing.id}` : '#/home';
  });

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
        try { await (await vidReady).uploadPending(saved.id); } catch (e) { toast(e.message); }
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
  const base = existing ? (d || {}) : {};
  const anchors = { 1: 'Missed', 5: 'Mixed', 10: 'Owned' };
  app.innerHTML = `${backBtn()}
    <div class="kicker" style="margin-top:14px">New entry</div>
    <h1 class="display">${existing ? 'Edit hitting session.' : 'Log individual hitting.'}</h1>
    <p class="lede">Track the purpose of your own session and the adjustment you want to keep testing.</p>
    ${voiceCard('f-focus', 'Describe what you worked on, how well you executed, what your body felt, your self-talk, and what you want to test next. Your words will fill the fields below.')}
    ${!existing ? entryTypeGrid('individual') : ''}
    <label class="field">Date</label>
    <input type="date" id="f-date" value="${esc(existing ? existing.date : todayStr())}">
    <label class="field">Session context</label>
    <span class="opt">Optional</span>
    <input type="text" id="f-context" value="${esc(existing ? existing.context : '')}" placeholder="Indoor cage, 60 swings">
    <label class="field">What were you working on?</label>
    <textarea id="f-focus" placeholder="Tee work for direction, front toss for timing...">${esc(d.focus || '')}</textarea>
    <label class="field">How well did you execute the plan?</label>
    ${scaleInput('exec', d.execution, anchors)}
    <label class="field">What worked, and what will you test next time?</label>
    <textarea id="f-notes" placeholder="The lesson you want available next time...">${esc(d.notes || '')}</textarea>
    <label class="field">Body and mechanics</label>
    <span class="opt">Optional</span>
    <textarea id="f-mech" placeholder="Timing, posture, barrel path, what the body felt...">${esc(d.mechanics || '')}</textarea>
    <label class="field">Self-talk</label>
    <span class="opt">Optional</span>
    <input type="text" id="f-selftalk" value="${esc(d.selfTalk || '')}" placeholder="What did you say to yourself? Was it believable and useful?">
    ${videoSectionHTML()}
    ${existing
      ? `<div class="btn-row"><button class="btn secondary" id="cancel-btn">Cancel</button><button class="btn" id="save">Save changes</button></div>
         <button class="btn danger" id="del">Delete</button>`
      : `<div class="btn-row"><button class="btn secondary" id="cancel-btn">Cancel</button><button class="btn" id="save">Save entry</button></div>`}
    ${tabbar('home')}`;
  wireNav(app);
  wireScales(app);
  wireVoice('voice-f-focus', 'f-focus');
  if (!existing) wireTypeGrid(app);
  const vidReady = wireVideoSection(existing ? existing.id : null);
  document.getElementById('back-to-menu').addEventListener('click', () => { location.hash = '#/home'; });
  document.getElementById('cancel-btn').addEventListener('click', () => {
    location.hash = existing ? '#/library' : '#/home';
  });

  const collect = () => ({
    date: document.getElementById('f-date').value,
    context: document.getElementById('f-context').value.trim(),
    data: Object.assign({}, base, {
      execution: getScale(app, 'exec'),
      focus: document.getElementById('f-focus').value.trim(),
      mechanics: document.getElementById('f-mech').value.trim(),
      selfTalk: document.getElementById('f-selftalk').value.trim(),
      notes: document.getElementById('f-notes').value.trim(),
    }),
  });
  document.getElementById('save').addEventListener('click', async () => {
    try {
      if (existing) {
        await put(`/api/entries/${existing.id}`, collect());
        toast('Saved');
      } else {
        const saved = await post('/api/entries', { type: 'individual', ...collect() });
        try { await (await vidReady).uploadPending(saved.id); } catch (e) { toast(e.message); }
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
    <div class="kicker" style="margin-top:14px">Archive</div>
    <h1 class="display">Library.</h1>
    <p class="lede">Every rep you've logged, searchable.</p>
    <div class="search-wrap">
      <input type="text" id="q" placeholder="Search: home run, strike out, fastball…" autocomplete="off">
    </div>
    <div class="chips" id="chips"><span class="chip-label">Try:</span></div>
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
  let vidsHtml = '';
  try {
    const vids = await get(`/api/entries/${id}/videos`);
    if (vids.length) {
      vidsHtml = `<h2 class="sect">Video</h2>` + vids.map((v) =>
        `<div class="card"><div class="kicker gray" style="margin-bottom:8px">${esc(v.original_name)}</div>
         <video class="vid-player" controls playsinline preload="metadata" src="/api/videos/${v.id}/stream"></video></div>`).join('');
    }
  } catch { /* no videos or offline — skip */ }
  app.innerHTML = `${topbar()}
    <button class="backbtn" id="back">← Back to library</button>
    <h1 class="display" style="font-size:36px">${typeLabel(e.type)}.</h1>
    <div class="card">${rows.join('')}</div>
    ${textFields.map(([k, v]) => v ? `<div class="card"><strong>${k}</strong><p>${esc(v)}</p></div>` : '').join('')}
    ${e.reflection ? `<div class="card"><strong>Reflection</strong><p>${esc(e.reflection)}</p></div>` : ''}
    ${e.takeaways && e.takeaways.length ? `<h2 class="sect">Takeaways</h2>${e.takeaways.map((t) =>
      `<div class="takeaway"><div class="kicker">Takeaway</div>${esc(t)}</div>`).join('')}` : ''}
    ${vidsHtml}
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
    <div class="kicker" style="margin-top:14px">Routines</div>
    <h1 class="display">Routines.</h1>
    <p class="lede">Your pre-game, between-pitch, and reset routines — in your own words.</p>
    <div id="list">${routines.length ? routines.map((r) => `
      <div class="card">
        <strong style="font-family:var(--serif);font-size:20px;font-weight:400">${esc(r.title)}</strong>
        ${r.steps && r.steps.length ? `<ol class="routine-steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p class="sub">No steps yet.</p>'}
        <button class="btn small secondary" data-edit="${r.id}">Edit</button>
        <button class="btn small danger" data-del="${r.id}">Delete</button>
      </div>`).join('') : '<div class="empty">No routines yet. Build your first one below.</div>'}
    </div>
    <h2 class="sect">New routine</h2>
    <div class="card">
      <label class="field">Title</label>
      <input type="text" id="r-title" placeholder="e.g. Pre-game lock-in">
      <label class="field">Steps <span style="color:var(--muted);font-weight:400;font-size:13px">(one per line)</span></label>
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
    <h1 class="display" style="font-size:36px">Edit routine.</h1>
    <div class="card">
      <label class="field">Title</label>
      <input type="text" id="r-title" value="${esc(r.title)}">
      <label class="field">Steps <span style="color:var(--muted);font-weight:400;font-size:13px">(one per line)</span></label>
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
    <div class="kicker" style="margin-top:14px">Checklist</div>
    <h1 class="display">Success Blueprint.</h1>
    <div class="card note-card">
      <p class="big-serif">Hitting is hard.</p>
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
