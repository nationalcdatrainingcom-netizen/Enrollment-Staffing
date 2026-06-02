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
  if (PROD) bits.push('Secure'); res.append('Set-Cookie', bits.join('; '));
}
function clearCookie(res) {
  const bits = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (PROD) bits.push('Secure'); res.append('Set-Cookie', bits.join('; '));
}
function readToken(req) {
  if (req.query && req.query.hub_token) return String(req.query.hub_token);
  if (req.query && req.query.token) return String(req.query.token);
  const h = req.headers.authorization; if (h && h.startsWith('Bearer ')) return h.slice(7);
  return parseCookies(req)[COOKIE] || null;
}
function identityFromClaims(p) {
  return String(p.username || p.first_name || p.firstName || p.given_name || p.name || p.sub || p.preferred_username || '').toLowerCase().trim();
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res, next) => {
  var urlTok = (req.query && (req.query.hub_token || req.query.token)) ? String(req.query.hub_token || req.query.token) : null;
  if (urlTok) {
    try { jwt.verify(urlTok, SECRET); setCookie(res, urlTok); } catch (e) {}
    // Only strip a plain ?token= (own-tab flow). Leave ?hub_token= in place so the
    // embedded Hub iframe can read it and send it as a Bearer header (cookies are
    // blocked in the cross-domain iframe).
    if (req.method === 'GET' && !req.path.startsWith('/api/') && req.query.token && !req.query.hub_token) {
      return res.redirect(req.path || '/');
    }
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
  setCookie(res, token); res.json({ ok: true });
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
  req.user = user; next();
}
function requireLeadership(req, res, next) {
  if (req.user.role === 'owner' || req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'forbidden', message: 'This area is for leadership only.' });
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
const toNum = v => { const n = parseFloat(v); return isNaN(n) || n < 0 ? 0 : n; };

function bandRequired(enroll, ratio, P) {
  if (enroll <= 0) return 0;
  const core = Math.ceil(enroll / ratio);
  const hours = core * 10 + Math.ceil(core / 2) * 1;
  return hours / P;
}

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
    let center; try { center = resolveCenter(req.user, req.query.center, centers); } catch (e) { return res.status(403).json({ error: 'forbidden', message: 'You can only view your own center.' }); }
    if (!center) return res.status(400).json({ error: 'no_center' });
    const c = await db.getCenter(center); if (!c) return res.status(404).json({ error: 'unknown_center' });
    const enr = await db.latestEnrollment(center); const stf = await db.latestStaffing(center);
    const inRoom = await db.getSetting('in_room_hours', '7.5');
    res.json({ center: c, enrollment: enr, staffing: stf, settings: { in_room_hours: parseFloat(inRoom) || 7.5 } });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});

