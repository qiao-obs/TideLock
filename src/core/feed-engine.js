(function (root) {
  'use strict';

  const DEFAULT_MAX_STITCHED = 180;
  const RETURN_INTENT_TTL_MS = 10000;

  function safeClone(obj) {
    if (obj === null || obj === undefined) return obj;
    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(obj);
      }
    } catch {
      // Fall back to JSON clone for non-cloneable host wrappers
    }
    return JSON.parse(JSON.stringify(obj));
  }

  function extractText(node) {
    if (!node) return '';
    if (typeof node === 'string') return node.trim();
    if (typeof node.content === 'string') return node.content.trim();
    if (typeof node.simpleText === 'string') return node.simpleText.trim();
    if (Array.isArray(node.runs)) {
      return node.runs.map((r) => (r && typeof r.text === 'string' ? r.text : '')).join('').trim();
    }
    return '';
  }

  function extractVideoIdFromUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    try {
      const u = new URL(urlStr, 'https://www.youtube.com');
      if (u.pathname === '/watch') {
        const v = u.searchParams.get('v');
        return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
      }
      const shortsMatch = u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];
      return null;
    } catch {
      return null;
    }
  }

  function isHomePath(pathname) {
    return pathname === '/' || pathname === '';
  }

  function parseBrowseRequestBody(rawBody) {
    const empty = {
      valid: false,
      browseId: null,
      hasParams: false,
      params: null,
      hasContinuation: false,
      continuation: null,
      isHomeInitial: false,
      isHomeChip: false,
      isContinuation: false,
      isSubscriptions: false,
    };

    if (!rawBody) return empty;
    let parsed = null;
    if (typeof rawBody === 'string') {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return empty;
      }
    } else if (ArrayBuffer.isView(rawBody) || Object.prototype.toString.call(rawBody) === '[object ArrayBuffer]') {
      try {
        const bytes = ArrayBuffer.isView(rawBody)
          ? new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength)
          : new Uint8Array(rawBody);
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return empty;
      }
    } else if (typeof rawBody === 'object') {
      parsed = rawBody;
    }

    if (!parsed || typeof parsed !== 'object') return empty;

    const browseId = typeof parsed.browseId === 'string' ? parsed.browseId : null;
    const params = typeof parsed.params === 'string' && parsed.params.length > 0 ? parsed.params : null;
    const continuation =
      typeof parsed.continuation === 'string' && parsed.continuation.length > 0 ? parsed.continuation : null;

    const isHome = browseId === 'FEwhat_to_watch';
    return {
      valid: true,
      browseId,
      hasParams: Boolean(params),
      params,
      hasContinuation: Boolean(continuation),
      continuation,
      isHomeInitial: isHome && !params && !continuation,
      isHomeChip: isHome && Boolean(params) && !continuation,
      isContinuation: Boolean(continuation),
      isSubscriptions: browseId === 'FEsubscriptions',
    };
  }

  function shouldInterceptHomeBrowse(state, reqInfo, now = Date.now()) {
    if (!state || !reqInfo) {
      return { intercept: false, reason: 'invalid_args' };
    }
    if (!state.enabled) {
      return { intercept: false, reason: 'disabled' };
    }
    if (!state.hasCachedFeed) {
      return { intercept: false, reason: 'no_cache' };
    }
    if (!reqInfo.isHomeInitial) {
      return { intercept: false, reason: 'not_home_initial' };
    }
    if (state.explicitRefreshUntil && now < state.explicitRefreshUntil) {
      return { intercept: false, reason: 'explicit_refresh' };
    }

    const intentFresh =
      state.returnIntentAt && now - state.returnIntentAt <= RETURN_INTENT_TTL_MS;

    if (intentFresh && state.returnIntent === 'BACK_TRAVERSE') {
      return { intercept: true, reason: 'back_traverse' };
    }

    if (
      intentFresh &&
      state.returnIntent === 'LOGO_FROM_AWAY' &&
      state.preserveOnLogoFromWatch
    ) {
      return { intercept: true, reason: 'logo_from_away' };
    }

    if (state.wasAwayFromHome && !state.explicitLogoOnHome) {
      return { intercept: true, reason: 'away_return_fallback' };
    }

    return { intercept: false, reason: 'fresh_load_allowed' };
  }

  function findRichGridContents(browseData) {
    if (!browseData || typeof browseData !== 'object') return null;
    const tabs = browseData?.contents?.twoColumnBrowseResultsRenderer?.tabs;
    if (!Array.isArray(tabs)) return null;

    for (const tab of tabs) {
      const grid = tab?.tabRenderer?.content?.richGridRenderer;
      if (grid && Array.isArray(grid.contents)) {
        return { grid, contents: grid.contents };
      }
    }
    return null;
  }

  function extractContinuationItems(continuationResponse) {
    if (!continuationResponse || typeof continuationResponse !== 'object') {
      return { items: [], trailingContinuation: null };
    }

    const actionLists = [
      continuationResponse.onResponseReceivedActions,
      continuationResponse.onResponseReceivedEndpoints,
      continuationResponse.onResponseReceivedCommands,
    ];

    const collected = [];
    let trailingContinuation = null;

    for (const list of actionLists) {
      if (!Array.isArray(list)) continue;
      for (const action of list) {
        const candidates =
          action?.appendContinuationItemsAction?.continuationItems ||
          action?.reloadContinuationItemsCommand?.continuationItems;
        if (!Array.isArray(candidates)) continue;
        for (const item of candidates) {
          if (item?.continuationItemRenderer) {
            trailingContinuation = item;
          } else {
            collected.push(item);
          }
        }
      }
    }

    return { items: collected, trailingContinuation };
  }

  function isAdItem(item) {
    const content = item?.richItemRenderer?.content;
    if (!content) return false;
    return Boolean(
      content.adSlotRenderer ||
        content.promotedSparklesWebRenderer ||
        content.displayAdRenderer ||
        content.statementBannerRenderer
    );
  }

  function extractCardFromRichItem(item) {
    if (!item || isAdItem(item)) return null;
    const content = item?.richItemRenderer?.content;
    if (!content) return null;

    // 1. Legacy & standard videoRenderer
    if (content.videoRenderer) {
      const v = content.videoRenderer;
      const videoId = v.videoId;
      if (!videoId || typeof videoId !== 'string') return null;
      const title = extractText(v.title);
      if (!title) return null;
      const channel = extractText(v.ownerText) || extractText(v.longBylineText) || extractText(v.shortBylineText);
      const duration = extractText(v.lengthText);
      const views = extractText(v.shortViewCountText) || extractText(v.viewCountText);
      const thumbs = v.thumbnail?.thumbnails;
      const thumbnail =
        Array.isArray(thumbs) && thumbs.length > 0
          ? thumbs[Math.min(1, thumbs.length - 1)]?.url || thumbs[0]?.url
          : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      return {
        videoId,
        title,
        channel,
        duration,
        views,
        thumbnail,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        isShort: false,
      };
    }

    // 2. Modern 2025-2026 lockupViewModel
    if (content.lockupViewModel) {
      const lv = content.lockupViewModel;
      const contentType = lv.contentType || '';
      if (contentType && contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' && contentType !== 'LOCKUP_CONTENT_TYPE_SHORTS') {
        // Still allow if watchEndpoint exists (skip mixes/playlists without single videoId unless watchEndpoint present)
        if (!lv?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId) {
          return null;
        }
      }

      const watchEpId = lv?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId;
      const rawId = typeof lv.contentId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(lv.contentId) ? lv.contentId : null;
      const videoId = watchEpId || rawId;
      if (!videoId) return null;

      const metaVm = lv?.metadata?.lockupMetadataViewModel;
      const title = extractText(metaVm?.title);
      if (!title) return null;

      const rows = metaVm?.metadata?.contentMetadataViewModel?.metadataRows;
      let channel = '';
      let views = '';
      if (Array.isArray(rows)) {
        const parts = [];
        for (const row of rows) {
          if (!Array.isArray(row?.metadataParts)) continue;
          const rowText = row.metadataParts
            .map((p) => extractText(p?.text))
            .filter(Boolean)
            .join(' · ');
          if (rowText) parts.push(rowText);
        }
        channel = parts[0] || '';
        views = parts[1] || '';
      }

      let duration = '';
      const overlays = lv?.contentImage?.thumbnailViewModel?.overlays;
      if (Array.isArray(overlays)) {
        for (const ov of overlays) {
          const badges = ov?.thumbnailOverlayBadgeViewModel?.thumbnailBadges;
          if (Array.isArray(badges)) {
            for (const b of badges) {
              const t = extractText(b?.thumbnailBadgeViewModel?.text);
              if (t && /\d+:\d+/.test(t)) {
                duration = t;
                break;
              }
            }
          }
          if (duration) break;
        }
      }

      const sources = lv?.contentImage?.thumbnailViewModel?.image?.sources;
      const thumbnail =
        Array.isArray(sources) && sources.length > 0
          ? sources[Math.min(1, sources.length - 1)]?.url || sources[0]?.url
          : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      const isShort = contentType === 'LOCKUP_CONTENT_TYPE_SHORTS';
      return {
        videoId,
        title,
        channel,
        duration,
        views,
        thumbnail,
        url: isShort
          ? `https://www.youtube.com/shorts/${videoId}`
          : `https://www.youtube.com/watch?v=${videoId}`,
        isShort,
      };
    }

    // 3. Shorts lockup
    if (content.shortsLockupViewModel) {
      const sv = content.shortsLockupViewModel;
      const videoId = sv?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
      if (!videoId) return null;
      const title = extractText(sv?.overlayMetadata?.primaryText) || sv?.accessibilityText || '';
      if (!title) return null;
      const views = extractText(sv?.overlayMetadata?.secondaryText);
      const sources = sv?.thumbnail?.sources;
      const thumbnail =
        Array.isArray(sources) && sources.length > 0
          ? sources[0]?.url
          : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      return {
        videoId,
        title,
        channel: 'Shorts',
        duration: 'Shorts',
        views,
        thumbnail,
        url: `https://www.youtube.com/shorts/${videoId}`,
        isShort: true,
      };
    }

    return null;
  }

  function extractItemVideoId(item) {
    const card = extractCardFromRichItem(item);
    return card ? card.videoId : null;
  }

  function extractSnapshotCardsFromBrowse(browseData, maxItems = DEFAULT_MAX_STITCHED) {
    const found = findRichGridContents(browseData);
    if (!found) return [];
    const seen = new Set();
    const cards = [];

    for (const item of found.contents) {
      const card = extractCardFromRichItem(item);
      if (card && !seen.has(card.videoId)) {
        seen.add(card.videoId);
        cards.push(card);
        if (cards.length >= maxItems) break;
      }
    }
    return cards;
  }

  function stitchHomeResponse(
    baseResponse,
    extraItems = [],
    trailingContinuation = null,
    maxItems = DEFAULT_MAX_STITCHED
  ) {
    if (!baseResponse || typeof baseResponse !== 'object') return null;
    const cloned = safeClone(baseResponse);
    const found = findRichGridContents(cloned);
    if (!found) return cloned;

    const existingContents = found.contents;
    let baseContinuation = null;
    const merged = [];
    const seenVideoIds = new Set();

    for (const item of existingContents) {
      if (item?.continuationItemRenderer) {
        baseContinuation = item;
        continue;
      }
      const vid = extractItemVideoId(item);
      if (vid) {
        if (seenVideoIds.has(vid)) continue;
        seenVideoIds.add(vid);
      }
      merged.push(item);
    }

    if (Array.isArray(extraItems)) {
      for (const item of extraItems) {
        if (!item || item.continuationItemRenderer) continue;
        if (merged.length >= maxItems) break;
        const vid = extractItemVideoId(item);
        if (vid) {
          if (seenVideoIds.has(vid)) continue;
          seenVideoIds.add(vid);
        }
        merged.push(safeClone(item));
      }
    }

    const finalContinuation = trailingContinuation || baseContinuation;
    if (finalContinuation) {
      merged.push(safeClone(finalContinuation));
    }

    found.grid.contents = merged;
    return cloned;
  }

  function computeOverlapRatio(cardsA, cardsB) {
    if (!Array.isArray(cardsA) || !Array.isArray(cardsB) || cardsA.length === 0 || cardsB.length === 0) {
      return 0;
    }
    const setA = new Set(cardsA.map((c) => c.videoId));
    let matches = 0;
    for (const c of cardsB) {
      if (setA.has(c.videoId)) matches++;
    }
    return matches / Math.min(cardsA.length, cardsB.length);
  }

  function mergeSnapshotVault(existingSnapshots, incomingSnapshot, maxSnapshots = 5) {
    const list = Array.isArray(existingSnapshots) ? existingSnapshots.slice() : [];
    if (!incomingSnapshot || !Array.isArray(incomingSnapshot.videos) || incomingSnapshot.videos.length === 0) {
      return list.slice(0, maxSnapshots);
    }

    const latest = list[0];
    if (latest) {
      const sameFeedId = incomingSnapshot.feedId && latest.feedId === incomingSnapshot.feedId;
      const highOverlap = computeOverlapRatio(latest.videos, incomingSnapshot.videos) >= 0.55;

      if (sameFeedId || highOverlap) {
        // Merge newly scrolled cards into the existing snapshot without creating duplicate entries
        const byId = new Map();
        for (const v of latest.videos) byId.set(v.videoId, v);
        for (const v of incomingSnapshot.videos) {
          const prev = byId.get(v.videoId);
          byId.set(v.videoId, prev ? { ...prev, ...v, title: v.title || prev.title } : v);
        }
        list[0] = {
          ...latest,
          updatedAt: incomingSnapshot.updatedAt || Date.now(),
          scrollY: typeof incomingSnapshot.scrollY === 'number' ? incomingSnapshot.scrollY : latest.scrollY,
          videos: Array.from(byId.values()).slice(0, DEFAULT_MAX_STITCHED),
        };
        return list.slice(0, maxSnapshots);
      }
    }

    list.unshift({
      id: incomingSnapshot.id || `snap_${Date.now()}`,
      feedId: incomingSnapshot.feedId || `feed_${Date.now()}`,
      createdAt: incomingSnapshot.createdAt || Date.now(),
      updatedAt: incomingSnapshot.updatedAt || Date.now(),
      scrollY: typeof incomingSnapshot.scrollY === 'number' ? incomingSnapshot.scrollY : 0,
      videos: incomingSnapshot.videos.slice(0, DEFAULT_MAX_STITCHED),
    });

    return list.slice(0, maxSnapshots);
  }

  const api = {
    DEFAULT_MAX_STITCHED,
    RETURN_INTENT_TTL_MS,
    safeClone,
    extractText,
    extractVideoIdFromUrl,
    isHomePath,
    parseBrowseRequestBody,
    shouldInterceptHomeBrowse,
    findRichGridContents,
    extractContinuationItems,
    isAdItem,
    extractCardFromRichItem,
    extractItemVideoId,
    extractSnapshotCardsFromBrowse,
    stitchHomeResponse,
    computeOverlapRatio,
    mergeSnapshotVault,
  };

  if (typeof root !== 'undefined') {
    root.__TideLockEngine = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
