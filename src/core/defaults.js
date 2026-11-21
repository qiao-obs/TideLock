(function (root) {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    SETTINGS: 'tidelock_settings',
    SNAPSHOTS: 'tidelock_snapshots',
    PINNED: 'tidelock_pinned',
    WATCHED: 'tidelock_watched',
    STATS: 'tidelock_stats',
    SCROLL_STATE: 'tidelock_scroll_state',
  });

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    preserveOnLogoFromWatch: true,
    restoreScroll: true,
    markWatched: true,
    showFloatingDock: true,
    showToast: true,
    maxSnapshots: 5,
    maxStitchedItems: 180,
  });

  const DEFAULT_STATS = Object.freeze({
    refreshesBlocked: 0,
    scrollsRestored: 0,
    snapshotsSaved: 0,
    lastRestoredAt: 0,
  });

  const BRIDGE_CHANNEL = 'TIDELOCK_BRIDGE_V1';

  const MSG = Object.freeze({
    // ISOLATED -> MAIN
    SYNC_SETTINGS: 'SYNC_SETTINGS',
    FORCE_REFRESH: 'FORCE_REFRESH',
    REQUEST_STATUS: 'REQUEST_STATUS',
    // MAIN -> ISOLATED
    HOME_CAPTURED: 'HOME_CAPTURED',
    FEED_RESTORED: 'FEED_RESTORED',
    CONTINUATION_STITCHED: 'CONTINUATION_STITCHED',
    STATUS_REPORT: 'STATUS_REPORT',
    NAV_AWAY_FROM_HOME: 'NAV_AWAY_FROM_HOME',
    NAV_BACK_TO_HOME: 'NAV_BACK_TO_HOME',
    WATCHED_VIDEO: 'WATCHED_VIDEO',
    // Popup/SW <-> Content
    GET_TAB_STATE: 'GET_TAB_STATE',
    OPEN_DRAWER: 'OPEN_DRAWER',
    TRIGGER_REFRESH: 'TRIGGER_REFRESH',
    NAVIGATE_VIDEO: 'NAVIGATE_VIDEO',
    STATE_UPDATED: 'STATE_UPDATED',
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
