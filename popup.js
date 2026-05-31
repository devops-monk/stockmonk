/* global chrome */
'use strict';

// ═══════════════════════════════════════════════════
// Constants & Defaults
// ═══════════════════════════════════════════════════
const DEFAULT_API = 'https://stockmonk.devops-monk.com/api/v1';
const CACHE_TTL_MS   = 5 * 60 * 1000; // 5 minutes
const MAX_WATCHLIST  = 20;
const MAX_HISTORY    = 8;

// ═══════════════════════════════════════════════════
// Storage helpers  (chrome.storage.local)
// ═══════════════════════════════════════════════════
function storageGet(defaults) {
  return new Promise(r => chrome.storage.local.get(defaults, r));
}
function storageSet(data) {
  return new Promise(r => chrome.storage.local.set(data, r));
}

// ═══════════════════════════════════════════════════
// App-level state (in-memory cache for this session)
// ═══════════════════════════════════════════════════
const state = {
  tab: 'dashboard',
  apiBase: DEFAULT_API,
  autoRefresh: true,
  minScore: 0,
  watchlist: [],
  searchHistory: [],
  dashboardCache: null,
  dashboardCacheTs: 0,
  watchlistCache: null,
  watchlistCacheTs: 0,
};

// ═══════════════════════════════════════════════════
// API helpers
// ═══════════════════════════════════════════════════
async function api(path) {
  const res = await fetch(`${state.apiBase}${path}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

// ═══════════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════════
function $(id) { return document.getElementById(id); }

let toastTimer = null;
function toast(msg, type = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function scoreClass(score) {
  if (score >= 60) return 'green';
  if (score >= 40) return 'amber';
  return 'red';
}
function scoreLabel(score) {
  if (score >= 60) return 'Buy Watch';
  if (score >= 40) return 'Neutral';
  return 'Low Interest';
}
function scoreColor(score) {
  if (score >= 60) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

const CURRENCY_SYMBOLS = { USD:'$', GBP:'£', GBp:'p', EUR:'€', INR:'₹', JPY:'¥', CHF:'Fr', HKD:'HK$', CAD:'C$', AUD:'A$' };

function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] ?? (code ? code + ' ' : '$');
}

function fmtPrice(p, currency) {
  if (p == null) return '—';
  const sym = currencySymbol(currency);
  const decimals = (currency === 'GBp' || currency === 'JPY') ? 0 : 2;
  return sym + Number(p).toFixed(decimals);
}

function fmtChange(change, pct, currency) {
  if (change == null) return '';
  const sign = change >= 0 ? '+' : '';
  const sym  = currencySymbol(currency);
  const decimals = (currency === 'GBp' || currency === 'JPY') ? 0 : 2;
  const pc = pct != null ? ` (${sign}${Number(pct).toFixed(2)}%)` : '';
  return `${sign}${sym}${Math.abs(Number(change)).toFixed(decimals)}${pc}`;
}

function fmtReportTime(raw) {
  if (!raw) return '';
  if (raw === 'before_market' || raw === 'BMO') return 'Pre-market';
  if (raw === 'after_market'  || raw === 'AMC') return 'After hours';
  return '';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function sanitize(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function setInner(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}
function loadingHTML(msg = 'Loading…') {
  return `<div class="loading-wrap"><div class="spinner"></div><span>${msg}</span></div>`;
}
function errorHTML(msg) {
  return `<div class="error-state">⚠ ${sanitize(msg)}</div>`;
}

// ═══════════════════════════════════════════════════
// Score Gauge SVG (circular arc)
// ═══════════════════════════════════════════════════
function buildGaugeSVG(score) {
  const R = 34, cx = 44, cy = 48;
  const startDeg = -220, totalDeg = 260;
  const filledDeg = (Math.min(score, 100) / 100) * totalDeg;
  const color = scoreColor(score);

  function polar(deg) {
    const rad = (deg - 90) * Math.PI / 180;
    return { x: cx + R * Math.cos(rad), y: cy + R * Math.sin(rad) };
  }
  function arcPath(from, span, r) {
    const s = polar(from), e = polar(from + span);
    const la = span > 180 ? 1 : 0;
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${la} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  }

  return `<svg class="score-gauge-svg" viewBox="0 0 88 88" fill="none">
    <path d="${arcPath(startDeg, totalDeg, R)}" stroke="#1e2a3d" stroke-width="7" stroke-linecap="round"/>
    <path d="${arcPath(startDeg, filledDeg, R)}" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
    <text x="${cx}" y="${cy - 3}" text-anchor="middle" fill="${color}" font-size="18" font-weight="800"
      font-family="-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif">${score}</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="#8899bb" font-size="7.5" font-weight="600"
      font-family="-apple-system,BlinkMacSystemFont,sans-serif" letter-spacing="0.3">${scoreLabel(score).toUpperCase()}</text>
  </svg>`;
}

// ═══════════════════════════════════════════════════
// Earnings Tab
// ═══════════════════════════════════════════════════
let earningsRange = 'upcoming';

async function loadEarnings(range = earningsRange) {
  earningsRange = range;
  const container = $('earnings-container');
  container.innerHTML = loadingHTML('Loading earnings…');

  // Update toggle button state
  document.querySelectorAll('.etoggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.range === range);
  });

  try {
    const endpoint = range === 'upcoming'
      ? '/earnings/upcoming?days=14'
      : '/earnings/recent?days=7';
    const data = await api(endpoint);
    renderEarningsList(data.earnings ?? [], range);
  } catch (err) {
    container.innerHTML = errorHTML(`Failed to load earnings: ${err.message}`);
  }
}

function renderEarningsList(earnings, range) {
  const container = $('earnings-container');
  if (!earnings.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">${range === 'upcoming' ? '📭' : '📋'}</div>
      <div class="empty-title">No earnings ${range === 'upcoming' ? 'scheduled' : 'reported'}</div>
      <div class="empty-sub">Check back later or widen the date range.</div>
    </div>`;
    return;
  }

  container.innerHTML = earnings.map((e, i) => {
    const isUpcoming = !e.epsActual;
    const beatCls = e.beatMiss === 'beat' ? 'beat' : e.beatMiss === 'miss' ? 'miss' : '';
    const beatLabel = e.beatMiss === 'beat' ? '✓ Beat' : e.beatMiss === 'miss' ? '✗ Miss' : e.beatMiss === 'inline' ? '= Inline' : '';
    const timeLabel = fmtReportTime(e.reportTime);
    const urgency = isUpcoming && e.daysUntil <= 2 ? 'urgent' : isUpcoming && e.daysUntil <= 5 ? 'soon' : '';

    const epsHtml = isUpcoming
      ? (e.epsEstimate != null ? `<span class="eps-est">Est. <strong>${Number(e.epsEstimate).toFixed(2)}</strong></span>` : '')
      : `<span class="eps-actual ${beatCls}">EPS ${Number(e.epsActual).toFixed(2)}</span>
         ${e.epsEstimate != null ? `<span class="eps-vs">vs ${Number(e.epsEstimate).toFixed(2)}</span>` : ''}`;

    return `<div class="earnings-row ${urgency}" data-ticker="${sanitize(e.ticker)}" style="animation-delay:${i * 25}ms">
      <div class="er-left">
        <span class="er-ticker">${sanitize(e.ticker)}</span>
        ${beatLabel ? `<span class="er-beat ${beatCls}">${beatLabel}</span>` : ''}
      </div>
      <div class="er-mid">
        <span class="er-date">${fmtDate(e.reportDate)}</span>
        ${timeLabel ? `<span class="er-time">${timeLabel}</span>` : ''}
        ${epsHtml}
      </div>
      <div class="er-right">
        ${isUpcoming
          ? `<span class="er-days ${urgency}">${e.daysUntil}d</span>`
          : (e.epsSurprisePct != null
              ? `<span class="er-surprise ${e.epsSurprisePct >= 0 ? 'pos' : 'neg'}">${e.epsSurprisePct >= 0 ? '+' : ''}${Number(e.epsSurprisePct).toFixed(1)}%</span>`
              : '')
        }
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.earnings-row').forEach(row => {
    row.addEventListener('click', () => goToSearch(row.dataset.ticker));
  });
}

function initEarningsTab() {
  document.querySelectorAll('.etoggle-btn').forEach(btn => {
    btn.addEventListener('click', () => loadEarnings(btn.dataset.range));
  });
}

// ═══════════════════════════════════════════════════
// Signal breakdown rows
// ═══════════════════════════════════════════════════
function breakdownRow(label, val, max) {
  const pct = max > 0 ? Math.min((val / max) * 100, 100).toFixed(0) : 0;
  return `<div class="breakdown-row">
    <span class="breakdown-label">${label}</span>
    <div class="breakdown-bar-bg"><div class="breakdown-bar-fill" style="width:${pct}%"></div></div>
    <span class="breakdown-val">${val}/${max}</span>
  </div>`;
}

// ═══════════════════════════════════════════════════
// Tab switching
// ═══════════════════════════════════════════════════
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('hidden', p.id !== `tab-${tab}`);
  });
  if (tab === 'watchlist') loadWatchlist();
  if (tab === 'earnings')  loadEarnings();
}

// ═══════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════
async function loadDashboard(force = false) {
  const fresh = Date.now() - state.dashboardCacheTs < CACHE_TTL_MS;
  if (!force && fresh && state.dashboardCache) {
    renderDashboard(state.dashboardCache);
    return;
  }

  setInner('signals-container',  loadingHTML('Loading signals…'));
  setInner('trending-container', loadingHTML('Loading trending…'));

  const btn = $('refresh-btn');
  btn.classList.add('spinning');

  try {
    const [sigRes, trendRes] = await Promise.all([
      api(`/signals/top?minScore=${state.minScore}&limit=15`),
      api('/trending/stocks?limit=20'),
    ]);
    const cache = { signals: sigRes, trending: trendRes };
    state.dashboardCache   = cache;
    state.dashboardCacheTs = Date.now();
    await storageSet({ dashboardCache: cache, dashboardCacheTs: state.dashboardCacheTs });
    renderDashboard(cache);

    const now = new Date();
    $('last-updated').textContent =
      `Updated ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  } catch (err) {
    setInner('signals-container',  errorHTML(err.message));
    setInner('trending-container', errorHTML('Failed to load trending'));
  } finally {
    btn.classList.remove('spinning');
  }
}

function renderDashboard({ signals, trending }) {
  const signalList = signals?.signals ?? [];
  const stockList  = trending?.stocks  ?? [];

  // If cache has no data at all, it's probably stale from a failed session — force refresh
  if (!signalList.length && !stockList.length) {
    loadDashboard(true);
    return;
  }

  renderSignals(signalList);
  renderTrending(stockList);
}

function factorBar(name, val, max, colorCls) {
  const pct = max > 0 ? Math.min((val / max) * 100, 100).toFixed(1) : 0;
  return `<div class="factor-row">
    <span class="factor-name">${name}</span>
    <div class="factor-track"><div class="factor-fill ${colorCls}" style="width:${pct}%"></div></div>
    <span class="factor-val">${val}/${max}</span>
  </div>`;
}

function renderSignals(signals) {
  const container = $('signals-container');
  if (!signals.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📡</div>
      <div class="empty-title">Signals calibrating</div>
      <div class="empty-sub">Building 7-day baseline data — scores will sharpen over the next few hours.</div>
    </div>`;
    return;
  }

  container.innerHTML = signals.map((s, i) => {
    const cls = scoreClass(s.score);
    const bd  = s.breakdown;
    return `<div class="signal-card ${cls}" data-ticker="${sanitize(s.ticker)}" style="animation-delay:${i * 40}ms">
      <div class="signal-left">
        <span class="ticker">${sanitize(s.ticker)}</span>
        <span class="signal-label ${cls}">${sanitize(s.label)}</span>
      </div>
      <div class="signal-mid">
        <div class="factor-bars">
          ${factorBar('Reddit',     bd.redditMentionSurge, 25, 'green')}
          ${factorBar('StockTwits', bd.stockTwitsBullish,  20, 'blue')}
          ${factorBar('News',       bd.newsSentiment,      20, 'amber')}
          ${factorBar('Earnings',   bd.earningsBeat,       20, 'green')}
          ${factorBar('Upcoming',   bd.upcomingEarnings,   15, 'purple')}
        </div>
      </div>
      <div class="signal-right">
        <span class="big-score ${cls}">${s.score}</span>
        <span class="score-of">/100</span>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.signal-card').forEach(card => {
    card.addEventListener('click', () => goToSearch(card.dataset.ticker));
  });
}

