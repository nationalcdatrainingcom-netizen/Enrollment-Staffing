'use strict';
const { Pool } = require('pg');

let _pool = null;
function getPool() {
  if (_pool) return _pool;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL is not set');
  const useSsl = process.env.PGSSL !== 'off' && !/localhost|127\.0\.0\.1/.test(cs);
  _pool = new Pool({ connectionString: cs, ssl: useSsl ? { rejectUnauthorized: false } : false });
  return _pool;
}
function __setPoolForTest(p) { _pool = p; }
function q(text, params) { return getPool().query(text, params); }
const f = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ch_centers (
     name TEXT PRIMARY KEY, label TEXT NOT NULL,
     cap_under3 INTEGER NOT NULL DEFAULT 0, cap_over3 INTEGER NOT NULL DEFAULT 0,
     goal_monthly DOUBLE PRECISION NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS ch_users (
     username TEXT PRIMARY KEY, role TEXT NOT NULL, center TEXT, name TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS ch_enrollment (
     id SERIAL PRIMARY KEY, center TEXT NOT NULL,
     under3 INTEGER NOT NULL DEFAULT 0, over3 INTEGER NOT NULL DEFAULT 0,
     entered_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS ch_staffing (
     id SERIAL PRIMARY KEY, center TEXT NOT NULL,
     dir_ft INTEGER DEFAULT 0, dir_pt INTEGER DEFAULT 0, ad_ft INTEGER DEFAULT 0, ad_pt INTEGER DEFAULT 0,
     lead_ft INTEGER DEFAULT 0, lead_pt INTEGER DEFAULT 0, assoc_ft INTEGER DEFAULT 0, assoc_pt INTEGER DEFAULT 0,
     care_ft INTEGER DEFAULT 0, care_pt INTEGER DEFAULT 0,
     entered_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS ch_settings ( key TEXT PRIMARY KEY, value TEXT )`,
  `CREATE TABLE IF NOT EXISTS ch_rates (
     center TEXT NOT NULL, band TEXT NOT NULL,
     sy_weekly DOUBLE PRECISION DEFAULT 0, summer_weekly DOUBLE PRECISION DEFAULT 0,
     PRIMARY KEY (center, band)
   )`,
  `CREATE TABLE IF NOT EXISTS ch_staff_rates ( role TEXT PRIMARY KEY, label TEXT, hourly DOUBLE PRECISION DEFAULT 0 )`,
  `CREATE TABLE IF NOT EXISTS ch_fixed_costs (
     center TEXT NOT NULL, category TEXT NOT NULL, monthly DOUBLE PRECISION DEFAULT 0,
     PRIMARY KEY (center, category)
   )`
];

async function migrate() {
  for (const s of SCHEMA) await q(s);
  try { await q('ALTER TABLE ch_centers ADD COLUMN goal_monthly DOUBLE PRECISION DEFAULT 0'); } catch (e) {}
  return true;
}

const SEED_CENTERS = [
  { name: 'Peace',      label: 'Peace Boulevard',              cap_under3: 56, cap_over3: 96, goal: 0 },
  { name: 'Niles',      label: 'Niles',                        cap_under3: 35, cap_over3: 70, goal: 5000 },
  { name: 'Montessori', label: "Montessori Children's Center", cap_under3: 52, cap_over3: 80, goal: 0 }
];
const SEED_RATES = {
  Peace:      { under3: 419.25, over3: 233 },
  Niles:      { under3: 352,    over3: 233 },
  Montessori: { under3: 419,    over3: 385 }
};
const STAFF_ROLES = [
  { role: 'dir',   label: 'Director',                          hourly: 28 },
  { role: 'ad',    label: "Assistant director / Director's assistant", hourly: 25 },
  { role: 'lead',  label: 'Lead / co-lead',                    hourly: 21 },
  { role: 'assoc', label: 'Associate / assistant',             hourly: 17 },
  { role: 'care',  label: 'Caregiver / floater',               hourly: 15 }
];
const FIXED_CATS = ['Rent', 'Utilities', 'Insurance', 'Food', 'Supplies', 'Administrative Allocation'];

function norm(s) { return String(s || '').toLowerCase().trim(); }

async function ensureCenter(c) {
  const ex = await q('SELECT name, goal_monthly FROM ch_centers WHERE name=$1', [c.name]);
  if (ex.rowCount) {
    await q('UPDATE ch_centers SET label=$2 WHERE name=$1', [c.name, c.label]);
    if (f(ex.rows[0].goal_monthly) === 0 && c.goal) await q('UPDATE ch_centers SET goal_monthly=$2 WHERE name=$1', [c.name, c.goal]);
  } else {
    await q('INSERT INTO ch_centers (name,label,cap_under3,cap_over3,goal_monthly) VALUES ($1,$2,$3,$4,$5)', [c.name, c.label, c.cap_under3, c.cap_over3, c.goal || 0]);
  }
}
async function setCenter(name, capU, capO, goal) {
  await q('UPDATE ch_centers SET cap_under3=$2, cap_over3=$3, goal_monthly=$4 WHERE name=$1', [name, capU, capO, goal]);
}
async function ensureSetting(key, val) {
  const ex = await q('SELECT key FROM ch_settings WHERE key=$1', [key]);
  if (!ex.rowCount) await q('INSERT INTO ch_settings (key,value) VALUES ($1,$2)', [key, String(val)]);
}
async function setSetting(key, value) {
  const ex = await q('SELECT key FROM ch_settings WHERE key=$1', [key]);
  if (ex.rowCount) await q('UPDATE ch_settings SET value=$2 WHERE key=$1', [key, String(value)]);
  else await q('INSERT INTO ch_settings (key,value) VALUES ($1,$2)', [key, String(value)]);
}
async function getSetting(key, dflt) {
  const r = await q('SELECT value FROM ch_settings WHERE key=$1', [key]);
  return r.rowCount ? r.rows[0].value : dflt;
}
async function getSettings() {
  const r = await q('SELECT key,value FROM ch_settings');
  const o = {}; r.rows.forEach(x => o[x.key] = x.value); return o;
}
async function ensureRate(center, band, sy, su) {
  const ex = await q('SELECT 1 FROM ch_rates WHERE center=$1 AND band=$2', [center, band]);
  if (!ex.rowCount) await q('INSERT INTO ch_rates (center,band,sy_weekly,summer_weekly) VALUES ($1,$2,$3,$4)', [center, band, sy, su]);
}
async function setRate(center, band, sy, su) {
  const ex = await q('SELECT 1 FROM ch_rates WHERE center=$1 AND band=$2', [center, band]);
  if (ex.rowCount) await q('UPDATE ch_rates SET sy_weekly=$3, summer_weekly=$4 WHERE center=$1 AND band=$2', [center, band, sy, su]);
  else await q('INSERT INTO ch_rates (center,band,sy_weekly,summer_weekly) VALUES ($1,$2,$3,$4)', [center, band, sy, su]);
}
async function listRates() {
  const r = await q('SELECT center,band,sy_weekly,summer_weekly FROM ch_rates');
  return r.rows.map(x => ({ center: x.center, band: x.band, sy_weekly: f(x.sy_weekly), summer_weekly: f(x.summer_weekly) }));
}
async function getRate(center, band) {
  const r = await q('SELECT sy_weekly,summer_weekly FROM ch_rates WHERE center=$1 AND band=$2', [center, band]);
  return r.rowCount ? { sy_weekly: f(r.rows[0].sy_weekly), summer_weekly: f(r.rows[0].summer_weekly) } : { sy_weekly: 0, summer_weekly: 0 };
}
async function ensureStaffRate(role, label, hourly) {
  const ex = await q('SELECT 1 FROM ch_staff_rates WHERE role=$1', [role]);
  if (!ex.rowCount) await q('INSERT INTO ch_staff_rates (role,label,hourly) VALUES ($1,$2,$3)', [role, label, hourly]);
}
async function setStaffRate(role, hourly) { await q('UPDATE ch_staff_rates SET hourly=$2 WHERE role=$1', [role, hourly]); }
async function listStaffRates() {
  const r = await q('SELECT role,label,hourly FROM ch_staff_rates');
  const o = {}; r.rows.forEach(x => o[x.role] = { label: x.label, hourly: f(x.hourly) }); return o;
}
async function ensureFixedCost(center, cat, monthly) {
  const ex = await q('SELECT 1 FROM ch_fixed_costs WHERE center=$1 AND category=$2', [center, cat]);
  if (!ex.rowCount) await q('INSERT INTO ch_fixed_costs (center,category,monthly) VALUES ($1,$2,$3)', [center, cat, monthly]);
}
async function setFixedCost(center, cat, monthly) {
  const ex = await q('SELECT 1 FROM ch_fixed_costs WHERE center=$1 AND category=$2', [center, cat]);
  if (ex.rowCount) await q('UPDATE ch_fixed_costs SET monthly=$3 WHERE center=$1 AND category=$2', [center, cat, monthly]);
  else await q('INSERT INTO ch_fixed_costs (center,category,monthly) VALUES ($1,$2,$3)', [center, cat, monthly]);
}
async function listFixedCosts() {
  const r = await q('SELECT center,category,monthly FROM ch_fixed_costs');
  return r.rows.map(x => ({ center: x.center, category: x.category, monthly: f(x.monthly) }));
}
async function fixedTotal(center) {
  const r = await q('SELECT COALESCE(SUM(monthly),0) AS t FROM ch_fixed_costs WHERE center=$1', [center]);
  return f(r.rows[0].t);
}

async function upsertUser(username, role, center, name) {
  username = norm(username);
  const ex = await q('SELECT username FROM ch_users WHERE username=$1', [username]);
  if (ex.rowCount) await q('UPDATE ch_users SET role=$2,center=$3,name=$4 WHERE username=$1', [username, role, center || null, name || null]);
  else await q('INSERT INTO ch_users (username,role,center,name) VALUES ($1,$2,$3,$4)', [username, role, center || null, name || null]);
  return getUser(username);
}
async function getUser(username) {
  const r = await q('SELECT username,role,center,name FROM ch_users WHERE username=$1', [norm(username)]);
  return r.rowCount ? r.rows[0] : null;
}
async function listCenters() {
  const r = await q('SELECT name,label,cap_under3,cap_over3,goal_monthly FROM ch_centers ORDER BY label');
  return r.rows.map(x => ({ name: x.name, label: x.label, cap_under3: x.cap_under3, cap_over3: x.cap_over3, goal_monthly: f(x.goal_monthly) }));
}
async function getCenter(name) {
  const r = await q('SELECT name,label,cap_under3,cap_over3,goal_monthly FROM ch_centers WHERE name=$1', [name]);
  if (!r.rowCount) return null;
  const x = r.rows[0]; return { name: x.name, label: x.label, cap_under3: x.cap_under3, cap_over3: x.cap_over3, goal_monthly: f(x.goal_monthly) };
}
async function latestEnrollment(center) {
  const r = await q('SELECT * FROM ch_enrollment WHERE center=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [center]);
  return r.rowCount ? r.rows[0] : null;
}
async function insertEnrollment(center, under3, over3, by) {
  const r = await q('INSERT INTO ch_enrollment (center,under3,over3,entered_by) VALUES ($1,$2,$3,$4) RETURNING *', [center, under3, over3, by]);
  return r.rows[0];
}
async function latestStaffing(center) {
  const r = await q('SELECT * FROM ch_staffing WHERE center=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [center]);
  return r.rowCount ? r.rows[0] : null;
}
async function insertStaffing(center, s, by) {
  const r = await q(
    `INSERT INTO ch_staffing (center,dir_ft,dir_pt,ad_ft,ad_pt,lead_ft,lead_pt,assoc_ft,assoc_pt,care_ft,care_pt,entered_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [center, s.dir_ft, s.dir_pt, s.ad_ft, s.ad_pt, s.lead_ft, s.lead_pt, s.assoc_ft, s.assoc_pt, s.care_ft, s.care_pt, by]);
  return r.rows[0];
}

async function seed() {
  await migrate();
  for (const c of SEED_CENTERS) await ensureCenter(c);
  await ensureSetting('in_room_hours', '7.5');
  await ensureSetting('weeks_per_month', String(52 / 12));
  await ensureSetting('full_time_hours', '40');
  for (const c of SEED_CENTERS) await ensureRate(c.name, 'Under 3', SEED_RATES[c.name].under3, SEED_RATES[c.name].under3);
  for (const c of SEED_CENTERS) await ensureRate(c.name, 'Over 3', SEED_RATES[c.name].over3, SEED_RATES[c.name].over3);
  for (const sr of STAFF_ROLES) await ensureStaffRate(sr.role, sr.label, sr.hourly);
  for (const c of SEED_CENTERS) for (const cat of FIXED_CATS) await ensureFixedCost(c.name, cat, 0);
  return true;
}

module.exports = {
  getPool, __setPoolForTest, migrate, seed, norm, FIXED_CATS, STAFF_ROLES,
  ensureCenter, setCenter, ensureSetting, setSetting, getSetting, getSettings,
  setRate, listRates, getRate, setStaffRate, listStaffRates, setFixedCost, listFixedCosts, fixedTotal,
  upsertUser, getUser, listCenters, getCenter,
  latestEnrollment, insertEnrollment, latestStaffing, insertStaffing
};
