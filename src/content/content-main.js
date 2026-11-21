(function () {
  'use strict';

  if (window.__tidelockContentMainInstalled) return;
  window.__tidelockContentMainInstalled = true;

  const D = globalThis.__TideLockDefaults;
  const E = globalThis.__TideLockEngine;
  if (!D || !E) return;

  const { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_STATS, BRIDGE_CHANNEL, MSG } = D;

  function t(key, fallback) {
    try {
      const msg = chrome.i18n.getMessage(key);
      return msg || fallback || key;
    } catch {
      return fallback || key;
    }
  }

  function isZhLocale() {
    try {
      return (chrome.i18n.getUILanguage() || '').toLowerCase().startsWith('zh');
    } catch {
      return false;
    }
  }

  function formatRelativeTime(ts) {
    if (!ts) return '';
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    const zh = isZhLocale();
    if (diffSec < 60) return zh ? '刚刚' : 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return zh ? `${diffMin} 分钟前` : `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return zh ? `${diffHr} 小时前` : `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return zh ? `${diffDay} 天前` : `${diffDay}d ago`;
  }

  // ---- Runtime State ----
  let settings = { ...DEFAULT_SETTINGS };
  let stats = { ...DEFAULT_STATS };
  let snapshots = [];
  let pinned = [];
  let watchedSet = new Set();

  let currentFeedId = null;
  let liveHomeScrollY = 0;
  let savedAnchor = { scrollY: 0, videoId: null, savedAt: 0 };
  let scrollRafPending = false;
  let decorateScheduled = false;
  let userCancelledScrollRestore = false;

  // UI state inside Shadow DOM
  let shadowRoot = null;
  let uiHost = null;
  let dockEl = null;
  let drawerOpen = false;
  let drawerTab = 'snapshots'; // 'snapshots' | 'pinned'
  let selectedSnapshotIdx = 0;
  let filterMode = 'all'; // 'all' | 'unwatched' | 'watched'
  let searchQuery = '';
  let toastTimer = null;

  // ---- Bridge to MAIN World ----
  function sendToMain(type, payload = {}) {
    try {
      window.postMessage(
        {
          channel: BRIDGE_CHANNEL,
          direction: 'ISOLATED_TO_MAIN',
          type,
          payload,
        },
        window.location.origin
      );
    } catch {
      // Ignore if window unavailable
    }
  }

  // ---- Storage Helpers ----
  async function loadAllState() {
    try {
      const data = await chrome.storage.local.get([
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.SNAPSHOTS,
        STORAGE_KEYS.PINNED,
        STORAGE_KEYS.WATCHED,
        STORAGE_KEYS.STATS,
        STORAGE_KEYS.SCROLL_STATE,
      ]);
      settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
      stats = { ...DEFAULT_STATS, ...(data[STORAGE_KEYS.STATS] || {}) };
      snapshots = Array.isArray(data[STORAGE_KEYS.SNAPSHOTS]) ? data[STORAGE_KEYS.SNAPSHOTS] : [];
      pinned = Array.isArray(data[STORAGE_KEYS.PINNED]) ? data[STORAGE_KEYS.PINNED] : [];
      const watchedArr = Array.isArray(data[STORAGE_KEYS.WATCHED]) ? data[STORAGE_KEYS.WATCHED] : [];
      watchedSet = new Set(watchedArr);
      if (data[STORAGE_KEYS.SCROLL_STATE]) {
        savedAnchor = { ...savedAnchor, ...data[STORAGE_KEYS.SCROLL_STATE] };
      }

      sendToMain(MSG.SYNC_SETTINGS, settings);
      updateDockVisibility();
      renderDockState();
      if (drawerOpen) renderDrawerBody();
      scheduleDecorateHomeCards();
    } catch {
      // Ignore transient storage errors during context invalidation
    }
  }

  async function saveSnapshots(nextSnapshots) {
    snapshots = nextSnapshots;
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.SNAPSHOTS]: snapshots });
    } catch {}
    renderDockState();
    if (drawerOpen) renderDrawerBody();
  }

  async function savePinned(nextPinned) {
    pinned = nextPinned;
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.PINNED]: pinned });
    } catch {}
    renderDockState();
    if (drawerOpen) renderDrawerBody();
    scheduleDecorateHomeCards();
  }

  async function markVideoWatched(videoId) {
    if (!videoId) return;
    watchedSet.add(videoId);
    const arr = Array.from(watchedSet).slice(-300);
    watchedSet = new Set(arr);
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.WATCHED]: arr });
    } catch {}
    scheduleDecorateHomeCards();
    if (drawerOpen) renderDrawerBody();
  }

  async function incrementStat(key) {
    stats = {
      ...stats,
      [key]: (stats[key] || 0) + 1,
      lastRestoredAt: key === 'refreshesBlocked' ? Date.now() : stats.lastRestoredAt,
    };
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
    } catch {}
  }

  async function persistScrollAnchor(anchor) {
    savedAnchor = { ...anchor, savedAt: Date.now() };
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.SCROLL_STATE]: savedAnchor });
    } catch {}
  }

  async function togglePinVideo(card) {
    if (!card || !card.videoId) return;
    const exists = pinned.some((p) => p.videoId === card.videoId);
    let next;
    if (exists) {
      next = pinned.filter((p) => p.videoId !== card.videoId);
      showToast(t('pinRemoved', 'Removed from pinned'), false);
    } else {
      next = [
        {
          videoId: card.videoId,
          title: card.title || card.videoId,
          channel: card.channel || '',
          duration: card.duration || '',
          views: card.views || '',
          thumbnail: card.thumbnail || `https://i.ytimg.com/vi/${card.videoId}/hqdefault.jpg`,
          url: card.url || `https://www.youtube.com/watch?v=${card.videoId}`,
          pinnedAt: Date.now(),
        },
        ...pinned.filter((p) => p.videoId !== card.videoId),
      ].slice(0, 60);
      showToast(t('pinAdded', 'Pinned to TideLock'), false);
    }
    await savePinned(next);
  }

  // ---- Scroll Tracking & Precision Restoration ----
  function onScrollPassive() {
    if (!E.isHomePath(window.location.pathname)) return;
    if (scrollRafPending) return;
    scrollRafPending = true;
    requestAnimationFrame(() => {
      scrollRafPending = false;
      if (E.isHomePath(window.location.pathname)) {
        liveHomeScrollY = window.scrollY || 0;
      }
    });
  }

  window.addEventListener('scroll', onScrollPassive, { passive: true });
  window.addEventListener(
    'wheel',
    () => {
      userCancelledScrollRestore = true;
    },
    { passive: true }
  );
  window.addEventListener(
    'touchstart',
    () => {
      userCancelledScrollRestore = true;
    },
    { passive: true }
  );

  function restoreHomeScrollPosition() {
    if (!settings.restoreScroll) return;
    const targetY = savedAnchor.scrollY || 0;
    const targetVid = savedAnchor.videoId;
    if (targetY < 40 && !targetVid) return;

    userCancelledScrollRestore = false;
    const startTime = Date.now();
    let restoredOnce = false;

    const attempt = () => {
      if (userCancelledScrollRestore || !E.isHomePath(window.location.pathname)) return;
      if (Date.now() - startTime > 2600) return;

      const browse = document.querySelector('ytd-browse[page-subtype="home"]');
      const isVisible = browse && !browse.hasAttribute('hidden');
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      if (isVisible && maxScroll >= Math.min(targetY, 160)) {
        if (targetVid) {
          const anchorLink = browse.querySelector(
            `a[href*="/watch?v=${CSS.escape(targetVid)}"], a[href*="/shorts/${CSS.escape(targetVid)}"]`
          );
          if (anchorLink) {
            const rect = anchorLink.getBoundingClientRect();
            const docTop = rect.top + window.scrollY;
            const desiredY = Math.max(0, docTop - Math.round(window.innerHeight * 0.28));
            const finalY = Math.abs(desiredY - targetY) < 260 ? targetY : desiredY;
            window.scrollTo({ top: finalY, behavior: 'instant' });
            if (!restoredOnce) {
              restoredOnce = true;
              incrementStat('scrollsRestored');
            }
            return;
          }
        }

        if (maxScroll >= targetY - 120) {
          window.scrollTo({ top: targetY, behavior: 'instant' });
          if (!restoredOnce) {
            restoredOnce = true;
            incrementStat('scrollsRestored');
          }
          if (Date.now() - startTime > 500) return;
        }
      }

      setTimeout(() => requestAnimationFrame(attempt), 80);
    };

    requestAnimationFrame(attempt);
  }

  // ---- DOM Extraction & Card Decoration (Batched via rAF) ----
  function extractCardInfoFromDomElement(itemEl) {
    if (!(itemEl instanceof Element)) return null;
    const link = itemEl.querySelector(
      'a#video-title-link[href*="/watch?"], a.yt-lockup-metadata-view-model__title[href*="/watch?"], a[href*="/watch?v="], a[href*="/shorts/"]'
    );
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const videoId = E.extractVideoIdFromUrl(href);
    if (!videoId) return null;

    const titleEl =
      itemEl.querySelector('#video-title') ||
      itemEl.querySelector('.yt-lockup-metadata-view-model__title') ||
      itemEl.querySelector('h3 a') ||
      link;
    const title = (titleEl?.textContent || link.getAttribute('title') || '').trim();
    if (!title) return null;

    const channelEl =
      itemEl.querySelector('ytd-channel-name #text') ||
      itemEl.querySelector('.yt-content-metadata-view-model__metadata-row a') ||
      itemEl.querySelector('.yt-content-metadata-view-model__metadata-row span');
    const channel = (channelEl?.textContent || '').trim();

    const durEl =
      itemEl.querySelector('ytd-thumbnail-overlay-time-status-renderer #text') ||
      itemEl.querySelector('badge-shape .badge-shape-wiz__text') ||
      itemEl.querySelector('.yt-badge-shape__text');
    const duration = (durEl?.textContent || '').trim();

    const isShort = href.includes('/shorts/');
    return {
      videoId,
      title,
      channel,
      duration,
      views: '',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: isShort
        ? `https://www.youtube.com/shorts/${videoId}`
        : `https://www.youtube.com/watch?v=${videoId}`,
      isShort,
    };
  }

  function findCardThumbnailHost(itemEl) {
    return (
      itemEl.querySelector('ytd-thumbnail') ||
      itemEl.querySelector('yt-thumbnail-view-model') ||
      itemEl.querySelector('a.yt-lockup-view-model__content-image') ||
      itemEl.querySelector('a#thumbnail')
    );
  }

  function scheduleDecorateHomeCards() {
    if (decorateScheduled) return;
    if (!E.isHomePath(window.location.pathname)) return;
    decorateScheduled = true;
    requestAnimationFrame(() => {
      decorateScheduled = false;
      decorateHomeCardsBatched();
    });
  }

  async function decorateHomeCardsBatched() {
    if (!E.isHomePath(window.location.pathname)) return;
    const browse = document.querySelector('ytd-browse[page-subtype="home"]');
    if (!browse || browse.hasAttribute('hidden')) return;

    const items = Array.from(browse.querySelectorAll('ytd-rich-item-renderer'));
    if (items.length === 0) return;

    const pinnedIds = new Set(pinned.map((p) => p.videoId));
    const domCards = [];
    const BATCH = 20;

    for (let i = 0; i < items.length; i += BATCH) {
      const slice = items.slice(i, i + BATCH);
      await new Promise((resolve) =>
        requestAnimationFrame(() => {
          for (const itemEl of slice) {
            const card = extractCardInfoFromDomElement(itemEl);
            if (!card) continue;
            domCards.push(card);

            const thumbHost = findCardThumbnailHost(itemEl);
            if (!thumbHost) continue;
            thumbHost.classList.add('tidelock-card-host');

            // 1) Watched badge
            let badge = thumbHost.querySelector(':scope > .tidelock-watched-badge');
            const shouldShowWatched = settings.markWatched && watchedSet.has(card.videoId);
            if (shouldShowWatched) {
              if (!badge) {
                badge = document.createElement('div');
                badge.className = 'tidelock-watched-badge';
                const dot = document.createElement('span');
                dot.className = 'tidelock-watched-dot';
                const label = document.createElement('span');
                label.textContent = t('badgeWatched', 'Watched');
                badge.appendChild(dot);
                badge.appendChild(label);
                thumbHost.appendChild(badge);
              }
            } else if (badge) {
              badge.remove();
            }

            // 2) Hover Quick-Pin button
            let pinBtn = thumbHost.querySelector(':scope > .tidelock-pin-btn');
            const isPinned = pinnedIds.has(card.videoId);
            if (!pinBtn) {
              pinBtn = document.createElement('button');
              pinBtn.type = 'button';
              pinBtn.className = 'tidelock-pin-btn';
              pinBtn.textContent = '📌';
              pinBtn.title = isZhLocale() ? '暂存到 TideLock 待看栏' : 'Pin to TideLock queue';
              pinBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                ev.stopImmediatePropagation();
                const latestCard = extractCardInfoFromDomElement(itemEl) || card;
                togglePinVideo(latestCard);
              });
              thumbHost.appendChild(pinBtn);
            }
            pinBtn.setAttribute('data-pinned', isPinned ? 'true' : 'false');
          }
          resolve();
        })
      );
      if (typeof globalThis.scheduler !== 'undefined' && globalThis.scheduler.yield) {
        await globalThis.scheduler.yield();
      }
    }

    // Enrich snapshot vault with DOM-observed titles (reflects DeArrow / Anti-Translate)
    if (domCards.length >= 4 && E.isHomePath(window.location.pathname)) {
      const merged = E.mergeSnapshotVault(
        snapshots,
        {
          feedId: currentFeedId || `dom_${Date.now()}`,
          updatedAt: Date.now(),
          scrollY: liveHomeScrollY,
          videos: domCards,
        },
        settings.maxSnapshots
      );
      // Only write if count changed or first snapshot didn't exist
      const prevCount = snapshots[0]?.videos?.length || 0;
      const nextCount = merged[0]?.videos?.length || 0;
      if (snapshots.length === 0 || nextCount !== prevCount) {
        await saveSnapshots(merged);
      }
    }
  }

  // ---- Shadow DOM UI (Floating Dock + Snapshot Drawer + Toast — Pure DOM APIs) ----
  const SHADOW_CSS = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Roboto, sans-serif;
      --tl-bg: rgba(255, 255, 255, 0.92);
      --tl-bg-solid: #ffffff;
      --tl-surface: #f1f5f9;
      --tl-surface-hover: #e2e8f0;
      --tl-text: #0f172a;
      --tl-text-muted: #475569;
      --tl-border: rgba(15, 23, 42, 0.12);
      --tl-accent: #0284c7;
      --tl-accent-soft: rgba(2, 132, 199, 0.12);
      --tl-coral: #e11d48;
      --tl-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
    }

    :host([data-theme="dark"]) {
      --tl-bg: rgba(15, 23, 42, 0.9);
      --tl-bg-solid: #0f172a;
      --tl-surface: #1e293b;
      --tl-surface-hover: #334155;
      --tl-text: #f8fafc;
      --tl-text-muted: #94a3b8;
      --tl-border: rgba(248, 250, 252, 0.14);
      --tl-accent: #38bdf8;
      --tl-accent-soft: rgba(56, 189, 248, 0.16);
      --tl-coral: #fb7185;
      --tl-shadow: 0 14px 36px rgba(0, 0, 0, 0.52);
    }

    .tl-dock {
      position: fixed;
      right: 18px;
      bottom: 20px;
      z-index: 2147483000;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border-radius: 999px;
      background: var(--tl-bg);
      border: 1px solid var(--tl-border);
      box-shadow: var(--tl-shadow);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }

    .tl-dock[hidden] {
      display: none !important;
    }

    .tl-dock-main {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 30px;
      padding: 0 12px;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: var(--tl-text);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .tl-dock-main:hover {
      background: var(--tl-surface);
    }

    .tl-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--tl-accent);
      box-shadow: 0 0 0 3px var(--tl-accent-soft);
      flex-shrink: 0;
    }

    .tl-dot[data-paused="true"] {
      background: #94a3b8;
      box-shadow: none;
    }

    .tl-pill-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      background: var(--tl-accent-soft);
      color: var(--tl-accent);
      font-size: 11px;
      font-weight: 700;
    }

    .tl-dock-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--tl-text-muted);
      font-size: 14px;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .tl-dock-icon-btn:hover {
      background: var(--tl-surface);
      color: var(--tl-text);
    }

    /* Toast */
    .tl-toast {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%) translateY(16px);
      z-index: 2147483002;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 9px 14px;
      border-radius: 999px;
      background: var(--tl-bg);
      color: var(--tl-text);
      border: 1px solid var(--tl-border);
      box-shadow: var(--tl-shadow);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      font-size: 13px;
      font-weight: 500;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s ease, transform 0.22s ease;
    }

    .tl-toast[data-visible="true"] {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }

    .tl-toast-btn {
      padding: 4px 10px;
      border: none;
      border-radius: 999px;
      background: var(--tl-accent-soft);
      color: var(--tl-accent);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .tl-toast-btn:hover {
      background: var(--tl-accent);
      color: #ffffff;
    }

    /* Slide-over Drawer */
    .tl-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483005;
      background: rgba(2, 6, 23, 0.36);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }

    .tl-backdrop[data-open="true"] {
      opacity: 1;
      pointer-events: auto;
    }

    .tl-drawer {
      position: fixed;
      top: 12px;
      right: 12px;
      bottom: 12px;
      width: min(410px, calc(100vw - 24px));
      z-index: 2147483006;
      display: flex;
      flex-direction: column;
      border-radius: 16px;
      background: var(--tl-bg-solid);
      color: var(--tl-text);
      border: 1px solid var(--tl-border);
      box-shadow: var(--tl-shadow);
      transform: translateX(calc(100% + 24px));
      transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
      overflow: hidden;
    }

    .tl-drawer[data-open="true"] {
      transform: translateX(0);
    }

    .tl-drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid var(--tl-border);
    }

    .tl-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .tl-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tl-btn-sm {
      height: 28px;
      padding: 0 10px;
      border: 1px solid var(--tl-border);
      border-radius: 8px;
      background: var(--tl-surface);
      color: var(--tl-text);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .tl-btn-sm:hover {
      background: var(--tl-surface-hover);
    }

    .tl-close-btn {
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--tl-text-muted);
      font-size: 16px;
      cursor: pointer;
    }

    .tl-close-btn:hover {
      background: var(--tl-surface);
      color: var(--tl-text);
    }

    .tl-tabs {
      display: flex;
      gap: 6px;
      padding: 10px 16px 0;
    }

    .tl-tab {
      flex: 1;
      height: 32px;
      border: none;
      border-radius: 9px;
      background: var(--tl-surface);
      color: var(--tl-text-muted);
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .tl-tab[data-active="true"] {
      background: var(--tl-accent-soft);
      color: var(--tl-accent);
    }

    .tl-controls {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--tl-border);
    }

    .tl-snap-pills,
    .tl-filter-row {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .tl-chip {
      flex-shrink: 0;
      height: 25px;
      padding: 0 10px;
      border: 1px solid var(--tl-border);
      border-radius: 999px;
      background: transparent;
      color: var(--tl-text-muted);
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
    }

    .tl-chip[data-active="true"] {
      background: var(--tl-accent);
      border-color: var(--tl-accent);
      color: #ffffff;
    }

    .tl-search {
      width: 100%;
      box-sizing: border-box;
      height: 32px;
      padding: 0 11px;
      border: 1px solid var(--tl-border);
      border-radius: 9px;
      background: var(--tl-surface);
      color: var(--tl-text);
      font-size: 12.5px;
      outline: none;
    }

    .tl-search:focus {
      border-color: var(--tl-accent);
    }

    .tl-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .tl-card {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 8px;
      border-radius: 11px;
      background: transparent;
      border: 1px solid transparent;
      text-decoration: none;
      color: inherit;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }

    .tl-card:hover {
      background: var(--tl-surface);
      border-color: var(--tl-border);
    }

    .tl-thumb-wrap {
      position: relative;
      width: 118px;
      height: 66px;
      border-radius: 8px;
      overflow: hidden;
      background: #1e293b;
      flex-shrink: 0;
    }

    .tl-thumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .tl-dur {
      position: absolute;
      right: 4px;
      bottom: 4px;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      font-size: 10px;
      font-weight: 600;
    }

    .tl-meta {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .tl-title {
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.35;
      color: var(--tl-text);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .tl-sub {
      font-size: 11px;
      color: var(--tl-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tl-tags {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tl-tag-watched {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--tl-accent-soft);
      color: var(--tl-accent);
      font-size: 10px;
      font-weight: 600;
    }

    .tl-card-pin {
      width: 26px;
      height: 26px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: var(--tl-text-muted);
      font-size: 13px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .tl-card-pin:hover,
    .tl-card-pin[data-pinned="true"] {
      background: var(--tl-accent-soft);
      color: var(--tl-accent);
    }

    .tl-empty {
      padding: 36px 18px;
      text-align: center;
      color: var(--tl-text-muted);
      font-size: 13px;
      line-height: 1.6;
    }
  `;

  function syncThemeAttr() {
    if (!uiHost) return;
    const isDark =
      document.documentElement.hasAttribute('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches &&
        getComputedStyle(document.documentElement).backgroundColor === 'rgb(15, 15, 15)';
    uiHost.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }

  function ensureShadowUi() {
    if (shadowRoot) return;
    if (!document.body) return;

    uiHost = document.createElement('div');
    uiHost.id = 'tidelock-shadow-host';
    shadowRoot = uiHost.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = SHADOW_CSS;
    shadowRoot.appendChild(styleEl);

    // 1) Floating Dock
    dockEl = document.createElement('div');
    dockEl.className = 'tl-dock';

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'tl-dock-main';
    mainBtn.id = 'tl-dock-main';

    const dot = document.createElement('span');
    dot.className = 'tl-dot';
    dot.id = 'tl-dock-dot';

    const label = document.createElement('span');
    label.id = 'tl-dock-label';
    label.textContent = isZhLocale() ? '首页快照' : 'TideLock';

    const countPill = document.createElement('span');
    countPill.className = 'tl-pill-count';
    countPill.id = 'tl-dock-count';
    countPill.hidden = true;

    mainBtn.appendChild(dot);
    mainBtn.appendChild(label);
    mainBtn.appendChild(countPill);
    mainBtn.addEventListener('click', () => setDrawerOpen(!drawerOpen));

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'tl-dock-icon-btn';
    refreshBtn.id = 'tl-dock-refresh';
    refreshBtn.textContent = '↻';
    refreshBtn.title = t('btnRefreshFeed', 'Refresh Feed Now');
    refreshBtn.addEventListener('click', () => {
      sendToMain(MSG.FORCE_REFRESH);
    });

    dockEl.appendChild(mainBtn);
    dockEl.appendChild(refreshBtn);
    shadowRoot.appendChild(dockEl);

    // 2) Toast
    const toastEl = document.createElement('div');
    toastEl.className = 'tl-toast';
    toastEl.id = 'tl-toast';
    const toastText = document.createElement('span');
    toastText.id = 'tl-toast-text';
    const toastBtn = document.createElement('button');
    toastBtn.type = 'button';
    toastBtn.className = 'tl-toast-btn';
    toastBtn.id = 'tl-toast-btn';
    toastBtn.textContent = t('toastRefreshAction', 'Refresh');
    toastBtn.addEventListener('click', () => {
      hideToast();
      sendToMain(MSG.FORCE_REFRESH);
    });
    toastEl.appendChild(toastText);
    toastEl.appendChild(toastBtn);
    shadowRoot.appendChild(toastEl);

    // 3) Drawer Backdrop + Drawer
    const backdrop = document.createElement('div');
    backdrop.className = 'tl-backdrop';
    backdrop.id = 'tl-backdrop';
    backdrop.addEventListener('click', () => setDrawerOpen(false));
    shadowRoot.appendChild(backdrop);

    const drawer = document.createElement('aside');
    drawer.className = 'tl-drawer';
    drawer.id = 'tl-drawer';

    const header = document.createElement('div');
    header.className = 'tl-drawer-header';

    const brand = document.createElement('div');
    brand.className = 'tl-brand';
    const brandDot = document.createElement('span');
    brandDot.className = 'tl-dot';
    const brandText = document.createElement('span');
    brandText.textContent = 'TideLock';
    brand.appendChild(brandDot);
    brand.appendChild(brandText);

    const headerActions = document.createElement('div');
    headerActions.className = 'tl-header-actions';

    const drawerRefreshBtn = document.createElement('button');
    drawerRefreshBtn.type = 'button';
    drawerRefreshBtn.className = 'tl-btn-sm';
    drawerRefreshBtn.textContent = t('btnRefreshFeed', 'Refresh Feed');
    drawerRefreshBtn.addEventListener('click', () => {
      setDrawerOpen(false);
      sendToMain(MSG.FORCE_REFRESH);
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tl-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => setDrawerOpen(false));

    headerActions.appendChild(drawerRefreshBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(brand);
    header.appendChild(headerActions);
    drawer.appendChild(header);

    // Tabs
    const tabsRow = document.createElement('div');
    tabsRow.className = 'tl-tabs';
    const tabSnaps = document.createElement('button');
    tabSnaps.type = 'button';
    tabSnaps.className = 'tl-tab';
    tabSnaps.id = 'tl-tab-snapshots';
    tabSnaps.textContent = t('tabSnapshots', 'Snapshots');
    tabSnaps.addEventListener('click', () => {
      drawerTab = 'snapshots';
      renderDrawerBody();
    });

    const tabPins = document.createElement('button');
    tabPins.type = 'button';
    tabPins.className = 'tl-tab';
    tabPins.id = 'tl-tab-pinned';
    tabPins.textContent = t('tabPinned', 'Pinned');
    tabPins.addEventListener('click', () => {
      drawerTab = 'pinned';
      renderDrawerBody();
    });

    tabsRow.appendChild(tabSnaps);
    tabsRow.appendChild(tabPins);
    drawer.appendChild(tabsRow);

    // Controls container
    const controls = document.createElement('div');
    controls.className = 'tl-controls';
    controls.id = 'tl-controls';

    const snapPills = document.createElement('div');
    snapPills.className = 'tl-snap-pills';
    snapPills.id = 'tl-snap-pills';

    const filterRow = document.createElement('div');
    filterRow.className = 'tl-filter-row';
    filterRow.id = 'tl-filter-row';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'tl-search';
    searchInput.id = 'tl-search';
    searchInput.placeholder = t('searchPlaceholder', 'Search title or channel...');
    searchInput.addEventListener('input', (ev) => {
      searchQuery = (ev.target.value || '').trim().toLowerCase();
      renderDrawerList();
    });

    controls.appendChild(snapPills);
    controls.appendChild(filterRow);
    controls.appendChild(searchInput);
    drawer.appendChild(controls);

    // List
    const listEl = document.createElement('div');
    listEl.className = 'tl-list';
    listEl.id = 'tl-list';
    drawer.appendChild(listEl);

    shadowRoot.appendChild(drawer);
    document.body.appendChild(uiHost);

    syncThemeAttr();
    updateDockVisibility();
    renderDockState();
  }

  function updateDockVisibility() {
    if (!dockEl) return;
    const isFullscreen = Boolean(document.fullscreenElement);
    dockEl.hidden = !settings.showFloatingDock || isFullscreen;
  }

  function renderDockState() {
    if (!shadowRoot) return;
    const dot = shadowRoot.getElementById('tl-dock-dot');
    const countPill = shadowRoot.getElementById('tl-dock-count');
    const refreshBtn = shadowRoot.getElementById('tl-dock-refresh');
    if (dot) {
      dot.setAttribute('data-paused', settings.enabled ? 'false' : 'true');
    }
    if (countPill) {
      const n = pinned.length;
      countPill.hidden = n === 0;
      countPill.textContent = String(n);
    }
    if (refreshBtn) {
      refreshBtn.hidden = !E.isHomePath(window.location.pathname);
    }
  }

  function setDrawerOpen(open) {
    ensureShadowUi();
    drawerOpen = Boolean(open);
    const backdrop = shadowRoot?.getElementById('tl-backdrop');
    const drawer = shadowRoot?.getElementById('tl-drawer');
    if (backdrop) backdrop.setAttribute('data-open', drawerOpen ? 'true' : 'false');
    if (drawer) drawer.setAttribute('data-open', drawerOpen ? 'true' : 'false');
    if (drawerOpen) {
      syncThemeAttr();
      renderDrawerBody();
    }
  }

  function showToast(message, showRefreshBtn = false) {
    if (!settings.showToast && showRefreshBtn) return;
    ensureShadowUi();
    const toast = shadowRoot?.getElementById('tl-toast');
    const text = shadowRoot?.getElementById('tl-toast-text');
    const btn = shadowRoot?.getElementById('tl-toast-btn');
    if (!toast || !text || !btn) return;

    text.textContent = message;
    btn.hidden = !showRefreshBtn;
    toast.setAttribute('data-visible', 'true');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hideToast(), showRefreshBtn ? 4200 : 2400);
  }

  function hideToast() {
    const toast = shadowRoot?.getElementById('tl-toast');
    if (toast) toast.setAttribute('data-visible', 'false');
  }

  function navigateToVideo(url, videoId) {
    setDrawerOpen(false);
    if (videoId) markVideoWatched(videoId);
    // Keep same-tab smooth experience!
    window.location.href = url;
  }

  function renderDrawerBody() {
    if (!shadowRoot) return;
    const tabSnaps = shadowRoot.getElementById('tl-tab-snapshots');
    const tabPins = shadowRoot.getElementById('tl-tab-pinned');
    const snapPills = shadowRoot.getElementById('tl-snap-pills');
    const filterRow = shadowRoot.getElementById('tl-filter-row');

    if (tabSnaps) {
      tabSnaps.setAttribute('data-active', drawerTab === 'snapshots' ? 'true' : 'false');
      tabSnaps.textContent = `${t('tabSnapshots', 'Snapshots')} (${snapshots.length})`;
    }
    if (tabPins) {
      tabPins.setAttribute('data-active', drawerTab === 'pinned' ? 'true' : 'false');
      tabPins.textContent = `${t('tabPinned', 'Pinned')} (${pinned.length})`;
    }

    if (snapPills) {
      snapPills.textContent = '';
      snapPills.hidden = drawerTab !== 'snapshots' || snapshots.length === 0;
      if (selectedSnapshotIdx >= snapshots.length) selectedSnapshotIdx = 0;

      snapshots.forEach((snap, idx) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tl-chip';
        chip.setAttribute('data-active', idx === selectedSnapshotIdx ? 'true' : 'false');
        const prefix = idx === 0 ? (isZhLocale() ? '最近' : 'Latest') : formatRelativeTime(snap.updatedAt || snap.createdAt);
        chip.textContent = `${prefix} · ${snap.videos.length}`;
        chip.addEventListener('click', () => {
          selectedSnapshotIdx = idx;
          renderDrawerBody();
        });
        snapPills.appendChild(chip);
      });
    }

    if (filterRow) {
      filterRow.textContent = '';
      filterRow.hidden = drawerTab !== 'snapshots';
      const modes = [
        { id: 'all', label: t('filterAll', 'All') },
        { id: 'unwatched', label: t('filterUnwatched', 'Unwatched') },
        { id: 'watched', label: t('filterWatched', 'Watched') },
      ];
      for (const m of modes) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tl-chip';
        chip.setAttribute('data-active', filterMode === m.id ? 'true' : 'false');
        chip.textContent = m.label;
        chip.addEventListener('click', () => {
          filterMode = m.id;
          renderDrawerBody();
        });
        filterRow.appendChild(chip);
      }
    }

    renderDrawerList();
  }

  function renderDrawerList() {
    if (!shadowRoot) return;
    const listEl = shadowRoot.getElementById('tl-list');
    if (!listEl) return;
    listEl.textContent = '';

    let videos = [];
    if (drawerTab === 'pinned') {
      videos = pinned;
    } else {
      const snap = snapshots[selectedSnapshotIdx];
      videos = snap ? snap.videos : [];
    }

    const filtered = videos.filter((v) => {
      if (drawerTab === 'snapshots') {
        const isWatched = watchedSet.has(v.videoId);
        if (filterMode === 'unwatched' && isWatched) return false;
        if (filterMode === 'watched' && !isWatched) return false;
      }
      if (searchQuery) {
        const hay = `${v.title || ''} ${v.channel || ''}`.toLowerCase();
        if (!hay.includes(searchQuery)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tl-empty';
      empty.textContent =
        drawerTab === 'pinned'
          ? t('emptyPinned', 'No pinned videos yet.')
          : t('emptySnapshots', 'No snapshots captured yet.');
      listEl.appendChild(empty);
      return;
    }

    const pinnedIds = new Set(pinned.map((p) => p.videoId));

    for (const v of filtered) {
      const row = document.createElement('div');
      row.className = 'tl-card';
      row.addEventListener('click', () => navigateToVideo(v.url, v.videoId));

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'tl-thumb-wrap';
      const img = document.createElement('img');
      img.className = 'tl-thumb';
      img.loading = 'lazy';
      img.src = v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
      img.alt = '';
      thumbWrap.appendChild(img);

      if (v.duration) {
        const dur = document.createElement('span');
        dur.className = 'tl-dur';
        dur.textContent = v.duration;
        thumbWrap.appendChild(dur);
      }

      const meta = document.createElement('div');
      meta.className = 'tl-meta';
      const title = document.createElement('div');
      title.className = 'tl-title';
      title.textContent = v.title;

      const sub = document.createElement('div');
      sub.className = 'tl-sub';
      sub.textContent = [v.channel, v.views].filter(Boolean).join(' · ');

      meta.appendChild(title);
      if (sub.textContent) meta.appendChild(sub);

      if (watchedSet.has(v.videoId)) {
        const tags = document.createElement('div');
        tags.className = 'tl-tags';
        const tag = document.createElement('span');
        tag.className = 'tl-tag-watched';
        tag.textContent = t('badgeWatched', 'Watched');
        tags.appendChild(tag);
        meta.appendChild(tags);
      }

      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = 'tl-card-pin';
      pinBtn.textContent = '📌';
      pinBtn.setAttribute('data-pinned', pinnedIds.has(v.videoId) ? 'true' : 'false');
      pinBtn.title = pinnedIds.has(v.videoId)
        ? t('pinRemoved', 'Unpin')
        : t('pinAdded', 'Pin');
      pinBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        togglePinVideo(v);
      });

      row.appendChild(thumbWrap);
      row.appendChild(meta);
      row.appendChild(pinBtn);
      listEl.appendChild(row);
    }
  }

  // ---- Receive Events from MAIN World Page Bridge ----
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== BRIDGE_CHANNEL || data.direction !== 'MAIN_TO_ISOLATED') {
      return;
    }

    switch (data.type) {
      case MSG.HOME_CAPTURED: {
        const p = data.payload || {};
        currentFeedId = p.feedId || currentFeedId;
        if (Array.isArray(p.videos) && p.videos.length > 0) {
          const next = E.mergeSnapshotVault(
            snapshots,
            {
              feedId: currentFeedId,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              scrollY: p.scrollY || 0,
              videos: p.videos,
            },
            settings.maxSnapshots
          );
          await saveSnapshots(next);
          await incrementStat('snapshotsSaved');
        }
        renderDockState();
        setTimeout(() => scheduleDecorateHomeCards(), 350);
        break;
      }

      case MSG.CONTINUATION_STITCHED: {
        const p = data.payload || {};
        if (Array.isArray(p.videos) && p.videos.length > 0) {
          const next = E.mergeSnapshotVault(
            snapshots,
            {
              feedId: p.feedId || currentFeedId,
              updatedAt: Date.now(),
              scrollY: p.scrollY || liveHomeScrollY,
              videos: p.videos,
            },
            settings.maxSnapshots
          );
          await saveSnapshots(next);
        }
        setTimeout(() => scheduleDecorateHomeCards(), 300);
        break;
      }

      case MSG.NAV_AWAY_FROM_HOME: {
        const p = data.payload || {};
        const y = typeof p.scrollY === 'number' && p.scrollY > 0 ? p.scrollY : liveHomeScrollY;
        await persistScrollAnchor({ scrollY: y, videoId: p.videoId || null });
        if (p.videoId) {
          await markVideoWatched(p.videoId);
        }
        renderDockState();
        break;
      }

      case MSG.WATCHED_VIDEO: {
        const p = data.payload || {};
        if (p.videoId) {
          await markVideoWatched(p.videoId);
        }
        renderDockState();
        break;
      }

      case MSG.FEED_RESTORED: {
        const p = data.payload || {};
        await incrementStat('refreshesBlocked');
        const countStr = p.cardCount ? ` (${p.cardCount})` : '';
        showToast(`${t('toastRestored', 'Home feed preserved')}${countStr}`, true);
        restoreHomeScrollPosition();
        setTimeout(() => scheduleDecorateHomeCards(), 400);
        renderDockState();
        break;
      }

      case MSG.NAV_BACK_TO_HOME: {
        const p = data.payload || {};
        if (!p.restoredFromCache) {
          // YouTube kept DOM alive without re-fetching, still restore scroll & decorate cards!
          restoreHomeScrollPosition();
        }
        setTimeout(() => scheduleDecorateHomeCards(), 350);
        renderDockState();
        break;
      }

      default:
        break;
    }
  });

  // ---- Receive Commands from Popup / Service Worker ----
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;
    (async () => {
      try {
        switch (message.type) {
          case MSG.OPEN_DRAWER: {
            setDrawerOpen(true);
            sendResponse({ ok: true });
            break;
          }
          case MSG.TRIGGER_REFRESH: {
            sendToMain(MSG.FORCE_REFRESH);
            sendResponse({ ok: true });
            break;
          }
          case MSG.NAVIGATE_VIDEO: {
            if (message.url) {
              navigateToVideo(message.url, message.videoId);
            }
            sendResponse({ ok: true });
            break;
          }
          case MSG.GET_TAB_STATE: {
            sendResponse({
              ok: true,
              isHome: E.isHomePath(window.location.pathname),
              pathname: window.location.pathname,
            });
            break;
          }
          default:
            sendResponse({ ok: false });
        }
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  });

  // ---- Storage Reactivity ----
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[STORAGE_KEYS.SETTINGS]?.newValue) {
      settings = { ...DEFAULT_SETTINGS, ...changes[STORAGE_KEYS.SETTINGS].newValue };
      sendToMain(MSG.SYNC_SETTINGS, settings);
      updateDockVisibility();
      renderDockState();
      scheduleDecorateHomeCards();
    }
    if (changes[STORAGE_KEYS.SNAPSHOTS]?.newValue) {
      snapshots = changes[STORAGE_KEYS.SNAPSHOTS].newValue;
      if (drawerOpen) renderDrawerBody();
    }
    if (changes[STORAGE_KEYS.PINNED]?.newValue) {
      pinned = changes[STORAGE_KEYS.PINNED].newValue;
      renderDockState();
      if (drawerOpen) renderDrawerBody();
      scheduleDecorateHomeCards();
    }
    if (changes[STORAGE_KEYS.WATCHED]?.newValue) {
      watchedSet = new Set(changes[STORAGE_KEYS.WATCHED].newValue);
      scheduleDecorateHomeCards();
      if (drawerOpen) renderDrawerBody();
    }
    if (changes[STORAGE_KEYS.STATS]?.newValue) {
      stats = { ...DEFAULT_STATS, ...changes[STORAGE_KEYS.STATS].newValue };
    }
  });

  // ---- Boot & Observers ----
  function initDomHooks() {
    ensureShadowUi();

    // Watch theme changes on <html>
    const htmlObserver = new MutationObserver(() => syncThemeAttr());
    htmlObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dark'],
    });

    // Hide dock during fullscreen playback
    document.addEventListener('fullscreenchange', () => updateDockVisibility());

    // Keyboard shortcut Escape closes drawer
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && drawerOpen) {
        setDrawerOpen(false);
      }
    });

    // Observe home grid mutations to decorate newly rendered / scrolled cards
    const bodyObserver = new MutationObserver(() => {
      if (E.isHomePath(window.location.pathname)) {
        scheduleDecorateHomeCards();
      }
    });
    if (document.body) {
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    scheduleDecorateHomeCards();
  }

  loadAllState();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDomHooks, { once: true });
  } else {
    initDomHooks();
  }
})();
