(function () {
  'use strict';

  if (window.__tidelockPageBridgeInstalled) return;
  window.__tidelockPageBridgeInstalled = true;

  const E = globalThis.__TideLockEngine;
  if (!E) return;

  const BRIDGE_CHANNEL = 'TIDELOCK_BRIDGE_V1';

  const state = {
    enabled: true,
    preserveOnLogoFromWatch: true,
    maxStitchedItems: 180,
    // Feed cache
    feedId: null,
    cachedHomeResponse: null,
    stitchedItems: [],
    trailingContinuation: null,
    // Navigation & intent state
    lastPathname: window.location.pathname,
    wasAwayFromHome: false,
    awaySince: 0,
    returnIntent: null,
    returnIntentAt: 0,
    explicitRefreshUntil: 0,
    explicitLogoOnHome: false,
    activeChipSelected: false,
    restoredThisNav: false,
  };

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
    const baseCards = E.extractSnapshotCardsFromBrowse(state.cachedHomeResponse, state.maxStitchedItems);
    const seen = new Set(baseCards.map((c) => c.videoId));
    for (const item of state.stitchedItems) {
      const id = E.extractItemVideoId(item);
      if (id) seen.add(id);
    }
    return seen.size;
  }

  function captureFreshHomeFeed(responseData, source = 'fetch') {
    if (!responseData || !E.findRichGridContents(responseData)) return;

    const cloned = E.safeClone(responseData);
    state.feedId = `feed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    state.cachedHomeResponse = cloned;
    state.stitchedItems = [];
    state.trailingContinuation = null;
    state.wasAwayFromHome = false;
    state.explicitLogoOnHome = false;
    state.activeChipSelected = false;

    const cards = E.extractSnapshotCardsFromBrowse(cloned, state.maxStitchedItems);
    postToIsolated('HOME_CAPTURED', {
      feedId: state.feedId,
      source,
      count: cards.length,
      videos: cards,
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
      E.extractSnapshotCardsFromBrowse(state.cachedHomeResponse, state.maxStitchedItems).map((c) => c.videoId)
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
      explicitRefreshUntil: state.explicitRefreshUntil,
      explicitLogoOnHome: state.explicitLogoOnHome,
      returnIntent: state.returnIntent,
      returnIntentAt: state.returnIntentAt,
      wasAwayFromHome: state.wasAwayFromHome,
    };
  }

  function triggerNativeHomeRefresh() {
    state.explicitRefreshUntil = Date.now() + 12000;
    state.wasAwayFromHome = false;
    state.returnIntent = null;
    state.returnIntentAt = 0;
    state.activeChipSelected = false;
    state.cachedHomeResponse = null;
    state.stitchedItems = [];
    state.trailingContinuation = null;

    const logoLink =
      document.querySelector('ytd-topbar-logo-renderer a#logo') ||
      document.querySelector('a#logo[href="/"]');

    if (E.isHomePath(window.location.pathname) && logoLink) {
      logoLink.click();
    } else if (logoLink) {
      logoLink.click();
    } else {
      window.location.href = 'https://www.youtube.com/';
    }
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

      // Track whether user selected a Home category chip
      if (reqInfo.isHomeChip) {
        state.activeChipSelected = true;
      }

      // Check if we should freeze and replay the cached Home feed
      const decision = E.shouldInterceptHomeBrowse(buildIntentStateSnapshot(), reqInfo, Date.now());
      if (decision.intercept && state.cachedHomeResponse) {
        const stitched = E.stitchHomeResponse(
          state.cachedHomeResponse,
          state.stitchedItems,
          state.trailingContinuation,
          state.maxStitchedItems
        );
        if (stitched) {
          state.restoredThisNav = true;
          state.wasAwayFromHome = false;
          state.returnIntent = null;
          state.returnIntentAt = 0;

          const cardCount = getCachedCardCount();
          postToIsolated('FEED_RESTORED', {
            feedId: state.feedId,
            reason: decision.reason,
            cardCount,
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

      // Pass through to real YouTube server and observe response
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

  // ---- 2. Observe XMLHttpRequest fallback (defensive) ----
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
          } catch {
            // Ignore non-JSON payloads
          }
        });
      }
    }
    return origXhrSend.apply(this, arguments);
  };

  // ---- 3. Capture Initial SSR ytInitialData & YouTube SPA events ----
  function tryCaptureInitialData(source) {
    if (!E.isHomePath(window.location.pathname)) return;
    if (state.cachedHomeResponse) return;
    if (window.ytInitialData && E.findRichGridContents(window.ytInitialData)) {
      captureFreshHomeFeed(window.ytInitialData, source);
    }
  }

  window.addEventListener('yt-page-data-updated', (event) => {
    try {
      const detail = event && event.detail;
      const pageData = detail && detail.pageData;
      const endpoint = pageData && pageData.endpoint;
      const browseEp = endpoint && endpoint.browseEndpoint;
      const isHomeBrowse =
        browseEp && browseEp.browseId === 'FEwhat_to_watch' && !browseEp.params;

      if (isHomeBrowse && pageData.response && !state.cachedHomeResponse) {
        captureFreshHomeFeed(pageData.response, 'yt-page-data-updated');
      }
    } catch {
      // Ignore unexpected event shape
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => tryCaptureInitialData('dom-ready'), {
      once: true,
    });
  } else {
    tryCaptureInitialData('immediate');
  }

  // ---- 4. Track Navigation Intent (Back, Logo, Video Clicks, SPA Transitions) ----
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
          const fromHome = E.isHomePath(window.location.pathname);

          if (event.navigationType === 'traverse' && toHome) {
            state.returnIntent = 'BACK_TRAVERSE';
            state.returnIntentAt = Date.now();
          } else if (fromHome && !toHome) {
            state.wasAwayFromHome = true;
            state.awaySince = Date.now();
            postToIsolated('NAV_AWAY_FROM_HOME', {
              toUrl: destUrl.href,
              scrollY: window.scrollY || 0,
              videoId: E.extractVideoIdFromUrl(destUrl.href),
            });
          }
        } catch {
          // Ignore invalid destination URLs
        }
      });
    } catch {
      // Navigation API optional
    }
  }

  // Capture user click intent before YouTube handles it
  document.addEventListener(
    'click',
    (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;

      // 1) YouTube Logo or Home sidebar entry
      const homeLink = target.closest(
        'ytd-topbar-logo-renderer a#logo, a#logo[href="/"], ytd-guide-entry-renderer a[href="/"], ytd-mini-guide-entry-renderer a[href="/"]'
      );
      if (homeLink) {
        if (E.isHomePath(window.location.pathname)) {
          // Clicking Home / Logo while ALREADY on Home means user wants fresh videos
          state.explicitRefreshUntil = Date.now() + 8000;
          state.explicitLogoOnHome = true;
          state.returnIntent = null;
          state.activeChipSelected = false;
        } else {
          // Clicking Logo/Home from Watch/Shorts -> return to frozen Home if enabled
          state.returnIntent = 'LOGO_FROM_AWAY';
          state.returnIntentAt = Date.now();
          state.explicitLogoOnHome = false;
        }
        return;
      }

      // 2) Category chip on Home
      const chip = target.closest('yt-chip-cloud-chip-renderer');
      if (chip && E.isHomePath(window.location.pathname)) {
        const isFirstChip = chip.parentElement && chip.parentElement.firstElementChild === chip;
        state.activeChipSelected = !isFirstChip;
        if (isFirstChip) {
          state.explicitRefreshUntil = Date.now() + 4000;
        }
        return;
      }

      // 3) Clicking a video card while on Home
      if (E.isHomePath(window.location.pathname)) {
        const videoAnchor = target.closest('a[href*="/watch?"], a[href*="/shorts/"]');
        if (videoAnchor) {
          const href = videoAnchor.getAttribute('href') || '';
          const vid = E.extractVideoIdFromUrl(href);
          if (vid) {
            state.wasAwayFromHome = true;
            state.awaySince = Date.now();
            postToIsolated('NAV_AWAY_FROM_HOME', {
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
    const prevPath = state.lastPathname;
    const nextUrl = event?.detail?.url || window.location.pathname;
    let nextPath = window.location.pathname;
    try {
      nextPath = new URL(nextUrl, window.location.origin).pathname;
    } catch {
      nextPath = window.location.pathname;
    }

    if (E.isHomePath(prevPath) && !E.isHomePath(nextPath)) {
      state.wasAwayFromHome = true;
      state.awaySince = Date.now();
      state.restoredThisNav = false;
      postToIsolated('NAV_AWAY_FROM_HOME', {
        toUrl: nextUrl,
        videoId: E.extractVideoIdFromUrl(nextUrl),
        scrollY: window.scrollY || 0,
      });
    }
  });

  window.addEventListener('yt-navigate-finish', () => {
    const currPath = window.location.pathname;
    const prevPath = state.lastPathname;
    state.lastPathname = currPath;

    const currentVideoId = E.extractVideoIdFromUrl(window.location.href);
    if (currentVideoId) {
      postToIsolated('WATCHED_VIDEO', {
        videoId: currentVideoId,
        url: window.location.href,
      });
    }

    if (E.isHomePath(currPath)) {
      tryCaptureInitialData('navigate-finish');
      if (!E.isHomePath(prevPath)) {
        const wasRestored = state.restoredThisNav;
        state.restoredThisNav = false;
        state.wasAwayFromHome = false;
        postToIsolated('NAV_BACK_TO_HOME', {
          feedId: state.feedId,
          restoredFromCache: wasRestored,
          cardCount: getCachedCardCount(),
        });
      }
    }
  });

  // ---- 5. Listen to Commands from ISOLATED Content Script ----
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
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
        break;
      }
      case 'FORCE_REFRESH': {
        triggerNativeHomeRefresh();
        break;
      }
      case 'REQUEST_STATUS': {
        postToIsolated('STATUS_REPORT', {
          enabled: state.enabled,
          hasCachedFeed: Boolean(state.cachedHomeResponse),
          feedId: state.feedId,
          cardCount: getCachedCardCount(),
          isHome: E.isHomePath(window.location.pathname),
          wasAwayFromHome: state.wasAwayFromHome,
        });
        break;
      }
      default:
        break;
    }
  });
})();
