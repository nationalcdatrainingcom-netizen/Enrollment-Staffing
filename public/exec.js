'use strict';
(function () {
  var mode = 'school_year';
  function $(id) { return document.getElementById(id); }
  function money(n) { var s = Math.round(n).toLocaleString('en-US'); return n < 0 ? '-$' + Math.abs(Math.round(n)).toLocaleString('en-US') : '$' + s; }
  function pct(n) { return Math.round(n * 100) + '%'; }
  function fte(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function api(p) { return fetch(p, { credentials: 'same-origin' }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); }); }

  function cell(k, v, neg) { return '<div class="cell"><div class="k">' + k + '</div><div class="v' + (neg ? ' neg' : '') + '">' + v + '</div></div>'; }

  function centerCard(r) {
    var pill = '<span class="pill ' + r.status + '">' + (r.status === 'green' ? 'At / above goal' : r.status === 'yellow' ? 'Near goal' : 'Below goal') + '</span>';
    return '<div class="card ' + r.status + '">' +
      '<div class="ctitle"><h2>' + r.label + '</h2>' + pill + '</div>' +
      '<div class="rows">' +
        cell('Enrollment', r.enrollment + ' / ' + r.capacity) +
        cell('Utilization', pct(r.utilization)) +
        cell('Required FTE', fte(r.requiredFte)) +
        cell('Actual FTE', fte(r.actualFte)) +
        cell('Revenue', money(r.revenue)) +
        cell('Expenses', money(r.expenses)) +
        cell('Profit / Loss', money(r.profit), r.profit < 0) +
        cell('Goal / Variance', money(r.goal) + '  (' + (r.varToGoal >= 0 ? '+' : '') + money(r.varToGoal).replace('$', '$') + ')') +
      '</div></div>';
  }
  function totalsCard(t) {
    return '<div class="card totals">' +
      '<div class="ctitle"><h2 style="color:#fff">Company total</h2></div>' +
      '<div class="rows">' +
        cell('Enrollment', t.enrollment + ' / ' + t.capacity) +
        cell('Utilization', pct(t.utilization)) +
        cell('Revenue', money(t.revenue)) +
        cell('Expenses', money(t.expenses)) +
        cell('Profit / Loss', money(t.profit)) +
        cell('Goal / Variance', money(t.goal) + '  (' + (t.varToGoal >= 0 ? '+' : '') + money(t.varToGoal) + ')') +
      '</div></div>';
  }

  function load() {
    api('/api/exec?mode=' + mode).then(function (res) {
      if (res.status === 403) { $('gate').classList.remove('hide'); $('app').classList.add('hide'); $('gate').innerHTML = 'This area is for leadership only.<br><a href="/">Back to Enrollment &amp; Staffing</a>'; return; }
      if (res.status === 401) { window.location.href = '/'; return; }
      if (res.status !== 200) { $('gate').textContent = 'Could not load.'; return; }
      $('gate').classList.add('hide'); $('app').classList.remove('hide');
      var html = ''; res.body.rows.forEach(function (r) { html += centerCard(r); });
      html += totalsCard(res.body.totals);
      $('centers').innerHTML = html;
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('m-sy').addEventListener('click', function () { mode = 'school_year'; this.classList.add('on'); $('m-su').classList.remove('on'); load(); });
    $('m-su').addEventListener('click', function () { mode = 'summer'; this.classList.add('on'); $('m-sy').classList.remove('on'); load(); });
    load();
  });
})();
