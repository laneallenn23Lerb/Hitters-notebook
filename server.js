// The Hitter's Notebook — multi-user server.
// Express + cookie sessions + SQLite (local) or Postgres (DATABASE_URL).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db');
const { generateTakeaways } = require('./takeaways');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const SESSION_DAYS = 30;

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(SESSION_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- search helpers ----------
function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
// Matches "strike out" against "strikeout" and vice versa.
function matchesQuery(haystack, q) {
  const nq = normalize(q);
  if (!nq) return true;
  const nh = normalize(haystack);
  if (nh.includes(nq)) return true;
  return nh.replace(/ /g, '').includes(nq.replace(/ /g, ''));
}
function entryText(e) {
  let d = {};
  try { d = JSON.parse(e.data || '{}'); } catch { d = {}; }
  let tw = [];
  try { tw = JSON.parse(e.takeaways || '[]'); } catch { tw = []; }
  const parts = [
    e.type, e.date, e.opponent, e.context, e.reflection,
    d.plan, d.result, d.contactQuality, d.mentalState, d.cue, d.cues,
    d.mechanics, d.selfTalk, d.approach, d.pitcherNotes, d.notes, d.focus,
    Array.isArray(tw) ? tw.join(' ') : '',
  ];
  return parts.filter(Boolean).join(' ');
}

// ---------- auth ----------
async function auth(req, res, next) {
  const token = req.signedCookies.hn_session;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const rows = await db.query('SELECT user_id, expires_at FROM sessions WHERE token = ?', [token]);
  if (!rows.length || new Date(rows[0].expires_at) < new Date()) {
    res.clearCookie('hn_session');
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
  req.userId = rows[0].user_id;
  next();
}

function setSessionCookie(res, token) {
  res.cookie('hn_session', token, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

app.post('/api/signup', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const existing = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) return res.status(409).json({ error: 'An account with that email already exists. Try signing in.' });
    const userId = db.newId();
    const hash = await bcrypt.hash(password, 10);
    await db.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)',
      [userId, email, hash, db.nowIso()]);
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', [token, userId, expires]);
    setSessionCookie(res, token);
    res.status(201).json({ email });
  } catch (err) {
    console.error('signup error', err);
    res.status(500).json({ error: 'Something went wrong signing up. Please try again.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const rows = await db.query('SELECT id, email, password_hash FROM users WHERE email = ?', [email]);
    if (!rows.length) return res.status(401).json({ error: 'No account found with that email.' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Wrong password. Please try again.' });
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', [token, rows[0].id, expires]);
    setSessionCookie(res, token);
    res.json({ email: rows[0].email });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Something went wrong signing in. Please try again.' });
  }
});

app.post('/api/logout', auth, async (req, res) => {
  const token = req.signedCookies.hn_session;
  if (token) await db.run('DELETE FROM sessions WHERE token = ?', [token]);
  res.clearCookie('hn_session');
  res.json({ ok: true });
});

app.get('/api/me', auth, async (req, res) => {
  const rows = await db.query('SELECT email FROM users WHERE id = ?', [req.userId]);
  res.json({ email: rows.length ? rows[0].email : '' });
});

// ---------- entries ----------
const REFLECTION_TYPES = ['game', 'practice'];

app.get('/api/entries', auth, async (req, res) => {
  const type = req.query.type;
  const q = (req.query.q || '').trim();
  let rows;
  if (type) {
    rows = await db.query(
      'SELECT * FROM entries WHERE user_id = ? AND type = ? ORDER BY date DESC, created_at DESC', [req.userId, type]);
  } else {
    rows = await db.query(
      'SELECT * FROM entries WHERE user_id = ? ORDER BY date DESC, created_at DESC', [req.userId]);
  }
  if (q) {
    // Record the search for the "frequent searches" chips
    const term = normalize(q);
    if (term) {
      await db.run(
        `INSERT INTO searches (id, user_id, term, count, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id, term) DO UPDATE SET count = searches.count + 1, updated_at = excluded.updated_at`,
        [db.newId(), req.userId, term, 1, db.nowIso()]);
    }
    rows = rows.filter((e) => matchesQuery(entryText(e), q));
  }
  res.json(rows.map(publicEntry));
});

function publicEntry(e) {
  let data = {};
  let takeaways = [];
  try { data = JSON.parse(e.data || '{}'); } catch { data = {}; }
  try { takeaways = JSON.parse(e.takeaways || '[]'); } catch { takeaways = []; }
  return {
    id: e.id, type: e.type, game_id: e.game_id, at_bat_number: e.at_bat_number,
    date: e.date, opponent: e.opponent, context: e.context,
    data, reflection: e.reflection || '', takeaways,
    created_at: e.created_at, updated_at: e.updated_at,
  };
}

app.post('/api/entries', auth, async (req, res) => {
  try {
    const { type, game_id, at_bat_number, date, opponent, context, data, reflection } = req.body || {};
    if (!['atbat', 'game', 'practice', 'individual'].includes(type)) {
      return res.status(400).json({ error: 'Unknown entry type.' });
    }
    const id = db.newId();
    const now = db.nowIso();
    let takeaways = [];
    if (REFLECTION_TYPES.includes(type)) {
      const ratings = (data && data.ratings) || {};
      takeaways = generateTakeaways({ ratings, reflection: reflection || '' });
    }
    await db.run(
      `INSERT INTO entries (id, user_id, type, game_id, at_bat_number, date, opponent, context, data, reflection, takeaways, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.userId, type, game_id || null, at_bat_number || null,
       date || null, opponent || null, context || null,
       JSON.stringify(data || {}), reflection || '', JSON.stringify(takeaways), now, now]);
    const rows = await db.query('SELECT * FROM entries WHERE id = ? AND user_id = ?', [id, req.userId]);
    res.status(201).json(publicEntry(rows[0]));
  } catch (err) {
    console.error('create entry error', err);
    res.status(500).json({ error: 'Could not save the entry. Please try again.' });
  }
});

app.get('/api/entries/:id', auth, async (req, res) => {
  const rows = await db.query('SELECT * FROM entries WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!rows.length) return res.status(404).json({ error: 'Entry not found.' });
  res.json(publicEntry(rows[0]));
});

app.put('/api/entries/:id', auth, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM entries WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!rows.length) return res.status(404).json({ error: 'Entry not found.' });
    const e = rows[0];
    const { date, opponent, context, data, reflection, at_bat_number } = req.body || {};
    const newData = data !== undefined ? data : JSON.parse(e.data || '{}');
    const newReflection = reflection !== undefined ? reflection : (e.reflection || '');
    let takeaways = JSON.parse(e.takeaways || '[]');
    if (REFLECTION_TYPES.includes(e.type) && (data !== undefined || reflection !== undefined)) {
      takeaways = generateTakeaways({ ratings: (newData && newData.ratings) || {}, reflection: newReflection });
    }
    await db.run(
      `UPDATE entries SET date = ?, opponent = ?, context = ?, data = ?, reflection = ?, takeaways = ?,
        at_bat_number = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [date !== undefined ? date : e.date,
       opponent !== undefined ? opponent : e.opponent,
       context !== undefined ? context : e.context,
       JSON.stringify(newData), newReflection, JSON.stringify(takeaways),
       at_bat_number !== undefined ? at_bat_number : e.at_bat_number,
       db.nowIso(), e.id, req.userId]);
    const updated = await db.query('SELECT * FROM entries WHERE id = ? AND user_id = ?', [e.id, req.userId]);
    res.json(publicEntry(updated[0]));
  } catch (err) {
    console.error('update entry error', err);
    res.status(500).json({ error: 'Could not save changes. Please try again.' });
  }
});

app.delete('/api/entries/:id', auth, async (req, res) => {
  const vids = await db.query('SELECT stored_filename FROM videos WHERE entry_id = ? AND user_id = ?', [req.params.id, req.userId]);
  await db.run('DELETE FROM entries WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  for (const v of vids) {
    try { fs.unlinkSync(videoPath(req.userId, v.stored_filename)); } catch { /* already gone */ }
  }
  res.json({ ok: true });
});

// ---------- video attachments ----------
// Videos live under data/uploads/<user_id>/ and are ONLY served through the
// authenticated /api/videos/:id/stream route below — never as public static files.
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function videoPath(userId, storedFilename) {
  const safeUser = String(userId).replace(/[^a-zA-Z0-9-]/g, '');
  const safeFile = path.basename(String(storedFilename));
  return path.join(__dirname, 'data', 'uploads', safeUser, safeFile);
}

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'data', 'uploads', String(req.userId).replace(/[^a-zA-Z0-9-]/g, ''));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const id = db.newId();
    file.videoId = id;
    const safe = (file.originalname || 'video').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'video';
    cb(null, id + '-' + safe);
  },
});

