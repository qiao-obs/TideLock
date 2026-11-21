import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadClassicScript(relPath, globalKey) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  vm.runInThisContext(code, { filename: relPath });
  return globalThis[globalKey];
}

const Engine = loadClassicScript('src/core/feed-engine.js', '__TideLockEngine');
const Defaults = loadClassicScript('src/core/defaults.js', '__TideLockDefaults');

function makeVideoRendererItem(id, title, channel = 'Demo Channel') {
  return {
    richItemRenderer: {
      content: {
        videoRenderer: {
          videoId: id,
          title: { runs: [{ text: title }] },
          ownerText: { runs: [{ text: channel }] },
          lengthText: { simpleText: '12:34' },
          shortViewCountText: { simpleText: '120K views' },
          thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }] },
        },
      },
    },
  };
}

function makeLockupViewModelItem(id, title, channel = 'Modern Creator') {
  return {
    richItemRenderer: {
      content: {
        lockupViewModel: {
          contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
          contentId: id,
          metadata: {
            lockupMetadataViewModel: {
              title: { content: title },
              metadata: {
                contentMetadataViewModel: {
                  metadataRows: [
                    { metadataParts: [{ text: { content: channel } }] },
                    { metadataParts: [{ text: { content: '88K views' } }, { text: { content: '2 days ago' } }] },
                  ],
                },
              },
            },
          },
          contentImage: {
            thumbnailViewModel: {
              image: { sources: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }] },
              overlays: [
                {
                  thumbnailOverlayBadgeViewModel: {
                    thumbnailBadges: [{ thumbnailBadgeViewModel: { text: '18:05' } }],
                  },
                },
              ],
            },
          },
          rendererContext: {
            commandContext: {
              onTap: {
                innertubeCommand: {
                  watchEndpoint: { videoId: id },
                },
              },
            },
          },
        },
      },
    },
  };
}

