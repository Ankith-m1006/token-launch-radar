// Token Launch Radar page. Reads window.RADAR (../data.js, written by main.ts); no network, no framework.
// URL parameters: ?tab=board|comps|aside  ?cat=<category>  ?q=<text>  ?wl=1  ?open=<slug>
(function () {
  'use strict';
  var R = window.RADAR;
  var $ = function (id) { return document.getElementById(id); };
  if (!R) { $('body').innerHTML = '<tr><td>data.js is missing: run main.ts first.</td></tr>'; return; }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
  }
  function usd(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function pct(x) {
    if (x === null || x === undefined) return '<span class="flat">n/a</span>';
    var cls = x > 0.5 ? 'up' : x < -0.5 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (x > 0 ? '+' : '') + x.toFixed(1) + '%</span>';
  }
  function age(days) {
    if (days === null || days === undefined) return 'n/a';
    if (days < 60) return days + ' d';
    var m = days / 30.44;
    return m < 24 ? Math.round(m) + ' mo' : (m / 12).toFixed(1) + ' yr';
  }
  function mult(x) { return '×' + x.toFixed(x < 0.1 ? 3 : 2); }

  var state = { tab: 'board', q: '', cat: '', wl: false, sort: null, dir: -1, open: null };
  var params = new URLSearchParams(location.search);
  if (params.get('tab')) state.tab = params.get('tab');
  if (params.get('cat')) state.cat = params.get('cat');
  if (params.get('q')) state.q = params.get('q');
  if (params.get('wl') === '1') state.wl = true;
  if (params.get('open')) state.open = params.get('open');

  var bySlug = {};
  R.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var compsByCat = {};
  R.comps.forEach(function (c) { (compsByCat[c.category] = compsByCat[c.category] || []).push(c); });
  var maxValue = R.rows.length ? R.rows[0].implied_value_usd : 1;

  // Column sets for each view: key, label, class, cell renderer, sort value.
  var VIEWS = {
    board: {
      rows: function () { return R.rows; },
      sort: 'rank', dir: 1,
      cols: [
        ['rank', '#', 'rank', function (r) { return r.rank; }, function (r) { return r.rank; }],
        ['name', 'Protocol', '', function (r) {
          return '<div class="name">' + esc(r.name) + '<small>' + esc(r.chains.slice(0, 4).join(' · ')) + (r.chains.length > 4 ? ' +' + (r.chains.length - 4) : '') + '</small></div>';
        }, function (r) { return r.name.toLowerCase(); }],
        ['category', 'Category', '', function (r) {
          return '<span class="tag">' + esc(r.category || 'Uncategorised') + '</span>' + (r.watchlist ? ' <span class="tag wl">watchlist</span>' : '');
        }, function (r) { return r.category || ''; }],
        ['tvl', 'TVL', 'num', function (r) { return usd(r.tvl_usd); }, function (r) { return r.tvl_usd; }],
        ['d7', '7d', 'num', function (r) { return pct(r.change_7d); }, function (r) { return r.change_7d === null ? -1e9 : r.change_7d; }],
        ['age', 'No token for', 'num hide-sm', function (r) { return age(r.age_days); }, function (r) { return r.age_days === null ? -1 : r.age_days; }],
        ['mult', 'Comp multiple', 'num', function (r) {
          return '<span class="badge' + (r.multiple_basis === 'global' ? ' global' : '') + '" title="' + (r.multiple_basis === 'category' ? r.multiple_comps + ' live comps in category' : 'global median of all live comps') + '">' + mult(r.multiple) + '</span>';
        }, function (r) { return r.multiple; }],
        ['value', 'Implied value', 'num', function (r) {
          var w = Math.max(4, Math.round(90 * Math.sqrt(r.implied_value_usd / maxValue)));
          return '<span class="value">' + usd(r.implied_value_usd) + '</span><span class="bar" style="width:' + w + 'px"></span>';
        }, function (r) { return r.implied_value_usd; }],
      ],
    },
    comps: {
      rows: function () { return R.comps; },
      sort: 'mcap', dir: -1,
      cols: [
        ['name', 'Trading token', '', function (c) { return '<div class="name">' + esc(c.name) + '<small>' + esc(c.symbol || '') + '</small></div>'; }, function (c) { return c.name.toLowerCase(); }],
        ['category', 'Category', '', function (c) { return '<span class="tag">' + esc(c.category) + '</span>'; }, function (c) { return c.category; }],
        ['tvl', 'TVL', 'num', function (c) { return usd(c.tvl_usd); }, function (c) { return c.tvl_usd; }],
        ['mcap', 'Market cap', 'num', function (c) { return usd(c.mcap_usd); }, function (c) { return c.mcap_usd; }],
        ['ratio', 'mcap / TVL', 'num', function (c) { return '<span class="badge">' + mult(c.ratio) + '</span>'; }, function (c) { return c.ratio; }],
      ],
    },
    aside: {
      rows: function () { return R.set_aside; },
      sort: 'tvl', dir: -1,
      cols: [
        ['name', 'Record', '', function (s) { return '<div class="name">' + esc(s.name) + '</div>'; }, function (s) { return s.name.toLowerCase(); }],
        ['category', 'Category', '', function (s) { return '<span class="tag">' + esc(s.category || 'Uncategorised') + '</span>'; }, function (s) { return s.category || ''; }],
        ['tvl', 'TVL', 'num', function (s) { return usd(s.tvl_usd); }, function (s) { return s.tvl_usd; }],
        ['reason', 'Why it is not a launch', '', function (s) { return esc(s.reason); }, function (s) { return s.reason; }],
      ],
    },
  };
  if (!VIEWS[state.tab]) state.tab = 'board';

  function matches(item) {
    if (state.cat && (item.category || 'Uncategorised') !== state.cat) return false;
    if (state.wl && state.tab === 'board' && !item.watchlist) return false;
    if (!state.q) return true;
    var hay = (item.name + ' ' + item.slug + ' ' + (item.category || '') + ' ' + (item.chains || []).join(' ') + ' ' + (item.symbol || '')).toLowerCase();
    return hay.indexOf(state.q.toLowerCase()) >= 0;
  }

  function renderStats() {
    var total = R.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var wl = R.rows.filter(function (r) { return r.watchlist; }).length;
    var catComps = R.rows.filter(function (r) { return r.multiple_basis === 'category'; }).length;
    var cards = [
      [R.rows.length, 'pre-token protocols ranked'],
      [wl + ' / ' + R.counts.watchlist, 'watchlist covered'],
      [R.counts.live, 'live tokens as comparables · ' + catComps + ' rows on a category comp'],
      [usd(total), 'combined implied value'],
    ];
    $('stats').innerHTML = cards.map(function (c) { return '<div class="stat glass"><div class="v">' + c[0] + '</div><div class="l">' + c[1] + '</div></div>'; }).join('');
    $('formula').innerHTML = '<b>implied = TVL × comp multiple × growth × maturity</b>' +
      'Multiple: median <code>mcap/TVL</code> of the category\'s live tokens (needs ' + R.min_comps + '; else the global median <code>' + mult(R.global_multiple) + '</code>), clamped to <code>' + mult(R.clamp[0]) + '–' + mult(R.clamp[1]) + '</code>. Growth: <code>1 + 0.5·tanh(7d%/20)</code>. Maturity: ×0.8 for a brand-new record, up to ×1.15 at 1–3 years, fading after.';
    $('asof').textContent = 'snapshot ' + R.as_of;
    $('model').textContent = R.model;
    $('source').textContent = 'Source: ' + R.source + '. Floor $' + (R.floor_usd / 1e6) + 'M. ' + R.counts.protocols + ' protocols in the snapshot.';
    $('n-board').textContent = R.rows.length;
    $('n-comps').textContent = R.comps.length;
    $('n-aside').textContent = R.set_aside.length;
  }

  function renderCats() {
    var items = VIEWS[state.tab].rows();
    var counts = {};
    items.forEach(function (i) { var c = i.category || 'Uncategorised'; counts[c] = (counts[c] || 0) + 1; });
    var cats = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    if (state.cat && !counts[state.cat]) cats.unshift(state.cat);
    $('cat').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === state.cat ? ' selected' : '') + '>' + esc(c) + ' (' + (counts[c] || 0) + ')</option>';
    }).join('');
  }

  function render() {
    var view = VIEWS[state.tab];
    var sortKey = state.sort || view.sort;
    var dir = state.sort ? state.dir : view.dir;
    var col = view.cols.filter(function (c) { return c[0] === sortKey; })[0] || view.cols[0];
    var list = view.rows().filter(matches).slice().sort(function (a, b) {
      var x = col[4](a), y = col[4](b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
    $('head').innerHTML = '<tr>' + view.cols.map(function (c) {
      var s = c[0] === sortKey ? (dir < 0 ? 'descending' : 'ascending') : 'none';
      return '<th class="' + c[2] + '" data-key="' + c[0] + '" aria-sort="' + s + '" tabindex="0">' + c[1] + '</th>';
    }).join('') + '</tr>';
    $('body').innerHTML = list.map(function (item) {
      var open = state.tab === 'board' && item.slug === state.open;
      return '<tr data-slug="' + esc(item.slug || '') + '" tabindex="0"' + (open ? ' class="open"' : '') + '>' +
        view.cols.map(function (c) { return '<td class="' + c[2] + '">' + c[3](item) + '</td>'; }).join('') + '</tr>';
    }).join('');
    $('empty').hidden = list.length > 0;
    $('count').textContent = list.length + ' of ' + view.rows().length + ' shown' + (state.cat ? ' · ' + state.cat : '');
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)); });
    $('wl').parentNode.style.visibility = state.tab === 'board' ? 'visible' : 'hidden';
  }

  function renderDrawer() {
    var r = state.open && bySlug[state.open];
    var d = $('drawer');
    if (!r) { d.hidden = true; return; }
    var comps = (compsByCat[r.category || 'Uncategorised'] || []).slice(0, 6);
    var basis = r.multiple_basis === 'category'
      ? 'median of ' + r.multiple_comps + ' live ' + esc(r.category) + ' tokens' + (r.multiple !== r.multiple_raw ? ' (raw ' + mult(r.multiple_raw) + ', clamped)' : '')
      : 'global median of ' + r.multiple_comps + ' live tokens: ' + esc(r.category || 'this category') + ' has fewer than ' + R.min_comps;
    var afterMult = r.tvl_usd * r.multiple;
    var afterGrowth = afterMult * r.growth_tilt;
    d.innerHTML = '<button class="close" aria-label="Close detail">×</button>' +
      '<span class="tag">#' + r.rank + ' of ' + R.rows.length + '</span> <span class="tag">' + esc(r.category || 'Uncategorised') + '</span>' + (r.watchlist ? ' <span class="tag wl">watchlist</span>' : ' <span class="tag">below the watchlist</span>') +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="meta">' + esc(r.chains.join(' · ')) + ' · tracked since ' + esc(r.listed_at || 'n/a') + ' · records no token</p>' +
      '<div class="big">' + usd(r.implied_value_usd) + '<small>implied token value if the record stays as it is</small></div>' +
      '<h3>How the value is built</h3><table class="math"><tbody>' +
      '<tr><td>TVL <em>snapshot ' + esc(R.as_of) + '</em></td><td>' + usd(r.tvl_usd) + '</td></tr>' +
      '<tr><td>× comp multiple ' + mult(r.multiple) + ' <em>' + basis + '</em></td><td>' + usd(afterMult) + '</td></tr>' +
      '<tr><td>× growth ' + r.growth_tilt.toFixed(3) + ' <em>7d TVL ' + (r.change_7d === null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</em></td><td>' + usd(afterGrowth) + '</td></tr>' +
      '<tr><td>× maturity ' + r.maturity_tilt.toFixed(3) + ' <em>' + age(r.age_days) + ' with no token recorded</em></td><td>' + usd(r.implied_value_usd) + '</td></tr>' +
      '<tr class="total"><td>Implied value</td><td>' + usd(r.implied_value_usd) + '</td></tr>' +
      '<tr><td><em>A flat 0.25×-TVL rule would say</em></td><td><em>' + usd(r.tvl_usd * 0.25) + ' (' + (r.implied_value_usd >= r.tvl_usd * 0.25 ? '+' : '') + Math.round((r.implied_value_usd / (r.tvl_usd * 0.25) - 1) * 100) + '%)</em></td></tr></tbody></table>' +
      (comps.length ? '<h3>Live comparables in ' + esc(r.category) + '</h3><table class="compset"><tbody>' + comps.map(function (c) {
        return '<tr><td>' + esc(c.name) + ' <em>' + esc(c.symbol || '') + '</em></td><td>' + usd(c.mcap_usd) + ' / ' + usd(c.tvl_usd) + '</td><td>' + mult(c.ratio) + '</td></tr>';
      }).join('') + '</tbody></table>' : '') +
      '<h3>Farm plan · ' + r.farm_steps.length + ' steps</h3><ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="note">A farm plan is a way to build a record with the protocol, not advice to buy anything. Costs are typical gas on the cheapest chain it runs on.</p>';
    d.hidden = false;
    d.querySelector('.close').addEventListener('click', function () { setOpen(null); });
  }

  function syncUrl() {
    var p = new URLSearchParams();
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.cat) p.set('cat', state.cat);
    if (state.q) p.set('q', state.q);
    if (state.wl) p.set('wl', '1');
    if (state.open) p.set('open', state.open);
    var qs = p.toString();
    try { history.replaceState(null, '', qs ? '?' + qs : location.pathname); } catch (e) { /* file:// in some browsers */ }
  }
  function setOpen(slug) { state.open = slug; render(); renderDrawer(); syncUrl(); }

  $('q').value = state.q;
  $('wl').checked = state.wl;
  $('q').addEventListener('input', function (e) { state.q = e.target.value.trim(); render(); syncUrl(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; render(); syncUrl(); });
  $('wl').addEventListener('change', function (e) { state.wl = e.target.checked; render(); syncUrl(); });
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    state.tab = b.dataset.tab; state.sort = null; state.cat = '';
    renderCats(); render(); syncUrl();
  });
  function sortBy(th) {
    var key = th.dataset.key;
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'rank' || key === 'name' || key === 'category' ? 1 : -1; }
    render();
  }
  $('head').addEventListener('click', function (e) { var th = e.target.closest('th'); if (th) sortBy(th); });
  $('head').addEventListener('keydown', function (e) { var th = e.target.closest('th'); if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sortBy(th); } });
  function pick(e) {
    var tr = e.target.closest('tr');
    if (!tr || state.tab !== 'board' || !bySlug[tr.dataset.slug]) return;
    setOpen(state.open === tr.dataset.slug ? null : tr.dataset.slug);
  }
  $('body').addEventListener('click', pick);
  $('body').addEventListener('keydown', function (e) { if (e.key === 'Enter') pick(e); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) setOpen(null); });

  renderStats();
  renderCats();
  render();
  renderDrawer();
})();
