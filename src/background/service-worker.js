importScripts('../core/defaults.js', '../core/feed-engine.js');

const { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_STATS, MSG } = globalThis.__TideLockDefaults;
const E = globalThis.__TideLockEngine;

const CTX_PIN_ID = 'tidelock-pin-video-link';

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

async function setupContextMenus() {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: CTX_PIN_ID,
      title: chrome.i18n.getMessage('ctxPinVideo') || 'Pin video to TideLock queue',
      contexts: ['link'],
      documentUrlPatterns: ['https://www.youtube.com/*'],
      targetUrlPatterns: [
        'https://www.youtube.com/watch*',
        'https://www.youtube.com/shorts/*',
        'https://youtu.be/*',
      ],
    });
  } catch (err) {
    console.warn('TideLock contextMenu setup warning:', err);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const existing = await chrome.storage.local.get([
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.STATS,
    ]);
    const toWrite = {};
    toWrite[STORAGE_KEYS.SETTINGS] = {
      ...DEFAULT_SETTINGS,
      ...(existing[STORAGE_KEYS.SETTINGS] || {}),
    };
    toWrite[STORAGE_KEYS.STATS] = {
      ...DEFAULT_STATS,
      ...(existing[STORAGE_KEYS.STATS] || {}),
    };
    await chrome.storage.local.set(toWrite);
    await setupContextMenus();
    await syncActionBadge();
  } catch (err) {
    console.error('TideLock onInstalled error:', err);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await syncActionBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CTX_PIN_ID || !info.linkUrl) return;
  const videoId = E.extractVideoIdFromUrl(info.linkUrl);
  if (!videoId) return;

  // Send to active YouTube tab so content script can enrich title & show user confirmation toast!
  if (tab && tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: MSG.PIN_VIDEO_EXTERNAL,
        url: info.linkUrl,
        videoId,
      });
      return;
    } catch {
      // Fallback: save directly into storage
    }
  }

  const data = await chrome.storage.local.get([STORAGE_KEYS.PINNED]);
  const pinned = Array.isArray(data[STORAGE_KEYS.PINNED]) ? data[STORAGE_KEYS.PINNED] : [];
  if (!pinned.some((p) => p.videoId === videoId)) {
    const next = [
      {
        videoId,
        title: `YouTube (${videoId})`,
        displayTitle: `YouTube (${videoId})`,
        originalTitle: `YouTube (${videoId})`,
        channel: '',
        duration: '',
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        pinnedAt: Date.now(),
      },
      ...pinned,
    ].slice(0, 80);
    await chrome.storage.local.set({ [STORAGE_KEYS.PINNED]: next });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-drawer') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      await chrome.tabs.sendMessage(tab.id, { type: MSG.TOGGLE_DRAWER });
    }
  } catch {
    // Active tab is not a YouTube page
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[STORAGE_KEYS.SETTINGS] || changes[STORAGE_KEYS.PINNED]) {
    await syncActionBadge();
  }
});
