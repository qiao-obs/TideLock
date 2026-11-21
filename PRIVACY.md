# Privacy Policy — TideLock

> Last Updated: 2026-11-21

**TideLock** runs 100% locally in your browser. We do not collect, transmit, sell, or share any personal data.

## What Data TideLock Stores Locally

To preserve your YouTube home feed across returns and reloads, remember scroll positions, support one-click Undo Refresh, and display recent snapshots or pinned videos, TideLock stores data **strictly on your own device**:

- **Browser Extension Local Storage (`chrome.storage.local`)**:
  - Extension preferences and feature toggles
  - Lightweight metadata for up to 6 recent YouTube Home feed snapshots (video IDs, original & translated titles, channel names, durations, thumbnails, and video URLs)
  - Videos you explicitly pin via hover button, snapshot drawer, or right-click menu
  - Per-route scroll anchors (Home, Subscriptions, Search) and recently watched video IDs
  - Local counters (unwanted refreshes blocked, scroll restores, undos performed)
- **Origin-Scoped IndexedDB on `youtube.com` (`TideLockFeedCache`)**:
  - The current and immediately previous Home feed payloads (auto-expiring after 12 hours) so your Home feed survives watch-page reloads, Chrome Memory Saver tab discards, and accidental `F5` refreshes.

## What TideLock Never Does

- **Zero external servers**: TideLock makes no network requests to any third-party server, analytics endpoint, or telemetry service.
- **Zero tracking or ads**: No cookies, no fingerprinting, no usage analytics, and no monetization scripts.
- **Scoped strictly to YouTube**: TideLock only runs on `https://www.youtube.com/*` and never accesses other websites.

## Controlling or Deleting Your Data

You can clear snapshots or reset watched badges anytime inside TideLock's **Settings** tab, clear site data for `youtube.com`, or uninstall the extension to remove all locally stored extension data immediately.

## Contact

For questions or privacy inquiries, please open an issue at:
https://github.com/qiao-obs/TideLock/issues
