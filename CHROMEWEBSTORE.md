# Chrome Web Store Listing — TideLock

> Last Updated: 2026-11-21

## Store Listing

**Extension Name** [REQUIRED]
TideLock — Keep YouTube Home Feed

**Short Description** [REQUIRED]
Stop YouTube from refreshing your home feed when returning from a video. Locks feed across reloads, adds undo refresh, scroll anchor & snapshots.

**Detailed Description** [REQUIRED]
Ever spot two great videos on your YouTube home page, watch the first one, hit Back — and watch the entire feed vanish in a surprise refresh? TideLock keeps your YouTube home feed right where you left it, without forcing you to juggle extra browser tabs.

Key Features:
Automatic Home Feed Lock — When you watch a video and return to Home, TideLock restores your exact previous home feed, including videos you loaded while scrolling down — even if you reloaded a video tab or your browser paused an inactive tab.
One-Click Undo Accidental Refresh — Accidentally pressed F5 on Home and lost a great recommendation? Click Undo Refresh to restore the previous home batch right back into YouTube.
Instant Same-Tab Switching — Jumping to a saved or pinned video switches smoothly inside YouTube with zero full-page reloads, keeping your locked home feed intact.
Right Beside What You Just Watched — Automatically surfaces the exact unwatched videos that were sitting next to the video you clicked, so you can jump straight to the next one from any watch page.
Multi-Feed Scroll Anchoring — Restores your exact scroll spot on YouTube Home, Subscriptions, and Search results, and yields immediately the moment you touch your scroll wheel.
Bilingual Snapshot Search & Quick-Pin Queue — Keeps your last 6 Home snapshots locally with All / Unwatched / Watched filters, searches both original and translated titles, supports right-click pinning on any YouTube video link, and copies lists as clean Markdown for Obsidian or Notion.
Built for Desktop PWA & Full-Tab Chrome — Includes a discreet, theme-aware floating dock and slide-over drawer (shortcut Alt+Shift+T) that hides automatically in fullscreen mode.
Respects Intentional Refreshes — Pressing F5, clicking a topic chip, clicking the YouTube logo while already on Home, or clicking Fresh Feed loads brand-new recommendations immediately.

How to Use:
1. Install TideLock — automatic feed locking is enabled out of the box.
2. Browse YouTube Home and click videos normally in the same tab.
3. Press Back (or click the YouTube logo from a video) when finished — your exact home feed and scroll spot are waiting for you.
4. Press Alt+Shift+T or click the TideLock icon / corner pill anytime to jump to neighboring unwatched videos, browse recent snapshots, undo an accidental refresh, or export pinned items as Markdown.

Privacy First:
TideLock runs 100% locally in your browser on youtube.com only. It collects zero personal data, makes zero external network requests, and never tracks your browsing.

Support & Open Source:
Source code and issue tracker: https://github.com/qiao-obs/TideLock

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Preserves the YouTube home feed, scroll position, and local feed snapshots when navigating back from watching videos.

**Primary Language** [REQUIRED]
English (with full Simplified Chinese `zh_CN` localization bundled)

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | Capture YouTube Home with preserved feed toast & watched badge |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | Capture slide-over Snapshot Drawer with "Right beside what you just watched" shelf |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | Capture v2 popup in light/dark mode with Undo Refresh & Markdown export |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Stores user preferences, up to 6 local YouTube home feed snapshots, locally pinned videos, per-route scroll anchors, watched video markers, and blocked-refresh counts strictly on the user's device. |
| `contextMenus` | permissions | Adds a single "Pin video to TideLock queue" menu entry when right-clicking YouTube video links on youtube.com so users can save interesting videos to their local TideLock queue without opening extra tabs. |
| `https://www.youtube.com/*` | host_permissions | Needed to preserve the YouTube Home feed when navigating back from a video, restore scroll positions on Home/Subscriptions/Search, display subtle watched badges and quick-pin buttons on cards, and render the local snapshot drawer on YouTube pages. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

All preferences, cached Home feeds (stored in origin-scoped IndexedDB), recent home snapshots, and pinned video entries are stored exclusively on the user's device and are never transmitted off-device.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://github.com/qiao-obs/TideLock/blob/main/PRIVACY.md

## Distribution

**Visibility**: Public
**Regions**: All regions

> **Free Store Option**: The exact same `dist/tidelock-v2.0.0.zip` package built by `npm run build` can be published for **\$0 (free)** to **Microsoft Edge Add-ons** (Partner Center).

## Developer Info

**Publisher Name** [REQUIRED]
qiao-obs

**Contact Email** [REQUIRED]
`<your-public-support-email>` (fill in Chrome Web Store Developer Dashboard before publishing)

**Support URL / Email** [RECOMMENDED]
https://github.com/qiao-obs/TideLock/issues

**Homepage URL** [RECOMMENDED]
https://github.com/qiao-obs/TideLock

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 2.1.0 | 2026-11-21 | Production YouTube 2026 fixes: desktop `richGridRowRenderer` recursive extraction & deduplicated stitching, intercept internal `params` on Home return without breaking topic chip clicks, 2026 camelCase DOM selectors (`ytLockupMetadataViewModelTitle`), self-healing grid observer hydration & `ytInitialData` / `<ytd-browse>.data` polling, 1-click Reload Tab banner for pre-existing YouTube tabs in Popup. | Draft |
| 2.0.0 | 2026-11-21 | Full architectural upgrade: IndexedDB cross-reload Home feed persistence, 1-click Undo Accidental Refresh (previous feed replay), zero-reload native YouTube SPA navigation from Drawer/Popup, "Right beside what you just watched" neighbor shelf, multi-feed scroll anchoring (Home + Subscriptions + Search), bilingual CN/EN title sync & search (Immersive Translate + DeArrow compatible), scoped debounced MutationObserver with O(1) card skip, pure SVG UI, right-click Pin context menu, Alt+Shift+T shortcut, Markdown export, live engine diagnostics. | Draft |
| 1.0.0 | 2026-11-21 | Initial release: automatic home feed lock, continuation stitching, scroll restore, watched badges, quick-pin queue, local snapshot drawer & popup, EN/zh_CN i18n. | Draft |

## Review Notes

### Known Issues / Limitations
- Only freezes the YouTube Home feed (`https://www.youtube.com/`); intentional refreshes (F5, topic chip clicks, clicking the YouTube logo while already on Home, or clicking Fresh Feed) fetch live recommendations immediately, while keeping the displaced batch available for 1-click Undo Refresh.
- Purely local storage; snapshots and pinned videos remain on-device and do not sync to external servers.
