import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  parseKeywords,
  evaluateGroup,
  evaluateCard,
  normalizeGroupCache,
  pruneHiddenRecords,
  addWatchLater,
  extractIdFromUrl,
  classifyCardFromSignals,
} from '../src/core.js';

// evaluateGroup consumes the cache's derived lookup instead of walking groups.
const AUTHOR_GROUPS = {
  'm:100': ['study', 'blocked'],
  'm:101': ['study'],
  'm:102': ['blocked'],
  'm:103': ['neutral'],
};

const GROUP_STATES = {
  study: 1,
  blocked: -1,
  neutral: 0,
};

function assertVisible(result, expected) {
  assert.equal(typeof result, 'object');
  assert.equal(result?.visible, expected);
}

test('DEFAULT_SETTINGS is a safe baseline accepted by normalizeSettings', () => {
  assert.equal(DEFAULT_SETTINGS.enabled, true);
  assert.deepEqual(DEFAULT_SETTINGS.keywords, []);
  assert.deepEqual(DEFAULT_SETTINGS.hiddenTypes, []);
  assert.deepEqual(DEFAULT_SETTINGS.collapsedSections, []);
  assert.deepEqual(DEFAULT_SETTINGS.groupStatesByUid, {});
  assert.ok(Number.isFinite(DEFAULT_SETTINGS.cacheHours));
  assert.ok(DEFAULT_SETTINGS.cacheHours > 0);
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
});

test('normalizeSettings validates storage values and migrates legacy group states', () => {
  const normalized = normalizeSettings({
    enabled: false,
    panelOpen: true,
    launcherCorner: 'top-left',
    dock: 'left',
    launcherPosition: null,
    panelDirection: 'auto',
    collapsedSections: ['layout', 'groups', 'layout', 'unknown'],
    fontScale: 100,
    theme: 'dark',
    density: 'compact',
    feedWidth: 'wide',
    hideSidebars: true,
    keywords: ' C++\n[教程]\nC++ ',
    caseSensitive: true,
    hiddenTypes: ['video', 'image', 'video', 'VIDEO', 'invalid'],
    groupStatesByUid: {
      42: { study: 1, blocked: -1, neutral: 0, invalid: 2 },
      empty: { neutral: 0 },
    },
    groupStates: { oldInclude: 1, oldExclude: -1, oldNeutral: 0 },
    cacheHours: 999,
    unexpectedKey: true,
  });

  assert.deepEqual(normalized, {
    schemaVersion: 2,
    enabled: false,
    panelOpen: true,
    launcherCorner: 'top-left',
    panelDirection: 'auto',
    collapsedSections: ['groups', 'layout'],
    fontScale: 100,
    theme: 'dark',
    density: 'compact',
    feedWidth: 'wide',
    hideSidebars: true,
    keywords: ['C++', '[教程]'],
    caseSensitive: true,
    hiddenTypes: ['video', 'image'],
    groupStatesByUid: {
      42: { study: 1, blocked: -1 },
      legacy: { oldInclude: 1, oldExclude: -1 },
    },
    cacheHours: 72,
  });
  assert.equal('unexpectedKey' in normalized, false);
});

test('normalizeSettings keeps only canonical collapsible section identifiers', () => {
  assert.deepEqual(
    normalizeSettings({ collapsedSections: ['layout', 'types', 'groups', 'types', null, 'future'] }).collapsedSections,
    ['groups', 'types', 'layout'],
  );
  assert.deepEqual(normalizeSettings({ collapsedSections: 'groups' }).collapsedSections, []);
  assert.deepEqual(normalizeSettings({}).collapsedSections, []);
});