// Director-safe financial snapshot for ONE center the user is allowed to see.
// Returns ONLY coverage % and break-even seats — never labor $, overhead $, pay, or other centers.
app.get('/api/center-finance', authenticate, async (req, res) => {
  try {
    const centers = await db.listCenters();
    let center;
    try { center = resolveCenter(req.user, req.query.center, centers); }
    catch (e) { return res.status(403).json({ error: 'forbidden', message: 'You can only view your own center.' }); }
    if (!center) return res.status(400).json({ error: 'no_center' });
    const c = await db.getCenter(center);
    if (!c) return res.status(404).json({ error: 'unknown_center' });
    const mode = req.query.mode === 'summer' ? 'summer' : 'school_year';
    const settings = await db.getSettings();
    const staffRates = await db.listStaffRates();
    const weeks = parseFloat(settings.weeks_per_month) || (52 / 12);
    const ftHours = parseFloat(settings.full_time_hours) || 40;

    const enr = await db.latestEnrollment(center) || { under3: 0, over3: 0, staff_under3: 0, staff_over3: 0 };
    const stf = await db.latestStaffing(center) || {};
    const rU = await db.getRate(center, 'Under 3');
    const rO = await db.getRate(center, 'Over 3');
    const rateU = mode === 'summer' ? rU.summer_weekly : rU.sy_weekly;
    const rateO = mode === 'summer' ? rO.summer_weekly : rO.sy_weekly;

    const under3 = enr.under3 || 0, over3 = enr.over3 || 0;       // paying
    const stfU = enr.staff_under3 || 0, stfO = enr.staff_over3 || 0; // non-paying staff children
    const payingEnrolled = under3 + over3;
    const enrolled = payingEnrolled + stfU + stfO;                // everyone in the building
    const revenue = (under3 * rateU + over3 * rateO) * weeks;     // staff children bring no revenue

    let labor = 0;
    ['dir', 'ad', 'lead', 'assoc', 'care'].forEach(r => {
      const fte = (stf[r + '_ft'] || 0) + 0.5 * (stf[r + '_pt'] || 0);
      const hr = staffRates[r] ? staffRates[r].hourly : 0;
      labor += fte * ftHours * hr * weeks;
    });
    const fixed = await db.fixedTotal(center);
    const totalCost = labor + fixed;            // includes overhead + current staffing
    const goal = c.goal_monthly || 0;
    const target = totalCost + goal;            // break-even that also meets the goal

    // Coverage = how much of full monthly cost the current tuition revenue covers.
    const coverage = totalCost > 0 ? revenue / totalCost : null;          // 1.0 = break-even
    const coverageWithGoal = target > 0 ? revenue / target : null;

    // Translate the gap to children at the CURRENT enrollment mix (blended weekly tuition).
    const avgWeekly = payingEnrolled > 0 ? (revenue / weeks) / payingEnrolled : (rateU + rateO) / 2;
    const gapToBreakEven = Math.max(0, totalCost - revenue);
    const gapToGoal = Math.max(0, target - revenue);
    const seatsToBreakEven = avgWeekly > 0 ? Math.ceil(gapToBreakEven / (avgWeekly * weeks)) : null;
    const seatsToGoal = avgWeekly > 0 ? Math.ceil(gapToGoal / (avgWeekly * weeks)) : null;

    // NOTE: deliberately NO labor/fixed/revenue dollars in the response.
    res.json({
      center: c.name, label: c.label, mode,
      enrolled, capacity: c.cap_under3 + c.cap_over3,
      hasCostData: totalCost > 0,
      coverage, coverageWithGoal,
      seatsToBreakEven, seatsToGoal,
      hasGoal: goal > 0,
      meetsBreakEven: coverage != null ? revenue >= totalCost : false,
      meetsGoal: target > 0 ? revenue >= target : false
    });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});

app.post('/api/enrollment', authenticate, async (req, res) => {
  try {
    const centers = await db.listCenters();
    let center; try { center = resolveCenter(req.user, req.body.center, centers); } catch (e) { return res.status(403).json({ error: 'forbidden', message: 'You can only edit your own center.' }); }
    if (!center) return res.status(400).json({ error: 'no_center' });
    const row = await db.insertEnrollment(center, toInt(req.body.under3), toInt(req.body.over3), toInt(req.body.staff_under3), toInt(req.body.staff_over3), req.user.username);
    res.json({ ok: true, enrollment: row });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});

app.post('/api/staffing', authenticate, async (req, res) => {
  try {
    const centers = await db.listCenters();
    let center; try { center = resolveCenter(req.user, req.body.center, centers); } catch (e) { return res.status(403).json({ error: 'forbidden', message: 'You can only edit your own center.' }); }
    if (!center) return res.status(400).json({ error: 'no_center' });
    const b = req.body;
    const s = { dir_ft: toInt(b.dir_ft), dir_pt: toInt(b.dir_pt), ad_ft: toInt(b.ad_ft), ad_pt: toInt(b.ad_pt), lead_ft: toInt(b.lead_ft), lead_pt: toInt(b.lead_pt), assoc_ft: toInt(b.assoc_ft), assoc_pt: toInt(b.assoc_pt), care_ft: toInt(b.care_ft), care_pt: toInt(b.care_pt) };
    const row = await db.insertStaffing(center, s, req.user.username);
    res.json({ ok: true, staffing: row });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});

async function computeCenter(c, mode, settings, staffRates) {
  const weeks = parseFloat(settings.weeks_per_month) || (52 / 12);
  const ftHours = parseFloat(settings.full_time_hours) || 40;
  const inRoom = parseFloat(settings.in_room_hours) || 7.5;
  const enr = await db.latestEnrollment(c.name) || { under3: 0, over3: 0, staff_under3: 0, staff_over3: 0 };
  const stf = await db.latestStaffing(c.name) || {};
  const rU = await db.getRate(c.name, 'Under 3'); const rO = await db.getRate(c.name, 'Over 3');
  const rateU = mode === 'summer' ? rU.summer_weekly : rU.sy_weekly;
  const rateO = mode === 'summer' ? rO.summer_weekly : rO.sy_weekly;
  const payU = enr.under3 || 0, payO = enr.over3 || 0;
  const stfU = enr.staff_under3 || 0, stfO = enr.staff_over3 || 0;
  const totU = payU + stfU, totO = payO + stfO;          // for ratio: every child in the room
  const enrollment = totU + totO;
  const capacity = c.cap_under3 + c.cap_over3;
  const revenue = (payU * rateU + payO * rateO) * weeks;  // only paying children bring revenue
  const roles = ['dir', 'ad', 'lead', 'assoc', 'care'];
  let labor = 0;
  roles.forEach(r => {
    const fte = (stf[r + '_ft'] || 0) + 0.5 * (stf[r + '_pt'] || 0);
    const hr = staffRates[r] ? staffRates[r].hourly : 0;
    labor += fte * ftHours * hr * weeks;
  });
  const fixed = await db.fixedTotal(c.name);
  const profit = revenue - labor - fixed;
  const requiredFte = bandRequired(totU, 4, inRoom) + bandRequired(totO, 10, inRoom);
  const actualFte = (stf.lead_ft || 0) + (stf.assoc_ft || 0) + (stf.care_ft || 0) + 0.5 * ((stf.lead_pt || 0) + (stf.assoc_pt || 0) + (stf.care_pt || 0));
  const goal = c.goal_monthly || 0;
  const tol = goal === 0 ? 500 : 0.05 * Math.abs(goal);
  let status = 'red';
  if (profit >= goal) status = 'green'; else if (profit >= goal - tol) status = 'yellow';
  return {
    name: c.name, label: c.label, enrollment, capacity,
    payingEnrollment: payU + payO, staffChildren: stfU + stfO,
    utilization: capacity ? enrollment / capacity : 0,
    requiredFte, actualFte, revenue, labor, fixed, expenses: labor + fixed,
    profit, goal, varToGoal: profit - goal, status
  };
}

app.get('/api/exec', authenticate, requireLeadership, async (req, res) => {
  try {
    const mode = req.query.mode === 'summer' ? 'summer' : 'school_year';
    const centers = await db.listCenters();
    const settings = await db.getSettings();
    const staffRates = await db.listStaffRates();
    const rows = [];
    for (const c of centers) rows.push(await computeCenter(c, mode, settings, staffRates));
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    const totEnroll = sum('enrollment'), totCap = sum('capacity');
    const totals = {
      enrollment: totEnroll, capacity: totCap, utilization: totCap ? totEnroll / totCap : 0,
      requiredFte: sum('requiredFte'), actualFte: sum('actualFte'),
      revenue: sum('revenue'), expenses: sum('expenses'), profit: sum('profit'),
      goal: sum('goal'), varToGoal: sum('profit') - sum('goal')
    };
    res.json({ mode, rows, totals });
  } catch (e) { res.status(500).json({ error: 'server', message: String(e.message || e) }); }
});

app.get('/api/config', authenticate, requireLeadership, async (req, res) => {
  try {
    res.json({
      centers: await db.listCenters(), rates: await db.listRates(), staffRates: await db.listStaffRates(),
      fixedCosts: await db.listFixedCosts(), settings: await db.getSettings(),
      fixedCategories: db.FIXED_CATS, roles: db.STAFF_ROLES.map(r => ({ role: r.role, label: r.label }))
    });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});

app.post('/api/config/center', authenticate, requireLeadership, async (req, res) => {
  try { await db.setCenter(req.body.name, toInt(req.body.cap_under3), toInt(req.body.cap_over3), toNum(req.body.goal_monthly)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'server' }); }
});
app.post('/api/config/rate', authenticate, requireLeadership, async (req, res) => {
  try { await db.setRate(req.body.center, req.body.band, toNum(req.body.sy_weekly), toNum(req.body.summer_weekly)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'server' }); }
});
app.post('/api/config/staffrate', authenticate, requireLeadership, async (req, res) => {
  try { await db.setStaffRate(req.body.role, toNum(req.body.hourly)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'server' }); }
});
app.post('/api/config/fixedcost', authenticate, requireLeadership, async (req, res) => {
  try { await db.setFixedCost(req.body.center, req.body.category, toNum(req.body.monthly)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'server' }); }
});
app.post('/api/config/setting', authenticate, requireLeadership, async (req, res) => {
  try { await db.setSetting(req.body.key, String(req.body.value)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'server' }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Enrollment & Staffing listening on ' + port));
}
module.exports = app;
