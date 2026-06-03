'use strict';
(function () {
  var RATIO = { u: 4, o: 10 }, FULL = 10, HALF = 1;
  var ME = null, CENTERS = {}, currentCenter = null, inRoomDefault = 7.5;

  // When opened from the TCC Hub (embedded iframe), the Hub passes ?hub_token=<JWT>.
  // Cross-domain iframes can't keep cookies, so we hold the token and send it as a
  // Bearer header on every request instead of relying on the login cookie.
  var HUB_TOKEN = null;
  (function () {
    try {
      var qs = new URLSearchParams(window.location.search);
      var t = qs.get('hub_token') || qs.get('token');
      if (t) { HUB_TOKEN = t; try { sessionStorage.setItem('chs_hub_token', t); } catch (e) {} }
      else { try { HUB_TOKEN = sessionStorage.getItem('chs_hub_token'); } catch (e) {} }
    } catch (e) {}
  })();

  function $(id) { return document.getElementById(id); }
  function num(id) { var el = $(id); if (!el) return 0; var v = parseInt(el.value, 10); return isNaN(v) || v < 0 ? 0 : v; }
  function fmt(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 1800); }
  function when(ts) {
    if (!ts) return '';
    try { var d = new Date(ts); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (HUB_TOKEN) headers['Authorization'] = 'Bearer ' + HUB_TOKEN;
    return fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers: headers }))
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
    var su = num('staff_under3'), so = num('staff_over3');
    var totU = u + su, totO = o + so;                 // every child in the room counts for ratio/capacity
    $('phrsOut').textContent = String(P);
    var uOpen = c.cap_under3 - totU, oOpen = c.cap_over3 - totO, tot = totU + totO, totCap = c.cap_under3 + c.cap_over3;
    $('ucap').textContent = 'cap ' + c.cap_under3 + (uOpen >= 0 ? ' · ' + uOpen + ' open' : ' · ' + (-uOpen) + ' over');
    $('ocap').textContent = 'cap ' + c.cap_over3 + (oOpen >= 0 ? ' · ' + oOpen + ' open' : ' · ' + (-oOpen) + ' over');
    var staffTotal = su + so;
    $('util').textContent = tot + ' of ' + totCap + ' seats filled · ' + (totCap ? Math.round(tot / totCap * 100) : 0) + '% utilization' + (staffTotal > 0 ? ' (incl. ' + staffTotal + ' staff/admin child' + (staffTotal === 1 ? '' : 'ren') + ')' : '');
    var cel = $('celebrate');
    if (totCap && (tot / totCap) > 0.95) { cel.classList.remove('hide'); cel.textContent = '🎉 Your program is filling seats — great job! Nearly every spot is taken.'; }
    else { cel.classList.add('hide'); cel.textContent = ''; }
    var ub = bandRequired(totU, RATIO.u, P), ob = bandRequired(totO, RATIO.o, P);
    var req = ub.fte + ob.fte;
    var have = (num('lead_ft') + num('assoc_ft') + num('care_ft')) + 0.5 * (num('lead_pt') + num('assoc_pt') + num('care_pt'));
    var admin = (num('dir_ft') + num('ad_ft')) + 0.5 * (num('dir_pt') + num('ad_pt'));
    $('req').textContent = fmt(req); $('have').textContent = fmt(have);
    var st = $('status');
    var surplus = have - req;
    if (surplus < -0.05) {
      st.className = 'status ok';
      var room = Math.floor(-surplus);
      if (room >= 1) {
        var word = room === 1 ? 'staff member' : 'staff members';
        st.innerHTML = '<strong>Room to grow</strong><br><span style="font-weight:400">Your current enrollment would support up to ' + room + ' more teaching ' + word + ' if needed. Keep an eye on your ratios, and check the costs panel below before adding hours.</span>';
      } else {
        st.innerHTML = '<strong>Right-sized for current enrollment</strong><br><span style="font-weight:400">Staffing matches your enrollment. Keep an eye on your ratios.</span>';
      }
    } else if (surplus <= 1.0) {
      st.className = 'status ok';
      st.innerHTML = 'Covered — ' + fmt(surplus) + ' FTE cushion';
    } else if (surplus < 4.0) {
      st.className = 'status short';
      st.innerHTML = '<strong>Moderately overstaffed — ' + fmt(surplus) + ' FTE above ratio</strong><br><span style="font-weight:400">Staffing is somewhat above what current enrollment supports. Reminder: staff should be encouraged to take turns leaving early whenever within ratio.</span>';
    } else {
      st.className = 'status bad';
      st.innerHTML = '<strong>Significantly overstaffed — ' + fmt(surplus) + ' FTE above ratio</strong><br><span style="font-weight:400">Staffing is well above what current enrollment supports. Please prioritize enrollment and review next steps with the administrative team.</span>';
    }
    $('uband').innerHTML = '<b>Under 3:</b> ' + totU + ' kids → ' + ub.core + ' in room at once → need ~<b>' + fmt(ub.fte) + ' FTE</b> (' + ub.core + ' core + ' + ub.coverage + ' coverage)';
    $('oband').innerHTML = '<b>Over 3:</b> ' + totO + ' kids → ' + ob.core + ' in room at once → need ~<b>' + fmt(ob.fte) + ' FTE</b> (' + ob.core + ' core + ' + ob.coverage + ' coverage)';
    $('split').innerHTML = 'Suggested mix: <b>' + (ub.core + ob.core) + '</b> leads/assistants (core) + <b>' + (ub.coverage + ob.coverage) + '</b> floaters/caregivers (coverage). Plus ' + fmt(admin) + ' admin out of ratio.';
  }

  function fillStaffing(s) {
    ['dir_ft', 'dir_pt', 'ad_ft', 'ad_pt', 'lead_ft', 'lead_pt', 'assoc_ft', 'assoc_pt', 'care_ft', 'care_pt'].forEach(function (id) { $(id).value = s ? (s[id] || 0) : 0; });
    $('staffSaved').textContent = s && s.created_at ? ('Last saved ' + when(s.created_at) + (s.entered_by ? ' by ' + s.entered_by : '')) : 'Not yet saved.';
  }
  function fillEnrollment(e) {
    $('under3').value = e ? (e.under3 || 0) : 0; $('over3').value = e ? (e.over3 || 0) : 0;
    $('staff_under3').value = e ? (e.staff_under3 || 0) : 0; $('staff_over3').value = e ? (e.staff_over3 || 0) : 0;
    $('enrollSaved').textContent = e && e.created_at ? ('Last saved ' + when(e.created_at) + (e.entered_by ? ' by ' + e.entered_by : '')) : 'Not yet saved.';
  }

  function loadState(center) {
    return api('/api/state?center=' + encodeURIComponent(center)).then(function (res) {
      if (res.status !== 200) { toast(res.body.message || 'Could not load center.'); return; }
      currentCenter = res.body.center.name; CENTERS[currentCenter] = res.body.center;
      fillEnrollment(res.body.enrollment); fillStaffing(res.body.staffing); compute();
      loadFinance();
    });
  }

  // Paying vs. free (staff/admin) split for the costs panel. Read from the inputs,
  // which at load/save time hold the saved values — so this stays in step with the
  // server-computed coverage and never relies on an element that might be missing.
  function renderSplit() {
    var sp = $('finSplit'); if (!sp) return;
    var paying = num('under3') + num('over3');
    var free = num('staff_under3') + num('staff_over3');
    if (free > 0) {
      sp.innerHTML = 'In your building today: <b>' + paying + '</b> paying \u00b7 <b>' + free + '</b> attending free (staff &amp; admin families). Only paying children cover your costs.';
    } else {
      sp.innerHTML = 'In your building today: <b>' + paying + '</b> paying ' + (paying === 1 ? 'child' : 'children') + '.';
    }
  }

  function loadFinance() {
    if (!currentCenter) return;
    var card = $('financeCard'); if (!card) return;
    api('/api/center-finance?center=' + encodeURIComponent(currentCenter)).then(function (res) {
      if (res.status !== 200 || !res.body) { card.classList.add('hide'); return; }
      var d = res.body;
      card.classList.remove('hide');
      var lead = $('finLead'), fill = $('finFill'), st = $('finStatus'), note = $('finNote'),
          be = $('finBreakeven'), fs = $('finStaffing');
      var label = (CENTERS[currentCenter] ? CENTERS[currentCenter].label : 'your center');

      renderSplit();
      function hideStaffingLine() { if (fs) { fs.style.display = 'none'; fs.innerHTML = ''; } }

      // No costs entered at all yet.
      if (!d.hasCostData) {
        if (lead) lead.textContent = 'Cost information for this center hasn\u2019t been entered yet.';
        if (fill) fill.style.width = '0%';
        if (be) be.style.display = 'none';
        if (st) st.style.display = 'none';
        if (note) note.style.display = 'none';
        hideStaffingLine();
        return;
      }
      // Costs exist but staffing hasn't been saved — labor is counted as $0, so the % is misleading.
      if (!d.hasStaffing) {
        if (lead) lead.innerHTML = 'Save your staffing above to see an accurate picture.';
        if (fill) fill.style.width = '0%';
        if (be) be.style.display = 'none';
        if (st) {
          st.style.display = ''; st.className = 'status short';
          st.innerHTML = '<strong>Staffing not saved yet</strong><br><span style="font-weight:400">Until staffing is saved, this only counts overhead \u2014 not the cost of your team \u2014 so the percentage would look far too high. Tap <strong>Save staffing</strong> above.</span>';
        }
        if (note) note.style.display = '';
        hideStaffingLine();
        return;
      }
      // Costs and staffing exist, but fixed costs (rent/overhead) are all $0 — coverage would
      // ignore overhead and read far too healthy. Don't show a coverage % or a green "covering".
      if (!d.hasFixed) {
        if (lead) lead.innerHTML = 'Add this location\u2019s fixed costs to see an accurate picture.';
        if (fill) fill.style.width = '0%';
        if (be) be.style.display = 'none';
        if (st) {
          st.style.display = ''; st.className = 'status short';
          st.innerHTML = '<strong>Overhead not entered yet</strong><br><span style="font-weight:400">This location\u2019s rent, utilities, insurance, food, and other overhead haven\u2019t been entered, so this would count payroll only \u2014 making coverage look far healthier than reality. The full picture appears once those are added under Capacities &amp; costs in Settings.</span>';
        }
        if (note) note.style.display = '';
        hideStaffingLine();
        return;
      }

      if (note) note.style.display = '';
      if (st) st.style.display = '';
      if (d.coverage == null) {
        if (lead) lead.textContent = 'Enter your enrollment to see how it tracks against costs.';
        if (fill) fill.style.width = '0%';
        if (be) be.style.display = 'none';
        if (st) { st.className = 'status'; st.textContent = ''; }
        hideStaffingLine();
        return;
      }

      var pctCov = Math.round(d.coverage * 100);
      if (fill) {
        fill.style.width = Math.max(0, Math.min(100, pctCov)) + '%';
        fill.style.background = d.meetsBreakEven ? 'var(--green)' : (d.coverage >= 0.85 ? '#d9a300' : 'var(--red)');
      }
      if (lead) lead.innerHTML = 'Your current enrollment covers about <strong>' + pctCov + '%</strong> of what it costs to run ' + label + ' each month.';

      // Targets block: break-even is always shown; the goal line appears whenever a goal is set,
      // in every state — so changing the goal in Settings visibly moves a number here.
      if (be) {
        be.style.display = '';
        var beHtml;
        if (d.meetsBreakEven) {
          beHtml = '<strong>Break-even:</strong> reached \u2014 enrollment is covering full monthly costs.';
        } else {
          var s = d.seatsToBreakEven, z = (s === 1 ? 'more child' : 'more children');
          beHtml = '<strong>Break-even:</strong> about <strong>' + s + '</strong> ' + z + ' (paying, at your current mix) to cover full monthly costs.';
        }
        if (d.hasGoal) {
          if (d.meetsGoal) {
            beHtml += '<br><strong>Goal:</strong> reached \u2014 enrollment is meeting this location\u2019s target.';
          } else if (d.seatsToGoal != null) {
            var sg = d.seatsToGoal, zg = (sg === 1 ? 'more child' : 'more children');
            beHtml += '<br><strong>Goal:</strong> about <strong>' + sg + '</strong> ' + zg + ' to reach this location\u2019s target.';
          }
        }
        be.innerHTML = beHtml;
      }

      if (st) {
        if (d.meetsBreakEven) {
          st.className = 'status ok';
          if (d.hasGoal && d.meetsGoal) {
            st.innerHTML = '<strong>Covering full costs and meeting goal</strong><br><span style="font-weight:400">Your enrollment is paying for everything it takes to run your center, with room to spare. Wonderful work.</span>';
          } else {
            st.innerHTML = '<strong>Covering full costs</strong><br><span style="font-weight:400">Your enrollment is paying for everything it takes to run your center. Wonderful work.</span>';
          }
        } else {
          st.className = (d.coverage >= 0.85) ? 'status short' : 'status bad';
          st.innerHTML = '<strong>Working toward covering full costs</strong><br><span style="font-weight:400">Every paying family you enroll brings this center closer to paying for itself.</span>';
        }
      }

      // Staffing-decision line — the affordability lens, kept calm (muted, never alarm-red).
      // This is a separate question from the ratio/safety card above: ratio asks "how many
      // staff do the children present require?"; this asks "can paying enrollment carry them?"
      if (fs) {
        fs.style.display = ''; fs.className = 'band';
        if (d.meetsBreakEven) {
          fs.innerHTML = '\uD83D\uDC9B Your paying enrollment supports your current team. Staff your rooms to ratio with confidence.';
        } else if (d.coverage >= 0.85) {
          var s2 = d.seatsToBreakEven, z2 = (s2 === 1 ? 'family' : 'families');
          fs.innerHTML = 'You\u2019re close \u2014 about <b>' + s2 + '</b> more enrolled ' + z2 + ' covers your team. Until then, hold staffing hours steady and combine rooms when you can, and keep working to fill those last openings.';
        } else {
          var s3 = d.seatsToBreakEven, z3 = (s3 === 1 ? 'child' : 'children');
          fs.innerHTML = 'Right now there are more open seats than enrollment is paying for \u2014 about <b>' + s3 + '</b> more enrolled ' + z3 + ' would bring this center to break-even. Until they fill, combine your lighter rooms for a season \u2014 for example, three lightly enrolled rooms can often become two \u2014 while keeping each room within its required ratio. Combining isn\u2019t always ideal, but when there isn\u2019t funding to cover extra staffing, that becomes the deciding factor. Lean on your marketing handbook, and keep working to fill those spots.';
        }
      }
    }).catch(function () { card.classList.add('hide'); });
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

  function injectNav() {
    if (document.getElementById('leadnav')) return;
    var q = HUB_TOKEN ? ('?hub_token=' + encodeURIComponent(HUB_TOKEN)) : '';
    var nav = document.createElement('div');
    nav.id = 'leadnav';
    nav.style.cssText = 'max-width:560px;margin:0 auto;padding:10px 16px 0;display:flex;gap:8px';
    nav.innerHTML =
      '<a href="/' + q + '" style="flex:1;text-align:center;padding:9px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;background:#1F3864;color:#fff">Enrollment &amp; Staffing</a>' +
      '<a href="/exec.html' + q + '" style="flex:1;text-align:center;padding:9px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;background:#fff;color:#1F3864;border:1px solid #e3e7ee">Executive</a>' +
      '<a href="/settings.html' + q + '" style="flex:1;text-align:center;padding:9px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;background:#fff;color:#1F3864;border:1px solid #e3e7ee">Settings</a>';
    var wrap = document.querySelector('.wrap');
    wrap.parentNode.insertBefore(nav, wrap);
  }

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
      else { $('centerCard').classList.remove('hide'); $('sub').textContent = 'Executive view — choose a center'; injectNav(); }
      $('signout').classList.remove('hide');
      $('gate').classList.add('hide'); $('app').classList.remove('hide');
      var first = ME.role === 'director' ? ME.center : res.body.centers[0].name;
      sel.value = first; loadState(first);
    }).catch(function () { renderLogin('Could not reach the server.'); });
  }

  document.addEventListener('input', function (e) {
    if (['under3', 'over3', 'staff_under3', 'staff_over3', 'phrs', 'dir_ft', 'dir_pt', 'ad_ft', 'ad_pt', 'lead_ft', 'lead_pt', 'assoc_ft', 'assoc_pt', 'care_ft', 'care_pt'].indexOf(e.target.id) > -1) compute();
  });

  document.addEventListener('DOMContentLoaded', function () {
    $('center').addEventListener('change', function () { loadState(this.value); });
    $('signout').addEventListener('click', signOut);
    $('saveEnroll').addEventListener('click', function () {
      api('/api/enrollment', { method: 'POST', body: JSON.stringify({ center: currentCenter, under3: num('under3'), over3: num('over3'), staff_under3: num('staff_under3'), staff_over3: num('staff_over3') }) })
        .then(function (res) { if (res.status !== 200) return toast(res.body.message || 'Save failed.'); fillEnrollment(res.body.enrollment); toast('Enrollment saved'); compute(); loadFinance(); });
    });
    $('saveStaff').addEventListener('click', function () {
      var body = { center: currentCenter };
      ['dir_ft', 'dir_pt', 'ad_ft', 'ad_pt', 'lead_ft', 'lead_pt', 'assoc_ft', 'assoc_pt', 'care_ft', 'care_pt'].forEach(function (id) { body[id] = num(id); });
      api('/api/staffing', { method: 'POST', body: JSON.stringify(body) })
        .then(function (res) { if (res.status !== 200) return toast(res.body.message || 'Save failed.'); fillStaffing(res.body.staffing); toast('Staffing saved'); compute(); loadFinance(); });
    });
    start();
  });
})();
