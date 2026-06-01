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

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ch_centers (
     name        TEXT PRIMARY KEY,
     label       TEXT NOT NULL,
     cap_under3  INTEGER NOT NULL DEFAULT 0,
     cap_over3   INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS ch_users (
     username TEXT PRIMARY KEY,
     role     TEXT NOT NULL,
     center   TEXT,
     name     TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS ch_enrollment (
     id          SERIAL PRIMARY KEY,
     center      TEXT NOT NULL,
     under3      INTEGER NOT NULL DEFAULT 0,
     over3       INTEGER NOT NULL DEFAULT 0,
     entered_by  TEXT,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS ch_staffing (
     id          SERIAL PRIMARY KEY,
     center      TEXT NOT NULL,
     dir_ft INTEGER DEFAULT 0, dir_pt INTEGER DEFAULT 0,
     ad_ft INTEGER DEFAULT 0,  ad_pt INTEGER DEFAULT 0,
     lead_ft INTEGER DEFAULT 0, lead_pt INTEGER DEFAULT 0,
     assoc_ft INTEGER DEFAULT 0, assoc_pt INTEGER DEFAULT 0,
     care_ft INTEGER DEFAULT 0, care_pt INTEGER DEFAULT 0,
     entered_by  TEXT,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS ch_settings (
     key   TEXT PRIMARY KEY,
     value TEXT
   )`
];

async function migrate() { for (const s of SCHEMA) await q(s); return true; }

const SEED_CENTERS = [
  { name: 'Peace',      label: 'Peace Boulevard',              cap_under3: 56, cap_over3: 96 },
  { name: 'Niles',      label: 'Niles',                        cap_under3: 35, cap_over3: 70 },
  { name: 'Montessori', label: "Montessori Children's Center", cap_under3: 52, cap_over3: 80 }
];

async function upsertCenter(c) {
  const ex = await q('SELECT name FROM ch_centers WHERE name=$1', [c.name]);
  if (ex.rowCount) await q('UPDATE ch_centers SET label=$2,cap_under3=$3,cap_over3=$4 WHERE name=$1', [c.name, c.label, c.cap_under3, c.cap_over3]);
  else await q('INSERT INTO ch_centers (name,label,cap_under3,cap_over3) VALUES ($1,$2,$3,$4)', [c.name, c.label, c.cap_under3, c.cap_over3]);
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
function norm(s) { return String(s || '').toLowerCase().trim(); }
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
  const r = await q('SELECT name,label,cap_under3,cap_over3 FROM ch_centers ORDER BY label');
  return r.rows;
}
async function getCenter(name) {
  const r = await q('SELECT name,label,cap_under3,cap_over3 FROM ch_centers WHERE name=$1', [name]);
  return r.rowCount ? r.rows[0] : null;
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
  for (const c of SEED_CENTERS) await upsertCenter(c);
  await setSetting('in_room_hours', '7.5');
  return true;
}
module.exports = {
  getPool, __setPoolForTest, migrate, seed,
  upsertCenter, setSetting, getSetting, upsertUser, getUser,
  listCenters, getCenter, latestEnrollment, insertEnrollment, latestStaffing, insertStaffing
};