function renderTrending(stocks) {
  const container = $('trending-container');
  if (!stocks.length) {
    container.innerHTML = '<div class="empty-state">No trending data available</div>';
    return;
  }
  container.innerHTML = stocks.map((s, i) => {
    const delta = s.mentionsDelta24h;
    const deltaEl = delta
      ? `<span class="delta ${delta.startsWith('+') ? 'green' : 'red'}">${sanitize(delta)}</span>`
      : '';
    const st = s.stockTwits;
    let sentimentEl = '';
    if (st) {
      const cls = st.sentimentLabel === 'Bullish' ? 'bull' : st.sentimentLabel === 'Bearish' ? 'bear' : 'neu';
      const short = st.sentimentLabel === 'Bullish' ? '🐂' : st.sentimentLabel === 'Bearish' ? '🐻' : '—';
      sentimentEl = `<span class="sentiment-pill ${cls}" title="${sanitize(st.sentimentLabel)}">${short} ${sanitize(st.sentimentLabel)}</span>`;
    }
    const isTop = s.rank <= 3;
    return `<div class="trending-item" data-ticker="${sanitize(s.ticker)}" style="animation-delay:${i * 30}ms">
      <div class="trend-rank-bubble ${isTop ? 'top3' : ''}">${s.rank}</div>
      <div class="trend-info">
        <div class="trend-ticker-row">
          <span class="ticker-sm">${sanitize(s.ticker)}</span>
          ${sentimentEl}
        </div>
        ${s.name ? `<span class="trend-name">${sanitize(s.name)}</span>` : ''}
      </div>
      <div class="trend-right">
        <span class="mention-count">${Number(s.mentions).toLocaleString()}</span>
        <span class="mention-label">mentions</span>
        ${deltaEl}
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.trending-item').forEach(item => {
    item.addEventListener('click', () => goToSearch(item.dataset.ticker));
  });
}

// ═══════════════════════════════════════════════════
// Search
// ═══════════════════════════════════════════════════
function goToSearch(ticker) {
  switchTab('search');
  $('search-input').value = ticker;
  performSearch(ticker);
}

function initSearch() {
  const input = $('search-input');
  const btn   = $('search-btn');

  btn.addEventListener('click', () => {
    const t = input.value.trim().toUpperCase();
    if (t) performSearch(t);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const t = input.value.trim().toUpperCase();
      if (t) performSearch(t);
    }
  });
  renderSearchHistory();
}

function renderSearchHistory() {
  const row = $('search-history-row');
  if (!state.searchHistory.length) { row.innerHTML = ''; return; }
  row.innerHTML = state.searchHistory.map(t =>
    `<button class="history-chip" data-ticker="${sanitize(t)}">${sanitize(t)}</button>`
  ).join('');
  row.querySelectorAll('.history-chip').forEach(chip => {
    chip.addEventListener('click', () => goToSearch(chip.dataset.ticker));
  });
}

async function performSearch(ticker) {
  ticker = ticker.trim().toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 10);
  if (!ticker) return;

  $('search-input').value = ticker;
  setInner('search-result-container', loadingHTML(`Looking up ${ticker}…`));

  try {
    const data = await api(`/stocks/${encodeURIComponent(ticker)}/detail`);
    addSearchHistory(ticker);
    renderDetailCard(data);
  } catch (err) {
    setInner('search-result-container', errorHTML(`Could not load ${ticker}: ${err.message}`));
  }
}

async function addSearchHistory(ticker) {
  const list = [ticker, ...state.searchHistory.filter(t => t !== ticker)].slice(0, MAX_HISTORY);
  state.searchHistory = list;
  await storageSet({ searchHistory: list });
  renderSearchHistory();
}

function renderDetailCard(data) {
  const { ticker, quote, profile, nextEarnings, newsSentiment, signal } = data;
  const inWL = state.watchlist.includes(ticker);

  const cur  = quote?.currency ?? 'USD';
  const mkt  = data.market ?? 'US';
  const mktCls = { US:'us', UK:'uk', IN:'in', DE:'de', FR:'fr', NL:'nl', ES:'es', IT:'it', CH:'ch' }[mkt] ?? 'other';
  const mktFlag = { US:'🇺🇸', UK:'🇬🇧', IN:'🇮🇳', DE:'🇩🇪', FR:'🇫🇷', NL:'🇳🇱', ES:'🇪🇸', IT:'🇮🇹', CH:'🇨🇭' }[mkt] ?? '';

  const priceHtml = quote
    ? (() => {
        const chg = Number(quote.change ?? 0);
        const cls = chg >= 0 ? 'pos' : 'neg';
        const arrow = chg >= 0 ? '▲' : '▼';
        return `<div class="detail-price-row">
          <span class="detail-price">${fmtPrice(quote.price, cur)}</span>
          <span class="detail-change ${cls}">${arrow} ${fmtChange(quote.change, quote.changePercent, cur)}</span>
        </div>
        <div class="detail-price-sub">
          <div class="price-meta-item"><span class="price-meta-label">Open</span><span class="price-meta-val">${fmtPrice(quote.open, cur)}</span></div>
          <div class="price-meta-item"><span class="price-meta-label">High</span><span class="price-meta-val">${fmtPrice(quote.high, cur)}</span></div>
          <div class="price-meta-item"><span class="price-meta-label">Low</span><span class="price-meta-val">${fmtPrice(quote.low, cur)}</span></div>
          <div class="price-meta-item"><span class="price-meta-label">Prev</span><span class="price-meta-val">${fmtPrice(quote.prevClose, cur)}</span></div>
        </div>
        ${quote.marketState && quote.marketState !== 'REGULAR'
          ? `<div class="market-state-pill">${quote.marketState === 'CLOSED' ? '🔴 Market Closed' : quote.marketState === 'PRE' ? '🟡 Pre-Market' : '🟡 After Hours'}</div>`
          : ''}`;
      })()
    : '<div class="detail-price-row"><span class="detail-price muted">Price unavailable</span></div>';

  const earningsHtml = nextEarnings
    ? (() => {
        const time = fmtReportTime(nextEarnings.reportTime);
        const urgency = nextEarnings.daysUntil <= 3 ? 'urgent' : nextEarnings.daysUntil <= 7 ? 'soon' : '';
        return `<div class="detail-earnings ${urgency}">
          <div class="earnings-left">
            <span class="earnings-label">Next Earnings</span>
            <span class="earnings-date">${fmtDate(nextEarnings.reportDate)}${time ? ` · ${time}` : ''}</span>
          </div>
          <span class="earnings-countdown ${urgency}">${nextEarnings.daysUntil}d</span>
        </div>`;
      })()
    : '';

  const sentColor = newsSentiment?.score >= 60 ? 'var(--green)' : newsSentiment?.score <= 40 ? 'var(--red)' : 'var(--amber)';
  const newsHtml = (newsSentiment?.topArticles?.length)
    ? `<div class="detail-news">
        <div class="news-header">
          <span class="news-title">Latest News</span>
          <span class="news-sentiment-pill" style="color:${sentColor};border-color:${sentColor}20;background:${sentColor}10">${sanitize(newsSentiment.label)}</span>
        </div>
        ${newsSentiment.topArticles.slice(0, 4).map(a => {
          const sentCls = a.sentiment === 'positive' ? 'positive' : a.sentiment === 'negative' ? 'negative' : 'neutral';
          const sentDot = a.sentiment === 'positive' ? '●' : a.sentiment === 'negative' ? '●' : '●';
          return `<div class="news-item ${a.url ? 'clickable' : ''}" data-url="${sanitize(a.url || '')}">
            <div class="news-body">
              <span class="news-dot ${sentCls}">${sentDot}</span>
              <span class="news-headline">${sanitize(a.headline)}</span>
            </div>
            <div class="news-meta">
              <span class="news-source">${sanitize(a.source)}</span>
              <span class="news-sep">·</span>
              <span class="news-time">${timeAgo(a.publishedAt)}</span>
              ${a.url ? `<svg class="news-link-icon" viewBox="0 0 12 12" fill="none"><path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>`
    : '';

  const sigHtml = signal
    ? `<div class="detail-signal">
        <div class="score-gauge-wrap">${buildGaugeSVG(signal.score)}</div>
        <div class="breakdown-list">
          ${breakdownRow('Reddit',     signal.breakdown.redditMentionSurge, 25)}
          ${breakdownRow('StockTwits', signal.breakdown.stockTwitsBullish,  20)}
          ${breakdownRow('News',       signal.breakdown.newsSentiment,      20)}
          ${breakdownRow('Earnings',   signal.breakdown.earningsBeat,       20)}
          ${breakdownRow('Upcoming',   signal.breakdown.upcomingEarnings,   15)}
        </div>
      </div>`
    : '';

  $('search-result-container').innerHTML = `<div class="detail-card">
    <div class="detail-header">
      <div class="detail-ticker-block">
        <div class="detail-ticker-line">
          <span class="detail-ticker">${sanitize(ticker)}</span>
          <span class="market-tag ${mktCls}">${mktFlag} ${sanitize(mkt)}</span>
        </div>
        ${profile?.name ? `<span class="detail-name">${sanitize(profile.name)}</span>` : ''}
        <div class="detail-meta-row">
          ${profile?.sector ? `<span class="detail-meta-chip">${sanitize(profile.sector)}</span>` : ''}
          ${profile?.exchange ? `<span class="detail-meta-chip">${sanitize(profile.exchange)}</span>` : ''}
          ${cur !== 'USD' ? `<span class="detail-meta-chip">${sanitize(cur)}</span>` : ''}
        </div>
      </div>
      <button class="add-wl-btn ${inWL ? 'in-list' : ''}" id="toggle-wl-btn" data-ticker="${sanitize(ticker)}">
        ${inWL ? '✓ Watching' : '+ Watch'}
      </button>
    </div>
    ${priceHtml}
    ${sigHtml}
    ${earningsHtml}
    ${newsHtml}
  </div>`;

  // Watchlist toggle button
  $('toggle-wl-btn').addEventListener('click', async () => {
    const t = ticker;
    if (state.watchlist.includes(t)) {
      await removeFromWatchlist(t);
      toast(`Removed ${t} from Watchlist`, 'info');
    } else {
      await addToWatchlist(t);
      toast(`Added ${t} to Watchlist`, 'success');
    }
    // Re-render button state
    const btn = $('toggle-wl-btn');
    if (btn) {
      const nowIn = state.watchlist.includes(t);
      btn.textContent = nowIn ? '✓ Watching' : '+ Watchlist';
      btn.classList.toggle('in-list', nowIn);
    }
  });

  // Open news links
  $('search-result-container').querySelectorAll('.news-item[data-url]').forEach(item => {
    const url = item.dataset.url;
    if (url) {
      item.addEventListener('click', () => chrome.tabs.create({ url }));
    }
  });
}

// ═══════════════════════════════════════════════════
// Watchlist
// ═══════════════════════════════════════════════════
async function addToWatchlist(ticker) {
  if (state.watchlist.includes(ticker)) return;
  if (state.watchlist.length >= MAX_WATCHLIST) {
    toast(`Watchlist is full (max ${MAX_WATCHLIST})`, 'error');
    return;
  }
  state.watchlist = [...state.watchlist, ticker];
  await storageSet({ watchlist: state.watchlist });
  updateWatchlistBadge();
}

async function removeFromWatchlist(ticker) {
  state.watchlist = state.watchlist.filter(t => t !== ticker);
  await storageSet({ watchlist: state.watchlist });
  updateWatchlistBadge();
}

function updateWatchlistBadge() {
  const badge = $('watchlist-badge');
  if (state.watchlist.length > 0) {
    badge.textContent = state.watchlist.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function loadWatchlist(force = false) {
  const container = $('watchlist-container');
  if (!state.watchlist.length) {
    container.innerHTML = `<div class="wl-empty">
      <div class="wl-empty-icon">⭐</div>
      <div class="wl-empty-title">Watchlist is empty</div>
      <div class="wl-empty-sub">Search for a ticker and click<br>"+ Watchlist" to track it here</div>
    </div>`;
    return;
  }

  const fresh = Date.now() - state.watchlistCacheTs < CACHE_TTL_MS;
  let stocks = null;

  if (!force && fresh && state.watchlistCache) {
    stocks = state.watchlistCache;
  } else {
    container.innerHTML = loadingHTML('Loading watchlist…');
    try {
      const res = await api(`/stocks/bulk?tickers=${state.watchlist.join(',')}`);
      stocks = res.stocks || [];
      state.watchlistCache   = stocks;
      state.watchlistCacheTs = Date.now();
    } catch (err) {
      container.innerHTML = errorHTML(`Failed to load watchlist: ${err.message}`);
      return;
    }
  }

  renderWatchlistCards(stocks);
}

function renderWatchlistCards(stocks) {
  const container = $('watchlist-container');
  if (!stocks || !stocks.length) {
    container.innerHTML = '<div class="empty-state">No data for watchlist</div>';
    return;
  }

  const actionBar = `<div class="wl-actions">
    <button class="refresh-all-btn" id="wl-refresh-btn">
      <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg>
      Refresh All
    </button>
  </div>`;

  const cards = stocks.map(s => {
    const { ticker, quote, signal } = s;
    const cls = signal ? scoreClass(signal.score) : 'red';
    const score = signal?.score ?? '—';
    const bd = signal?.breakdown;

    const barDefs = bd ? [
      { w: bd.redditMentionSurge / 25, c: 'green' },
      { w: bd.stockTwitsBullish  / 20, c: 'blue' },
      { w: bd.newsSentiment      / 20, c: 'amber' },
      { w: bd.earningsBeat       / 20, c: 'green' },
      { w: bd.upcomingEarnings   / 15, c: 'amber' },
    ] : [];
    const bars = barDefs.map(b =>
      `<div class="wl-bar ${b.w > 0 ? `filled ${b.c}` : ''}"></div>`
    ).join('');

    const chg = quote?.change ?? null;
    const chgCls = chg == null ? 'neu' : chg >= 0 ? 'pos' : 'neg';

    return `<div class="wl-card ${cls}" data-ticker="${sanitize(ticker)}">
      <div class="wl-left">
        <span class="ticker">${sanitize(ticker)}</span>
        <span class="score-badge ${cls}">${score}</span>
      </div>
      <div class="wl-mid">
        <span class="wl-label ${cls}">${signal ? sanitize(signal.label) : 'N/A'}</span>
        <div class="wl-bars">${bars}</div>
      </div>
      <div class="wl-right">
        <span class="price-text">${fmtPrice(quote?.price, quote?.currency)}</span>
        <span class="change-text ${chgCls}">${chg != null ? fmtChange(chg, quote?.changePercent, quote?.currency) : ''}</span>
      </div>
      <button class="remove-btn" data-ticker="${sanitize(ticker)}" title="Remove">✕</button>
    </div>`;
  }).join('');

  container.innerHTML = actionBar + cards;

  $('wl-refresh-btn').addEventListener('click', () => loadWatchlist(true));

  container.querySelectorAll('.wl-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.remove-btn')) return;
      goToSearch(card.dataset.ticker);
    });
  });
  container.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const t = btn.dataset.ticker;
      await removeFromWatchlist(t);
      state.watchlistCache = state.watchlistCache?.filter(s => s.ticker !== t) || null;
      toast(`Removed ${t}`, 'info');
      loadWatchlist();
    });
  });
}

// ═══════════════════════════════════════════════════
// Watchlist add-input
// ═══════════════════════════════════════════════════
function initWatchlistInput() {
  const input = $('wl-input');
  const btn   = $('wl-add-btn');

  const add = async () => {
    const t = input.value.trim().toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 10);
    if (!t) return;
    if (state.watchlist.includes(t)) { toast(`${t} is already in your Watchlist`, 'info'); return; }
    await addToWatchlist(t);
    input.value = '';
    toast(`Added ${t} to Watchlist`, 'success');
    loadWatchlist(true);
  };

  btn.addEventListener('click', add);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
}


// ═══════════════════════════════════════════════════
// Help Modal
// ═══════════════════════════════════════════════════
function initHelp() {
  $('help-btn').addEventListener('click', () => $('help-overlay').classList.remove('hidden'));
  $('help-close').addEventListener('click', () => $('help-overlay').classList.add('hidden'));
  $('help-overlay').addEventListener('click', e => {
    if (e.target === $('help-overlay')) $('help-overlay').classList.add('hidden');
  });
}

// ═══════════════════════════════════════════════════
// Auto-refresh alarm (background.js handles wakeup)
// ═══════════════════════════════════════════════════
function setupAutoRefresh() {
  if (!state.autoRefresh) return;
  chrome.alarms.create('dashboard-refresh', { periodInMinutes: 5 });
}

// ═══════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════
async function init() {
  // Load persisted prefs / data
  const saved = await storageGet({
    apiBase: DEFAULT_API,
    autoRefresh: true,
    minScore: 0,
    watchlist: [],
    searchHistory: [],
    dashboardCache: null,
    dashboardCacheTs: 0,
    watchlistCache: null,
    watchlistCacheTs: 0,
  });

  Object.assign(state, saved);

  // Wire up tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Init components
  initSearch();
  initWatchlistInput();
  initEarningsTab();
  initHelp();
  updateWatchlistBadge();
  setupAutoRefresh();

  // Show loading state immediately so screen is never blank
  setInner('signals-container',  loadingHTML('Loading signals…'));
  setInner('trending-container', loadingHTML('Loading trending…'));

  // Restore cached dashboard or load fresh
  if (state.dashboardCache) {
    renderDashboard(state.dashboardCache);
    const ts = state.dashboardCacheTs;
    if (ts) {
      const d = new Date(ts);
      $('last-updated').textContent =
        `Updated ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    }
    // Refresh in background if stale
    if (Date.now() - state.dashboardCacheTs > CACHE_TTL_MS) {
      loadDashboard(true);
    }
  } else {
    loadDashboard(true);
  }

  $('refresh-btn').addEventListener('click', () => loadDashboard(true));
}

document.addEventListener('DOMContentLoaded', init);