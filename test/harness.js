// Runs the Apps Script code in Node with in-memory mocks of SpreadsheetApp, UrlFetchApp, etc.
// Usage: node test/harness.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'apps-script');
const sheets = {};
function makeSheet(name) {
  const data = [];
  const api = {
    _name: name, _data: data,
    getLastRow: () => data.length,
    setFrozenRows: () => api,
    getRange: (r, c, nr, nc) => {
      if (typeof r === 'string') return { setNumberFormat: () => {} };
      nr = nr || 1; nc = nc || 1;
      const rng = {
        setValues: (vals) => { for (let i = 0; i < nr; i++) { data[r - 1 + i] = data[r - 1 + i] || []; for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = vals[i][j]; } return rng; },
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = data[r - 1 + i] || []; out.push(Array.from({ length: nc }, (_, j) => row[c - 1 + j] === undefined ? '' : row[c - 1 + j])); } return out; },
        setFontWeight: () => rng, setBackground: () => rng, setFontColor: () => rng, setNumberFormat: () => rng,
      };
      return rng;
    },
  };
  return api;
}
const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = makeSheet(n)),
  getSheets: () => Object.values(sheets),
  deleteSheet: (s) => delete sheets[s._name],
};

const props = { MUSE_API_KEY: 'test-key', ADMIN_TOKEN: 'secret' };
const fetchLog = [];
let museReply = null;
const pages = {};

function UrlFetch(url, opts) {
  fetchLog.push(url);
  if (url.indexOf('/chat/completions') >= 0) {
    const body = JSON.parse(opts.payload);
    let ctx; try { ctx = JSON.parse(body.messages[1].content); } catch (e) { ctx = { extractionPrompt: body.messages[1].content }; }
    museReply.lastCtx = ctx;
    const content = JSON.stringify(museReply.make(ctx));
    return resp(200, JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 1234 } }));
  }
  for (const k in pages) if (url.indexOf(k) >= 0) return resp(200, pages[k]);
  return resp(404, 'nope');
}
function resp(code, txt) { return { getResponseCode: () => code, getContentText: () => txt }; }

const ctx = {
  console,
  SpreadsheetApp: { openById: () => ss },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const m = new Date(d.getTime() + 8 * 3600e3).toISOString();
      return fmt === 'yyyy' ? m.slice(0, 4) : m.slice(0, 10) + ' ' + m.slice(11, 19);
    },
    sleep: () => {},
  },
  UrlFetchApp: { fetch: UrlFetch },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ContentService: { createTextOutput: (s) => ({ setMimeType: () => ({ text: s }) }), MimeType: { JSON: 'json' } },
  ScriptApp: { getProjectTriggers: () => [] },
};
vm.createContext(ctx);
for (const f of ['Config.gs', 'Seed.gs', 'Algo.gs', 'Fetch.gs', 'Muse.gs', 'Pipeline.gs', 'Api.gs']) {
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
}
const run = (code) => vm.runInContext(code, ctx);
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok  -', msg); };

// ---------- 1. setup + seed ----------
const rep = run('setup()');
console.log(rep);
assert(sheets.Draws._data.length === 562, 'Draws seeded with 561 rows + header');
assert(sheets.Algo._data.length === 5, 'Algo seeded for 4 games');
const next = sheets.Projections._data.filter((r) => r[16] === 'PENDING').map((r) => [r[1], r[2], r.slice(6, 12)]);
console.log('pending:', JSON.stringify(next));
const expect = { '658': [43, 58, 53, 12, 14, 57], '655': [23, 50, 54, 51, 5, 55], '649': [26, 44, 5, 40, 20, 6], '645': [3, 43, 23, 17, 19, 33] };
next.forEach(([g, d, p]) => assert(JSON.stringify(p) === JSON.stringify(expect[g]), g + ' seeded next pick matches Excel model (' + d + ')'));
assert(next.find((x) => x[0] === '658')[1] === '2026-11-27' && next.find((x) => x[0] === '655')[1] === '2026-11-28' &&
       next.find((x) => x[0] === '649')[1] === '2026-11-29' && next.find((x) => x[0] === '645')[1] === '2026-11-27', 'next draw dates follow schedule');
