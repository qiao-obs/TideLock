importScripts('../core/defaults.js');

const { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_STATS } = globalThis.__TideLockDefaults;

async function syncActionBadge() {
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.PINNED,
    ]);
    const settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
    const pinned = Array.isArray(data[STORAGE_KEYS.PINNED]) ? data[STORAGE_KEYS.PINNED] : [];

    if (!settings.enabled) {
      await chrome.action.setBadgeText({ text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ color: '#64748B' });
      return;
    }

    if (pinned.length > 0) {
      await chrome.action.setBadgeText({ text: String(Math.min(pinned.length, 99)) });
      await chrome.action.setBadgeBackgroundColor({ color: '#0284C7' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.warn('TideLock badge sync failed:', err);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const existing = await chrome.storage.local.get([
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.STATS,
    ]);
    const toWrite = {};
    if (!existing[STORAGE_KEYS.SETTINGS]) {
      toWrite[STORAGE_KEYS.SETTINGS] = { ...DEFAULT_SETTINGS };
    } else {
      toWrite[STORAGE_KEYS.SETTINGS] = {
        ...DEFAULT_SETTINGS,
        ...existing[STORAGE_KEYS.SETTINGS],
      };
    }
    if (!existing[STORAGE_KEYS.STATS]) {
      toWrite[STORAGE_KEYS.STATS] = { ...DEFAULT_STATS };
    }
    await chrome.storage.local.set(toWrite);
    await syncActionBadge();
  } catch (err) {
    console.error('TideLock onInstalled error:', err);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await syncActionBadge();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[STORAGE_KEYS.SETTINGS] || changes[STORAGE_KEYS.PINNED]) {
    await syncActionBadge();
  }
});
