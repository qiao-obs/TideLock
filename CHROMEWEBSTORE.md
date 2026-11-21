# Chrome Web Store Listing — TideLock

> Last Updated: 2026-11-21

## Store Listing

**Extension Name** [REQUIRED]
TideLock — Keep YouTube Home Feed

**Short Description** [REQUIRED]
Stop YouTube from refreshing your home feed when returning from a video. Anchors scroll position, marks watched videos, and saves local snapshots.

**Detailed Description** [REQUIRED]
Ever spot two great videos on your YouTube home page, watch the first one, hit Back — and watch the entire feed vanish in a surprise refresh? TideLock keeps your YouTube home feed right where you left it, without forcing you to juggle extra browser tabs.

Key Features:
Automatic Home Feed Lock — When you watch a video and return to Home, TideLock restores your exact previous home feed, including videos you loaded while scrolling down.
Precision Scroll Anchor — Automatically brings you back to the exact scroll position and video card you clicked, and immediately yields the moment you start scrolling yourself.
Subtle Watched Badges — Marks videos you opened in this session so the unwatched videos sitting right beside them stand out at a glance.
Instant Home Snapshots — Automatically keeps your last 5 home feed snapshots locally with All / Unwatched / Watched filters and instant title or channel search, so even an accidental page reload never costs you a video.
Quick-Pin Queue — Hover any home card or snapshot entry to pin interesting videos to a lightweight local queue without cluttering your YouTube Watch Later list.
Works in YouTube Desktop PWA Windows — Includes a discreet, theme-aware floating dock and slide-over drawer so you can access snapshots or trigger a fresh feed even in toolbar-free app windows.
Respects Intentional Refreshes — Pressing F5, clicking a category chip, clicking the YouTube logo while already on Home, or clicking Refresh Feed loads brand-new recommendations immediately.

How to Use:
1. Install TideLock — automatic feed locking is enabled out of the box.
2. Browse YouTube Home and click videos normally in the same tab.
3. Press Back (or click the YouTube logo from a video) when finished — your exact home feed and scroll spot are waiting for you.
4. Click the TideLock icon or the compact corner pill anytime to browse recent home snapshots, view pinned videos, or request a fresh feed.

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
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | Capture slide-over Snapshot Drawer with Unwatched filter |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | Capture extension popup in light/dark mode |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |

### Screenshot Notes
Capture clean 1280×800 screenshots demonstrating:
1. Returning to YouTube Home with the "Home feed preserved · Refresh" subtle bottom toast and "Watched" pill next to an unwatched video.
2. The right-side TideLock Snapshot & Pinned Drawer open over YouTube in dark or light mode.
3. The compact TideLock popup showing blocked refresh stats and settings toggles.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Stores user preferences, recent local YouTube home feed snapshots (up to 5), locally pinned videos, watched video markers, and blocked-refresh counts strictly on the user's device. |
| `https://www.youtube.com/*` | host_permissions | Needed to preserve the YouTube Home feed when navigating back from a video, restore scroll position, show optional watched badges and quick-pin controls on home cards, and render the local snapshot drawer on YouTube pages. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

All preferences, recent home feed snapshots, and pinned video entries are stored exclusively in the user's local browser storage and are never transmitted off-device.

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

> **Free Alternative Stores**: The exact same `dist/tidelock-v1.0.0.zip` package built by `npm run build` can be published for **\$0 (free)** to **Microsoft Edge Add-ons** (Partner Center) without paying Chrome Web Store's \$5 registration fee.

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
| 1.0.0 | 2026-11-21 | Initial release: automatic home feed lock on Back/Logo return, infinite-scroll continuation stitching, precision scroll restore, subtle watched badges, hover quick-pin queue, local snapshot drawer & popup, EN/zh_CN i18n. | Draft |

## Review Notes

### Known Issues / Limitations
- Only preserves the YouTube Home feed (`https://www.youtube.com/`); intentional refreshes (F5, category chip clicks, clicking the YouTube logo while already on Home, or clicking Refresh Feed) intentionally fetch fresh recommendations.
- Purely local storage; snapshots do not sync across devices.
