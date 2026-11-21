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
    lastReturnedHomeAt: 0,
    lastChipClickAt: 0,
    explicitRefreshUntil: 0,
    explicitLogoOnHome: false,
    activeChipSelected: false,
    restoredThisNav: false,
    undoneThisNav: false,
    hydratedFromIdb: false,
    lastCaptureSource: '',
    lastDecision: '',
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
    } catch {}
  }

  function getCachedCards() {
    if (!state.cachedHomeResponse) return [];
    const baseCards = E.extractSnapshotCardsFromBrowse(
      state.cachedHomeResponse,
      state.maxStitchedItems
    );
    const extraCards = E.extractSnapshotCardsFromItems(
      state.stitchedItems,
      state.maxStitchedItems
    );
    const byId = new Map();
    for (const c of baseCards) byId.set(c.videoId, c);
    for (const c of extraCards) {
      if (!byId.has(c.videoId)) byId.set(c.videoId, c);
    }
    return Array.from(byId.values()).slice(0, state.maxStitchedItems);
  }

  function getCachedCardCount() {
    return getCachedCards().length;
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
    }, 250);
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

      if (!E.isHomePath(window.location.pathname)) {
        if (cur && cur.baseResponse && !state.cachedHomeResponse) {
          state.feedId = cur.feedId;
          state.cachedHomeResponse = cur.baseResponse;
          state.stitchedItems = Array.isArray(cur.stitchedItems) ? cur.stitchedItems : [];
          state.trailingContinuation = cur.trailingContinuation || null;
          state.hydratedFromIdb = true;
          state.wasAwayFromHome = true;
          state.lastCaptureSource = 'idb-hydrate';
        }
      } else {
        const navEntry = performance.getEntriesByType?.('navigation')?.[0];
        const isReload = navEntry && navEntry.type === 'reload';
        if (cur && cur.baseResponse && (!state.previousFeed || isReload)) {
          state.previousFeed = cur;
        }
      }

      emitStatusReport();
    } catch {}
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
      lastCaptureSource: state.lastCaptureSource,
      lastDecision: state.lastDecision,
    });
  }

  function captureFreshHomeFeed(responseData, source = 'fetch') {
    if (!responseData || !E.findRichGridContents(responseData)) return false;

    const cloned = E.safeClone(responseData);
    const incomingCards = E.extractSnapshotCardsFromBrowse(cloned, state.maxStitchedItems);
    if (incomingCards.length === 0) return false;

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
    state.lastCaptureSource = source;

    schedulePersistToIdb();

    postToIsolated('HOME_CAPTURED', {
      feedId: state.feedId,
      source,
      count: incomingCards.length,
      videos: incomingCards,
      hasPreviousFeed: Boolean(state.previousFeed),
      scrollY: window.scrollY || 0,
    });
    return true;
  }

  function appendContinuationResponse(responseData) {
    if (!state.cachedHomeResponse || state.activeChipSelected) return;
    if (!E.isHomePath(window.location.pathname)) return;

    const { items, trailingContinuation } = E.extractContinuationItems(responseData);
    if (trailingContinuation) {
      state.trailingContinuation = E.safeClone(trailingContinuation);
    }
    if (!items.length) return;

    const existingIds = new Set(getCachedCards().map((c) => c.videoId));
    const newCards = [];

    for (const item of items) {
      if (state.stitchedItems.length >= state.maxStitchedItems) break;
      const extracted = E.extractSnapshotCardsFromItems([item], 32);
      if (extracted.length > 0) {
        const unseen = extracted.filter((c) => !existingIds.has(c.videoId));
        if (unseen.length === 0) continue;
        for (const c of unseen) {
          existingIds.add(c.videoId);
          newCards.push(c);
        }
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
    const recentlyReturnedHome =
      Boolean(state.lastReturnedHomeAt) && Date.now() - state.lastReturnedHomeAt <= 5000;
    return {
      enabled: state.enabled,
      preserveOnLogoFromWatch: state.preserveOnLogoFromWatch,
      hasCachedFeed: Boolean(state.cachedHomeResponse),
      undoReplayPending: state.undoReplayPending,
      explicitRefreshUntil: state.explicitRefreshUntil,
      explicitLogoOnHome: state.explicitLogoOnHome,
      returnIntent: state.returnIntent,
      returnIntentAt: state.returnIntentAt,
      lastChipClickAt: state.lastChipClickAt,
      wasAwayFromHome: state.wasAwayFromHome || recentlyReturnedHome,
    };
  }

  // ---- Native YouTube SPA Navigation (ZERO Full-Page Reload!) ----
  function dispatchYouTubeSpaEndpoint(endpoint, fallbackUrl) {
    const startHref = window.location.href;
    const ytApp = document.querySelector('ytd-app');

    try {
      if (ytApp && typeof ytApp.fire === 'function') {
        ytApp.fire('yt-navigate', { endpoint });
      } else {
        document.dispatchEvent(
          new CustomEvent('yt-navigate', {
            bubbles: true,
            composed: true,
            detail: { endpoint },
          })
        );
      }
    } catch {}

    setTimeout(() => {
      if (window.location.href === startHref && fallbackUrl && fallbackUrl !== startHref) {
        window.location.href = fallbackUrl;
      }
    }, 350);
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
      dispatchYouTubeSpaEndpoint(
        {
          commandMetadata: {
            webCommandMetadata: {
              url: `/shorts/${vid}`,
              webPageType: 'WEB_PAGE_TYPE_SHORTS',
              rootVe: 37414,
            },
          },
          reelWatchEndpoint: { videoId: vid },
        },
        `https://www.youtube.com/shorts/${vid}`
      );
      return;
    }

    dispatchYouTubeSpaEndpoint(
      {
        commandMetadata: {
          webCommandMetadata: {
            url: `/watch?v=${vid}`,
            webPageType: 'WEB_PAGE_TYPE_WATCH',
            rootVe: 3832,
          },
        },
        watchEndpoint: { videoId: vid },
      },
      `https://www.youtube.com/watch?v=${vid}`
    );
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
    state.lastReturnedHomeAt = 0;
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

  // ---- 1. Intercept window.fetch for InnerTube /youtubei/v1/browse (with gzip/deflate decoding) ----
  const originalFetch = window.fetch.bind(window);

  function readHeaderValue(headers, name) {
    if (!headers) return '';
    const target = name.toLowerCase();
    try {
      if (typeof headers.get === 'function') {
        return headers.get(name) || headers.get(target) || '';
      }
      if (Array.isArray(headers)) {
        for (const pair of headers) {
          if (Array.isArray(pair) && String(pair[0] || '').toLowerCase() === target) {
            return String(pair[1] || '');
          }
        }
      } else if (typeof headers === 'object') {
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === target) return String(v || '');
        }
      }
    } catch {}
    return '';
  }

  async function decodeBytesToText(bytes, contentEncoding = '') {
    if (!bytes || bytes.byteLength === 0) return '';
    const enc = (contentEncoding || '').toLowerCase();
    const hasGzipMagic = bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const isGzip = hasGzipMagic || enc.includes('gzip');
    const isDeflate = !isGzip && enc.includes('deflate');

    if ((isGzip || isDeflate) && typeof DecompressionStream === 'function') {
      try {
        const ds = new DecompressionStream(isGzip ? 'gzip' : 'deflate');
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        return await new Response(stream).text();
      } catch {
        // Fall through to plain UTF-8 decode if stream wasn't actually compressed
      }
    }
    return new TextDecoder().decode(bytes);
  }

  async function extractBodyText(rawBody, contentEncoding = '') {
    if (rawBody === null || rawBody === undefined) return '';
    if (typeof rawBody === 'string') return rawBody;
    if (ArrayBuffer.isView(rawBody)) {
      const bytes = new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
      return decodeBytesToText(bytes, contentEncoding);
    }
    if (Object.prototype.toString.call(rawBody) === '[object ArrayBuffer]') {
      return decodeBytesToText(new Uint8Array(rawBody), contentEncoding);
    }
    if (typeof Blob !== 'undefined' && rawBody instanceof Blob) {
      const buf = await rawBody.arrayBuffer();
      return decodeBytesToText(new Uint8Array(buf), contentEncoding);
    }
    return '';
  }

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

    const contentEncoding =
      readHeaderValue(init && init.headers, 'content-encoding') ||
      (input instanceof Request ? readHeaderValue(input.headers, 'content-encoding') : '');

    let rawText = '';
    if (init && init.body !== undefined && init.body !== null) {
      rawText = await extractBodyText(init.body, contentEncoding);
    } else if (
      input instanceof Request &&
      (!input.method || input.method.toUpperCase() === 'POST')
    ) {
      try {
        const buf = await input.clone().arrayBuffer();
        rawText = await decodeBytesToText(new Uint8Array(buf), contentEncoding);
      } catch {
        rawText = '';
      }
    }

    const reqInfo = E.parseBrowseRequestBody(rawText);
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

      const decision = E.shouldInterceptHomeBrowse(buildIntentStateSnapshot(), reqInfo, Date.now());
      if (reqInfo.isHomeBrowse) {
        state.lastDecision = `${decision.intercept ? 'LOCKED' : 'PASS'}:${decision.reason}${reqInfo.hasParams ? '+p' : ''}`;
      }

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
          state.lastReturnedHomeAt = 0;
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
          emitStatusReport();

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
            if (reqInfo.isHomeBrowse && decision.reason !== 'explicit_chip_filter') {
              state.explicitRefreshUntil = 0;
              captureFreshHomeFeed(json, 'fetch');
            } else if (reqInfo.isContinuation) {
              appendContinuationResponse(json);
            }
          } catch {}
        })();
      }
      return response;
    }

    return originalFetch(input, init);
  };

  // ---- 2. Observe XMLHttpRequest fallback (supports gzipped bodies too) ----
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;
  const origXhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function tidelockXhrOpen(method, url) {
    this.__tidelockUrl = typeof url === 'string' ? url : String(url || '');
    this.__tidelockEncoding = '';
    return origXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function tidelockXhrSetHeader(name, value) {
    if (typeof name === 'string' && name.toLowerCase() === 'content-encoding') {
      this.__tidelockEncoding = String(value || '');
    }
    return origXhrSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function tidelockXhrSend(body) {
    if (this.__tidelockUrl && this.__tidelockUrl.includes('/youtubei/v1/browse')) {
      const encoding = this.__tidelockEncoding || '';
      this.addEventListener('load', async () => {
        try {
          const txt = await extractBodyText(body, encoding);
          const reqInfo = E.parseBrowseRequestBody(txt);
          if (!reqInfo.valid) return;
          if (this.status >= 200 && this.status < 300 && typeof this.responseText === 'string') {
            const json = JSON.parse(this.responseText);
            if (reqInfo.isHomeBrowse && !reqInfo.hasParams) {
              captureFreshHomeFeed(json, 'xhr');
            } else if (reqInfo.isContinuation) {
              appendContinuationResponse(json);
            }
          }
        } catch {}
      });
    }
    return origXhrSend.apply(this, arguments);
  };

  // ---- 3. Multi-Source Initial Home Feed Capture (ytInitialData poll + Polymer browse.data + yt-page-data-updated) ----
  function tryCaptureInitialData(source) {
    if (!E.isHomePath(window.location.pathname)) return false;
    if (state.cachedHomeResponse) return true;

    if (window.ytInitialData && captureFreshHomeFeed(window.ytInitialData, source)) {
      return true;
    }

    // Fallback: Polymer <ytd-browse page-subtype="home"> holds live response in .data
    const browseEl = document.querySelector('ytd-browse[page-subtype="home"]');
    if (browseEl && browseEl.data && captureFreshHomeFeed(browseEl.data, `${source}:browse.data`)) {
      return true;
    }
    return false;
  }

  // Short-lived poll (up to 24s) for streaming ytInitialData / Polymer hydration on Home (proxy-friendly)
  let initialPollTicks = 0;
  const initialPollTimer = setInterval(() => {
    initialPollTicks++;
    if (
      state.cachedHomeResponse ||
      !E.isHomePath(window.location.pathname) ||
      initialPollTicks > 120
    ) {
      clearInterval(initialPollTimer);
      return;
    }
    if (tryCaptureInitialData('poll')) {
      clearInterval(initialPollTimer);
    }
  }, 200);

  window.addEventListener('load', () => tryCaptureInitialData('window-load'), { once: true });

  function onPageDataUpdated(event) {
    try {
      const pageData = event?.detail?.pageData;
      const browseEp = pageData?.endpoint?.browseEndpoint;
      const isHomeBrowse = browseEp && browseEp.browseId === 'FEwhat_to_watch' && !browseEp.params;
      if (isHomeBrowse && pageData.response && !state.cachedHomeResponse) {
        captureFreshHomeFeed(pageData.response, 'yt-page-data-updated');
      }
    } catch {}
  }

  window.addEventListener('yt-page-data-updated', onPageDataUpdated);
  document.addEventListener('yt-page-data-updated', onPageDataUpdated);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => tryCaptureInitialData('dom-ready'), {
      once: true,
    });
  } else {
    tryCaptureInitialData('immediate');
  }

  void hydrateFromIdb();

  // ---- 4. Navigation Intent & Multi-Route Tracking (listen on BOTH document & window!) ----
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
          state.lastReturnedHomeAt = 0;
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
        if (!isFirstChip) {
          state.lastChipClickAt = Date.now();
          state.lastReturnedHomeAt = 0;
        } else {
          state.explicitRefreshUntil = Date.now() + 4000;
          state.lastReturnedHomeAt = 0;
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

  let lastNavStartAt = 0;
  function onNavigateStart(event) {
    const now = Date.now();
    if (now - lastNavStartAt < 50) return;
    lastNavStartAt = now;

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
  }

  let lastNavFinishAt = 0;
  function onNavigateFinish() {
    const now = Date.now();
    if (now - lastNavFinishAt < 50) return;
    lastNavFinishAt = now;

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
      setTimeout(() => tryCaptureInitialData('navigate-finish-late'), 600);
    }

    if (currRoute && currRoute !== prevRoute) {
      const wasRestored = currRoute === 'home' ? state.restoredThisNav : false;
      const wasUndone = currRoute === 'home' ? state.undoneThisNav : false;
      state.restoredThisNav = false;
      state.undoneThisNav = false;
      if (currRoute === 'home') {
        if (state.wasAwayFromHome && !wasRestored && !wasUndone) {
          state.lastReturnedHomeAt = Date.now();
        } else {
          state.lastReturnedHomeAt = 0;
        }
        state.wasAwayFromHome = false;
      }

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
  }

  document.addEventListener('yt-navigate-start', onNavigateStart);
  window.addEventListener('yt-navigate-start', onNavigateStart);
  document.addEventListener('yt-navigate-finish', onNavigateFinish);
  window.addEventListener('yt-navigate-finish', onNavigateFinish);

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
        // Re-broadcast cached Home feed if ISOLATED script finished booting after capture
        if (state.cachedHomeResponse && E.isHomePath(window.location.pathname)) {
          const cards = getCachedCards();
          if (cards.length > 0) {
            postToIsolated('HOME_CAPTURED', {
              feedId: state.feedId,
              source: `${state.lastCaptureSource}:resync`,
              count: cards.length,
              videos: cards,
              hasPreviousFeed: Boolean(state.previousFeed),
              scrollY: window.scrollY || 0,
            });
          }
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
      case 'RETURN_TO_HOME': {
        if (E.isHomePath(window.location.pathname)) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          state.returnIntent = 'LOGO_FROM_AWAY';
          state.returnIntentAt = Date.now();
          state.explicitLogoOnHome = false;
          state.wasAwayFromHome = true;
          triggerNativeHomeBrowse();
        }
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