assert(JSON.stringify(run('setup()')).indexOf('Already') >= 0, 'setup is idempotent');

// ---------- 2. parsers ----------
const pcsoHtml = '<table><tr><th>LOTTO GAME</th><th>COMBINATIONS</th><th>DRAW DATE</th><th>JACKPOT (PHP)</th><th>WINNERS</th></tr>' +
  '<tr><td>Ultra Lotto 6/58</td><td>43-12-07-58-30-01</td><td>11/27/2026</td><td>600,123,456.78</td><td>0</td></tr>' +
  '<tr><td>Megalotto 6/45</td><td>03-17-40-41-42-44</td><td>11/27/2026</td><td>44,000,000.00</td><td>0</td></tr>' +
  '<tr><td>Grand Lotto 6/55</td><td>36-30-15-17-24-42</td><td>11/25/2026</td><td>45,084,438.55</td><td>0</td></tr></table>';
pages['pcso.gov.ph'] = pcsoHtml;
pages['6-58-lotto/history'] = '<h1>x</h1><table><tr><td>November 27, 2026</td><td>431207583001</td><td>&#8369;600,123,456</td></tr>' +
  '<tr><td>November 24, 2026</td><td>25 31 39 11 32 21</td><td>₱588,407,563.78</td></tr></table>';
pages['6-45-lotto/history'] = '<p>layout changed, no table</p><div>November 27, 2026 — winning numbers: three, seventeen …</div>';
const pc = run("parsePcso_(htmlToText_(" + JSON.stringify(pcsoHtml) + "), GAMES['658'])");
assert(pc.length === 1 && pc[0].date === '2026-11-27' && pc[0].nums.join() === '43,12,7,58,30,1', 'PCSO parser reads 6/58 row');
const hist = run("parseHistory_(htmlToText_(" + JSON.stringify(pages['6-58-lotto/history']) + "), GAMES['658'], 'x')");
assert(hist.length === 2 && hist[0].nums.join() === '43,12,7,58,30,1' && hist[1].nums.join() === '25,31,39,11,32,21', 'history parser handles 12-digit and spaced numbers');

// ---------- 3. pipeline with Muse ----------
museReply = {
  make: (c) => ({
    assessment: 'Last projection matched 3 of 6, above the 10.3% random baseline; the backtest edge is small.',
    weights: { frequency: 0.3, overdue: 0.5, recent: 0.3 }, // sums to 1.1 → should be normalised
    window: 20, cap: 3,
    picks: c.top15UnderBestGridSettings.slice(0, 6).map((x) => x.n),
    rationale: 'Chose the config that held up in the last 40 draws.',
    confidence_note: 'Random draws; no edge is guaranteed.',
  }),
};
const r1 = run("runPipeline({game:'658'})");
console.log(JSON.stringify(r1, null, 1).slice(0, 900));
const x = r1.results[0];
assert(x.newDraws.join() === '2026-11-27', '6/58 new draw stored');
assert(x.evaluated.length === 1 && x.evaluated[0].matched === 3, 'pending 6/58 projection scored: 43,12,58 hit → 3/6');
assert(x.projection.source === 'MUSE' && x.projection.next === '2026-11-29', 'Muse projection for next 6/58 draw (Sun Nov 29)');
const ctxSent = museReply.lastCtx;
assert(ctxSent.gridSearchTop10.length === 10 && ctxSent.projectionTrackRecord.live.count === 1, 'Muse context has grid search + live track record');
const algo658 = sheets.Algo._data.find((r) => r[0] === '658');
assert(Math.abs(algo658[1] + algo658[2] + algo658[3] - 1) < 0.01 && algo658[7] === 'meta/muse-spark-1.3', 'Muse weights normalised & saved');
const evRow = sheets.Projections._data.find((r) => r[0] === 'P-658-2026-11-27');
assert(evRow[16] === 'EVALUATED' && evRow[20] === 50, 'MatchPct = 50% stored on projection row');

