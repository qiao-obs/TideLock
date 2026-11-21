(function (root) {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    SETTINGS: 'tidelock_settings',
    SNAPSHOTS: 'tidelock_snapshots',
    PINNED: 'tidelock_pinned',
    WATCHED: 'tidelock_watched',
    STATS: 'tidelock_stats',
    ROUTE_ANCHORS: 'tidelock_route_anchors',
  });

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    preserveOnLogoFromWatch: true,
    restoreScroll: true,
    anchorSubAndSearch: true,
    markWatched: true,
    showFloatingDock: true,
    showToast: true,
    maxSnapshots: 6,
    maxStitchedItems: 200,
    idbTtlHours: 12,
  });

  const DEFAULT_STATS = Object.freeze({
    refreshesBlocked: 0,
    scrollsRestored: 0,
    snapshotsSaved: 0,
    undosPerformed: 0,
    lastRestoredAt: 0,
  });

  const BRIDGE_CHANNEL = 'TIDELOCK_BRIDGE_V2';

  const MSG = Object.freeze({
    // ISOLATED -> MAIN
    SYNC_SETTINGS: 'SYNC_SETTINGS',
    FORCE_REFRESH: 'FORCE_REFRESH',
    UNDO_REFRESH: 'UNDO_REFRESH',
    SPA_NAVIGATE: 'SPA_NAVIGATE',
    REQUEST_STATUS: 'REQUEST_STATUS',
    // MAIN -> ISOLATED
    HOME_CAPTURED: 'HOME_CAPTURED',
    FEED_RESTORED: 'FEED_RESTORED',
    FEED_UNDONE: 'FEED_UNDONE',
    CONTINUATION_STITCHED: 'CONTINUATION_STITCHED',
    STATUS_REPORT: 'STATUS_REPORT',
    NAV_AWAY_FROM_LIST: 'NAV_AWAY_FROM_LIST',
    NAV_BACK_TO_LIST: 'NAV_BACK_TO_LIST',
    WATCHED_VIDEO: 'WATCHED_VIDEO',
    // Popup/SW <-> Content
    GET_TAB_STATE: 'GET_TAB_STATE',
    TOGGLE_DRAWER: 'TOGGLE_DRAWER',
    OPEN_DRAWER: 'OPEN_DRAWER',
    TRIGGER_REFRESH: 'TRIGGER_REFRESH',
    TRIGGER_UNDO: 'TRIGGER_UNDO',
    NAVIGATE_VIDEO: 'NAVIGATE_VIDEO',
    PIN_VIDEO_EXTERNAL: 'PIN_VIDEO_EXTERNAL',
  });

  const api = {
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    DEFAULT_STATS,
    BRIDGE_CHANNEL,
    MSG,
  };

  if (typeof root !== 'undefined') {
    root.__TideLockDefaults = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
