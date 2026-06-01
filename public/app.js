'use strict';
(function () {
  var RATIO = { u: 4, o: 10 }, FULL = 10, HALF = 1;
  var ME = null, CENTERS = {}, currentCenter = null, inRoomDefault = 7.5;

  function $(id) { return document.getElementById(id); }
  function num(id) { var v = parseInt($(id).value, 10); return isNaN(v) || v < 0 ? 0 : v; }
  function fmt(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 1800); }
  function when(ts) {
    if (!ts) return '';
    try { var d = new Date(ts); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }, opts || {}))
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }

  function bandRequired(enroll, ratio, P) {
    if (enroll <= 0) return { core: 0, fte: 0, coverage: 0 };
    var core = Math.ceil(enroll / ratio);
    var hours = core * FULL + Math.ceil(core / 2) * HALF;
    var fte = hours / P;
    return { core: core, fte: fte, coverage: Math.max(0, Math.ceil(fte) - core) };
  }

  function compute() {
    var c = CENTERS[currentCenter]; if (!c) return;
    var u = num('under3'), o = num('over3'), P = parseFloat($('phrs').value) || 7.5;
    $('phrsOut').textContent = String(P);
    var uOpen = c.cap_under3 - u, oOpen = c.cap_over3 - o, tot = u + o, totCap = c.cap_under3 + c.cap_over3;
    $('ucap').textContent = 'cap ' + c.cap_under3 + (uOpen >= 0 ? ' · ' + uOpen + ' open' : ' · ' + (-uOpen) + ' over');
    $('ocap').textContent = 'cap ' + c.cap_over3 + (oOpen >= 0 ? ' · ' + oOpen + ' open' : ' · ' + (-oOpen) + ' over');
    $('util').textContent = tot + ' of ' + totCap + ' seats filled · ' + (totCap ? Math.round(tot / totCap * 100) : 0) + '% utilization';
    var ub = bandRequired(u, RATIO.u, P), ob = bandRequired(o, RATIO.o, P);
    var req = ub.fte + ob.fte;
    var have = (num('lead_ft') + num('assoc_ft') + num('care_ft')) + 0.5 * (num('lead_pt') + num('assoc_pt') + num('care_pt'));
    var admin = (num('dir_ft') + num('ad_ft')) + 0.5 * (num('dir_pt') + num('ad_pt'));
    $('req').textContent = fmt(req); $('have').textContent = fmt(have);
    var st = $('status');
    if (have + 0.05 >= req) { st.className = 'status ok'; st.textContent = 'Covered — ' + fmt(have - req) + ' FTE cushion'; }
    else { st.className = 'status short'; st.textContent = 'Short by ' + fmt(req - have) + ' FTE'; }
    $('uband').innerHTML = '<b>Under 3:</b> ' + u + ' kids → ' + ub.core + ' in room at once → need ~<b>' + fmt(ub.fte) + ' FTE</b> (' + ub.core + ' core + ' + ub.coverage + ' coverage)';
    $('oband').innerHTML = '<b>Over 3:</b> ' + o + ' kids → ' + ob.core + ' in room at once → need ~<b>' + fmt(ob.fte) + ' FTE</b> (' + ob.core + ' core + ' + ob.coverage + ' coverage)';
    $('split').innerHTML = 'Suggested mix: <b>' + (ub.core + ob.core) + '</b> leads/assistants (core) + <b>' + (ub.coverage + ob.coverage) + '</b> floaters/caregivers (coverage). Plus ' + fmt(admin) + ' admin out of ratio.';
  }

  function fillStaffing(s) {
    ['dir_ft', 'dir_pt', 'ad_ft', 'ad_pt', 'lead_ft', 'lead_pt', 'assoc_ft', 'assoc_pt', 'care_ft', 'care_pt'].forEach(function (id) { $(id).value = s ? (s[id] || 0) : 0; });
    $('staffSaved').textContent = s && s.created_at ? ('Last saved ' + when(s.created_at) + (s.entered_by ? ' by ' + s.entered_by : '')) : 'Not yet saved.';
  }
  function fillEnrollment(e) {
    $('under3').value = e ? (e.under3 || 0) : 0; $('over3').value = e ? (e.over3 || 0) : 0;
    $('enrollSaved').textContent = e && e.created_at ? ('Last saved ' + when(e.created_at) + (e.entered_by ? ' by ' + e.entered_by : '')) : 'Not yet saved.';
  }

  function loadState(center) {
    return api('/api/state?center=' + encodeURIComponent(center)).then(function (res) {
      if (res.status !== 200) { toast(res.body.message || 'Could not load center.'); return; }
      currentCenter = res.body.center.name; CENTERS[currentCenter] = res.body.center;
      fillEnrollment(res.body.enrollment); fillStaffing(res.body.staffing); compute();
    });
  }

  function renderLogin(msg) {
    $('signout').classList.add('hide'); $('sub').textContent = 'Please sign in';
    var g = $('gate'); g.classList.remove('hide'); $('app').classList.add('hide');
    g.style.textAlign = 'left';
    g.innerHTML =
      '<h2 style="margin:0 0 4px;font-size:16px;color:var(--ink)">Sign in</h2>' +
      '<p class="hint" style="margin:0 0 14px">Use your first name and the center password.</p>' +
      '<label for="li-name">First name</label>' +
      '<input id="li-name" type="text" autocomplete="given-name" autocapitalize="words" />' +
      '<div style="height:10px"></div>' +
      '<label for="li-pw">Password</label>' +
      '<input id="li-pw" type="password" autocomplete="current-password" />' +
      '<button class="save" id="li-go" style="margin-top:14px">Sign in</button>' +
      '<p class="status short" id="li-err" style="display:none;margin-top:12px"></p>' +
      (msg ? '<p class="hint" style="margin-top:10px">' + msg + '</p>' : '');
    $('li-go').addEventListener('click', doLogin);
    $('li-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    $('li-name').focus();
  }
  function doLogin() {
    var name = $('li-name').value.trim(), pw = $('li-pw').value;
    if (!name || !pw) return;
    api('/api/login', { method: 'POST', body: JSON.stringify({ name: name, password: pw }) }).then(function (res) {
      if (res.status !== 200) { var er = $('li-err'); er.style.display = 'block'; er.textContent = res.body.message || 'Sign in failed.'; return; }
      start();
    });
  }
  function signOut() { api('/api/logout', { method: 'POST' }).then(function () { renderLogin('You have signed out.'); }); }

  function start() {
    api('/api/me').then(function (res) {
      if (res.status === 401) return renderLogin();
      if (res.status === 403) return renderLogin((res.body.message || '') + ' Try a different name or ask Mary.');
      if (res.status !== 200) return renderLogin('Could not load. Please sign in again.');
      ME = res.body;
      inRoomDefault = (res.body.settings && res.body.settings.in_room_hours) || 7.5;
      $('phrs').value = inRoomDefault; $('phrsOut').textContent = String(inRoomDefault);
      var sel = $('center'); sel.innerHTML = '';
      res.body.centers.forEach(function (c) { CENTERS[c.name] = c; var o = document.createElement('option'); o.value = c.name; o.textContent = c.label; sel.appendChild(o); });
      if (ME.role === 'director') { $('centerCard').classList.add('hide'); $('sub').textContent = (CENTERS[ME.center] ? CENTERS[ME.center].label : ME.center); }
      else { $('centerCard').classList.remove('hide'); $('sub').textContent = 'Leadership view — choose a center'; }
      $('signout').classList.remove('hide');
      $('gate').classList.add('hide'); $('app').classList.remove('hide');
      var first = ME.role === 'director' ? ME.center : res.body.centers[0].name;
      sel.value = first; loadState(first);
    }).catch(function () { renderLogin('Could not reach the server.'); });
  }

  document.addEventListener('input', function (e) {
    if (['under3', 'over3', 'phrs', 'dir_ft', 'dir_pt', 'ad_ft', 'ad_pt', 'lead_ft', 'lead_pt', 'assoc_ft', 'assoc_pt', 'care_ft', 'care_pt'].indexOf(e.target.id) > -1) compute();
  });

  document.addEventListener('DOMContentLoaded', function () {
    $('center').addEventListener('change', function () { loadState(this.value); });
    $('signout').addEventListener('click', signOut);
    $('saveEnroll').addEventListener('click', function () {
      api('/api/enrollment', { method: 'POST', body: JSON.stringify({ center: currentCenter, under3: num('under3'), over3: num('over3') }) })
        .then(function (res) { if (res.status !== 200) return toast(res.body.message || 'Save failed.'); fillEnrollment(res.body.enrollment); toast('Enrollment saved'); compute(); });
    });
    $('saveStaff').addEventListener('click', function () {
      var body = { center: currentCenter };
      ['dir_ft', 'dir_pt', 'ad_ft', 'ad_pt', 'lead_ft', 'lead_pt', 'assoc_ft', 'assoc_pt', 'care_ft', 'care_pt'].forEach(function (id) { body[id] = num(id); });
      api('/api/staffing', { method: 'POST', body: JSON.stringify(body) })
        .then(function (res) { if (res.status !== 200) return toast(res.body.message || 'Save failed.'); fillStaffing(res.body.staffing); toast('Staffing saved'); compute(); });
    });
    start();
  });
})();
