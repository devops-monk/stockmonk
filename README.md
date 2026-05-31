# StockMonk Chrome Extension

A dark-theme fintech Chrome extension for [StockMonk API](https://github.com/devops-monk/stockmonk-api).

**Features:**
- 🔥 Buy Signals dashboard — top stocks ranked by composite score
- 📈 Reddit trending — real-time mention counts + StockTwits sentiment
- 🔍 Stock detail search — US & UK tickers (NVDA, TSCO, BP, AZN, HSBA…)
- ⭐ Persistent Watchlist — saved in your browser, bulk-refreshed on demand
- ⚙ Settings — API URL, min score filter, auto-refresh toggle

## Install (unpacked)

1. Clone / download this repo
2. Open Chrome → `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. Click the StockMonk icon — it works immediately out of the box

## Configuration

All preferences are saved in `chrome.storage.local` (persists across sessions):

| Setting | Default | Description |
|---------|---------|-------------|
| API Base URL | `http://168.231.79.163:3003/api/v1` | Your StockMonk API server |
| UK Stocks | — | Pass TSCO, BP, AZN, SHEL, HSBA, VOD etc. — `.L` suffix optional |
| Auto-Refresh | On | Invalidates dashboard cache every 5 minutes |
| Min Signal Score | 0 | Filter signals below this score on the Dashboard |

> The API is open — no key required. Just load the extension and start using it.