const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files can be attached.'));
  },
});

function publicVideo(v) {
  return {
    id: v.id,
    original_name: v.original_name,
    mime_type: v.mime_type,
    size_bytes: v.size_bytes,
    created_at: v.created_at,
  };
}

// List videos attached to one of the user's entries
app.get('/api/entries/:id/videos', auth, async (req, res) => {
  const entryRows = await db.query('SELECT id FROM entries WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!entryRows.length) return res.status(404).json({ error: 'Entry not found.' });
  const rows = await db.query(
    'SELECT id, original_name, mime_type, size_bytes, created_at FROM videos WHERE entry_id = ? AND user_id = ? ORDER BY created_at ASC',
    [req.params.id, req.userId]);
  res.json(rows.map(publicVideo));
});

// Upload one or more videos to an entry
app.post('/api/entries/:id/videos', auth, (req, res) => {
  videoUpload.array('videos', 10)(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'That video is too large (max 100MB).'
        : (err.message || 'Upload failed. Please try again.');
      return res.status(400).json({ error: msg });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Choose a video first.' });
    try {
      const entryRows = await db.query('SELECT id FROM entries WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
      if (!entryRows.length) {
        for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* ignore */ } }
        return res.status(404).json({ error: 'Entry not found.' });
      }
      const now = db.nowIso();
      const out = [];
      for (const f of files) {
        const vid = f.videoId || db.newId();
        await db.run(
          'INSERT INTO videos (id, user_id, entry_id, stored_filename, original_name, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?,?,?,?)',
          [vid, req.userId, req.params.id, f.filename, f.originalname || 'video', f.mimetype, f.size, now]);
        out.push(publicVideo({
          id: vid, original_name: f.originalname || 'video',
          mime_type: f.mimetype, size_bytes: f.size, created_at: now,
        }));
      }
      res.status(201).json(out);
    } catch (e) {
      console.error('video upload error', e);
      for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* ignore */ } }
      res.status(500).json({ error: 'Could not save the video. Please try again.' });
    }
  });
});

