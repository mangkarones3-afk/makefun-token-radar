'use strict';
/* Token Radar dashboard. Renders window.RADAR — the exact board the program
   wrote to board.json — with no network and no other data source, so the page
   can never disagree with the scored board. */

const R = window.RADAR;
const $ = (sel) => document.querySelector(sel);
const nf = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

function money(v) { return '$' + nf.format(Math.round(v)); }
function moneyShort(v) { return '$' + compact.format(v); }
function pct(v) {
  if (v === null || v === undefined) return ['—', 'flat'];
  const s = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  return [s, v > 0 ? 'up' : v < 0 ? 'down' : 'flat'];
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/* ---------- headline fills ---------- */
function fill(name, text) {
  document.querySelectorAll(`[data-fill="${name}"]`).forEach((n) => (n.textContent = text));
}
function fillStatic() {
  const m = R.meta, v = R.validation, model = R.model;
  fill('as_of', m.as_of); fill('as_of2', m.as_of);
  fill('source', m.source); fill('source2', m.source);
  fill('protocols', nf.format(m.protocols));
  fill('floor', nf.format(m.floor_usd));
  fill('total_implied', moneyShort(R.board.reduce((s, r) => s + r.implied_value_usd, 0)));
  fill('board_rows', nf.format(R.board.length));
  fill('self_found', nf.format(R.board.filter((r) => !r.watchlist).length));
  fill('watch_covered', nf.format(R.board.filter((r) => r.watchlist).length));
  fill('watch_total', nf.format(m.watchlist));
  fill('oos_median_ape', v.median_ape_pct.toFixed(1) + '%');
  fill('oos_median_ape2', v.median_ape_pct.toFixed(1) + '%');
  fill('oos_median_ape3', v.median_ape_pct.toFixed(1) + '%');
  fill('oos_factor', v.median_factor.toFixed(2));
  fill('oos_factor2', v.median_factor.toFixed(2));
  fill('oos_n', nf.format(v.test_n));
  fill('oos_global', v.global_baseline_median_ape_pct.toFixed(1) + '%');
  fill('oos_flat', v.flat_baseline_median_ape_pct.toFixed(1) + '%');
  fill('oos_spearman', v.spearman.toFixed(2));
  fill('train_n', nf.format(v.train_n));
  fill('test_n', nf.format(v.test_n));
  fill('fit_n', nf.format(model.fit_n));
  fill('zero_mcap', nf.format(model.zero_mcap_excluded));
  fill('global_multiple', model.global_multiple.toFixed(3));
  fill('live_shown', nf.format(R.live.length));
  fill('live_total', nf.format(R.live_total));
}

/* ---------- board table ---------- */
const state = { q: '', category: '', chain: '', watchOnly: false, sortKey: 'rank', sortDir: 1 };

function filteredBoard() {
  let rows = R.board.filter((r) => {
    if (state.watchOnly && !r.watchlist) return false;
    if (state.category && (r.category ?? 'Uncategorized') !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.q) {
      const q = state.q.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    }
    return true;
  });
  const k = state.sortKey;
  rows.sort((a, b) => {
    const av = a[k], bv = b[k];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const c = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return c * state.sortDir;
  });
  return rows;
}

function renderBoard() {
  const rows = filteredBoard();
  const body = $('#board-body');
  body.textContent = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => openDetail(r));
    const rank = el('td', 'num', String(r.rank));
    const nameTd = el('td');
    nameTd.appendChild(el('span', '', r.name));
    if (r.watchlist) nameTd.appendChild(el('span', 'badge', 'WATCHLIST'));
    nameTd.appendChild(el('span', 'slug', r.slug));
    const cat = el('td', '', r.category ?? 'Uncategorized');
    const chains = el('td', '', r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''));
    const tvl = el('td', 'num', money(r.tvl_usd));
    const [chgText, chgCls] = pct(r.change_7d);
    const chg = el('td', 'num ' + chgCls, chgText);
    const mult = el('td', 'num', r.multiple_used.toFixed(3));
    const implied = el('td', 'num implied', money(r.implied_value_usd));
    tr.append(rank, nameTd, cat, chains, tvl, chg, mult, implied);
    body.appendChild(tr);
  }
  $('#row-count').textContent = `${nf.format(rows.length)} of ${nf.format(R.board.length)} protocols shown`;
}

function wireControls() {
  const cats = [...new Set(R.board.map((r) => r.category ?? 'Uncategorized'))].sort();
  const catSel = $('#f-category');
  for (const c of cats) catSel.appendChild(el('option', '', c)).value = c;
  const chains = [...new Set(R.board.flatMap((r) => r.chains))].sort();
  const chainSel = $('#f-chain');
  for (const c of chains) chainSel.appendChild(el('option', '', c)).value = c;
  $('#q').addEventListener('input', (e) => { state.q = e.target.value.trim(); renderBoard(); });
  catSel.addEventListener('change', (e) => { state.category = e.target.value; renderBoard(); });
  chainSel.addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
  $('#f-watch').addEventListener('change', (e) => { state.watchOnly = e.target.checked; renderBoard(); });
  document.querySelectorAll('#board-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.sortKey === k) state.sortDir *= -1;
      else { state.sortKey = k; state.sortDir = k === 'name' || k === 'category' ? 1 : -1; }
      if (k === 'rank') state.sortDir = 1;
      renderBoard();
    });
  });
}

