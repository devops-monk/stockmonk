/* global chrome */
'use strict';

// Listen for the periodic alarm and bust the dashboard cache
// so the next popup open triggers a fresh fetch.
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'dashboard-refresh') {
    chrome.storage.local.set({ dashboardCacheTs: 0, watchlistCacheTs: 0 });
  }
});