'use strict';
(function () {
  var CFG = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/"/g, '&quot;'); }
  function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 1600); }
  function api(p, opts) { return fetch(p, Object.assign({ headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }, opts || {})).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); }); }
  function post(p, body, msg) { api(p, { method: 'POST', body: JSON.stringify(body) }).then(function (res) { toast(res.status === 200 ? (msg || 'Saved') : (res.body.message || 'Save failed')); }); }
  function val(id) { return $(id).value; }

  function renderCenters() {
    var h = '<div class="row" style="grid-template-columns:1fr 70px 70px 90px"><span></span><span class="colhead">Under 3</span><span class="colhead">Over 3</span><span class="colhead">Goal $</span></div>';
    CFG.centers.forEach(function (c, i) {
      h += '<div class="row" style="grid-template-columns:1fr 70px 70px 90px">' +
        '<label>' + c.label + '</label>' +
        '<input id="c-u-' + i + '" type="number" min="0" value="' + c.cap_under3 + '">' +
        '<input id="c-o-' + i + '" type="number" min="0" value="' + c.cap_over3 + '">' +
        '<input id="c-g-' + i + '" type="number" min="0" value="' + c.goal_monthly + '"></div>';
    });
    h += '<button class="save" id="save-centers">Save capacities &amp; goals</button>';
    $('centers').innerHTML = h;
    $('save-centers').addEventListener('click', function () {
      CFG.centers.forEach(function (c, i) { post('/api/config/center', { name: c.name, cap_under3: val('c-u-' + i), cap_over3: val('c-o-' + i), goal_monthly: val('c-g-' + i) }); });
      toast('Capacities & goals saved');
    });
  }

  function renderRates() {
    var byCenter = {};
    CFG.rates.forEach(function (r) { (byCenter[r.center] = byCenter[r.center] || {})[r.band] = r; });
    var h = '<div class="row" style="grid-template-columns:1fr 80px 80px"><span></span><span class="colhead">School yr</span><span class="colhead">Summer</span></div>';
    var idx = 0; window.__rateMap = [];
    CFG.centers.forEach(function (c) {
      ['Under 3', 'Over 3'].forEach(function (band) {
        var r = (byCenter[c.name] && byCenter[c.name][band]) || { sy_weekly: 0, summer_weekly: 0 };
        h += '<div class="row" style="grid-template-columns:1fr 80px 80px">' +
          '<label>' + c.label.split(' ')[0] + ' · ' + band + '</label>' +
          '<input id="r-sy-' + idx + '" type="number" min="0" step="0.01" value="' + r.sy_weekly + '">' +
          '<input id="r-su-' + idx + '" type="number" min="0" step="0.01" value="' + r.summer_weekly + '"></div>';
        window.__rateMap.push({ center: c.name, band: band, idx: idx }); idx++;
      });
    });
    h += '<button class="save" id="save-rates">Save tuition rates</button>';
    $('rates').innerHTML = h;
    $('save-rates').addEventListener('click', function () {
      window.__rateMap.forEach(function (m) { post('/api/config/rate', { center: m.center, band: m.band, sy_weekly: val('r-sy-' + m.idx), summer_weekly: val('r-su-' + m.idx) }); });
      toast('Tuition rates saved');
    });
  }

  function renderStaff() {
    var h = '';
    CFG.roles.forEach(function (role, i) {
      var sr = CFG.staffRates[role.role] || { hourly: 0 };
      h += '<div class="row" style="grid-template-columns:1fr 90px"><label>' + role.label + '</label>' +
        '<input id="s-' + i + '" type="number" min="0" step="0.01" value="' + sr.hourly + '"></div>';
    });
    h += '<button class="save" id="save-staff">Save staff pay rates</button>';
    $('staff').innerHTML = h;
    $('save-staff').addEventListener('click', function () {
      CFG.roles.forEach(function (role, i) { post('/api/config/staffrate', { role: role.role, hourly: val('s-' + i) }); });
      toast('Pay rates saved');
    });
  }

  function renderFixed() {
    var map = {}; CFG.fixedCosts.forEach(function (x) { (map[x.center] = map[x.center] || {})[x.category] = x.monthly; });
    var h = ''; window.__fixMap = []; var idx = 0;
    CFG.centers.forEach(function (c) {
      h += '<div class="sub">' + c.label + '</div>';
      CFG.fixedCategories.forEach(function (cat) {
        var v = (map[c.name] && map[c.name][cat] != null) ? map[c.name][cat] : 0;
        h += '<div class="row" style="grid-template-columns:1fr 110px"><label>' + cat + '</label>' +
          '<input id="f-' + idx + '" type="number" min="0" step="0.01" value="' + v + '"></div>';
        window.__fixMap.push({ center: c.name, category: cat, idx: idx }); idx++;
      });
    });
    h += '<button class="save" id="save-fixed">Save fixed costs</button>';
    $('fixed').innerHTML = h;
    $('save-fixed').addEventListener('click', function () {
      window.__fixMap.forEach(function (m) { post('/api/config/fixedcost', { center: m.center, category: m.category, monthly: val('f-' + m.idx) }); });
      toast('Fixed costs saved');
    });
  }

  function renderGeneral() {
    var s = CFG.settings || {};
    var rows = [['weeks_per_month', 'Weeks per month'], ['full_time_hours', 'Full-time hours / week'], ['in_room_hours', 'In-room hours / shift']];
    var h = '';
    rows.forEach(function (r, i) {
      h += '<div class="row" style="grid-template-columns:1fr 110px"><label>' + r[1] + '</label>' +
        '<input id="g-' + i + '" type="number" step="0.01" value="' + (s[r[0]] != null ? s[r[0]] : '') + '"></div>';
    });
    h += '<button class="save" id="save-general">Save general settings</button>';
    $('general').innerHTML = h;
    $('save-general').addEventListener('click', function () {
      rows.forEach(function (r, i) { post('/api/config/setting', { key: r[0], value: val('g-' + i) }); });
      toast('Settings saved');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    api('/api/config').then(function (res) {
      if (res.status === 403) { $('gate').innerHTML = 'This area is for leadership only.<br><a href="/">Back</a>'; return; }
      if (res.status === 401) { window.location.href = '/'; return; }
      if (res.status !== 200) { $('gate').textContent = 'Could not load.'; return; }
      CFG = res.body; $('gate').classList.add('hide'); $('app').classList.remove('hide');
      renderCenters(); renderRates(); renderStaff(); renderFixed(); renderGeneral();
    });
  });
})();