test('normalizeSettings validates fixed launcher corners, migrates legacy positions, and snaps font scaling', () => {
  const normalized = normalizeSettings({
    launcherCorner: 'bottom-left',
    panelDirection: 'left',
    fontScale: 136,
  });
  assert.equal(normalized.launcherCorner, 'bottom-left');
  assert.equal(normalizeSettings({ panelDirection: 'left' }).panelDirection, 'left');
  assert.equal(normalizeSettings({ fontScale: 136 }).fontScale, 140);
  assert.equal(normalizeSettings({ fontScale: 999 }).fontScale, 150);
  assert.equal(normalizeSettings({ fontScale: 1 }).fontScale, 80);
  assert.equal(normalizeSettings({ fontScale: 'invalid' }).fontScale, 100);
  assert.equal(normalizeSettings({ panelDirection: 'diagonal' }).panelDirection, 'auto');
  assert.equal(normalizeSettings({ launcherCorner: 'center' }).launcherCorner, 'bottom-right');
  assert.equal(normalizeSettings({ launcherPosition: { x: 0.2, y: 0.1 } }).launcherCorner, 'top-left');
  assert.equal(normalizeSettings({ launcherPosition: { x: 0.8, y: 0.1 } }).launcherCorner, 'top-right');
  assert.equal(normalizeSettings({ launcherPosition: { x: 0.2, y: 0.8 } }).launcherCorner, 'bottom-left');
  assert.equal(normalizeSettings({ launcherPosition: { x: 0.8, y: 0.8 } }).launcherCorner, 'bottom-right');
  assert.equal(normalizeSettings({ launcherPosition: { x: 0.5, y: 0.5 } }).launcherCorner, 'bottom-right');
  assert.equal(normalizeSettings({ launcherPosition: { x: -0.25, y: 1.4 } }).launcherCorner, 'bottom-left');
  assert.equal(normalizeSettings({ launcherPosition: { x: 0.5, y: 'bad' }, dock: 'left' }).launcherCorner, 'bottom-left');
});

test('parseKeywords handles each entry as case-insensitive literal text', () => {
  assert.deepEqual(
    parseKeywords('  Alpha, beta；ALPHA\nC++\r\n[教程]  '),
    ['Alpha, beta；ALPHA', 'C++', '[教程]'],
  );
  assert.deepEqual(parseKeywords([' Foo ', 'BAR', 'foo', null]), ['Foo', 'BAR']);
  assert.deepEqual(
    parseKeywords(['Alpha', 'alpha'], { caseSensitive: true }),
    ['Alpha', 'alpha'],
  );
  assert.deepEqual(parseKeywords(null), []);
});

test('evaluateGroup implements neutral/include/exclude with exclusion priority', () => {
  assert.equal(evaluateGroup('m:101', AUTHOR_GROUPS, GROUP_STATES), true);
  assert.equal(evaluateGroup('m:103', AUTHOR_GROUPS, GROUP_STATES), false);
  assert.equal(evaluateGroup('m:102', AUTHOR_GROUPS, GROUP_STATES), false);

  // This author is in both an included and an excluded group: exclusion wins.
  assert.equal(evaluateGroup('m:100', AUTHOR_GROUPS, GROUP_STATES), false);

  // A known author with no group memberships does not satisfy an include rule.
  assert.equal(evaluateGroup('m:999', AUTHOR_GROUPS, GROUP_STATES), false);

  // Missing author identity and missing caches are fail-open.
  assert.equal(evaluateGroup(null, AUTHOR_GROUPS, GROUP_STATES), true);
  assert.equal(evaluateGroup('m:101', null, GROUP_STATES), true);

  assert.equal(evaluateGroup('m:103', AUTHOR_GROUPS, {}), true);
  assert.equal(
    evaluateGroup('m:102', AUTHOR_GROUPS, { blocked: -1 }),
    false,
  );
});

