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
                    {
                      metadataParts: [
                        { text: { content: '88K views' } },
                        { text: { content: '2 days ago' } },
                      ],
                    },
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

test('getRouteAnchorKey normalizes Home, Subscriptions, and Search routes', () => {
  assert.equal(Engine.getRouteAnchorKey('https://www.youtube.com/'), 'home');
  assert.equal(Engine.getRouteAnchorKey('https://www.youtube.com/feed/subscriptions'), 'subscriptions');
  assert.equal(
    Engine.getRouteAnchorKey('https://www.youtube.com/results?search_query=AI+Agents'),
    'search:ai agents'
  );
  assert.equal(Engine.getRouteAnchorKey('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
});

test('extractVideoIdFromUrl handles watch, shorts, and youtu.be URLs', () => {
  assert.equal(Engine.extractVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30'), 'dQw4w9WgXcQ');
  assert.equal(Engine.extractVideoIdFromUrl('https://www.youtube.com/shorts/abc123XYZ89'), 'abc123XYZ89');
  assert.equal(Engine.extractVideoIdFromUrl('https://youtu.be/abc123XYZ89?si=foo'), 'abc123XYZ89');
  assert.equal(Engine.extractVideoIdFromUrl('https://www.youtube.com/'), null);
});

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

test('shouldInterceptHomeBrowse handles back navigation, logo clicks, explicit refresh, and undo replay', () => {
  const reqHome = Engine.parseBrowseRequestBody(JSON.stringify({ browseId: 'FEwhat_to_watch' }));
  const reqChip = Engine.parseBrowseRequestBody(JSON.stringify({ browseId: 'FEwhat_to_watch', params: 'CHIP' }));
  const now = 1_000_000;

  // Undo accidental refresh overrides even when enabled=false or explicit refresh happened earlier
  const undoRes = Engine.shouldInterceptHomeBrowse(
    {
      enabled: false,
      hasCachedFeed: true,
      undoReplayPending: true,
      explicitRefreshUntil: now + 5000,
    },
    reqHome,
    now
  );
  assert.equal(undoRes.intercept, true);
  assert.equal(undoRes.reason, 'undo_replay');

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

  // Explicit refresh -> pass through
  const explicitRes = Engine.shouldInterceptHomeBrowse(
    {
      enabled: true,
      hasCachedFeed: true,
      preserveOnLogoFromWatch: true,
      explicitRefreshUntil: now + 5000,
      wasAwayFromHome: false,
    },
    reqHome,
    now
  );
  assert.equal(explicitRes.intercept, false);
  assert.equal(explicitRes.reason, 'explicit_refresh');

  // Chip filter clicked explicitly within TTL -> never intercept
  const chipRes = Engine.shouldInterceptHomeBrowse(
    {
      enabled: true,
      hasCachedFeed: true,
      returnIntent: 'BACK_TRAVERSE',
      returnIntentAt: now - 100,
      lastChipClickAt: now - 500,
      wasAwayFromHome: true,
    },
    reqChip,
    now
  );
  assert.equal(chipRes.intercept, false);
  assert.equal(chipRes.reason, 'explicit_chip_filter');

  // Internal YouTube params on Home return WITHOUT clicking a chip -> MUST intercept!
  const internalParamsBack = Engine.shouldInterceptHomeBrowse(
    {
      enabled: true,
      hasCachedFeed: true,
      returnIntent: 'BACK_TRAVERSE',
      returnIntentAt: now - 200,
      lastChipClickAt: 0,
      wasAwayFromHome: true,
    },
    reqChip,
    now
  );
  assert.equal(internalParamsBack.intercept, true);
  assert.equal(internalParamsBack.reason, 'back_traverse');
});

test('extractSnapshotCardsFromBrowse & stitchHomeResponse support desktop richGridRowRenderer rows', () => {
  const row1 = {
    richGridRowRenderer: {
      contents: [
        makeVideoRendererItem('row00000001', 'Row Video 1', 'Ch 1'),
        makeLockupViewModelItem('row00000002', 'Row Video 2', 'Ch 2'),
      ],
    },
  };
  const row2 = {
    richGridRowRenderer: {
      contents: [
        makeLockupViewModelItem('row00000003', 'Row Video 3', 'Ch 3'),
      ],
    },
  };

  const base = makeBrowsePayload([row1], 'TOK_ROW_1');
  const cards = Engine.extractSnapshotCardsFromBrowse(base);
  assert.deepEqual(
    cards.map((c) => c.videoId),
    ['row00000001', 'row00000002']
  );

  // Stitch row2 + duplicate row1
  const stitched = Engine.stitchHomeResponse(base, [row1, row2], null, 50);
  const stitchedCards = Engine.extractSnapshotCardsFromBrowse(stitched);
  assert.deepEqual(
    stitchedCards.map((c) => c.videoId),
    ['row00000001', 'row00000002', 'row00000003']
  );
});

test('extractSnapshotCardsFromBrowse parses legacy videoRenderer and 2026 lockupViewModel while skipping ads', () => {
  const adItem = { richItemRenderer: { content: { adSlotRenderer: { id: 'ad1' } } } };
  const payload = makeBrowsePayload([
    makeVideoRendererItem('dQw4w9WgXcQ', 'Legacy Video Title', 'Channel A'),
    adItem,
    makeLockupViewModelItem('abc123XYZ89', 'Modern Lockup Title', 'Channel B'),
  ]);

  const cards = Engine.extractSnapshotCardsFromBrowse(payload);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(cards[0].originalTitle, 'Legacy Video Title');
  assert.equal(cards[1].videoId, 'abc123XYZ89');
  assert.equal(cards[1].displayTitle, 'Modern Lockup Title');
  assert.equal(cards[1].duration, '18:05');
});

test('stitchHomeResponse appends deduplicated continuation items and preserves latest continuation token', () => {
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
  const stitched = Engine.stitchHomeResponse(base, items, trailingContinuation, 50);
  const found = Engine.findRichGridContents(stitched);
  assert.equal(found.contents.length, 4);
  assert.equal(
    found.contents[3].continuationItemRenderer.continuationEndpoint.continuationCommand.token,
    'TOKEN_NEW'
  );
  assert.deepEqual(
    Engine.extractSnapshotCardsFromBrowse(stitched).map((c) => c.videoId),
    ['vid00000001', 'vid00000002', 'vid00000003']
  );
});

test('bilingual title enrichment preserves originalTitle and supports CN/EN search', () => {
  const snap = {
    id: 's1',
    feedId: 'f1',
    videos: [
      {
        videoId: 'v0000000001',
        title: 'What Are AI Agents?',
        originalTitle: 'What Are AI Agents?',
        displayTitle: 'What Are AI Agents?',
        channel: 'Stanford Online',
      },
    ],
  };

  const { snapshot: updated, changed } = Engine.enrichSnapshotWithDomCards(snap, [
    {
      videoId: 'v0000000001',
      title: '什么是人工智能体？',
      displayTitle: '什么是人工智能体？',
      channel: 'Stanford Online',
    },
  ]);

  assert.equal(changed, true);
  assert.equal(updated.videos[0].displayTitle, '什么是人工智能体？');
  assert.equal(updated.videos[0].originalTitle, 'What Are AI Agents?');

  // Repeating identical enrichment yields changed=false (prevents storage write storms)
  const repeat = Engine.enrichSnapshotWithDomCards(updated, [
    { videoId: 'v0000000001', displayTitle: '什么是人工智能体？', channel: 'Stanford Online' },
  ]);
  assert.equal(repeat.changed, false);

  // Bilingual search matches BOTH Chinese translated title and original English title!
  assert.equal(Engine.filterVideos(updated.videos, { searchQuery: '人工智能' }).length, 1);
  assert.equal(Engine.filterVideos(updated.videos, { searchQuery: 'ai agents' }).length, 1);
  assert.equal(Engine.filterVideos(updated.videos, { searchQuery: 'stanford' }).length, 1);
});

test('extractNeighborVideos returns immediate unwatched neighbors around clicked card', () => {
  const videos = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'].map((id) => ({ videoId: id, title: id }));
  const watched = new Set(['v3', 'v4']);
  // Clicked v3; v4 is watched, so neighbors should pick v2, v5, v1, v6 in proximity order
  const neighbors = Engine.extractNeighborVideos(videos, 'v3', watched, 3);
  assert.deepEqual(
    neighbors.map((n) => n.videoId),
    ['v2', 'v5', 'v1']
  );
});

test('formatVideosAsMarkdown outputs clean Obsidian/Notion-ready Markdown links', () => {
  const md = Engine.formatVideosAsMarkdown(
    [
      {
        videoId: 'abc123XYZ89',
        displayTitle: '[Deep Dive] AI Engineering',
        channel: 'Dave',
        duration: '3:10:07',
        url: 'https://www.youtube.com/watch?v=abc123XYZ89',
      },
    ],
    'Study Queue'
  );
  assert.ok(md.includes('## Study Queue'));
  assert.ok(md.includes('- [Deep Dive AI Engineering](https://www.youtube.com/watch?v=abc123XYZ89) — Dave · 3:10:07'));
});

test('Manifest V3, locales, commands, permissions, cross-world isolation, and CSP compliance checks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '2.2.0');
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('contextMenus'));
  assert.ok(manifest.commands['toggle-drawer']);
  assert.equal(Defaults.DEFAULT_SETTINGS.enabled, true);

  // Critical Chromium MV3 guard: never share the same content_script JS path across MAIN & ISOLATED worlds
  const worldByPath = new Map();
  for (const cs of manifest.content_scripts || []) {
    const world = cs.world || 'ISOLATED';
    for (const file of cs.js || []) {
      assert.equal(
        worldByPath.has(file),
        false,
        `Duplicate content script path "${file}" across content_scripts entries (${worldByPath.get(file)} vs ${world})`
      );
      worldByPath.set(file, world);
    }
  }
  const coreEngineBuf = fs.readFileSync(path.join(ROOT, 'src/core/feed-engine.js'));
  const mainEngineBuf = fs.readFileSync(path.join(ROOT, 'src/content/page-engine.js'));
  assert.equal(coreEngineBuf.equals(mainEngineBuf), true, 'page-engine.js must stay byte-identical to feed-engine.js');

  for (const loc of ['en', 'zh_CN']) {
    const msgs = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', loc, 'messages.json'), 'utf8'));
    assert.ok(msgs.extName?.message);
    assert.ok(msgs.extDescription?.message);
    assert.ok(msgs.cmdToggleDrawer?.message);
    assert.ok(msgs.ctxPinVideo?.message);
  }

  // Zero innerHTML, zero eval, zero .then() chains in src/
  const scanDir = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.name.endsWith('.js')) {
        const code = fs.readFileSync(full, 'utf8');
        assert.equal(/\binnerHTML\b/.test(code), false, `Found forbidden innerHTML in ${full}`);
        assert.equal(/\beval\s*\(/.test(code), false, `Found forbidden eval() in ${full}`);
        assert.equal(/\.then\s*\(/.test(code), false, `Found .then() chain (use async/await) in ${full}`);
      }
    }
  };
  scanDir(path.join(ROOT, 'src'));
});