function makeBrowsePayload(items, continuationToken = 'TOK_1') {
  return {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              endpoint: { browseEndpoint: { browseId: 'FEwhat_to_watch' } },
              content: {
                richGridRenderer: {
                  contents: [
                    ...items,
                    {
                      continuationItemRenderer: {
                        continuationEndpoint: {
                          continuationCommand: { token: continuationToken },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
}

test('parseBrowseRequestBody distinguishes initial Home, chip filters, and continuations', () => {
  const home = Engine.parseBrowseRequestBody(JSON.stringify({ browseId: 'FEwhat_to_watch' }));
  assert.equal(home.valid, true);
  assert.equal(home.isHomeInitial, true);
  assert.equal(home.isHomeChip, false);
  assert.equal(home.isContinuation, false);

  const chip = Engine.parseBrowseRequestBody(JSON.stringify({ browseId: 'FEwhat_to_watch', params: '8gU1' }));
  assert.equal(chip.isHomeInitial, false);
  assert.equal(chip.isHomeChip, true);

  const cont = Engine.parseBrowseRequestBody(new TextEncoder().encode(JSON.stringify({ continuation: 'ABC123' })));
  assert.equal(cont.isContinuation, true);
  assert.equal(cont.isHomeInitial, false);

  const subs = Engine.parseBrowseRequestBody(JSON.stringify({ browseId: 'FEsubscriptions' }));
  assert.equal(subs.isSubscriptions, true);
  assert.equal(subs.isHomeInitial, false);
});

test('shouldInterceptHomeBrowse handles back navigation, logo clicks, and explicit refresh accurately', () => {
  const reqHome = Engine.parseBrowseRequestBody(JSON.stringify({ browseId: 'FEwhat_to_watch' }));
  const reqChip = Engine.parseBrowseRequestBody(JSON.stringify({ browseId: 'FEwhat_to_watch', params: 'CHIP' }));
  const now = 1_000_000;

  // Back traverse -> intercept
  const backRes = Engine.shouldInterceptHomeBrowse(
    {
      enabled: true,
      hasCachedFeed: true,
      preserveOnLogoFromWatch: true,
      returnIntent: 'BACK_TRAVERSE',
      returnIntentAt: now - 500,
      explicitRefreshUntil: 0,
      wasAwayFromHome: true,
    },
    reqHome,
    now
  );
  assert.equal(backRes.intercept, true);
  assert.equal(backRes.reason, 'back_traverse');

  // Logo clicked from watch page -> intercept when setting enabled
  const logoAwayRes = Engine.shouldInterceptHomeBrowse(
    {
      enabled: true,
      hasCachedFeed: true,
      preserveOnLogoFromWatch: true,
      returnIntent: 'LOGO_FROM_AWAY',
      returnIntentAt: now - 300,
      explicitRefreshUntil: 0,
      wasAwayFromHome: true,
    },
    reqHome,
    now
  );
  assert.equal(logoAwayRes.intercept, true);
  assert.equal(logoAwayRes.reason, 'logo_from_away');

  // Explicit refresh (Logo on Home or Refresh button) -> pass through
  const explicitRes = Engine.shouldInterceptHomeBrowse(
    {
      enabled: true,
      hasCachedFeed: true,
      preserveOnLogoFromWatch: true,
      returnIntent: null,
      returnIntentAt: 0,
      explicitRefreshUntil: now + 5000,
      wasAwayFromHome: false,
    },
    reqHome,
    now
  );
  assert.equal(explicitRes.intercept, false);
  assert.equal(explicitRes.reason, 'explicit_refresh');

  // Chip filter -> never intercept
  const chipRes = Engine.shouldInterceptHomeBrowse(
    {
      enabled: true,
      hasCachedFeed: true,
      returnIntent: 'BACK_TRAVERSE',
      returnIntentAt: now - 100,
      wasAwayFromHome: true,
    },
    reqChip,
    now
  );
  assert.equal(chipRes.intercept, false);
  assert.equal(chipRes.reason, 'not_home_initial');
});

test('extractSnapshotCardsFromBrowse parses both legacy videoRenderer and 2026 lockupViewModel while skipping ads', () => {
  const adItem = { richItemRenderer: { content: { adSlotRenderer: { id: 'ad1' } } } };
  const payload = makeBrowsePayload([
    makeVideoRendererItem('dQw4w9WgXcQ', 'Legacy Video Title', 'Channel A'),
    adItem,
    makeLockupViewModelItem('abc123XYZ89', 'Modern Lockup Title', 'Channel B'),
  ]);

  const cards = Engine.extractSnapshotCardsFromBrowse(payload);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(cards[0].title, 'Legacy Video Title');
  assert.equal(cards[0].duration, '12:34');

  assert.equal(cards[1].videoId, 'abc123XYZ89');
  assert.equal(cards[1].title, 'Modern Lockup Title');
  assert.equal(cards[1].channel, 'Channel B');
  assert.equal(cards[1].duration, '18:05');
});

test('stitchHomeResponse appends deduplicated continuation items and keeps latest continuation token', () => {
  const base = makeBrowsePayload(
    [
      makeVideoRendererItem('vid00000001', 'Video 1'),
      makeLockupViewModelItem('vid00000002', 'Video 2'),
    ],
    'TOKEN_OLD'
  );

  const contResponse = {
    onResponseReceivedActions: [
      {
        appendContinuationItemsAction: {
          continuationItems: [
            makeLockupViewModelItem('vid00000002', 'Video 2 Duplicate'),
            makeLockupViewModelItem('vid00000003', 'Video 3'),
            {
              continuationItemRenderer: {
                continuationEndpoint: { continuationCommand: { token: 'TOKEN_NEW' } },
              },
            },
          ],
        },
      },
    ],
  };

  const { items, trailingContinuation } = Engine.extractContinuationItems(contResponse);
  assert.equal(items.length, 2);
  assert.equal(trailingContinuation.continuationItemRenderer.continuationEndpoint.continuationCommand.token, 'TOKEN_NEW');

  const stitched = Engine.stitchHomeResponse(base, items, trailingContinuation, 50);
  const found = Engine.findRichGridContents(stitched);
  // Expect 3 unique video cards + 1 trailing continuationItemRenderer = 4 items
  assert.equal(found.contents.length, 4);
  assert.equal(
    found.contents[3].continuationItemRenderer.continuationEndpoint.continuationCommand.token,
    'TOKEN_NEW'
  );
  const ids = Engine.extractSnapshotCardsFromBrowse(stitched).map((c) => c.videoId);
  assert.deepEqual(ids, ['vid00000001', 'vid00000002', 'vid00000003']);
});

test('mergeSnapshotVault merges overlapping feed updates and caps LRU length', () => {
  let vault = [];
  vault = Engine.mergeSnapshotVault(
    vault,
    {
      feedId: 'feed_1',
      videos: [
        { videoId: 'a0000000001', title: 'A1' },
        { videoId: 'a0000000002', title: 'A2' },
      ],
    },
    2
  );
  assert.equal(vault.length, 1);

  // Same feedId with scrolled card -> merges in-place
  vault = Engine.mergeSnapshotVault(
    vault,
    {
      feedId: 'feed_1',
      videos: [{ videoId: 'a0000000003', title: 'A3' }],
    },
    2
  );
  assert.equal(vault.length, 1);
  assert.equal(vault[0].videos.length, 3);

  // Brand new feed -> prepends new snapshot
  vault = Engine.mergeSnapshotVault(
    vault,
    {
      feedId: 'feed_2',
      videos: [{ videoId: 'b0000000001', title: 'B1' }],
    },
    2
  );
  assert.equal(vault.length, 2);
  assert.equal(vault[0].feedId, 'feed_2');

  // Third distinct feed -> evicts oldest beyond maxSnapshots=2
  vault = Engine.mergeSnapshotVault(
    vault,
    {
      feedId: 'feed_3',
      videos: [{ videoId: 'c0000000001', title: 'C1' }],
    },
    2
  );
  assert.equal(vault.length, 2);
  assert.equal(vault[0].feedId, 'feed_3');
  assert.equal(vault[1].feedId, 'feed_2');
});

test('Manifest V3, locales, icons, and Trusted Types safety checks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(Defaults.DEFAULT_SETTINGS.enabled === true);

  // Verify locales parse and contain manifest __MSG__ keys
  for (const loc of ['en', 'zh_CN']) {
    const msgs = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', loc, 'messages.json'), 'utf8'));
    assert.ok(msgs.extName?.message);
    assert.ok(msgs.extDescription?.message);
  }

  // Verify no innerHTML or eval in src/ (YouTube Trusted Types + MV3 CSP compliance)
  const scanDir = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.name.endsWith('.js')) {
        const code = fs.readFileSync(full, 'utf8');
        assert.equal(/\binnerHTML\b/.test(code), false, `Found forbidden innerHTML in ${full}`);
        assert.equal(/\beval\s*\(/.test(code), false, `Found forbidden eval() in ${full}`);
      }
    }
  };
  scanDir(path.join(ROOT, 'src'));
});
