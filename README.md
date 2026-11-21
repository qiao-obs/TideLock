<p align="center">
  <img src="icons/icon-128.png" width="88" height="88" alt="TideLock logo" />
</p>

<h1 align="center">TideLock</h1>

<p align="center">
  <strong>Tidal-lock your YouTube Home feed — go back from any video without losing the recommendations right beside it.</strong>
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="#features">Features</a> ·
  <a href="#how-it-works">Architecture</a> ·
  <a href="#installation">Install Locally</a> ·
  <a href="PRIVACY.md">Privacy</a>
</p>

---

## The Problem

You spot **two** videos you want to watch on the YouTube Home page. You click the first one, watch it for 30 minutes, hit **Back** — and YouTube silently wipes the entire home page with a fresh batch of recommendations. The second video is gone forever.

Opening every video in a new tab clutters your browser (and doesn't even stay in the same window if you use YouTube's desktop PWA app).

**TideLock** fixes this at the root — automatically, silently, and in the **same tab**.

---

## Features

- **Zero-Friction Auto-Lock (Default ON)**: Watch a video for 2 minutes or 2 hours, then press Back (or click the YouTube logo from a video) — TideLock hands YouTube back your exact previous home feed, including every extra screen you scrolled down through.
- **Precision Scroll Anchor**: Restores your exact vertical position (or locks onto the video card you clicked) and immediately backs off the instant you touch your scroll wheel.
- **Subtle "Watched" Badges**: Gently marks cards you opened in this session so the unwatched videos sitting right next to them jump out immediately.
- **Local Snapshot Time Machine**: Keeps your last **5** Home feed snapshots locally with **All / Unwatched / Watched** filters and instant search — even an accidental `F5` or browser restart won't lose a video you spotted earlier.
- **Quick-Pin Local Queue**: Hover any thumbnail (or snapshot item) to pin videos into a private local watchlist without polluting your official YouTube Watch Later list.
- **Built for Desktop PWA & Full-Tab Chrome**: Includes a discreet, auto-themed Shadow DOM floating dock & slide-over drawer that hides automatically during fullscreen playback — ideal for toolbar-free YouTube desktop app windows.
- **Respects Real Refreshes**: Pressing `F5`, clicking any topic chip, clicking the YouTube logo while *already* on Home, or clicking **Refresh Feed** loads fresh recommendations immediately.
- **100% Compatible with Popular Extensions**: Works cleanly alongside Enhancer for YouTube™, Right Side Comments, SponsorBlock, DeArrow, YouTube Anti Translate, Immersive Translate, Video Speed Controller, Return YouTube Dislike, PocketTube, and uBlock Origin Lite.
- **Zero Telemetry & Zero Dependencies**: Pure Manifest V3, scoped strictly to `https://www.youtube.com/*`, zero `innerHTML` (Trusted Types safe), bilingual **English & 简体中文**.

---

## How It Works

TideLock uses a **3-layer defense-in-depth architecture**:

```text
Layer 1 · MAIN World InnerTube Bridge (src/content/page-bridge.js)
  ├─ Captures initial SSR ytInitialData & /youtubei/v1/browse (FEwhat_to_watch)
  ├─ Stitches infinite-scroll continuation items (deduped, bounded, preserves trailing token)
  └─ Intercepts stale return-to-home auto-refreshes while passing intentional refreshes straight through

Layer 2 · ISOLATED World Precision UX (src/content/content-main.js)
  ├─ Anchors exact scrollY & clicked videoId, yielding immediately on manual wheel/touch
  ├─ Supports both legacy videoRenderer & 2025–2026 lockupViewModel cards
  └─ Renders subtle Watched pills, hover Pin buttons, and a Shadow DOM Snapshot Drawer

Layer 3 · Local Snapshot Vault (chrome.storage.local)
  └─ Stores up to 5 recent Home snapshots + Pinned queue locally as a zero-loss failsafe
```

---

## Installation

### Load Unpacked in Chrome / Edge / Brave (Free, 30 Seconds)

1. Download or clone this repository:
   ```bash
   git clone https://github.com/qiao-obs/TideLock.git
   ```
   Or download the latest ZIP from Releases / run `npm run build` to generate `dist/tidelock-v1.0.0.zip`.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Toggle **Developer mode** ON in the top-right corner.
4. Click **Load unpacked** and select the `TideLock` folder.
5. Refresh YouTube — TideLock is active immediately with zero setup required.

---

## Development & Testing

Requires Node.js 20+ (and Python + Pillow only if regenerating PNG icons).

```bash
# Run unit tests (InnerTube parser, continuation stitching, intent state machine, Trusted Types checks)
npm test

# Validate manifest/icons and package a store-ready ZIP in dist/
npm run build

# Regenerate 4x supersampled PNG icons (16/32/48/128)
npm run icons
```

---

## Publishing Readiness

Ready-to-submit store listing copy, permission justifications, and pre-publish checklists are maintained in [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) and [PRIVACY.md](PRIVACY.md). The same `dist/tidelock-v*.zip` bundle works for both **Chrome Web Store** and **Microsoft Edge Add-ons** (free submission).

## License

[MIT](LICENSE)
