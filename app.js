/* Lotto Muse frontend — talks to the Apps Script web app defined in config.js */
(function () {
  'use strict';

  const API = (window.LOTTO_CONFIG && window.LOTTO_CONFIG.API_URL) || '';
  const GAME_ORDER = ['658', '655', '649', '645'];
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const $ = (s) => document.querySelector(s);

  let state = { data: null, active: GAME_ORDER[0] };
  try { state.active = localStorage.getItem('lm.tab') || state.active; } catch (e) { /* storage unavailable */ }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const fmtDate = (s) => {
    if (!s) return '—';
    const d = new Date(s + 'T00:00:00');
    return isNaN(d) ? s : d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };
  const peso = (n) => (n ? '₱' + (Number(n) / 1e6).toFixed(1) + 'M' : '—');
  const pct = (v) => (v == null ? '—' : Number(v).toFixed(1) + '%');

  /* ---------------- API ---------------- */
  async function apiGet(action) {
    const r = await fetch(API + '?action=' + encodeURIComponent(action), { method: 'GET' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'API error');
    return j;
  }
  async function apiPost(body) {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'API error');
    return j;
  }

  /* ---------------- render helpers ---------------- */
  function balls(nums, opts) {
    opts = opts || {};
    const actual = opts.actual || null;
    return '<div class="' + (opts.mini ? 'mini-balls' : 'balls') + '">' + nums.map((n) => {
      let cls = 'ball';
      if (opts.big) cls += ' big';
      if (opts.mini) cls += ' small';
      if (actual) cls += actual.indexOf(n) >= 0 ? ' hit' : ' miss';
      else if (opts.pick) cls += ' pick';
      return '<span class="' + cls + '">' + pad(n) + '</span>';
    }).join('') + '</div>';
  }

  function sourceTag(p) {
    if (!p) return '';
    if (p.source === 'MUSE') return '<span class="tag muse">Muse Spark</span>';
    if (p.source === 'BACKTEST') return '<span class="tag">Backtest</span>';
    return '<span class="tag algo">Algorithm</span>';
  }

  function chart(history, randomPct) {
    if (!history.length) return '<p class="muted">No evaluated projections yet.</p>';
    const W = 760, H = 190, padL = 30, padB = 22, padT = 10;
    const maxY = 66.7; // 4 of 6
    const bw = (W - padL - 8) / history.length;
    const y = (v) => padT + (H - padT - padB) * (1 - Math.min(v, maxY) / maxY);
    let bars = '';
    history.forEach((p, i) => {
      const v = p.matchPct || 0;
      const x = padL + i * bw + 1;
      const color = p.source === 'BACKTEST' ? '#3b4a63' : (v > 0 ? '#22c55e' : '#3a4556');
      const h = Math.max(y(0) - y(v), v ? 2 : 1);
      bars += '<rect x="' + x.toFixed(1) + '" y="' + (y(0) - h).toFixed(1) + '" width="' + Math.max(bw - 2, 1).toFixed(1) +
        '" height="' + h.toFixed(1) + '" rx="2" fill="' + color + '"><title>' + esc(p.forDate + ': ' + p.matched + '/6 (' + pct(v) + ') ' + p.source) + '</title></rect>';
    });
    let grid = '';
    [0, 16.7, 33.3, 50].forEach((v) => {
      grid += '<line class="axis" x1="' + padL + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text x="0" y="' + (y(v) + 3) + '">' + Math.round(v) + '%</text>';
    });
    const ry = y(randomPct);
    const first = history[0].forDate, last = history[history.length - 1].forDate;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + grid + bars +
      '<line x1="' + padL + '" x2="' + W + '" y1="' + ry + '" y2="' + ry + '" stroke="#f59e0b" stroke-dasharray="4 4" stroke-width="1.5"/>' +
      '<text x="' + (W - 120) + '" y="' + (ry - 4) + '" style="fill:#f59e0b">random ' + pct(randomPct) + '</text>' +
      '<text x="' + padL + '" y="' + (H - 4) + '">' + esc(first) + '</text>' +
      '<text x="' + (W - 70) + '" y="' + (H - 4) + '">' + esc(last) + '</text></svg>';
  }

  function renderTabs() {
    const games = state.data.games;
    $('#tabs').innerHTML = GAME_ORDER.map((c) => {
      const g = games.find((x) => x.code === c);
      if (!g) return '';
      const lp = g.lastEvaluated ? pct(g.lastEvaluated.matchPct) : '';
      return '<button class="tab" role="tab" data-code="' + c + '" aria-selected="' + (c === state.active) + '">' + esc(g.name) +
        (lp ? '<span class="pct">' + lp + '</span>' : '') + '</button>';
    }).join('');
    document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
      state.active = b.dataset.code;
      try { localStorage.setItem('lm.tab', state.active); } catch (e) { /* ignore */ }
      render();
    }));
  }

  function render() {
    const d = state.data;
    if (!d) return;
    $('#model-name').textContent = d.muse ? d.model : 'Muse Spark 1.3 (not configured)';
    $('#updated').textContent = 'Updated ' + d.updatedAt;
    renderTabs();
    const g = d.games.find((x) => x.code === state.active) || d.games[0];
    const n = g.next, le = g.lastEvaluated, st = g.stats;
    const days = g.schedule.map((x) => DAY[x]).join(' / ');

    // Next projection
    const nextCard = '<section class="card span-7">' +
      '<h2>Next draw projection</h2>' +
      (n ? '<div class="next-head"><div><div class="next-date">' + esc(fmtDate(n.forDate)) + '</div>' +
        '<div class="muted">' + esc(g.name) + ' · ' + days + ' · 9:00 PM · odds 1 in ' + g.odds.toLocaleString() + '</div></div>' +
        sourceTag(n) + '</div>' +
        balls(n.picks, { big: true, pick: true }) +
        (n.algoPicks && n.algoPicks.join() !== n.picks.join()
          ? '<div class="row"><span class="label">Algorithm top-6</span>' + balls(n.algoPicks, { mini: true }) + '</div>' : '') +
        '<div class="row"><span class="label">Weights</span><span class="chips">' +
        (n.weights ? '<span class="chip">freq<em>' + Math.round(n.weights.wFrequency * 100) + '%</em></span>' +
          '<span class="chip">overdue<em>' + Math.round(n.weights.wOverdue * 100) + '%</em></span>' +
          '<span class="chip">recent<em>' + Math.round(n.weights.wRecent * 100) + '%</em></span>' +
          '<span class="chip">window<em>' + n.weights.window + '</em></span><span class="chip">cap<em>' + n.weights.cap + '×</em></span>' : '') +
        '</span></div>' +
        (n.rationale ? '<div class="rationale">' + esc(n.rationale) + '</div>' : '') +
        (n.confidence ? '<div class="confidence">' + esc(n.confidence) + '</div>' : '') +
        '<div class="confidence">Generated ' + esc(n.createdAt) + ' · ' + esc(n.model) + '</div>'
        : '<p class="muted">No pending projection — run the pipeline.</p>') +
      '</section>';

    // Last projected vs actual
    const lastCard = '<section class="card span-5">' +
      '<h2>Last projection vs actual</h2>' +
      (le ? '<div class="vs">' +
        '<div class="next-head"><div><div class="muted">Draw of</div><div class="next-date">' + esc(fmtDate(le.actualDate || le.forDate)) + '</div></div>' + sourceTag(le) + '</div>' +
        '<div class="big-pct">' + pct(le.matchPct) + '<small>' + le.matched + ' of 6 matched</small></div>' +
        '<div class="meter"><span style="width:' + Math.min(le.matchPct, 100) + '%"></span><i style="left:' + st.randomMatchPct + '%"></i></div>' +
        '<div class="legend">Random baseline <b>' + pct(st.randomMatchPct) + '</b> (average for 6 random numbers)</div>' +
        '<div class="row"><span class="label">Projected</span>' + balls(le.picks, { actual: le.actual }) + '</div>' +
        '<div class="row"><span class="label">Actual</span>' + balls(le.actual, { pick: true }) + '</div>' +
        (le.algoMatchPct != null && le.source === 'MUSE'
          ? '<div class="legend">Algorithm-only top-6 would have matched ' + le.algoMatched + '/6 (' + pct(le.algoMatchPct) + ')</div>' : '') +
        '</div>'
        : '<p class="muted">Nothing evaluated yet.</p>') +
      '</section>';

    // KPIs
    const kpis = '<section class="card span-12"><h2>Track record</h2><div class="kpis">' +
      kpi(pct(st.live.avgMatchPct), 'Live avg % matched (' + st.live.count + ' draws)') +
      kpi(pct(st.backtest.avgMatchPct), 'Backtest avg % matched (' + st.backtest.count + ' draws)') +
      kpi(pct(st.randomMatchPct), 'Random baseline') +
      kpi(st.live.twoPlus + st.backtest.twoPlus, 'Draws with 2+ numbers hit') +
      '</div><div class="chart" style="margin-top:16px">' + chart(g.history, st.randomMatchPct) + '</div>' +
      '<div class="legend">Green = live projection with a hit · dark blue = seeded backtest · dashed = random baseline. Last 40 evaluated draws.</div></section>';

    // History table
    const rows = g.history.slice().reverse().slice(0, 20).map((p) =>
      '<tr><td>' + esc(p.forDate) + '</td><td>' + sourceTag(p) + '</td><td>' + balls(p.picks, { mini: true, actual: p.actual }) + '</td>' +
      '<td>' + balls(p.actual, { mini: true }) + '</td><td class="num">' + p.matched + '/6</td>' +
      '<td class="pct-cell ' + (p.matched ? 'pct-hit' : 'pct-0') + '">' + pct(p.matchPct) + '</td></tr>').join('');
    const histCard = '<section class="card span-8"><h2>Projected vs actual — history</h2>' +
      '<table><thead><tr><th>Draw</th><th>By</th><th>Projected (green = hit)</th><th>Actual</th><th>Hits</th><th>% matched</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="muted">No history yet.</td></tr>') + '</tbody></table></section>';

    // Side: latest results + numbers
    const recent = g.recentDraws.slice(0, 8).map((r) =>
      '<tr><td>' + esc(r.date) + '</td><td>' + balls(r.nums.slice().sort((a, b) => a - b), { mini: true }) + '</td><td class="num">' + peso(r.jackpot) + '</td></tr>').join('');
    const side = '<section class="card span-4"><h2>Latest results</h2><table><tbody>' + recent + '</tbody></table>' +
      '<h2 style="margin-top:18px">Hottest (hits)</h2><div class="chips">' + g.hottest.map((x) => '<span class="chip">' + pad(x.n) + '<em>' + x.v + '</em></span>').join('') + '</div>' +
      '<h2 style="margin-top:14px">Most overdue (gap ÷ avg gap)</h2><div class="chips">' + g.mostOverdue.map((x) => '<span class="chip">' + pad(x.n) + '<em>' + x.v + '×</em></span>').join('') + '</div>' +
      '<p class="legend" style="margin-top:14px">Settings updated ' + esc(g.settings.updatedAt) + ' by ' + esc(g.settings.updatedBy) + '</p></section>';

    $('#app').innerHTML = '<div class="grid">' + nextCard + lastCard + kpis + histCard + side + '</div>';
  }

  function kpi(v, k) { return '<div class="kpi"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k) + '</div></div>'; }

  /* ---------------- actions ---------------- */
  async function load() {
    if (!API || API.indexOf('PASTE_') === 0) {
      $('#app').innerHTML = '<div class="card setup-box"><h2>Connect the backend</h2>' +
        '<p>Open <code>docs/config.js</code> and paste your Apps Script web app URL (ends with <code>/exec</code>). See README for deployment steps.</p></div>';
      $('#btn-run').disabled = true;
      return;
    }
    $('#btn-reload').disabled = true;
    try {
      state.data = await apiGet('dashboard');
      if (!state.data.games.some((g) => g.code === state.active)) state.active = state.data.games[0].code;
      render();
    } catch (e) {
      $('#app').innerHTML = '<div class="error">Could not load dashboard:\n' + esc(e.message) + '</div>';
    } finally {
      $('#btn-reload').disabled = false;
    }
  }

  function getToken() {
    let t = '';
    try { t = sessionStorage.getItem('lm.token') || ''; } catch (e) { /* ignore */ }
    if (!t) {
      t = window.prompt('Admin token (ADMIN_TOKEN from Apps Script → Script Properties):') || '';
      try { if (t) sessionStorage.setItem('lm.token', t); } catch (e) { /* ignore */ }
    }
    return t;
  }

  async function run() {
    const token = getToken();
    if (!token) return;
    const force = window.confirm('Ask Muse Spark to re-analyse every game even if no new results were found?\n\nOK = force re-analysis · Cancel = only games with new results');
    const list = $('#progress-list');
    list.innerHTML = '';
    $('#progress').classList.remove('hidden');
    $('#progress-close').classList.add('hidden');
    $('#btn-run').disabled = true;
    // One game per request keeps each call well inside Apps Script's 6-minute limit.
    for (const code of GAME_ORDER) {
      const g = state.data ? state.data.games.find((x) => x.code === code) : null;
      const li = document.createElement('li');
      li.textContent = (g ? g.name : code) + ': fetching results, scoring, ' + (force ? 'Muse re-analysis…' : 'analysing if new…');
      list.appendChild(li);
      try {
        const r = await apiPost({ action: 'run', token: token, game: code, force: force });
        const x = r.results[0] || {};
        const parts = [];
        parts.push(x.newDraws && x.newDraws.length ? 'new: ' + x.newDraws.join(', ') : 'no new results');
        if (x.evaluated && x.evaluated.length) parts.push('scored ' + x.evaluated.map((e) => e.forDate + ' → ' + e.matched + '/6').join(', '));
        if (x.projection && x.projection.picks) parts.push('next ' + x.projection.next + ': ' + x.projection.picks.map(pad).join('-') + ' (' + x.projection.source + ')');
        if (x.projection && x.projection.skipped) parts.push(x.projection.skipped);
        li.textContent = (g ? g.name : code) + ' — ' + parts.join(' · ');
        li.className = 'done';
      } catch (e) {
        li.textContent = (g ? g.name : code) + ' — failed: ' + e.message;
        li.className = 'fail';
        if (/token/i.test(e.message)) { try { sessionStorage.removeItem('lm.token'); } catch (x) { /* ignore */ } break; }
      }
    }
    $('#progress-close').classList.remove('hidden');
    $('#btn-run').disabled = false;
    await load();
  }

  $('#btn-reload').addEventListener('click', load);
  $('#btn-run').addEventListener('click', run);
  $('#progress-close').addEventListener('click', () => $('#progress').classList.add('hidden'));
  load();
})();