test('evaluateCard composes group, literal keyword, and type filters', () => {
  const settings = normalizeSettings({
    groupStatesByUid: {
      'viewer-42': GROUP_STATES,
    },
    keywords: ['[广告]'],
    hiddenTypes: ['pgc'],
  });
  const context = {
    uid: 'viewer-42',
    authorGroupsMap: AUTHOR_GROUPS,
  };

  assertVisible(
    evaluateCard(
      { authorMid: '101', text: '从零学习 C++ [教程]', type: 'video' },
      settings,
      context,
    ),
    true,
  );
  assertVisible(
    evaluateCard(
      { authorMid: '101', text: '教程 [广告]', type: 'video' },
      settings,
      context,
    ),
    false,
  );
  assertVisible(
    evaluateCard(
      { authorMid: '100', text: '普通动态', type: 'video' },
      settings,
      context,
    ),
    false,
  );
  assertVisible(
    evaluateCard(
      { authorMid: '103', text: '普通动态', type: 'video' },
      settings,
      context,
    ),
    false,
  );
  assertVisible(
    evaluateCard(
      { authorMid: '101', text: '番剧更新', type: 'pgc' },
      settings,
      context,
    ),
    false,
  );

  // A card whose author cannot be extracted is fail-open; other filters still apply.
  assertVisible(
    evaluateCard(
      { text: '普通动态', type: 'video' },
      settings,
      context,
    ),
    true,
  );
  // Nicknames are mutable and non-unique, so a name-only match must not drive
  // a group decision even if a legacy cache contains an n: lookup.
  assertVisible(
    evaluateCard(
      { authorName: '同名作者', text: '普通动态', type: 'video' },
      settings,
      { ...context, authorGroupsMap: { ...AUTHOR_GROUPS, 'n:同名作者': ['included'] } },
    ),
    true,
  );
  assertVisible(
    evaluateCard(
      { text: '[广告]', type: 'video' },
      settings,
      context,
    ),
    false,
  );

  // Brackets and other regular-expression metacharacters remain literal.
  assert.doesNotThrow(() =>
    evaluateCard(
      { text: '只有一个左方括号 [', type: 'other' },
      normalizeSettings({ keywords: ['['] }),
    ),
  );
  assertVisible(
    evaluateCard(
      { text: '只有一个左方括号 [', type: 'other' },
      normalizeSettings({ keywords: ['['] }),
    ),
    false,
  );
});

test('normalizeGroupCache returns the standard schema plus a derived lookup', () => {
  const raw = {
    schemaVersion: '1',
    uid: 42,
    fetchedAt: '1700000000123',
    groups: [
      {
        id: 7,
        name: ' 学习 ',
        count: '2',
        memberMids: [100, '101', '100'],
        memberNames: ['甲', '乙', '甲'],
      },
      {
        id: '8',
        name: '休闲',
        count: -1,
        memberMids: [102],
        memberNames: ['丙'],
      },
      null,
      { id: null, name: '无效分组' },
    ],
  };

  assert.deepEqual(normalizeGroupCache(raw), {
    schemaVersion: 2,
    uid: '42',
    fetchedAt: 1_700_000_000_123,
    groups: [
      {
        id: '7',
        name: '学习',
        count: 2,
        loadedAt: 0,
        memberMids: ['100', '101'],
        memberNames: ['甲', '乙'],
      },
      {
        id: '8',
        name: '休闲',
        count: 0,
        loadedAt: 0,
        memberMids: ['102'],
        memberNames: ['丙'],
      },
    ],
    memberships: {
      'm:100': ['7'],
      'm:101': ['7'],
      'n:甲': ['7'],
      'n:乙': ['7'],
      'm:102': ['8'],
      'n:丙': ['8'],
    },
  });

  assert.deepEqual(normalizeGroupCache(null), {
    schemaVersion: 2,
    uid: null,
    fetchedAt: 0,
    groups: [],
    memberships: {},
  });
});

test('pruneHiddenRecords applies TTL inclusively and retains the newest records', () => {
  const now = 10_000;
  const ttlResult = pruneHiddenRecords(
    {
      expired: 8_999,
      boundary: 9_000,
      fresh: 9_900,
      invalid: 'not-a-time',
    },
    { now, ttlMs: 1_000, maxEntries: 10 },
  );

  assert.deepEqual(ttlResult, { fresh: 9_900, boundary: 9_000 });

  const capped = pruneHiddenRecords(
    {
      oldest: 9_100,
      newest: 9_900,
      middle: 9_500,
    },
    { now, ttlMs: 1_000, maxEntries: 2 },
  );
  assert.deepEqual(capped, { newest: 9_900, middle: 9_500 });
});

test('pruneHiddenRecords accepts arrays, keeps the newest duplicate, and returns a map', () => {
  const result = pruneHiddenRecords(
    [
      { id: 'same', hiddenAt: 9_100 },
      { id: 'same', hiddenAt: 9_900 },
      { id: 200, timestamp: 9_800 },
      { id: '', hiddenAt: 9_950 },
    ],
    { now: 10_000, ttlMs: 1_000, maxEntries: 10 },
  );

  assert.equal(Array.isArray(result), false);
  assert.deepEqual(result, { same: 9_900, 200: 9_800 });
});