test('page-bridge decompresses gzip-encoded YouTube 2026 /youtubei/v1/browse POST requests and replays cached Home feed', async () => {
  const zlib = await import('node:zlib');
  const homePayload = makeBrowsePayload([
    makeLockupViewModelItem('AAA11111111', 'Cached Home Video 1'),
    makeLockupViewModelItem('BBB22222222', 'Cached Home Video 2'),
  ]);
  const freshServerPayload = makeBrowsePayload([
    makeLockupViewModelItem('NEW99999999', 'Refreshed Server Video'),
  ]);

  let serverFetchCalls = 0;
  const postedMessages = [];
  const listeners = new Map();
  const addEvt = (t, fn) => {
    if (!listeners.has(t)) listeners.set(t, []);
    listeners.get(t).push(fn);
  };

  const sandbox = {
    URL,
    Request,
    Response,
    Headers,
    Blob,
    TextDecoder,
    TextEncoder,
    DecompressionStream,
    Uint8Array,
    ArrayBuffer,
    CustomEvent,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    console,
    performance: { getEntriesByType: () => [] },
    location: { href: 'https://www.youtube.com/', pathname: '/', origin: 'https://www.youtube.com' },
    scrollY: 0,
    ytInitialData: homePayload,
    XMLHttpRequest: class FakeXhr {
      open() {}
      send() {}
      setRequestHeader() {}
      addEventListener() {}
    },
    document: {
      readyState: 'complete',
      addEventListener: addEvt,
      querySelector: () => null,
      dispatchEvent: () => true,
    },
    addEventListener: addEvt,
    postMessage(msg) {
      postedMessages.push(msg);
    },
    fetch: async () => {
      serverFetchCalls++;
      return new Response(JSON.stringify(freshServerPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/content/page-engine.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/content/page-bridge.js'), 'utf8'), ctx);

  // Verify initial Home capture fired
  assert.ok(postedMessages.some((m) => m.type === 'HOME_CAPTURED' && m.payload.count === 2));

  // Simulate navigating away to a video (/watch?v=AAA11111111), watching for a long time, then returning Back
  sandbox.location.href = 'https://www.youtube.com/watch?v=AAA11111111';
  sandbox.location.pathname = '/watch';
  for (const fn of listeners.get('yt-navigate-start') || []) {
    fn({ detail: { url: 'https://www.youtube.com/watch?v=AAA11111111' } });
  }
  for (const fn of listeners.get('yt-navigate-finish') || []) fn();

  // Simulate Back traverse to Home
  sandbox.location.href = 'https://www.youtube.com/';
  sandbox.location.pathname = '/';
  for (const fn of listeners.get('popstate') || []) fn();

  // Send a REAL YouTube 2026 gzip-compressed Request POST to /youtubei/v1/browse!
  const gzippedBody = zlib.gzipSync(
    Buffer.from(
      JSON.stringify({
        context: { client: { hl: 'zh-CN', gl: 'JP' } },
        browseId: 'FEwhat_to_watch',
      }),
      'utf8'
    )
  );
  const req = new Request('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
    },
    body: gzippedBody,
  });

  const res = await sandbox.fetch(req);
  assert.equal(serverFetchCalls, 0, 'Cached Home feed must intercept gzipped browse POST without hitting server');
  assert.equal(res.headers.get('x-tidelock-restored'), '1');
  const returnedJson = await res.json();
  const returnedCards = Engine.extractSnapshotCardsFromBrowse(returnedJson);
  assert.deepEqual(
    returnedCards.map((c) => c.videoId),
    ['AAA11111111', 'BBB22222222']
  );
  assert.ok(postedMessages.some((m) => m.type === 'FEED_RESTORED'));
});

test('v2.2.0 polish: single-row 2026 metadata views, invisible blank title stripping, and hideShorts filtering', () => {
  // 1. Invisible Hangul filler / zero-width blank titles must be stripped
  assert.equal(Engine.cleanDisplayText('ㅤㅤㅤ\u200B  '), '');
  assert.equal(Engine.cleanDisplayText('  AI   Agents\uFEFF '), 'AI Agents');

  // 2. Single-row 2026 desktop lockupViewModel metadata: [channel, views, relativeTime]
  const singleRowItem = {
    richItemRenderer: {
      content: {
        lockupViewModel: {
          contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
          contentId: 'MC7k4ruZD5c',
          metadata: {
            lockupMetadataViewModel: {
              title: { content: '初学者如何投资（2026年版）' },
              metadata: {
                contentMetadataViewModel: {
                  metadataRows: [
                    {
                      metadataParts: [
                        { text: { content: 'Mark Tilbury' } },
                        { text: { content: '917万次观看' } },
                        { text: { content: '3年前' } },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
  };
  const blankTitleItem = {
    richItemRenderer: {
      content: {
        videoRenderer: {
          videoId: 'QrqiSt4qyNM',
          title: { runs: [{ text: 'ㅤㅤㅤ' }] },
        },
      },
    },
  };
  const card = Engine.extractCardFromRichItem(singleRowItem);
  assert.equal(card.channel, 'Mark Tilbury');
  assert.equal(card.views, '917万次观看 · 3年前');
  assert.equal(Engine.extractCardFromRichItem(blankTitleItem), null);

  // 3. hideShorts filters Shorts in both filterVideos and extractNeighborVideos
  const mix = [
    { videoId: 'v1', title: 'Long 1', isShort: false },
    { videoId: 's1', title: 'Short 1', isShort: true },
    { videoId: 'v2', title: 'Long 2', isShort: false },
    { videoId: 's2', title: 'Short 2', isShort: true },
    { videoId: 'v3', title: 'Long 3', isShort: false },
  ];
  assert.deepEqual(
    Engine.filterVideos(mix, { hideShorts: true }).map((v) => v.videoId),
    ['v1', 'v2', 'v3']
  );
  assert.deepEqual(
    Engine.extractNeighborVideos(mix, 'v2', new Set(), 4, { hideShorts: true }).map((v) => v.videoId),
    ['v3', 'v1']
  );
});
