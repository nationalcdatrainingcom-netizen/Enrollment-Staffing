'use strict';
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
app.use(express.json());

const SECRET = process.env.HUB_JWT_SECRET || 'tcc-hub-jwt-2026';
const LOGIN_PASSWORD = process.env.CENTER_LOGIN_PASSWORD || 'TCC2026';
const COOKIE = 'chs_jwt';
const PROD = process.env.NODE_ENV === 'production';

function parseCookies(req) {
  const out = {}; const h = req.headers.cookie; if (!h) return out;
  h.split(';').forEach(p => { const i = p.indexOf('='); if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setCookie(res, token) {
  const bits = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=43200'];
  if (PROD) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}
function clearCookie(res) {
  const bits = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (PROD) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}
function readToken(req) {
  if (req.query && req.query.token) return String(req.query.token);
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return parseCookies(req)[COOKIE] || null;
}
function identityFromClaims(p) {
  return String(p.username || p.first_name || p.firstName || p.given_name || p.name || p.sub || p.preferred_username || '').toLowerCase().trim();
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res, next) => {
  if (req.query && req.query.token) {
    try { jwt.verify(String(req.query.token), SECRET); setCookie(res, String(req.query.token)); } catch (e) {}
    if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.redirect(req.path || '/');
  }
  next();
});

app.post('/api/login', async (req, res) => {
  const name = String(req.body.name || '').toLowerCase().trim();
  const pw = String(req.body.password || '');
  if (!name || !pw) return res.status(400).json({ error: 'missing', message: 'Enter your first name and password.' });
  let user;
  try { user = await db.getUser(name); }
  catch (e) { return res.status(500).json({ error: 'db', message: 'Could not reach the database.' }); }
  if (!user) return res.status(403).json({ error: 'not_provisioned', message: `"${req.body.name}" isn't set up yet. Ask Mary to add you.` });
  if (pw.toLowerCase() !== LOGIN_PASSWORD.toLowerCase()) return res.status(401).json({ error: 'bad_password', message: 'Incorrect password.' });
  const token = jwt.sign({ username: user.username }, SECRET, { expiresIn: '12h' });
  setCookie(res, token);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => { clearCookie(res); res.json({ ok: true }); });

async function authenticate(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'no_token', message: 'Please sign in.' });
  let payload;
  try { payload = jwt.verify(token, SECRET); }
  catch (e) { return res.status(401).json({ error: 'bad_token', message: 'Your session expired. Please sign in again.' }); }
  const id = identityFromClaims(payload);
  if (!id) return res.status(401).json({ error: 'no_identity', message: 'Login token is missing a name.' });
  let user;
  try { user = await db.getUser(id); }
  catch (e) { return res.status(500).json({ error: 'db', message: 'Could not reach the database.' }); }
  if (!user) return res.status(403).json({ error: 'not_provisioned', username: id, message: `"${id}" isn't set up for this app yet.` });
  req.user = user;
  next();
}

function resolveCenter(user, requested, centers) {
  if (user.role === 'director') {
    if (requested && requested !== user.center) { const e = new Error('forbidden'); e.code = 403; throw e; }
    return user.center;
  }
  if (requested) return requested;
  return centers && centers.length ? centers[0].name : null;
}
const toInt = v => { const n = parseInt(v, 10); return isNaN(n) || n < 0 ? 0 : n; };

app.get('/api/me', authenticate, async (req, res) => {
  try {
    const all = await db.listCenters();
    const centers = req.user.role === 'director' ? all.filter(c => c.name === req.user.center) : all;
    const inRoom = await db.getSetting('in_room_hours', '7.5');
    res.json({ username: req.user.username, role: req.user.role, center: req.user.center, name: req.user.name, centers, settings: { in_room_hours: parseFloat(inRoom) || 7.5 } });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});

app.get('/api/state', authenticate, async (req, res) => {
  try {
    const centers = await db.listCenters();
    let center;
    try { center = resolveCenter(req.user, req.query.center, centers); }
    catch (e) { return res.status(403).json({ error: 'forbidden', message: 'You can only view your own center.' }); }
    if (!center) return res.status(400).json({ error: 'no_center' });
    const c = await db.getCenter(center);
    if (!c) return res.status(404).json({ error: 'unknown_center' });
    const enr = await db.latestEnrollment(center);
    const stf = await db.latestStaffing(center);
    const inRoom = await db.getSetting('in_room_hours', '7.5');
    res.json({ center: c, enrollment: enr, staffing: stf, settings: { in_room_hours: parseFloat(inRoom) || 7.5 } });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});

app.post('/api/enrollment', authenticate, async (req, res) => {
  try {
    const centers = await db.listCenters();
    let center;
    try { center = resolveCenter(req.user, req.body.center, centers); }
    catch (e) { return res.status(403).json({ error: 'forbidden', message: 'You can only edit your own center.' }); }
    if (!center) return res.status(400).json({ error: 'no_center' });
    const row = await db.insertEnrollment(center, toInt(req.body.under3), toInt(req.body.over3), req.user.username);
    res.json({ ok: true, enrollment: row });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});

app.post('/api/staffing', authenticate, async (req, res) => {
  try {
    const centers = await db.listCenters();
    let center;
    try { center = resolveCenter(req.user, req.body.center, centers); }
    catch (e) { return res.status(403).json({ error: 'forbidden', message: 'You can only edit your own center.' }); }
    if (!center) return res.status(400).json({ error: 'no_center' });
    const b = req.body;
    const s = { dir_ft: toInt(b.dir_ft), dir_pt: toInt(b.dir_pt), ad_ft: toInt(b.ad_ft), ad_pt: toInt(b.ad_pt), lead_ft: toInt(b.lead_ft), lead_pt: toInt(b.lead_pt), assoc_ft: toInt(b.assoc_ft), assoc_pt: toInt(b.assoc_pt), care_ft: toInt(b.care_ft), care_pt: toInt(b.care_pt) };
    const row = await db.insertStaffing(center, s, req.user.username);
    res.json({ ok: true, staffing: row });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Enrollment & Staffing listening on ' + port));
}
module.exports = app;
