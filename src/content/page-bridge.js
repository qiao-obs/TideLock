(function () {
  'use strict';

  if (window.__tidelockPageBridgeInstalled) return;
  window.__tidelockPageBridgeInstalled = true;

  const E = globalThis.__TideLockEngine;
  const IDB = globalThis.__TideLockIdbCache;
  if (!E) return;

  const BRIDGE_CHANNEL = 'TIDELOCK_BRIDGE_V2';

  const state = {
    enabled: true,
    preserveOnLogoFromWatch: true,
    maxStitchedItems: 200,
    idbTtlMs: 12 * 60 * 60 * 1000,
    // Current active Home feed cache
    feedId: null,
    cachedHomeResponse: null,
    stitchedItems: [],
    trailingContinuation: null,
    // Displaced previous Home feed cache (for 1-click Undo Accidental Refresh)
    previousFeed: null,
    undoReplayPending: false,
    // Navigation & intent state
    lastHref: window.location.href,
    lastRouteKey: E.getRouteAnchorKey(window.location.href),
    wasAwayFromHome: !E.isHomePath(window.location.pathname),
    awaySince: E.isHomePath(window.location.pathname) ? 0 : Date.now(),
    returnIntent: null,
    returnIntentAt: 0,
    explicitRefreshUntil: 0,
    explicitLogoOnHome: false,
    activeChipSelected: false,
    restoredThisNav: false,
    undoneThisNav: false,
    hydratedFromIdb: false,
  };

  let persistTimer = null;

  function postToIsolated(type, payload = {}) {
    try {
      window.postMessage(
        {
          channel: BRIDGE_CHANNEL,
          direction: 'MAIN_TO_ISOLATED',
          type,
          payload,
        },
        window.location.origin
      );
    } catch {
      // Ignore postMessage failures during page teardown
    }
  }

  function getCachedCardCount() {
    if (!state.cachedHomeResponse) return 0;
    const baseCards = E.extractSnapshotCardsFromBrowse(
      state.cachedHomeResponse,
      state.maxStitchedItems
    );
    const seen = new Set(baseCards.map((c) => c.videoId));
    for (const item of state.stitchedItems) {
      const id = E.extractItemVideoId(item);
      if (id) seen.add(id);
    }
    return seen.size;
  }

  function schedulePersistToIdb() {
    if (!IDB || !state.cachedHomeResponse) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const currentRecord = {
        feedId: state.feedId,
        savedAt: Date.now(),
        baseResponse: state.cachedHomeResponse,
        stitchedItems: state.stitchedItems.slice(0, state.maxStitchedItems),
        trailingContinuation: state.trailingContinuation,
      };
      void IDB.putFeedSlot('current', currentRecord);
      if (state.previousFeed) {
        void IDB.putFeedSlot('previous', state.previousFeed);
      }
    }, 350);
  }

  async function hydrateFromIdb() {
    if (!IDB) return;
    try {
      const [cur, prev] = await Promise.all([
        IDB.getFeedSlot('current', state.idbTtlMs),
        IDB.getFeedSlot('previous', state.idbTtlMs),
      ]);

      if (prev && prev.baseResponse) {
        state.previousFeed = prev;
      }

      // On non-Home pages (e.g. user refreshed a /watch page or Chrome discarded tab),
      // hydrate current Home feed so pressing Back STILL restores the frozen Home feed!
      if (!E.isHomePath(window.location.pathname)) {
        if (cur && cur.baseResponse && !state.cachedHomeResponse) {
          state.feedId = cur.feedId;
          state.cachedHomeResponse = cur.baseResponse;
          state.stitchedItems = Array.isArray(cur.stitchedItems) ? cur.stitchedItems : [];
          state.trailingContinuation = cur.trailingContinuation || null;
          state.hydratedFromIdb = true;
          state.wasAwayFromHome = true;
        }
      } else {
        // On Home: if a previous feed existed in IDB before this fresh page load (e.g. F5 reload!),
        // preserve that displaced feed in `previousFeed` so user can 1-click Undo Refresh!
        const navEntry = performance.getEntriesByType?.('navigation')?.[0];
        const isReload = navEntry && navEntry.type === 'reload';
        if (cur && cur.baseResponse && (!state.previousFeed || isReload)) {
          state.previousFeed = cur;
        }
      }

      emitStatusReport();
    } catch {
      // IDB optional fallback
    }
  }

  function emitStatusReport() {
    postToIsolated('STATUS_REPORT', {
      enabled: state.enabled,
      hasCachedFeed: Boolean(state.cachedHomeResponse),
      hasPreviousFeed: Boolean(state.previousFeed),
      hydratedFromIdb: state.hydratedFromIdb,
      feedId: state.feedId,
      cardCount: getCachedCardCount(),
      isHome: E.isHomePath(window.location.pathname),
      routeKey: E.getRouteAnchorKey(window.location.href),
      wasAwayFromHome: state.wasAwayFromHome,
    });
  }

  function captureFreshHomeFeed(responseData, source = 'fetch') {
    if (!responseData || !E.findRichGridContents(responseData)) return;

    const cloned = E.safeClone(responseData);
    const incomingCards = E.extractSnapshotCardsFromBrowse(cloned, state.maxStitchedItems);

    // Rotate displaced active feed into `previousFeed` slot if genuinely distinct
    if (state.cachedHomeResponse) {
      const prevCards = E.extractSnapshotCardsFromBrowse(
        state.cachedHomeResponse,
        state.maxStitchedItems
      );
      if (E.computeOverlapRatio(prevCards, incomingCards) < 0.55) {
        state.previousFeed = {
          feedId: state.feedId,
          savedAt: Date.now(),
          baseResponse: state.cachedHomeResponse,
          stitchedItems: state.stitchedItems.slice(0, state.maxStitchedItems),
          trailingContinuation: state.trailingContinuation,
        };
      }
    }

    state.feedId = `feed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    state.cachedHomeResponse = cloned;
    state.stitchedItems = [];
    state.trailingContinuation = null;
    state.wasAwayFromHome = false;
    state.explicitLogoOnHome = false;
    state.activeChipSelected = false;
    state.hydratedFromIdb = false;

    schedulePersistToIdb();

    postToIsolated('HOME_CAPTURED', {
      feedId: state.feedId,
      source,
      count: incomingCards.length,
      videos: incomingCards,
      hasPreviousFeed: Boolean(state.previousFeed),
      scrollY: window.scrollY || 0,
    });
  }

  function appendContinuationResponse(responseData) {
    if (!state.cachedHomeResponse || state.activeChipSelected) return;
    if (!E.isHomePath(window.location.pathname)) return;

    const { items, trailingContinuation } = E.extractContinuationItems(responseData);
    if (trailingContinuation) {
      state.trailingContinuation = E.safeClone(trailingContinuation);
    }
    if (!items.length) return;

    const existingIds = new Set(
      E.extractSnapshotCardsFromBrowse(state.cachedHomeResponse, state.maxStitchedItems).map(
        (c) => c.videoId
      )
    );
    for (const prev of state.stitchedItems) {
      const id = E.extractItemVideoId(prev);
      if (id) existingIds.add(id);
    }

    const newCards = [];
    for (const item of items) {
      if (state.stitchedItems.length >= state.maxStitchedItems) break;
      const card = E.extractCardFromRichItem(item);
      if (card) {
        if (existingIds.has(card.videoId)) continue;
        existingIds.add(card.videoId);
        newCards.push(card);
      }
      state.stitchedItems.push(E.safeClone(item));
    }

    if (newCards.length > 0) {
      schedulePersistToIdb();
      postToIsolated('CONTINUATION_STITCHED', {
        feedId: state.feedId,
        videos: newCards,
        totalCount: existingIds.size,
        scrollY: window.scrollY || 0,
      });
    }
  }

  function buildIntentStateSnapshot() {
    return {
      enabled: state.enabled,
      preserveOnLogoFromWatch: state.preserveOnLogoFromWatch,
      hasCachedFeed: Boolean(state.cachedHomeResponse),
      undoReplayPending: state.undoReplayPending,
      explicitRefreshUntil: state.explicitRefreshUntil,
      explicitLogoOnHome: state.explicitLogoOnHome,
      returnIntent: state.returnIntent,
      returnIntentAt: state.returnIntentAt,
      wasAwayFromHome: state.wasAwayFromHome,
    };
  }

  // ---- Native YouTube SPA Navigation (ZERO Full-Page Reload!) ----
  function dispatchYouTubeSpaEndpoint(endpoint, fallbackUrl) {
    const startHref = window.location.href;
    const ytApp = document.querySelector('ytd-app');

    // Method 1: Polymer ytd-app.fire('yt-navigate', { endpoint })
    try {
      if (ytApp && typeof ytApp.fire === 'function') {
        ytApp.fire('yt-navigate', { endpoint });
      } else {
        window.dispatchEvent(
          new CustomEvent('yt-navigate', {
            bubbles: true,
            composed: true,
            detail: { endpoint },
          })
        );
      }
    } catch {
      // Try fallback anchor click
    }

    // Verify SPA router accepted the transition within 320ms; fallback cleanly if not
    setTimeout(() => {
      if (window.location.href === startHref && fallbackUrl && fallbackUrl !== startHref) {
        window.location.href = fallbackUrl;
      }
    }, 320);
  }

  function spaNavigateToVideo(url, videoId) {
    const vid = videoId || E.extractVideoIdFromUrl(url);
    const isShort = typeof url === 'string' && url.includes('/shorts/');

    if (E.isHomePath(window.location.pathname)) {
      state.wasAwayFromHome = true;
      state.awaySince = Date.now();
    }

    if (!vid) {
      if (url) window.location.href = url;
      return;
    }

    if (isShort) {
      const endpoint = {
        commandMetadata: {
          webCommandMetadata: {
            url: `/shorts/${vid}`,
            webPageType: 'WEB_PAGE_TYPE_SHORTS',
            rootVe: 37414,
          },
        },
        reelWatchEndpoint: { videoId: vid },
      };
      dispatchYouTubeSpaEndpoint(endpoint, `https://www.youtube.com/shorts/${vid}`);
      return;
    }

    const endpoint = {
      commandMetadata: {
        webCommandMetadata: {
          url: `/watch?v=${vid}`,
          webPageType: 'WEB_PAGE_TYPE_WATCH',
          rootVe: 3832,
        },
      },
      watchEndpoint: { videoId: vid },
    };
    dispatchYouTubeSpaEndpoint(endpoint, `https://www.youtube.com/watch?v=${vid}`);
  }

  function triggerNativeHomeBrowse() {
    const endpoint = {
      commandMetadata: {
        webCommandMetadata: {
          url: '/',
          webPageType: 'WEB_PAGE_TYPE_BROWSE',
          rootVe: 3854,
          apiUrl: '/youtubei/v1/browse',
        },
      },
      browseEndpoint: { browseId: 'FEwhat_to_watch' },
    };
    const ytApp = document.querySelector('ytd-app');
    try {
      if (ytApp && typeof ytApp.fire === 'function') {
        ytApp.fire('yt-navigate', { endpoint });
        return;
      }
    } catch {}

    const logoLink =
      document.querySelector('ytd-topbar-logo-renderer a#logo') ||
      document.querySelector('a#logo[href="/"]');
    if (logoLink) {
      logoLink.click();
    } else {
      window.location.href = 'https://www.youtube.com/';
    }
  }

  function triggerNativeHomeRefresh() {
    state.explicitRefreshUntil = Date.now() + 12000;
    state.undoReplayPending = false;
    state.wasAwayFromHome = false;
    state.returnIntent = null;
    state.returnIntentAt = 0;
    state.activeChipSelected = false;

    triggerNativeHomeBrowse();
  }

  function triggerUndoAccidentalRefresh() {
    if (!state.previousFeed || !state.previousFeed.baseResponse) {
      emitStatusReport();
      return;
    }

    // Swap current <-> previous so user can even toggle back if desired!
    const displaced = state.cachedHomeResponse
      ? {
          feedId: state.feedId,
          savedAt: Date.now(),
          baseResponse: state.cachedHomeResponse,
          stitchedItems: state.stitchedItems.slice(0, state.maxStitchedItems),
          trailingContinuation: state.trailingContinuation,
        }
      : null;

    const target = state.previousFeed;
    state.feedId = target.feedId;
    state.cachedHomeResponse = target.baseResponse;
    state.stitchedItems = Array.isArray(target.stitchedItems) ? target.stitchedItems : [];
    state.trailingContinuation = target.trailingContinuation || null;
    state.previousFeed = displaced;

    state.undoReplayPending = true;
    state.explicitRefreshUntil = 0;
    state.activeChipSelected = false;

    schedulePersistToIdb();
    triggerNativeHomeBrowse();
  }

  // ---- 1. Intercept window.fetch for InnerTube /youtubei/v1/browse ----
  const originalFetch = window.fetch.bind(window);

  async function extractFetchRequestMeta(input, init) {
    let url = '';
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input && typeof input.url === 'string') {
      url = input.url;
    }

    if (!url || !url.includes('/youtubei/v1/browse')) {
      return null;
    }

    let rawBody = init && init.body !== undefined ? init.body : null;
    if (!rawBody && input instanceof Request && input.method && input.method.toUpperCase() === 'POST') {
      try {
        rawBody = await input.clone().text();
      } catch {
        rawBody = null;
      }
    }

    const reqInfo = E.parseBrowseRequestBody(rawBody);
    return { url, reqInfo };
  }

  window.fetch = async function tidelockFetch(input, init) {
    let meta = null;
    try {
      meta = await extractFetchRequestMeta(input, init);
    } catch {
      meta = null;
    }

    if (meta && meta.reqInfo.valid) {
      const { reqInfo } = meta;

      if (reqInfo.isHomeChip) {
        state.activeChipSelected = true;
      }

      const decision = E.shouldInterceptHomeBrowse(buildIntentStateSnapshot(), reqInfo, Date.now());
      if (decision.intercept && state.cachedHomeResponse) {
        const stitched = E.stitchHomeResponse(
          state.cachedHomeResponse,
          state.stitchedItems,
          state.trailingContinuation,
          state.maxStitchedItems
        );
        if (stitched) {
          const isUndo = decision.reason === 'undo_replay';
          state.undoReplayPending = false;
          state.restoredThisNav = true;
          state.undoneThisNav = isUndo;
          state.wasAwayFromHome = false;
          state.returnIntent = null;
          state.returnIntentAt = 0;

          const cardCount = getCachedCardCount();
          postToIsolated(isUndo ? 'FEED_UNDONE' : 'FEED_RESTORED', {
            feedId: state.feedId,
            reason: decision.reason,
            cardCount,
            hasPreviousFeed: Boolean(state.previousFeed),
            awayDurationMs: state.awaySince ? Date.now() - state.awaySince : 0,
          });

          return new Response(JSON.stringify(stitched), {
            status: 200,
            statusText: 'OK',
            headers: {
              'content-type': 'application/json; charset=UTF-8',
              'x-tidelock-restored': '1',
            },
          });
        }
      }

      const response = await originalFetch(input, init);
      if (response.ok) {
        const clone = response.clone();
        void (async () => {
          try {
            const json = await clone.json();
            if (reqInfo.isHomeInitial) {
              state.explicitRefreshUntil = 0;
              captureFreshHomeFeed(json, 'fetch');
            } else if (reqInfo.isContinuation) {
              appendContinuationResponse(json);
            }
          } catch {
            // Never disrupt native fetch response
          }
        })();
      }
      return response;
    }

    return originalFetch(input, init);
  };

  // ---- 2. Observe XMLHttpRequest fallback ----
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function tidelockXhrOpen(method, url) {
    this.__tidelockUrl = typeof url === 'string' ? url : String(url || '');
    return origXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function tidelockXhrSend(body) {
    if (this.__tidelockUrl && this.__tidelockUrl.includes('/youtubei/v1/browse')) {
      const reqInfo = E.parseBrowseRequestBody(body);
      if (reqInfo.valid) {
        this.addEventListener('load', () => {
          try {
            if (this.status >= 200 && this.status < 300 && typeof this.responseText === 'string') {
              const json = JSON.parse(this.responseText);
              if (reqInfo.isHomeInitial) {
                captureFreshHomeFeed(json, 'xhr');
              } else if (reqInfo.isContinuation) {
                appendContinuationResponse(json);
              }
            }
          } catch {}
        });
      }
    }
    return origXhrSend.apply(this, arguments);
  };

  // ---- 3. Capture Initial SSR ytInitialData & Polymer Events ----
  function tryCaptureInitialData(source) {
    if (!E.isHomePath(window.location.pathname)) return;
    if (state.cachedHomeResponse) return;
    if (window.ytInitialData && E.findRichGridContents(window.ytInitialData)) {
      captureFreshHomeFeed(window.ytInitialData, source);
    }
  }

  window.addEventListener('yt-page-data-updated', (event) => {
    try {
      const pageData = event?.detail?.pageData;
      const browseEp = pageData?.endpoint?.browseEndpoint;
      const isHomeBrowse =
        browseEp && browseEp.browseId === 'FEwhat_to_watch' && !browseEp.params;
      if (isHomeBrowse && pageData.response && !state.cachedHomeResponse) {
        captureFreshHomeFeed(pageData.response, 'yt-page-data-updated');
      }
    } catch {}
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => tryCaptureInitialData('dom-ready'), {
      once: true,
    });
  } else {
    tryCaptureInitialData('immediate');
  }

  // Hydrate persistent cache from IndexedDB immediately
  void hydrateFromIdb();

  // ---- 4. Navigation Intent & Multi-Route Tracking ----
  window.addEventListener('popstate', () => {
    if (E.isHomePath(window.location.pathname)) {
      state.returnIntent = 'BACK_TRAVERSE';
      state.returnIntentAt = Date.now();
    }
  });

  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    try {
      window.navigation.addEventListener('navigate', (event) => {
        try {
          const destUrl = new URL(event.destination.url);
          const toHome = E.isHomePath(destUrl.pathname);
          const fromRoute = E.getRouteAnchorKey(window.location.href);
          const toRoute = E.getRouteAnchorKey(destUrl.href);

          if (event.navigationType === 'traverse' && toHome) {
            state.returnIntent = 'BACK_TRAVERSE';
            state.returnIntentAt = Date.now();
          } else if (fromRoute && fromRoute !== toRoute) {
            if (fromRoute === 'home') {
              state.wasAwayFromHome = true;
              state.awaySince = Date.now();
            }
            postToIsolated('NAV_AWAY_FROM_LIST', {
              routeKey: fromRoute,
              toUrl: destUrl.href,
              scrollY: window.scrollY || 0,
              videoId: E.extractVideoIdFromUrl(destUrl.href),
            });
          }
        } catch {}
      });
    } catch {}
  }

  document.addEventListener(
    'click',
    (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;

      const homeLink = target.closest(
        'ytd-topbar-logo-renderer a#logo, a#logo[href="/"], ytd-guide-entry-renderer a[href="/"], ytd-mini-guide-entry-renderer a[href="/"]'
      );
      if (homeLink) {
        if (E.isHomePath(window.location.pathname)) {
          state.explicitRefreshUntil = Date.now() + 8000;
          state.explicitLogoOnHome = true;
          state.returnIntent = null;
          state.activeChipSelected = false;
        } else {
          state.returnIntent = 'LOGO_FROM_AWAY';
          state.returnIntentAt = Date.now();
          state.explicitLogoOnHome = false;
        }
        return;
      }

      const chip = target.closest('yt-chip-cloud-chip-renderer');
      if (chip && E.isHomePath(window.location.pathname)) {
        const isFirstChip = chip.parentElement && chip.parentElement.firstElementChild === chip;
        state.activeChipSelected = !isFirstChip;
        if (isFirstChip) {
          state.explicitRefreshUntil = Date.now() + 4000;
        }
        return;
      }

      const currRoute = E.getRouteAnchorKey(window.location.href);
      if (currRoute) {
        const videoAnchor = target.closest('a[href*="/watch?"], a[href*="/shorts/"]');
        if (videoAnchor) {
          const href = videoAnchor.getAttribute('href') || '';
          const vid = E.extractVideoIdFromUrl(href);
          if (vid) {
            if (currRoute === 'home') {
              state.wasAwayFromHome = true;
              state.awaySince = Date.now();
            }
            postToIsolated('NAV_AWAY_FROM_LIST', {
              routeKey: currRoute,
              videoId: vid,
              toUrl: href,
              scrollY: window.scrollY || 0,
            });
          }
        }
      }
    },
    true
  );

  window.addEventListener('yt-navigate-start', (event) => {
    const prevRoute = state.lastRouteKey;
    const nextUrl = event?.detail?.url || window.location.href;
    const nextRoute = E.getRouteAnchorKey(nextUrl);

    if (prevRoute && prevRoute !== nextRoute) {
      if (prevRoute === 'home') {
        state.wasAwayFromHome = true;
        state.awaySince = Date.now();
        state.restoredThisNav = false;
        state.undoneThisNav = false;
      }
      postToIsolated('NAV_AWAY_FROM_LIST', {
        routeKey: prevRoute,
        toUrl: nextUrl,
        videoId: E.extractVideoIdFromUrl(nextUrl),
        scrollY: window.scrollY || 0,
      });
    }
  });

  window.addEventListener('yt-navigate-finish', () => {
    const currHref = window.location.href;
    const currRoute = E.getRouteAnchorKey(currHref);
    const prevRoute = state.lastRouteKey;
    state.lastHref = currHref;
    state.lastRouteKey = currRoute;

    const currentVideoId = E.extractVideoIdFromUrl(currHref);
    if (currentVideoId) {
      postToIsolated('WATCHED_VIDEO', {
        videoId: currentVideoId,
        url: currHref,
      });
    }

    if (currRoute === 'home') {
      tryCaptureInitialData('navigate-finish');
    }

    if (currRoute && currRoute !== prevRoute) {
      const wasRestored = currRoute === 'home' ? state.restoredThisNav : false;
      const wasUndone = currRoute === 'home' ? state.undoneThisNav : false;
      state.restoredThisNav = false;
      state.undoneThisNav = false;
      if (currRoute === 'home') state.wasAwayFromHome = false;

      postToIsolated('NAV_BACK_TO_LIST', {
        routeKey: currRoute,
        feedId: state.feedId,
        restoredFromCache: wasRestored,
        undoneFromPrevious: wasUndone,
        hasPreviousFeed: Boolean(state.previousFeed),
        cardCount: getCachedCardCount(),
      });
    }

    emitStatusReport();
  });

  // ---- 5. Listen to Commands from ISOLATED Content Script ----
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== BRIDGE_CHANNEL || data.direction !== 'ISOLATED_TO_MAIN') {
      return;
    }

    switch (data.type) {
      case 'SYNC_SETTINGS': {
        const s = data.payload || {};
        if (typeof s.enabled === 'boolean') state.enabled = s.enabled;
        if (typeof s.preserveOnLogoFromWatch === 'boolean') {
          state.preserveOnLogoFromWatch = s.preserveOnLogoFromWatch;
        }
        if (typeof s.maxStitchedItems === 'number' && s.maxStitchedItems >= 20) {
          state.maxStitchedItems = s.maxStitchedItems;
        }
        if (typeof s.idbTtlHours === 'number' && s.idbTtlHours > 0) {
          state.idbTtlMs = s.idbTtlHours * 60 * 60 * 1000;
        }
        emitStatusReport();
        break;
      }
      case 'FORCE_REFRESH': {
        triggerNativeHomeRefresh();
        break;
      }
      case 'UNDO_REFRESH': {
        triggerUndoAccidentalRefresh();
        break;
      }
      case 'SPA_NAVIGATE': {
        const p = data.payload || {};
        spaNavigateToVideo(p.url, p.videoId);
        break;
      }
      case 'REQUEST_STATUS': {
        emitStatusReport();
        break;
      }
      default:
        break;
    }
  });
})();
