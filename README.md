# StockMonk Chrome Extension

A dark-theme fintech Chrome extension for [StockMonk API](https://github.com/devops-monk/stockmonk-api).

**Features:**
- 🔥 Buy Signals dashboard — top stocks ranked by composite score
- 📈 Reddit trending — real-time mention counts + StockTwits sentiment
- 🔍 Stock detail search — price, signal gauge, news, earnings countdown
- ⭐ Persistent Watchlist — saved in your browser, bulk-refreshed on demand
- ⚙ Settings — API URL, API key, min score filter, auto-refresh toggle

## Install (unpacked)

1. Clone / download this repo
2. Open Chrome → `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. Click the StockMonk icon → open Settings → enter your **API key**

## Configuration

All preferences are saved in `chrome.storage.local` (persists across sessions):

| Setting | Default | Description |
|---------|---------|-------------|
| API Base URL | `http://168.231.79.163:3003/api/v1` | Your StockMonk API server |
| API Key | *(empty)* | `x-api-key` header — required for all `/api/v1/*` endpoints |
| Auto-Refresh | On | Invalidates dashboard cache every 5 minutes |
| Min Signal Score | 0 | Filter signals below this score on the Dashboard |

> **Security:** Never commit your API key. Enter it through the Settings panel after loading the extension.