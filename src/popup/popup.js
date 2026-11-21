(function () {
  'use strict';

  const { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_STATS, MSG } = globalThis.__TideLockDefaults;

  function t(key, fallback) {
    try {
      return chrome.i18n.getMessage(key) || fallback || key;
    } catch {
      return fallback || key;
    }
  }

  function isZh() {
    try {
      return (chrome.i18n.getUILanguage() || '').toLowerCase().startsWith('zh');
    } catch {
      return false;
    }
  }

  function formatRelTime(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    const zh = isZh();
    if (s < 60) return zh ? '刚刚' : 'Just now';
    const m = Math.floor(s / 60);
    if (m < 60) return zh ? `${m} 分钟前` : `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return zh ? `${h} 小时前` : `${h}h ago`;
    const d = Math.floor(h / 24);
    return zh ? `${d} 天前` : `${d}d ago`;
  }

  let settings = { ...DEFAULT_SETTINGS };
  let stats = { ...DEFAULT_STATS };
  let snapshots = [];
  let pinned = [];
  let watchedSet = new Set();

  let activeTab = 'snapshots';
  let selectedSnapIdx = 0;
  let filterMode = 'all';
  let searchQuery = '';
  let activeYouTubeTabId = null;

  const els = {
    statusLabel: document.getElementById('status-label'),
    masterToggle: document.getElementById('master-toggle'),
    statBlocked: document.getElementById('stat-blocked'),
    statSnapshots: document.getElementById('stat-snapshots'),
    statPinned: document.getElementById('stat-pinned'),
    labelStatBlocked: document.getElementById('label-stat-blocked'),
    labelStatSnapshots: document.getElementById('label-stat-snapshots'),
    labelStatPinned: document.getElementById('label-stat-pinned'),
    ytActions: document.getElementById('yt-actions'),
    btnOpenDrawer: document.getElementById('btn-open-drawer'),
    btnRefreshFeed: document.getElementById('btn-refresh-feed'),
    tabSnapshots: document.getElementById('tab-snapshots'),
    tabPinned: document.getElementById('tab-pinned'),
    tabSettings: document.getElementById('tab-settings'),
    panelSnapshots: document.getElementById('panel-snapshots'),
    panelPinned: document.getElementById('panel-pinned'),
    panelSettings: document.getElementById('panel-settings'),
    snapshotPills: document.getElementById('snapshot-pills'),
    filterPills: document.getElementById('filter-pills'),
    searchInput: document.getElementById('search-input'),
    snapshotList: document.getElementById('snapshot-list'),
    pinnedList: document.getElementById('pinned-list'),
    settingsList: document.getElementById('settings-list'),
    btnClearSnapshots: document.getElementById('btn-clear-snapshots'),
  };

  async function detectActiveYouTubeTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id && typeof tab.url === 'string' && tab.url.startsWith('https://www.youtube.com/')) {
        activeYouTubeTabId = tab.id;
        els.ytActions.hidden = false;
      } else {
        activeYouTubeTabId = null;
        els.ytActions.hidden = true;
      }
    } catch {
      activeYouTubeTabId = null;
      els.ytActions.hidden = true;
    }
  }

  async function loadState() {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.STATS,
      STORAGE_KEYS.SNAPSHOTS,
      STORAGE_KEYS.PINNED,
      STORAGE_KEYS.WATCHED,
    ]);
    settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
    stats = { ...DEFAULT_STATS, ...(data[STORAGE_KEYS.STATS] || {}) };
    snapshots = Array.isArray(data[STORAGE_KEYS.SNAPSHOTS]) ? data[STORAGE_KEYS.SNAPSHOTS] : [];
    pinned = Array.isArray(data[STORAGE_KEYS.PINNED]) ? data[STORAGE_KEYS.PINNED] : [];
    watchedSet = new Set(Array.isArray(data[STORAGE_KEYS.WATCHED]) ? data[STORAGE_KEYS.WATCHED] : []);
    renderAll();
  }

  async function updateSettings(patch) {
    settings = { ...settings, ...patch };
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
    renderHeaderAndStats();
    renderSettingsPanel();
  }

  async function togglePin(video) {
    const exists = pinned.some((p) => p.videoId === video.videoId);
    if (exists) {
      pinned = pinned.filter((p) => p.videoId !== video.videoId);
    } else {
      pinned = [{ ...video, pinnedAt: Date.now() }, ...pinned].slice(0, 60);
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.PINNED]: pinned });
    renderAll();
  }

  async function openVideo(video) {
    if (activeYouTubeTabId) {
      try {
        await chrome.tabs.sendMessage(activeYouTubeTabId, {
          type: MSG.NAVIGATE_VIDEO,
          url: video.url,
          videoId: video.videoId,
        });
        window.close();
        return;
      } catch {
        // Fallback to updating tab directly
        await chrome.tabs.update(activeYouTubeTabId, { url: video.url });
        window.close();
        return;
      }
    }
    await chrome.tabs.create({ url: video.url });
    window.close();
  }

  function renderHeaderAndStats() {
    els.masterToggle.checked = Boolean(settings.enabled);
    els.statusLabel.textContent = settings.enabled
      ? t('statusActive', 'Feed Lock Active')
      : t('statusPaused', 'Feed Lock Paused');
    els.statusLabel.setAttribute('data-paused', settings.enabled ? 'false' : 'true');

    els.statBlocked.textContent = String(stats.refreshesBlocked || 0);
    els.statSnapshots.textContent = String(snapshots.length);
    els.statPinned.textContent = String(pinned.length);

    els.labelStatBlocked.textContent = t('statBlocked', 'Refreshes blocked');
    els.labelStatSnapshots.textContent = t('statSnapshots', 'Saved snapshots');
    els.labelStatPinned.textContent = t('statPinned', 'Pinned videos');

    els.btnOpenDrawer.textContent = t('btnOpenDrawer', 'Open on Page');
    els.btnRefreshFeed.textContent = t('btnRefreshFeed', 'Refresh Feed');
    els.btnClearSnapshots.textContent = t('btnClearSnapshots', 'Clear Snapshots');
    els.searchInput.placeholder = t('searchPlaceholder', 'Search title or channel...');

    els.tabSnapshots.textContent = `${t('tabSnapshots', 'Snapshots')} (${snapshots.length})`;
    els.tabPinned.textContent = `${t('tabPinned', 'Pinned')} (${pinned.length})`;
    els.tabSettings.textContent = t('tabSettings', 'Settings');
  }

  function renderTabs() {
    for (const btn of [els.tabSnapshots, els.tabPinned, els.tabSettings]) {
      btn.setAttribute('data-active', btn.dataset.tab === activeTab ? 'true' : 'false');
    }
    els.panelSnapshots.hidden = activeTab !== 'snapshots';
    els.panelPinned.hidden = activeTab !== 'pinned';
    els.panelSettings.hidden = activeTab !== 'settings';
  }

  function createVideoCardElement(video, showWatchedBadge) {
    const pinnedIds = new Set(pinned.map((p) => p.videoId));
    const isPinned = pinnedIds.has(video.videoId);

    const card = document.createElement('div');
    card.className = 'video-card';
    card.addEventListener('click', () => openVideo(video));

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'thumb-wrap';
    const img = document.createElement('img');
    img.className = 'thumb';
    img.loading = 'lazy';
    img.src = video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
    img.alt = '';
    thumbWrap.appendChild(img);

    if (video.duration) {
      const dur = document.createElement('span');
      dur.className = 'dur';
      dur.textContent = video.duration;
      thumbWrap.appendChild(dur);
    }

    const meta = document.createElement('div');
    meta.className = 'v-meta';
    const title = document.createElement('div');
    title.className = 'v-title';
    title.textContent = video.title;
    meta.appendChild(title);

    const subText = [video.channel, video.views].filter(Boolean).join(' · ');
    if (subText) {
      const sub = document.createElement('div');
      sub.className = 'v-sub';
      sub.textContent = subText;
      meta.appendChild(sub);
    }

    if (showWatchedBadge && watchedSet.has(video.videoId)) {
      const badge = document.createElement('span');
      badge.className = 'v-badge';
      badge.textContent = t('badgeWatched', 'Watched');
      meta.appendChild(badge);
    }

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'pin-icon-btn';
    pinBtn.textContent = '📌';
    pinBtn.setAttribute('data-pinned', isPinned ? 'true' : 'false');
    pinBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      togglePin(video);
    });

    card.appendChild(thumbWrap);
    card.appendChild(meta);
    card.appendChild(pinBtn);
    return card;
  }

  function renderSnapshotsPanel() {
    els.snapshotPills.textContent = '';
    if (selectedSnapIdx >= snapshots.length) selectedSnapIdx = 0;

    snapshots.forEach((snap, idx) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill';
      pill.setAttribute('data-active', idx === selectedSnapIdx ? 'true' : 'false');
      const label = idx === 0 ? (isZh() ? '最近' : 'Latest') : formatRelTime(snap.updatedAt || snap.createdAt);
      pill.textContent = `${label} · ${snap.videos.length}`;
      pill.addEventListener('click', () => {
        selectedSnapIdx = idx;
        renderSnapshotsPanel();
      });
      els.snapshotPills.appendChild(pill);
    });

    els.filterPills.textContent = '';
    const filters = [
      { id: 'all', label: t('filterAll', 'All') },
      { id: 'unwatched', label: t('filterUnwatched', 'Unwatched') },
      { id: 'watched', label: t('filterWatched', 'Watched') },
    ];
    for (const f of filters) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill';
      pill.setAttribute('data-active', filterMode === f.id ? 'true' : 'false');
      pill.textContent = f.label;
      pill.addEventListener('click', () => {
        filterMode = f.id;
        renderSnapshotsPanel();
      });
      els.filterPills.appendChild(pill);
    }

    els.snapshotList.textContent = '';
    const currentSnap = snapshots[selectedSnapIdx];
    const list = currentSnap ? currentSnap.videos : [];
    const filtered = list.filter((v) => {
      const isWatched = watchedSet.has(v.videoId);
      if (filterMode === 'unwatched' && isWatched) return false;
      if (filterMode === 'watched' && !isWatched) return false;
      if (searchQuery) {
        const hay = `${v.title || ''} ${v.channel || ''}`.toLowerCase();
        if (!hay.includes(searchQuery)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = t('emptySnapshots', 'Visit YouTube Home to capture snapshots.');
      els.snapshotList.appendChild(empty);
      return;
    }

    for (const v of filtered) {
      els.snapshotList.appendChild(createVideoCardElement(v, true));
    }
  }

  function renderPinnedPanel() {
    els.pinnedList.textContent = '';
    if (pinned.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = t('emptyPinned', 'No pinned videos yet.');
      els.pinnedList.appendChild(empty);
      return;
    }
    for (const v of pinned) {
      els.pinnedList.appendChild(createVideoCardElement(v, true));
    }
  }

  function renderSettingsPanel() {
    els.settingsList.textContent = '';
    const items = [
      { key: 'enabled', title: 'settingEnabled', desc: 'settingEnabledDesc' },
      { key: 'preserveOnLogoFromWatch', title: 'settingLogoPreserve', desc: 'settingLogoPreserveDesc' },
      { key: 'restoreScroll', title: 'settingRestoreScroll', desc: 'settingRestoreScrollDesc' },
      { key: 'markWatched', title: 'settingMarkWatched', desc: 'settingMarkWatchedDesc' },
      { key: 'showFloatingDock', title: 'settingShowDock', desc: 'settingShowDockDesc' },
      { key: 'showToast', title: 'settingShowToast', desc: 'settingShowToastDesc' },
    ];

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'setting-row';

      const textWrap = document.createElement('div');
      textWrap.className = 'setting-text';
      const titleEl = document.createElement('span');
      titleEl.className = 'setting-title';
      titleEl.textContent = t(item.title, item.key);
      const descEl = document.createElement('span');
      descEl.className = 'setting-desc';
      descEl.textContent = t(item.desc, '');
      textWrap.appendChild(titleEl);
      textWrap.appendChild(descEl);

      const label = document.createElement('label');
      label.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(settings[item.key]);
      input.addEventListener('change', () => updateSettings({ [item.key]: input.checked }));
      const slider = document.createElement('span');
      slider.className = 'slider';
      label.appendChild(input);
      label.appendChild(slider);

      row.appendChild(textWrap);
      row.appendChild(label);
      els.settingsList.appendChild(row);
    }
  }

  function renderAll() {
    renderHeaderAndStats();
    renderTabs();
    renderSnapshotsPanel();
    renderPinnedPanel();
    renderSettingsPanel();
  }

  // ---- Wire Events ----
  els.masterToggle.addEventListener('change', () => {
    updateSettings({ enabled: els.masterToggle.checked });
  });

  for (const btn of [els.tabSnapshots, els.tabPinned, els.tabSettings]) {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderTabs();
    });
  }

  els.searchInput.addEventListener('input', (ev) => {
    searchQuery = (ev.target.value || '').trim().toLowerCase();
    renderSnapshotsPanel();
  });

  els.btnOpenDrawer.addEventListener('click', async () => {
    if (!activeYouTubeTabId) return;
    try {
      await chrome.tabs.sendMessage(activeYouTubeTabId, { type: MSG.OPEN_DRAWER });
      window.close();
    } catch {}
  });

  els.btnRefreshFeed.addEventListener('click', async () => {
    if (!activeYouTubeTabId) return;
    try {
      await chrome.tabs.sendMessage(activeYouTubeTabId, { type: MSG.TRIGGER_REFRESH });
      window.close();
    } catch {}
  });

  els.btnClearSnapshots.addEventListener('click', async () => {
    snapshots = [];
    await chrome.storage.local.set({ [STORAGE_KEYS.SNAPSHOTS]: [] });
    renderAll();
  });

  (async () => {
    await detectActiveYouTubeTab();
    await loadState();
  })();
})();