// Delete one video (file + row)
app.delete('/api/videos/:id', auth, async (req, res) => {
  const rows = await db.query('SELECT * FROM videos WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!rows.length) return res.status(404).json({ error: 'Video not found.' });
  await db.run('DELETE FROM videos WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  try { fs.unlinkSync(videoPath(req.userId, rows[0].stored_filename)); } catch { /* already gone */ }
  res.json({ ok: true });
});

// Stream a video — authenticated, ownership-checked, with Range support for mobile playback
app.get('/api/videos/:id/stream', auth, async (req, res) => {
  const rows = await db.query('SELECT * FROM videos WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!rows.length) return res.status(404).json({ error: 'Video not found.' });
  const filePath = videoPath(req.userId, rows[0].stored_filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Video file is missing.' });
  const stat = fs.statSync(filePath);
  const mime = rows[0].mime_type || 'video/mp4';
  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (isNaN(start) || start < 0 || start >= stat.size) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }
    const safeEnd = Math.min(isNaN(end) ? stat.size - 1 : end, stat.size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${safeEnd}/${stat.size}`);
    res.setHeader('Content-Length', safeEnd - start + 1);
    fs.createReadStream(filePath, { start, end: safeEnd }).pipe(res);
  } else {
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
  }
});

// ---------- frequent searches ----------
app.get('/api/searches/frequent', auth, async (req, res) => {
  const rows = await db.query(
    'SELECT term, count FROM searches WHERE user_id = ? ORDER BY count DESC, updated_at DESC LIMIT 6', [req.userId]);
  res.json(rows);
});

// ---------- routines ----------
app.get('/api/routines', auth, async (req, res) => {
  const rows = await db.query('SELECT * FROM routines WHERE user_id = ? ORDER BY created_at ASC', [req.userId]);
  res.json(rows.map((r) => ({ ...r, steps: safeJson(r.steps, []) })));
});

app.post('/api/routines', auth, async (req, res) => {
  const { title, steps } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Give the routine a title.' });
  const id = db.newId();
  const now = db.nowIso();
  await db.run('INSERT INTO routines (id, user_id, title, steps, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    [id, req.userId, title.trim(), JSON.stringify(Array.isArray(steps) ? steps : []), now, now]);
  res.status(201).json({ id, title: title.trim(), steps: Array.isArray(steps) ? steps : [] });
});

app.put('/api/routines/:id', auth, async (req, res) => {
  const { title, steps } = req.body || {};
  await db.run('UPDATE routines SET title = ?, steps = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [title, JSON.stringify(Array.isArray(steps) ? steps : []), db.nowIso(), req.params.id, req.userId]);
  res.json({ ok: true });
});

app.delete('/api/routines/:id', auth, async (req, res) => {
  await db.run('DELETE FROM routines WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  res.json({ ok: true });
});

// ---------- blueprint checklist ----------
app.get('/api/blueprint', auth, async (req, res) => {
  const rows = await db.query(
    'SELECT * FROM blueprint_items WHERE user_id = ? ORDER BY position ASC, created_at ASC', [req.userId]);
  res.json(rows.map((r) => ({ id: r.id, text: r.text, done: !!r.done, position: r.position })));
});

app.post('/api/blueprint', auth, async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Write the checklist item first.' });
  const existing = await db.query('SELECT COUNT(*) AS n FROM blueprint_items WHERE user_id = ?', [req.userId]);
  const id = db.newId();
  await db.run('INSERT INTO blueprint_items (id, user_id, text, done, position, created_at) VALUES (?,?,?,?,?,?)',
    [id, req.userId, text.trim(), 0, Number(existing[0].n) || 0, db.nowIso()]);
  res.status(201).json({ id, text: text.trim(), done: false });
});

app.put('/api/blueprint/:id', auth, async (req, res) => {
  const { text, done } = req.body || {};
  const rows = await db.query('SELECT * FROM blueprint_items WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!rows.length) return res.status(404).json({ error: 'Item not found.' });
  await db.run('UPDATE blueprint_items SET text = ?, done = ? WHERE id = ? AND user_id = ?',
    [text !== undefined ? text : rows[0].text, done ? 1 : 0, req.params.id, req.userId]);
  res.json({ ok: true });
});

app.delete('/api/blueprint/:id', auth, async (req, res) => {
  await db.run('DELETE FROM blueprint_items WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  res.json({ ok: true });
});

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// ---------- boot ----------
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Hitter's Notebook listening on port ${PORT} (${db.usePg ? 'postgres' : 'sqlite'})`);
  });
}).catch((err) => {
  console.error('Failed to initialize database', err);
  process.exit(1);
});
