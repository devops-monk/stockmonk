/* global chrome */
'use strict';

// ═══════════════════════════════════════════════════
// Constants & Defaults
// ═══════════════════════════════════════════════════
const DEFAULT_API    = 'http://168.231.79.163:3003/api/v1';
const DEFAULT_APIKEY = ''; // Set your API key in Settings (gear icon)
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
  apiKey: DEFAULT_APIKEY,
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
  const headers = {};
  if (state.apiKey) headers['x-api-key'] = state.apiKey;
  const res = await fetch(`${state.apiBase}${path}`, { headers });
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

function fmtPrice(p) {
  if (p == null) return '—';
  return '$' + Number(p).toFixed(2);
}
function fmtChange(change, pct) {
  if (change == null) return '';
  const sign = change >= 0 ? '+' : '';
  const pc   = pct != null ? ` (${sign}${Number(pct).toFixed(2)}%)` : '';
  return `${sign}${Number(change).toFixed(2)}${pc}`;
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
  renderSignals(signals?.signals ?? []);
  renderTrending(trending?.stocks ?? []);
}

function renderSignals(signals) {
  const container = $('signals-container');
  if (!signals.length) {
    container.innerHTML = '<div class="empty-state">No signals found — try lowering the min score in Settings</div>';
    return;
  }

  container.innerHTML = signals.map(s => {
    const cls = scoreClass(s.score);
    const bd  = s.breakdown;
    const bars = [
      { w: bd.redditMentionSurge / 25, cls: '' },
      { w: bd.stockTwitsBullish  / 20, cls: 'blue' },
      { w: bd.newsSentiment      / 20, cls: '' },
      { w: bd.earningsBeat       / 20, cls: '' },
      { w: bd.upcomingEarnings   / 15, cls: '' },
    ].map(b => `<div class="mini-bar ${b.cls}" style="width:${Math.max(1, b.w*100)}%"></div>`).join('');

    return `<div class="signal-card ${cls}" data-ticker="${sanitize(s.ticker)}">
      <div class="signal-left">
        <span class="ticker">${sanitize(s.ticker)}</span>
        <span class="score-badge ${cls}">${s.score}</span>
      </div>
      <div class="signal-right">
        <span class="signal-label ${cls}">${sanitize(s.label)}</span>
        <div class="mini-breakdown">${bars}</div>
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
  container.innerHTML = stocks.map(s => {
    const delta = s.mentionsDelta24h;
    const deltaEl = delta
      ? `<span class="delta ${delta.startsWith('+') ? 'green' : 'red'}">${sanitize(delta)}</span>`
      : '';
    const st = s.stockTwits;
    let sentimentEl = '';
    if (st) {
      const cls = st.sentimentLabel === 'Bullish' ? 'bull' : st.sentimentLabel === 'Bearish' ? 'bear' : 'neu';
      sentimentEl = `<span class="sentiment-pill ${cls}">${sanitize(st.sentimentLabel)}</span>`;
    }
    return `<div class="trending-item" data-ticker="${sanitize(s.ticker)}">
      <span class="trend-rank">#${s.rank}</span>
      <div class="trend-info">
        <span class="ticker">${sanitize(s.ticker)}</span>
        ${s.name ? `<span class="trend-name">${sanitize(s.name)}</span>` : ''}
      </div>
      <div class="trend-stats">
        <span class="mention-count">${Number(s.mentions).toLocaleString()} mentions</span>
        ${deltaEl}
      </div>
      ${sentimentEl}
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

  const priceHtml = quote
    ? (() => {
        const chg = Number(quote.change ?? 0);
        const cls = chg >= 0 ? 'pos' : 'neg';
        return `<div class="detail-price-row">
          <span class="detail-price">${fmtPrice(quote.price)}</span>
          <span class="detail-change ${cls}">${fmtChange(quote.change, quote.changePercent)}</span>
        </div>
        <div class="detail-price-sub">
          <div class="price-meta-item"><span class="price-meta-label">Open</span><span class="price-meta-val">${fmtPrice(quote.open)}</span></div>
          <div class="price-meta-item"><span class="price-meta-label">High</span><span class="price-meta-val">${fmtPrice(quote.high)}</span></div>
          <div class="price-meta-item"><span class="price-meta-label">Low</span><span class="price-meta-val">${fmtPrice(quote.low)}</span></div>
          <div class="price-meta-item"><span class="price-meta-label">Prev Close</span><span class="price-meta-val">${fmtPrice(quote.prevClose)}</span></div>
        </div>`;
      })()
    : '<div class="detail-price-row"><span class="detail-price" style="color:var(--text-muted)">Price N/A</span></div>';

  const earningsHtml = nextEarnings
    ? `<div class="detail-earnings">
        <span class="earnings-icon">📅</span>
        <span class="earnings-text">Next earnings: ${sanitize(nextEarnings.reportDate)} <span style="color:var(--text-muted)">(${sanitize(nextEarnings.reportTime?.toUpperCase() ?? '?')})</span></span>
        <span class="earnings-countdown">${nextEarnings.daysUntil}d away</span>
      </div>`
    : '';

  const newsHtml = (newsSentiment?.topArticles?.length)
    ? `<div class="detail-news">
        <div class="news-title">Latest News · Sentiment: <span style="color:${newsSentiment.score >= 60 ? 'var(--green)' : newsSentiment.score <= 40 ? 'var(--red)' : 'var(--amber)'}">${sanitize(newsSentiment.label)}</span></div>
        ${newsSentiment.topArticles.slice(0, 4).map(a => {
          const sentCls = a.sentiment === 'positive' ? 'positive' : a.sentiment === 'negative' ? 'negative' : 'neutral';
          return `<div class="news-item" data-url="${sanitize(a.url || '')}">
            <span class="news-headline">${sanitize(a.headline)}</span>
            <div class="news-meta">
              <span class="news-source">${sanitize(a.source)}</span>
              <span class="news-time">· ${timeAgo(a.publishedAt)}</span>
              <span class="news-sentiment ${sentCls}">${sentCls}</span>
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
      <div class="detail-ticker-row">
        <span class="detail-ticker">${sanitize(ticker)}</span>
        ${profile?.name ? `<span class="detail-name">${sanitize(profile.name)}</span>` : ''}
        ${profile?.exchange ? `<span class="detail-exchange">${sanitize(profile.exchange)}</span>` : ''}
      </div>
      <button class="add-wl-btn ${inWL ? 'in-list' : ''}" id="toggle-wl-btn" data-ticker="${sanitize(ticker)}">
        ${inWL ? '✓ Watching' : '+ Watchlist'}
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

    const bars = bd
      ? [
          { w: bd.redditMentionSurge / 25 },
          { w: bd.stockTwitsBullish  / 20 },
          { w: bd.newsSentiment      / 20 },
          { w: bd.earningsBeat       / 20 },
          { w: bd.upcomingEarnings   / 15 },
        ].map(b => `<div class="wl-score-bar" style="width:${Math.max(2, b.w*100)}%;background:${b.w > 0.5 ? 'var(--green)' : 'var(--text-muted)'}"></div>`).join('')
      : '';

    const chg = quote?.change ?? null;
    const chgCls = chg == null ? 'neu' : chg >= 0 ? 'pos' : 'neg';

    return `<div class="wl-card ${cls}" data-ticker="${sanitize(ticker)}">
      <div class="wl-left">
        <span class="ticker">${sanitize(ticker)}</span>
        <span class="score-badge ${cls}">${score}</span>
      </div>
      <div class="wl-mid">
        <span class="wl-label ${cls}">${signal ? sanitize(signal.label) : 'N/A'}</span>
        <div class="wl-score-breakdown">${bars}</div>
      </div>
      <div class="wl-right">
        <span class="price-text">${fmtPrice(quote?.price)}</span>
        <span class="change-text ${chgCls}">${chg != null ? fmtChange(chg, quote?.changePercent) : ''}</span>
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
// Settings
// ═══════════════════════════════════════════════════
function initSettings() {
  $('settings-btn').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-overlay').addEventListener('click', e => {
    if (e.target === $('settings-overlay')) closeSettings();
  });

  const slider = $('setting-min-score');
  slider.addEventListener('input', () => {
    $('setting-min-score-val').textContent = slider.value;
  });

  $('settings-save').addEventListener('click', saveSettings);
  $('settings-clear').addEventListener('click', clearAllData);
}

function openSettings() {
  $('setting-api-url').value         = state.apiBase;
  $('setting-api-key').value         = state.apiKey;
  $('setting-auto-refresh').checked  = state.autoRefresh;
  $('setting-min-score').value       = state.minScore;
  $('setting-min-score-val').textContent = state.minScore;
  $('settings-overlay').classList.remove('hidden');
}
function closeSettings() {
  $('settings-overlay').classList.add('hidden');
}

async function saveSettings() {
  const apiBase     = $('setting-api-url').value.trim().replace(/\/+$/, '');
  const apiKey      = $('setting-api-key').value.trim();
  const autoRefresh = $('setting-auto-refresh').checked;
  const minScore    = parseInt($('setting-min-score').value, 10);

  state.apiBase     = apiBase || DEFAULT_API;
  state.apiKey      = apiKey || DEFAULT_APIKEY;
  state.autoRefresh = autoRefresh;
  state.minScore    = minScore;

  await storageSet({ apiBase: state.apiBase, apiKey: state.apiKey, autoRefresh, minScore });
  closeSettings();
  toast('Settings saved', 'success');
  // Reset cache so next load uses new settings
  state.dashboardCache   = null;
  state.dashboardCacheTs = 0;
  if (state.tab === 'dashboard') loadDashboard(true);
}

async function clearAllData() {
  if (!confirm('Clear all stored data including Watchlist and Search History?')) return;
  await storageSet({
    watchlist: [], searchHistory: [],
    dashboardCache: null, dashboardCacheTs: 0,
    watchlistCache: null, watchlistCacheTs: 0,
  });
  state.watchlist      = [];
  state.searchHistory  = [];
  state.dashboardCache = null;
  state.watchlistCache = null;
  updateWatchlistBadge();
  closeSettings();
  toast('All data cleared', 'info');
  loadDashboard(true);
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
    apiKey: DEFAULT_APIKEY,
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
  initSettings();
  updateWatchlistBadge();
  setupAutoRefresh();

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