// 6/45: page layout broken → Muse extraction must be verified against text (it is not present → rejected)
museReply.make = (c) => (!c.extractionPrompt ? museReply._analysis(c) : { rows: [{ date: '2026-11-27', numbers: [3, 17, 40, 41, 42, 44], jackpot: 0 }] });
museReply._analysis = (c) => ({ assessment: 'a', weights: { frequency: 0.35, overdue: 0.4, recent: 0.25 }, window: 20, cap: 3, picks: [1, 1, 2, 3, 4, 5], rationale: 'r', confidence_note: 'c' });
const r2 = run("runPipeline({game:'645'})");
const y = r2.results[0];
assert(y.newDraws.join() === '2026-11-27', '6/45 new draw taken from official PCSO page');
assert(y.evaluated[0].matched === 2, '6/45 projection [3,43,23,17,19,33] vs 03-17-40-41-42-44 → 2/6, got ' + y.evaluated[0].matched);
assert(sheets.Draws._data.filter((r) => r[0] === '645' && r[1] === '2026-11-27').length === 1 && sheets.Log._data.some((r) => /lottoresulta.com: 0 row/.test(r[3])), 'Muse-extracted rows not found in page text are rejected');
assert(y.projection.source === 'MUSE' && JSON.stringify(y.projection.picks) === JSON.stringify(y.projection.algoPicks), 'invalid Muse picks (duplicate) fall back to algorithm top-6');

// No new results → no re-analysis unless forced
const r3 = run("runPipeline({game:'649'})");
assert(r3.results[0].newDraws.length === 0 && r3.results[0].projection === null, '6/49 with no new draws: no re-analysis');
const r4 = run("runPipeline({game:'649', force:true})");
assert(r4.results[0].projection && r4.results[0].projection.source === 'MUSE', 'forced re-analysis replaces pending 6/49 projection');
assert(sheets.Projections._data.filter((r) => r[1] === '649' && r[16] === 'PENDING').length === 1, 'only one pending 6/49 projection');

// Muse down → algorithm fallback
const saved = UrlFetch;
ctx.UrlFetchApp.fetch = (u, o) => (u.indexOf('/chat/completions') >= 0 ? resp(500, 'boom') : saved(u, o));
const r5 = run("runPipeline({game:'655', force:true})");
assert(r5.results[0].projection.source === 'ALGO', 'Muse error → algorithm projection, pipeline continues');
ctx.UrlFetchApp.fetch = saved;

// ---------- 4. API ----------
const dash = JSON.parse(run("doGet({parameter:{action:'dashboard'}})").text);
assert(dash.ok && dash.games.length === 4, 'dashboard returns 4 games');
const g58 = dash.games.find((g) => g.code === '658');
assert(g58.lastEvaluated.matchPct === 50 && g58.stats.live.count === 1 && g58.stats.backtest.count > 100, 'dashboard has % matched + track record');
assert(g58.next.forDate === '2026-11-29' && g58.next.source === 'MUSE', 'dashboard next projection');
const bad = JSON.parse(run("doPost({postData:{contents:JSON.stringify({action:'run',token:'nope'})}})").text);
assert(!bad.ok && /token/.test(bad.error), 'POST without valid token rejected');
fs.writeFileSync(path.join(__dirname, 'sample-dashboard.json'), JSON.stringify(dash, null, 1));
console.log('\nBacktest avg % matched:', dash.games.map((g) => g.code + ' ' + g.stats.backtest.avgMatchPct + '% vs random ' + g.stats.randomMatchPct + '%').join(' | '));