test('addWatchLater moves a duplicate to the front without mutating its input', () => {
  const original = [
    {
      id: 'BV1xx411c7mD',
      title: '旧标题',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      addedAt: 1,
    },
    {
      id: 'BV1Q541167Qg',
      title: '第二条',
      url: 'https://www.bilibili.com/video/BV1Q541167Qg',
      addedAt: 2,
    },
  ];
  const snapshot = JSON.stringify(original);

  const result = addWatchLater(
    original,
    {
      id: 'BV1xx411c7mD',
      title: '新标题',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD?t=10',
      addedAt: 3,
    },
    { maxEntries: 2 },
  );

  assert.deepEqual(
    result.map((item) => item.id),
    ['BV1xx411c7mD', 'BV1Q541167Qg'],
  );
  assert.equal(result[0].title, '新标题');
  assert.equal(JSON.stringify(original), snapshot);
  assert.notStrictEqual(result, original);
});

test('addWatchLater de-duplicates canonical URLs and enforces its maximum size', () => {
  const deDuplicated = addWatchLater(
    [
      {
        title: '旧条目',
        url: '/video/BV1xx411c7mD?spm_id_from=old',
        addedAt: 1,
      },
    ],
    {
      title: '新条目',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD?t=10',
      addedAt: 2,
    },
    { maxEntries: 5 },
  );
  assert.equal(deDuplicated.length, 1);
  assert.equal(deDuplicated[0].title, '新条目');

  const capped = addWatchLater(
    [
      { id: 'BV1Q541167Qg', addedAt: 2 },
      { id: 'av170001', addedAt: 1 },
    ],
    { id: 'BV1xx411c7mD', addedAt: 3 },
    { maxEntries: 2 },
  );
  assert.deepEqual(
    capped.map((item) => item.id),
    ['BV1xx411c7mD', 'BV1Q541167Qg'],
  );
});

test('extractIdFromUrl recognizes video and dynamic URL variants safely', () => {
  assert.equal(
    extractIdFromUrl(
      'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.1007',
    ),
    'BV1xx411c7mD',
  );
  assert.equal(
    extractIdFromUrl('//www.bilibili.com/video/AV170001?p=2'),
    'av170001',
  );
  assert.equal(extractIdFromUrl('/video/BV1Q541167Qg?t=3'), 'BV1Q541167Qg');
  assert.equal(extractIdFromUrl('https://t.bilibili.com/123456789'), '123456789');
  assert.equal(
    extractIdFromUrl('https://www.bilibili.com/opus/987654321?from=dynamic'),
    '987654321',
  );
  assert.equal(extractIdFromUrl('not a url'), null);
  assert.equal(extractIdFromUrl(null), null);
});

test('classifyCardFromSignals maps aliases into the public type vocabulary', () => {
  const cases = [
    [{ video: true }, 'video'],
    [{ image: true }, 'image'],
    [{ article: true }, 'image'],
    [{ opus: true }, 'image'],
    [{ forward: true }, 'forward'],
    [{ live: true }, 'live'],
    [{ pgc: true }, 'pgc'],
    [{ other: true }, 'other'],
    [{}, 'unknown'],
    [null, 'unknown'],
  ];

  for (const [signals, expected] of cases) {
    assert.equal(classifyCardFromSignals(signals), expected);
  }
});

test('classifyCardFromSignals has stable precedence for overlapping DOM signals', () => {
  assert.equal(
    classifyCardFromSignals({
      forward: true,
      live: true,
      pgc: true,
      video: true,
      image: true,
      other: true,
    }),
    'forward',
  );
  assert.equal(
    classifyCardFromSignals({ live: true, pgc: true, video: true, image: true }),
    'live',
  );
  assert.equal(
    classifyCardFromSignals({ pgc: true, video: true, image: true }),
    'pgc',
  );
  assert.equal(
    classifyCardFromSignals({ video: true, image: true, other: true }),
    'video',
  );
  assert.equal(
    classifyCardFromSignals({ image: true, other: true }),
    'image',
  );
});