/* ---------- detail drawer ---------- */
function openDetail(r) {
  const box = $('#detail-content');
  box.textContent = '';
  box.appendChild(el('h2', '', r.name));
  const sub = el('p', 'sub', `${r.slug} · ${r.category ?? 'Uncategorized'} · rank #${r.rank} of ${nf.format(R.board.length)}`);
  box.appendChild(sub);

  const fit = R.model.categories.find((c) => c.category === (r.category ?? 'Uncategorized'));
  const arith = el('div', 'arith');
  const row = (label, value) => {
    const d = el('div', 'row');
    d.appendChild(el('span', '', label));
    d.appendChild(el('b', '', value));
    return d;
  };
  arith.appendChild(row('TVL (snapshot)', money(r.tvl_usd)));
  if (fit) {
    const w = fit.n / (fit.n + 4);
    arith.appendChild(row(`Category median multiple (n=${fit.n} tokenized peers)`, fit.median_multiple.toFixed(3) + '×'));
    arith.appendChild(row('Global median multiple', R.model.global_multiple.toFixed(3) + '×'));
    arith.appendChild(row('Shrinkage weight on the category', w.toFixed(2)));
    arith.appendChild(row('Blended multiple used', r.multiple_used.toFixed(3) + '×'));
  } else {
    arith.appendChild(row('Category has <3 tokenized peers — global median used', R.model.global_multiple.toFixed(3) + '×'));
    arith.appendChild(row('Blended multiple used', r.multiple_used.toFixed(3) + '×'));
  }
  const total = row('Implied value = TVL × multiple', money(r.implied_value_usd));
  total.classList.add('total');
  arith.appendChild(total);
  box.appendChild(arith);

  const [chgText] = pct(r.change_7d);
  const meta = el('p', 'meta',
    `Chains: ${r.chains.join(', ') || '—'} · 7d TVL change: ${chgText} · ` +
    (r.listed_at ? `tracked by DefiLlama since ${r.listed_at}` : 'no listing date in the snapshot') +
    (r.watchlist ? ' · on the bounty watchlist' : ' · found by the model beyond the watchlist'));
  box.appendChild(meta);

  box.appendChild(el('h3', '', 'Farm plan'));
  const ol = document.createElement('ol');
  for (const s of r.farm_steps) ol.appendChild(el('li', '', s));
  box.appendChild(ol);
  $('#detail').classList.remove('hidden');
}
$('#detail-close').addEventListener('click', () => $('#detail').classList.add('hidden'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#detail').classList.add('hidden'); });

/* ---------- category chart: one hue, magnitude, zero baseline ---------- */
function renderChart() {
  const host = $('#cat-chart');
  host.textContent = '';
  const onBoard = new Set(R.board.map((r) => r.category ?? 'Uncategorized'));
  const cats = R.model.categories.filter((c) => onBoard.has(c.category));
  const max = Math.max(...cats.map((c) => c.blended_multiple));
  for (const c of cats) {
    const rowEl = el('div', 'bar-row');
    rowEl.appendChild(el('div', 'cat', `${c.category} `)).appendChild(el('span', 'n', `(n=${c.n})`));
    const track = el('div', 'bar-track');
    const fillBar = el('div', 'bar-fill');
    fillBar.style.width = Math.max(1.5, (c.blended_multiple / max) * 100) + '%';
    track.appendChild(fillBar);
    rowEl.appendChild(track);
    rowEl.appendChild(el('div', 'val', c.blended_multiple.toFixed(3) + '×'));
    host.appendChild(rowEl);
  }
}

/* ---------- live (already trading) table ---------- */
function renderLive() {
  const body = $('#live-body');
  body.textContent = '';
  for (const r of R.live) {
    const tr = document.createElement('tr');
    const nameTd = el('td');
    nameTd.appendChild(el('span', '', r.name));
    nameTd.appendChild(el('span', 'slug', r.slug));
    const [chgText, chgCls] = pct(r.change_7d);
    tr.append(
      nameTd,
      el('td', '', r.symbol ?? '—'),
      el('td', '', r.category ?? 'Uncategorized'),
      el('td', 'num', money(r.tvl_usd)),
      el('td', 'num', money(r.mcap_usd)),
      el('td', 'num', r.multiple.toFixed(3)),
      el('td', 'num ' + chgCls, chgText),
    );
    body.appendChild(tr);
  }
}

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    for (const v of ['board', 'live', 'method']) {
      $('#view-' + v).classList.toggle('hidden', v !== t.dataset.view);
    }
  });
});

fillStatic();
wireControls();
renderBoard();
renderChart();
renderLive();
