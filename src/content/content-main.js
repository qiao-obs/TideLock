(function () {
  'use strict';

  if (window.__tidelockContentMainInstalled) return;
  window.__tidelockContentMainInstalled = true;

  const D = globalThis.__TideLockDefaults;
  const E = globalThis.__TideLockEngine;
  const I = globalThis.__TideLockIcons;
  if (!D || !E || !I) return;

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
  let routeAnchors = {}; // { home: { scrollY, videoId, savedAt }, subscriptions: ..., 'search:...': ... }
  let bridgeStatus = {
    enabled: true,
    hasCachedFeed: false,
    hasPreviousFeed: false,
    hydratedFromIdb: false,
    cardCount: 0,
    isHome: E.isHomePath(window.location.pathname),
  };

  let currentFeedId = null;
  let liveRouteScrollY = {};
  let scrollRafPending = false;
  let decorateTimer = null;
  let userCancelledScrollRestore = false;
  let activeGridObserver = null;
  let observedContainer = null;

  // Shadow DOM UI handles
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
    } catch {}
  }

  // ---- Storage Operations ----
  async function loadAllState() {
    try {
      const data = await chrome.storage.local.get([
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.SNAPSHOTS,
        STORAGE_KEYS.PINNED,
        STORAGE_KEYS.WATCHED,
        STORAGE_KEYS.STATS,
        STORAGE_KEYS.ROUTE_ANCHORS,
      ]);
      settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
      stats = { ...DEFAULT_STATS, ...(data[STORAGE_KEYS.STATS] || {}) };
      snapshots = Array.isArray(data[STORAGE_KEYS.SNAPSHOTS]) ? data[STORAGE_KEYS.SNAPSHOTS] : [];
      pinned = Array.isArray(data[STORAGE_KEYS.PINNED]) ? data[STORAGE_KEYS.PINNED] : [];
      watchedSet = new Set(Array.isArray(data[STORAGE_KEYS.WATCHED]) ? data[STORAGE_KEYS.WATCHED] : []);
      routeAnchors =
        data[STORAGE_KEYS.ROUTE_ANCHORS] && typeof data[STORAGE_KEYS.ROUTE_ANCHORS] === 'object'
          ? data[STORAGE_KEYS.ROUTE_ANCHORS]
          : {};

      sendToMain(MSG.SYNC_SETTINGS, settings);
      sendToMain(MSG.REQUEST_STATUS);
      updateDockVisibility();
      renderDockState();
      if (drawerOpen) renderDrawerBody();
      scheduleDecorateActiveFeed(60);
    } catch {}
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
    scheduleDecorateActiveFeed(50);
  }

  async function markVideoWatched(videoId) {
    if (!videoId) return;
    watchedSet.add(videoId);
    const arr = Array.from(watchedSet).slice(-400);
    watchedSet = new Set(arr);
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.WATCHED]: arr });
    } catch {}
    scheduleDecorateActiveFeed(80);
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

  async function persistRouteAnchor(routeKey, anchor) {
    if (!routeKey) return;
    routeAnchors = {
      ...routeAnchors,
      [routeKey]: {
        scrollY: anchor.scrollY || 0,
        videoId: anchor.videoId || null,
        savedAt: Date.now(),
      },
    };
    // Keep anchor map bounded to 12 most recent routes (Home + Subs + recent Searches)
    const entries = Object.entries(routeAnchors)
      .sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0))
      .slice(0, 12);
    routeAnchors = Object.fromEntries(entries);
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.ROUTE_ANCHORS]: routeAnchors });
    } catch {}
  }

  async function togglePinVideo(card, forceAdd = false) {
    if (!card || !card.videoId) return;
    const exists = pinned.some((p) => p.videoId === card.videoId);
    if (exists && forceAdd) {
      showToast(t('pinAdded', 'Pinned to TideLock'), { showRefresh: false });
      return;
    }

    let next;
    if (exists) {
      next = pinned.filter((p) => p.videoId !== card.videoId);
      showToast(t('pinRemoved', 'Removed from pinned'), { showRefresh: false });
    } else {
      const displayTitle = card.displayTitle || card.title || card.videoId;
      const originalTitle = card.originalTitle || card.title || displayTitle;
      next = [
        {
          videoId: card.videoId,
          title: displayTitle,
          displayTitle,
          originalTitle,
          channel: card.channel || '',
          duration: card.duration || '',
          views: card.views || '',
          thumbnail: card.thumbnail || `https://i.ytimg.com/vi/${card.videoId}/hqdefault.jpg`,
          url: card.url || `https://www.youtube.com/watch?v=${card.videoId}`,
          pinnedAt: Date.now(),
        },
        ...pinned.filter((p) => p.videoId !== card.videoId),
      ].slice(0, 80);
      showToast(t('pinAdded', 'Pinned to TideLock'), { showRefresh: false });
    }
    await savePinned(next);
  }

  async function copyListAsMarkdown(videos, heading) {
    const md = E.formatVideosAsMarkdown(videos, heading);
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
      showToast(t('toastCopiedMd', 'Copied as Markdown'), { showRefresh: false });
    } catch {
      // Fallback textarea copy
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast(t('toastCopiedMd', 'Copied as Markdown'), { showRefresh: false });
    }
  }

  // ---- Scroll Tracking & Stabilized Anti-Reset Scroll Restoration ----
  function onScrollPassive() {
    const routeKey = E.getRouteAnchorKey(window.location.href);
    if (!routeKey) return;
    if (scrollRafPending) return;
    scrollRafPending = true;
    requestAnimationFrame(() => {
      scrollRafPending = false;
      const rk = E.getRouteAnchorKey(window.location.href);
      if (rk) liveRouteScrollY[rk] = window.scrollY || 0;
    });
  }

  function cancelScrollRestore() {
    userCancelledScrollRestore = true;
  }

  window.addEventListener('scroll', onScrollPassive, { passive: true });
  window.addEventListener('wheel', cancelScrollRestore, { passive: true });
  window.addEventListener('touchstart', cancelScrollRestore, { passive: true });
  window.addEventListener(
    'keydown',
    (ev) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(ev.key)) {
        userCancelledScrollRestore = true;
      }
    },
    { passive: true }
  );

  function getActiveListRoot(routeKey) {
    if (routeKey === 'home') {
      const b = document.querySelector('ytd-browse[page-subtype="home"]');
      return b && !b.hasAttribute('hidden') ? b : null;
    }
    if (routeKey === 'subscriptions') {
      const b = document.querySelector('ytd-browse[page-subtype="subscriptions"]');
      return b && !b.hasAttribute('hidden') ? b : null;
    }
    if (routeKey && routeKey.startsWith('search')) {
      const s = document.querySelector('ytd-search');
      return s && !s.hasAttribute('hidden') ? s : null;
    }
    return null;
  }

  function restoreScrollForRoute(routeKey) {
    if (!settings.restoreScroll || !routeKey) return;
    if (routeKey !== 'home' && !settings.anchorSubAndSearch) return;

    const anchor = routeAnchors[routeKey];
    if (!anchor) return;
    const targetY = anchor.scrollY || 0;
    const targetVid = anchor.videoId;
    if (targetY < 40 && !targetVid) return;

    userCancelledScrollRestore = false;
    const startTime = Date.now();
    let statRecorded = false;
    let settledFrames = 0;

    const step = () => {
      if (userCancelledScrollRestore) return;
      if (E.getRouteAnchorKey(window.location.href) !== routeKey) return;
      const elapsed = Date.now() - startTime;
      if (elapsed > 2800) return;

      const root = getActiveListRoot(routeKey);
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      if (root && maxScroll >= Math.min(targetY, 160)) {
        let desiredY = targetY;

        if (targetVid) {
          const anchorLink = root.querySelector(
            `a[href*="/watch?v=${CSS.escape(targetVid)}"], a[href*="/shorts/${CSS.escape(targetVid)}"]`
          );
          if (anchorLink) {
            const rect = anchorLink.getBoundingClientRect();
            const docTop = rect.top + window.scrollY;
            const centeredY = Math.max(0, docTop - Math.round(window.innerHeight * 0.28));
            desiredY = Math.abs(centeredY - targetY) < 280 ? targetY : centeredY;
          }
        }

        if (maxScroll >= desiredY - 120) {
          if (Math.abs(window.scrollY - desiredY) > 24) {
            window.scrollTo({ top: desiredY, behavior: 'instant' });
            settledFrames = 0;
            if (!statRecorded) {
              statRecorded = true;
              incrementStat('scrollsRestored');
            }
          } else {
            settledFrames++;
            // Stay vigilant for at least 750ms in case Polymer fires a delayed scrollTo(0,0)
            if (settledFrames >= 3 && elapsed >= 750) return;
          }
        }
      }

      setTimeout(() => requestAnimationFrame(step), 75);
    };

    requestAnimationFrame(step);
  }

  // ---- Scoped DOM Observer + O(1) Batched Card Decoration & Bilingual Sync ----
  function extractCardInfoFromDomElement(itemEl) {
    if (!(itemEl instanceof Element)) return null;
    const link = itemEl.querySelector(
      'a#video-title-link[href*="/watch?"], a.yt-lockup-metadata-view-model__title[href*="/watch?"], a#video-title[href*="/watch?"], a[href*="/watch?v="], a[href*="/shorts/"]'
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
    const displayTitle = (titleEl?.textContent || link.getAttribute('title') || '').trim();
    if (!displayTitle) return null;

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
      title: displayTitle,
      displayTitle,
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

  function scheduleDecorateActiveFeed(delayMs = 220) {
    const routeKey = E.getRouteAnchorKey(window.location.href);
    if (!routeKey) return;
    if (routeKey !== 'home' && !settings.anchorSubAndSearch) return;
    if (decorateTimer) clearTimeout(decorateTimer);
    decorateTimer = setTimeout(() => {
      decorateTimer = null;
      void decorateActiveFeedBatched(routeKey);
    }, delayMs);
  }

  async function decorateActiveFeedBatched(routeKey) {
    const root = getActiveListRoot(routeKey);
    if (!root) return;

    const selector =
      routeKey.startsWith('search')
        ? 'ytd-video-renderer, ytd-rich-item-renderer'
        : 'ytd-rich-item-renderer';
    const items = Array.from(root.querySelectorAll(selector));
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
            if (routeKey === 'home') domCards.push(card);

            const thumbHost = findCardThumbnailHost(itemEl);
            if (!thumbHost) continue;

            const shouldShowWatched = settings.markWatched && watchedSet.has(card.videoId);
            const isPinned = pinnedIds.has(card.videoId);
            const stateSig = `${card.videoId}|${shouldShowWatched ? 1 : 0}|${isPinned ? 1 : 0}`;

            // O(1) fast path: skip DOM mutations when state unchanged
            if (thumbHost.getAttribute('data-tidelock-sig') === stateSig) {
              continue;
            }
            thumbHost.setAttribute('data-tidelock-sig', stateSig);
            thumbHost.classList.add('tidelock-card-host');

            // 1) Watched badge (notranslate so Immersive Translate leaves it crisp)
            let badge = thumbHost.querySelector(':scope > .tidelock-watched-badge');
            if (shouldShowWatched) {
              if (!badge) {
                badge = document.createElement('div');
                badge.className = 'tidelock-watched-badge notranslate';
                badge.setAttribute('translate', 'no');
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

            // 2) Hover Quick-Pin SVG button
            let pinBtn = thumbHost.querySelector(':scope > .tidelock-pin-btn');
            if (!pinBtn) {
              pinBtn = document.createElement('button');
              pinBtn.type = 'button';
              pinBtn.className = 'tidelock-pin-btn notranslate';
              pinBtn.setAttribute('translate', 'no');
              pinBtn.title = isZhLocale() ? '暂存到 TideLock 待看栏' : 'Pin to TideLock queue';
              pinBtn.appendChild(I.createSvgIcon('pin', 14));
              pinBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                ev.stopImmediatePropagation();
                const freshCard = extractCardInfoFromDomElement(itemEl) || card;
                void togglePinVideo(freshCard);
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

    // Bilingual Title Sync: enrich Home snapshot with live translated/DeArrow titles ONLY if changed
    if (routeKey === 'home' && domCards.length >= 4) {
      if (snapshots.length === 0) {
        const next = E.mergeSnapshotVault(
          snapshots,
          {
            feedId: currentFeedId || `dom_${Date.now()}`,
            updatedAt: Date.now(),
            scrollY: liveRouteScrollY.home || 0,
            videos: domCards,
          },
          settings.maxSnapshots
        );
        await saveSnapshots(next);
      } else {
        const { snapshot: enriched, changed } = E.enrichSnapshotWithDomCards(
          snapshots[0],
          domCards
        );
        if (changed) {
          const next = [enriched, ...snapshots.slice(1)];
          await saveSnapshots(next);
        }
      }
    }
  }

  function attachScopedGridObserver() {
    const routeKey = E.getRouteAnchorKey(window.location.href);
    const root = routeKey ? getActiveListRoot(routeKey) : null;
    const target = root ? root.querySelector('#contents') || root : null;

    if (target === observedContainer) return;

    if (activeGridObserver) {
      activeGridObserver.disconnect();
      activeGridObserver = null;
    }
    observedContainer = target;

    if (!target) return;
    activeGridObserver = new MutationObserver(() => {
      scheduleDecorateActiveFeed(260);
    });
    activeGridObserver.observe(target, { childList: true, subtree: true });
  }

  // ---- Shadow DOM UI (Pure DOM + Crisp SVG — Trusted Types Safe & notranslate) ----
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
      --tl-amber: #d97706;
      --tl-amber-soft: rgba(217, 119, 6, 0.12);
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
      --tl-amber: #fbbf24;
      --tl-amber-soft: rgba(251, 191, 36, 0.16);
      --tl-shadow: 0 14px 36px rgba(0, 0, 0, 0.55);
    }

    .tl-dock {
      position: fixed;
      right: 18px;
      bottom: 20px;
      z-index: 2147483000;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 4px;
      border-radius: 999px;
      background: var(--tl-bg);
      border: 1px solid var(--tl-border);
      box-shadow: var(--tl-shadow);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }

    .tl-dock[hidden] { display: none !important; }

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

    .tl-dock-main:hover { background: var(--tl-surface); }

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
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .tl-dock-icon-btn:hover {
      background: var(--tl-surface);
      color: var(--tl-text);
    }

    .tl-dock-icon-btn[data-variant="undo"] {
      color: var(--tl-amber);
    }

    .tl-dock-icon-btn[data-variant="undo"]:hover {
      background: var(--tl-amber-soft);
    }

    .tl-dock-icon-btn[hidden] { display: none !important; }

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
      padding: 8px 14px;
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
      display: inline-flex;
      align-items: center;
      gap: 5px;
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

    .tl-toast-btn[hidden] { display: none !important; }

    /* Backdrop + Slide-over Drawer */
    .tl-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483005;
      background: rgba(2, 6, 23, 0.38);
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
      width: min(430px, calc(100vw - 24px));
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

    .tl-drawer[data-open="true"] { transform: translateX(0); }

    .tl-drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 13px 14px 10px;
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

    .tl-kbd {
      padding: 2px 6px;
      border-radius: 5px;
      background: var(--tl-surface);
      color: var(--tl-text-muted);
      font-size: 10px;
      font-weight: 600;
    }

    .tl-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tl-btn-sm {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 28px;
      padding: 0 9px;
      border: 1px solid var(--tl-border);
      border-radius: 8px;
      background: var(--tl-surface);
      color: var(--tl-text);
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
    }

    .tl-btn-sm:hover { background: var(--tl-surface-hover); }
    .tl-btn-sm[hidden] { display: none !important; }
    .tl-btn-sm[data-variant="undo"] {
      color: var(--tl-amber);
      background: var(--tl-amber-soft);
      border-color: transparent;
    }

    .tl-close-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--tl-text-muted);
      cursor: pointer;
    }

    .tl-close-btn:hover {
      background: var(--tl-surface);
      color: var(--tl-text);
    }

    .tl-tabs {
      display: flex;
      gap: 6px;
      padding: 10px 14px 0;
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
      padding: 10px 14px;
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

    .tl-filter-wrap {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
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

    .tl-search:focus { border-color: var(--tl-accent); }

    .tl-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .tl-section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px 2px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: var(--tl-accent);
      text-transform: uppercase;
    }

    .tl-divider {
      height: 1px;
      background: var(--tl-border);
      margin: 6px 4px;
    }

    .tl-card {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 7px 8px;
      border-radius: 11px;
      background: transparent;
      border: 1px solid transparent;
      color: inherit;
      cursor: pointer;
      transition: background 0.14s ease, border-color 0.14s ease;
    }

    .tl-card:hover {
      background: var(--tl-surface);
      border-color: var(--tl-border);
    }

    .tl-card[data-neighbor="true"] {
      background: var(--tl-accent-soft);
      border-color: rgba(56, 189, 248, 0.25);
    }

    .tl-card[data-neighbor="true"]:hover {
      background: var(--tl-surface);
    }

    .tl-thumb-wrap {
      position: relative;
      width: 116px;
      height: 65px;
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
      background: rgba(0, 0, 0, 0.82);
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

    .tl-tags { display: flex; align-items: center; gap: 6px; }

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
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: var(--tl-text-muted);
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
      (window.matchMedia('(prefers-color-scheme: dark)').matches &&
        getComputedStyle(document.documentElement).backgroundColor === 'rgb(15, 15, 15)');
    uiHost.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }

  function ensureShadowUi() {
    if (shadowRoot || !document.body) return;

    uiHost = document.createElement('div');
    uiHost.id = 'tidelock-shadow-host';
    uiHost.className = 'notranslate';
    uiHost.setAttribute('translate', 'no');
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
    mainBtn.title = 'TideLock (Alt+Shift+T)';

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

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'tl-dock-icon-btn';
    undoBtn.id = 'tl-dock-undo';
    undoBtn.setAttribute('data-variant', 'undo');
    undoBtn.title = t('btnUndoRefresh', 'Undo Refresh');
    undoBtn.hidden = true;
    undoBtn.appendChild(I.createSvgIcon('undo', 15));
    undoBtn.addEventListener('click', () => sendToMain(MSG.UNDO_REFRESH));

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'tl-dock-icon-btn';
    refreshBtn.id = 'tl-dock-refresh';
    refreshBtn.title = t('btnRefreshFeed', 'Fresh Feed');
    refreshBtn.appendChild(I.createSvgIcon('refresh', 14));
    refreshBtn.addEventListener('click', () => sendToMain(MSG.FORCE_REFRESH));

    dockEl.appendChild(mainBtn);
    dockEl.appendChild(undoBtn);
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
    toastBtn.appendChild(I.createSvgIcon('refresh', 12));
    const toastBtnLabel = document.createElement('span');
    toastBtnLabel.textContent = t('toastRefreshAction', 'Fresh Feed');
    toastBtn.appendChild(toastBtnLabel);
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
    const kbd = document.createElement('span');
    kbd.className = 'tl-kbd';
    kbd.textContent = 'Alt+Shift+T';
    brand.appendChild(brandDot);
    brand.appendChild(brandText);
    brand.appendChild(kbd);

    const headerActions = document.createElement('div');
    headerActions.className = 'tl-header-actions';

    const drawerUndoBtn = document.createElement('button');
    drawerUndoBtn.type = 'button';
    drawerUndoBtn.className = 'tl-btn-sm';
    drawerUndoBtn.id = 'tl-drawer-undo';
    drawerUndoBtn.setAttribute('data-variant', 'undo');
    drawerUndoBtn.hidden = true;
    drawerUndoBtn.appendChild(I.createSvgIcon('undo', 13));
    const undoSpan = document.createElement('span');
    undoSpan.textContent = t('btnUndoRefresh', 'Undo');
    drawerUndoBtn.appendChild(undoSpan);
    drawerUndoBtn.addEventListener('click', () => {
      setDrawerOpen(false);
      sendToMain(MSG.UNDO_REFRESH);
    });

    const drawerRefreshBtn = document.createElement('button');
    drawerRefreshBtn.type = 'button';
    drawerRefreshBtn.className = 'tl-btn-sm';
    drawerRefreshBtn.appendChild(I.createSvgIcon('refresh', 13));
    const refSpan = document.createElement('span');
    refSpan.textContent = t('btnRefreshFeed', 'Fresh');
    drawerRefreshBtn.appendChild(refSpan);
    drawerRefreshBtn.addEventListener('click', () => {
      setDrawerOpen(false);
      sendToMain(MSG.FORCE_REFRESH);
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tl-close-btn';
    closeBtn.appendChild(I.createSvgIcon('close', 16));
    closeBtn.addEventListener('click', () => setDrawerOpen(false));

    headerActions.appendChild(drawerUndoBtn);
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
    tabSnaps.addEventListener('click', () => {
      drawerTab = 'snapshots';
      renderDrawerBody();
    });

    const tabPins = document.createElement('button');
    tabPins.type = 'button';
    tabPins.className = 'tl-tab';
    tabPins.id = 'tl-tab-pinned';
    tabPins.addEventListener('click', () => {
      drawerTab = 'pinned';
      renderDrawerBody();
    });

    tabsRow.appendChild(tabSnaps);
    tabsRow.appendChild(tabPins);
    drawer.appendChild(tabsRow);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'tl-controls';

    const snapPills = document.createElement('div');
    snapPills.className = 'tl-snap-pills';
    snapPills.id = 'tl-snap-pills';

    const filterWrap = document.createElement('div');
    filterWrap.className = 'tl-filter-wrap';
    const filterRow = document.createElement('div');
    filterRow.className = 'tl-filter-row';
    filterRow.id = 'tl-filter-row';

    const copyMdBtn = document.createElement('button');
    copyMdBtn.type = 'button';
    copyMdBtn.className = 'tl-btn-sm';
    copyMdBtn.id = 'tl-copy-md';
    copyMdBtn.title = t('btnCopyMarkdown', 'Copy Markdown');
    copyMdBtn.appendChild(I.createSvgIcon('copy', 12));
    const mdSpan = document.createElement('span');
    mdSpan.textContent = 'MD';
    copyMdBtn.appendChild(mdSpan);
    copyMdBtn.addEventListener('click', () => {
      const list = getCurrentDrawerVideos();
      const title =
        drawerTab === 'pinned'
          ? 'TideLock Pinned Videos'
          : `TideLock Home Snapshot (${list.length})`;
      void copyListAsMarkdown(list, title);
    });

    filterWrap.appendChild(filterRow);
    filterWrap.appendChild(copyMdBtn);

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'tl-search';
    searchInput.id = 'tl-search';
    searchInput.placeholder = t('searchPlaceholder', 'Search title (CN/EN) or channel...');
    searchInput.addEventListener('input', (ev) => {
      searchQuery = (ev.target.value || '').trim().toLowerCase();
      renderDrawerList();
    });

    controls.appendChild(snapPills);
    controls.appendChild(filterWrap);
    controls.appendChild(searchInput);
    drawer.appendChild(controls);

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
    const undoBtn = shadowRoot.getElementById('tl-dock-undo');
    const drawerUndoBtn = shadowRoot.getElementById('tl-drawer-undo');

    const onHome = E.isHomePath(window.location.pathname);

    if (dot) dot.setAttribute('data-paused', settings.enabled ? 'false' : 'true');
    if (countPill) {
      countPill.hidden = pinned.length === 0;
      countPill.textContent = String(pinned.length);
    }
    if (refreshBtn) refreshBtn.hidden = !onHome;
    if (undoBtn) undoBtn.hidden = !(onHome && bridgeStatus.hasPreviousFeed);
    if (drawerUndoBtn) drawerUndoBtn.hidden = !bridgeStatus.hasPreviousFeed;
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
      renderDockState();
      renderDrawerBody();
    }
  }

  function showToast(message, { showRefresh = false } = {}) {
    if (!settings.showToast && showRefresh) return;
    ensureShadowUi();
    const toast = shadowRoot?.getElementById('tl-toast');
    const text = shadowRoot?.getElementById('tl-toast-text');
    const btn = shadowRoot?.getElementById('tl-toast-btn');
    if (!toast || !text || !btn) return;

    text.textContent = message;
    btn.hidden = !showRefresh;
    toast.setAttribute('data-visible', 'true');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hideToast(), showRefresh ? 4400 : 2400);
  }

  function hideToast() {
    const toast = shadowRoot?.getElementById('tl-toast');
    if (toast) toast.setAttribute('data-visible', 'false');
  }

  // Zero-reload native SPA video switch!
  function navigateToVideoSpa(url, videoId) {
    setDrawerOpen(false);
    if (videoId) void markVideoWatched(videoId);
    sendToMain(MSG.SPA_NAVIGATE, { url, videoId });
  }

  function getCurrentDrawerVideos() {
    const base =
      drawerTab === 'pinned' ? pinned : snapshots[selectedSnapshotIdx]?.videos || [];
    return E.filterVideos(base, {
      filterMode: drawerTab === 'snapshots' ? filterMode : 'all',
      searchQuery,
      watchedSet,
    });
  }

  function buildDrawerCard(v, pinnedIds, isNeighbor = false) {
    const row = document.createElement('div');
    row.className = 'tl-card';
    if (isNeighbor) row.setAttribute('data-neighbor', 'true');
    row.addEventListener('click', () => navigateToVideoSpa(v.url, v.videoId));

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
    title.textContent = v.displayTitle || v.title || v.videoId;

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

    const isPinned = pinnedIds.has(v.videoId);
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'tl-card-pin';
    pinBtn.setAttribute('data-pinned', isPinned ? 'true' : 'false');
    pinBtn.appendChild(I.createSvgIcon('pin', 14, { filled: isPinned }));
    pinBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      void togglePinVideo(v);
    });

    row.appendChild(thumbWrap);
    row.appendChild(meta);
    row.appendChild(pinBtn);
    return row;
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
        const prefix =
          idx === 0
            ? isZhLocale()
              ? '最近'
              : 'Latest'
            : formatRelativeTime(snap.updatedAt || snap.createdAt);
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

    const filtered = getCurrentDrawerVideos();
    const pinnedIds = new Set(pinned.map((p) => p.videoId));

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

    // Highlight "Right beside what you just watched" when on Latest Snapshot with no search filter!
    const homeAnchorVid = routeAnchors.home?.videoId;
    const showNeighbors =
      drawerTab === 'snapshots' &&
      selectedSnapshotIdx === 0 &&
      !searchQuery &&
      filterMode !== 'watched' &&
      homeAnchorVid;

    const shownNeighborIds = new Set();
    if (showNeighbors) {
      const neighbors = E.extractNeighborVideos(
        snapshots[0]?.videos || [],
        homeAnchorVid,
        watchedSet,
        4
      );
      if (neighbors.length > 0) {
        const hdr = document.createElement('div');
        hdr.className = 'tl-section-header';
        hdr.appendChild(I.createSvgIcon('compass', 13));
        const hdrTxt = document.createElement('span');
        hdrTxt.textContent = t('sectionBesideLast', 'Right beside what you just watched');
        hdr.appendChild(hdrTxt);
        listEl.appendChild(hdr);

        for (const nv of neighbors) {
          shownNeighborIds.add(nv.videoId);
          listEl.appendChild(buildDrawerCard(nv, pinnedIds, true));
        }

        const divider = document.createElement('div');
        divider.className = 'tl-divider';
        listEl.appendChild(divider);
      }
    }

    for (const v of filtered) {
      if (shownNeighborIds.has(v.videoId)) continue;
      listEl.appendChild(buildDrawerCard(v, pinnedIds, false));
    }
  }

  // ---- Receive Events from MAIN World Page Bridge ----
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== BRIDGE_CHANNEL || data.direction !== 'MAIN_TO_ISOLATED') {
      return;
    }

    switch (data.type) {
      case MSG.STATUS_REPORT: {
        bridgeStatus = { ...bridgeStatus, ...(data.payload || {}) };
        renderDockState();
        break;
      }

      case MSG.HOME_CAPTURED: {
        const p = data.payload || {};
        currentFeedId = p.feedId || currentFeedId;
        bridgeStatus.hasCachedFeed = true;
        bridgeStatus.hasPreviousFeed = Boolean(p.hasPreviousFeed);
        bridgeStatus.cardCount = p.count || bridgeStatus.cardCount;
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
        attachScopedGridObserver();
        scheduleDecorateActiveFeed(300);
        break;
      }

      case MSG.CONTINUATION_STITCHED: {
        const p = data.payload || {};
        bridgeStatus.cardCount = p.totalCount || bridgeStatus.cardCount;
        if (Array.isArray(p.videos) && p.videos.length > 0) {
          const next = E.mergeSnapshotVault(
            snapshots,
            {
              feedId: p.feedId || currentFeedId,
              updatedAt: Date.now(),
              scrollY: p.scrollY || liveRouteScrollY.home || 0,
              videos: p.videos,
            },
            settings.maxSnapshots
          );
          await saveSnapshots(next);
        }
        scheduleDecorateActiveFeed(280);
        break;
      }

      case MSG.NAV_AWAY_FROM_LIST: {
        const p = data.payload || {};
        const rk = p.routeKey || E.getRouteAnchorKey(window.location.href);
        if (rk) {
          const y =
            typeof p.scrollY === 'number' && p.scrollY > 0
              ? p.scrollY
              : liveRouteScrollY[rk] || 0;
          await persistRouteAnchor(rk, { scrollY: y, videoId: p.videoId || null });
        }
        if (p.videoId) {
          await markVideoWatched(p.videoId);
        }
        renderDockState();
        break;
      }

      case MSG.WATCHED_VIDEO: {
        const p = data.payload || {};
        if (p.videoId) await markVideoWatched(p.videoId);
        renderDockState();
        break;
      }

      case MSG.FEED_RESTORED: {
        const p = data.payload || {};
        bridgeStatus.hasPreviousFeed = Boolean(p.hasPreviousFeed);
        await incrementStat('refreshesBlocked');
        const countStr = p.cardCount ? ` (${p.cardCount})` : '';
        showToast(`${t('toastRestored', 'Home feed preserved')}${countStr}`, { showRefresh: true });
        restoreScrollForRoute('home');
        attachScopedGridObserver();
        scheduleDecorateActiveFeed(320);
        renderDockState();
        break;
      }

      case MSG.FEED_UNDONE: {
        const p = data.payload || {};
        bridgeStatus.hasPreviousFeed = Boolean(p.hasPreviousFeed);
        await incrementStat('undosPerformed');
        const countStr = p.cardCount ? ` (${p.cardCount})` : '';
        showToast(`${t('toastUndoReady', 'Previous Home feed restored')}${countStr}`, {
          showRefresh: false,
        });
        attachScopedGridObserver();
        scheduleDecorateActiveFeed(320);
        renderDockState();
        break;
      }

      case MSG.NAV_BACK_TO_LIST: {
        const p = data.payload || {};
        const rk = p.routeKey;
        bridgeStatus.hasPreviousFeed = Boolean(p.hasPreviousFeed);
        if (rk && !p.restoredFromCache && !p.undoneFromPrevious) {
          restoreScrollForRoute(rk);
        }
        attachScopedGridObserver();
        scheduleDecorateActiveFeed(300);
        renderDockState();
        break;
      }

      default:
        break;
    }
  });

  // ---- Receive Commands from Popup & Service Worker ----
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;
    (async () => {
      try {
        switch (message.type) {
          case MSG.TOGGLE_DRAWER: {
            setDrawerOpen(!drawerOpen);
            sendResponse({ ok: true, open: drawerOpen });
            break;
          }
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
          case MSG.TRIGGER_UNDO: {
            sendToMain(MSG.UNDO_REFRESH);
            sendResponse({ ok: true });
            break;
          }
          case MSG.NAVIGATE_VIDEO: {
            if (message.url) navigateToVideoSpa(message.url, message.videoId);
            sendResponse({ ok: true });
            break;
          }
          case MSG.PIN_VIDEO_EXTERNAL: {
            const vid = message.videoId || E.extractVideoIdFromUrl(message.url);
            if (vid) {
              // Try enriching title from DOM or snapshots
              let matched = null;
              for (const snap of snapshots) {
                matched = snap.videos.find((v) => v.videoId === vid);
                if (matched) break;
              }
              if (!matched) {
                const link = document.querySelector(
                  `a[href*="/watch?v=${CSS.escape(vid)}"], a[href*="/shorts/${CSS.escape(vid)}"]`
                );
                const cardEl = link?.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer');
                if (cardEl) matched = extractCardInfoFromDomElement(cardEl);
              }
              await togglePinVideo(
                matched || {
                  videoId: vid,
                  title: message.title || `YouTube (${vid})`,
                  url: message.url || `https://www.youtube.com/watch?v=${vid}`,
                },
                true
              );
            }
            sendResponse({ ok: true });
            break;
          }
          case MSG.GET_TAB_STATE: {
            sendResponse({
              ok: true,
              ...bridgeStatus,
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
      scheduleDecorateActiveFeed(80);
    }
    if (changes[STORAGE_KEYS.SNAPSHOTS]?.newValue) {
      snapshots = changes[STORAGE_KEYS.SNAPSHOTS].newValue;
      if (drawerOpen) renderDrawerBody();
    }
    if (changes[STORAGE_KEYS.PINNED]?.newValue) {
      pinned = changes[STORAGE_KEYS.PINNED].newValue;
      renderDockState();
      if (drawerOpen) renderDrawerBody();
      scheduleDecorateActiveFeed(80);
    }
    if (changes[STORAGE_KEYS.WATCHED]?.newValue) {
      watchedSet = new Set(changes[STORAGE_KEYS.WATCHED].newValue);
      scheduleDecorateActiveFeed(80);
      if (drawerOpen) renderDrawerBody();
    }
    if (changes[STORAGE_KEYS.STATS]?.newValue) {
      stats = { ...DEFAULT_STATS, ...changes[STORAGE_KEYS.STATS].newValue };
    }
  });

  // ---- Boot & Scoped Observers ----
  function initDomHooks() {
    ensureShadowUi();

    const htmlObserver = new MutationObserver(() => syncThemeAttr());
    htmlObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dark'],
    });

    document.addEventListener('fullscreenchange', () => updateDockVisibility());
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && drawerOpen) setDrawerOpen(false);
    });

    window.addEventListener('yt-navigate-finish', () => {
      setTimeout(() => {
        attachScopedGridObserver();
        renderDockState();
        scheduleDecorateActiveFeed(200);
      }, 120);
    });

    attachScopedGridObserver();
    scheduleDecorateActiveFeed(250);
  }

  void loadAllState();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDomHooks, { once: true });
  } else {
    initDomHooks();
  }
})();
