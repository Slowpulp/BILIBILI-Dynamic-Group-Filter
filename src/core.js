export const SCHEMA_VERSION = 1;
export const HIDDEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const HIDDEN_MAX_ENTRIES = 2000;
export const WATCH_LATER_MAX_ENTRIES = 500;
export const FONT_SCALE_MIN = 80;
export const FONT_SCALE_MAX = 150;
export const FONT_SCALE_STEP = 10;

export const CARD_TYPES = Object.freeze([
  "video",
  "image",
  "forward",
  "live",
  "pgc",
  "other",
]);

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  panelOpen: false,
  dock: "right",
  launcherPosition: null,
  panelDirection: "auto",
  fontScale: 100,
  theme: "auto",
  density: "comfortable",
  feedWidth: "default",
  hideSidebars: false,
  keywords: [],
  caseSensitive: false,
  hiddenTypes: [],
  groupStatesByUid: {},
  cacheHours: 6,
});

const VALID_DOCKS = new Set(["left", "right"]);
const VALID_PANEL_DIRECTIONS = new Set(["auto", "up", "down", "left", "right"]);
const VALID_THEMES = new Set(["auto", "light", "dark"]);
const VALID_DENSITIES = new Set(["comfortable", "compact"]);
const VALID_WIDTHS = new Set(["default", "wide"]);
const VALID_TYPES = new Set(CARD_TYPES);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function normalizeFontScale(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.fontScale;
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, parsed));
  return Math.round(clamped / FONT_SCALE_STEP) * FONT_SCALE_STEP;
}

export function normalizeLauncherPosition(value) {
  if (!isPlainObject(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}

function normalizeGroupStates(raw) {
  if (!isPlainObject(raw)) return {};
  const output = {};
  for (const [key, value] of Object.entries(raw)) {
    const state = Number(value);
    if (state === 1 || state === -1) output[String(key)] = state;
  }
  return output;
}

function normalizeGroupStatesByUid(raw, legacyStates) {
  const output = {};
  if (isPlainObject(raw)) {
    for (const [uid, states] of Object.entries(raw)) {
      const clean = normalizeGroupStates(states);
      if (Object.keys(clean).length) output[String(uid)] = clean;
    }
  }
  const legacy = normalizeGroupStates(legacyStates);
  if (Object.keys(legacy).length && !output.legacy) output.legacy = legacy;
  return output;
}

export function parseKeywords(input, { caseSensitive = false, maxEntries = 100, maxLength = 100 } = {}) {
  const source = Array.isArray(input) ? input : String(input ?? "").split(/\r?\n/);
  const seen = new Set();
  const output = [];
  for (const item of source) {
    const trimmed = String(item ?? "").trim().slice(0, maxLength);
    if (!trimmed) continue;
    const comparisonKey = caseSensitive ? trimmed : trimmed.toLocaleLowerCase("zh-CN");
    if (seen.has(comparisonKey)) continue;
    seen.add(comparisonKey);
    // Preserve the user's spelling for display and for a later switch to
    // case-sensitive mode. Normalization belongs to comparison, not storage.
    output.push(trimmed);
    if (output.length >= maxEntries) break;
  }
  return output;
}

export function normalizeSettings(raw) {
  const value = isPlainObject(raw) ? raw : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: value.enabled !== false,
    panelOpen: value.panelOpen === true,
    dock: VALID_DOCKS.has(value.dock) ? value.dock : DEFAULT_SETTINGS.dock,
    launcherPosition: normalizeLauncherPosition(value.launcherPosition),
    panelDirection: VALID_PANEL_DIRECTIONS.has(value.panelDirection)
      ? value.panelDirection
      : DEFAULT_SETTINGS.panelDirection,
    fontScale: normalizeFontScale(value.fontScale),
    theme: VALID_THEMES.has(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    density: VALID_DENSITIES.has(value.density) ? value.density : DEFAULT_SETTINGS.density,
    feedWidth: VALID_WIDTHS.has(value.feedWidth) ? value.feedWidth : DEFAULT_SETTINGS.feedWidth,
    hideSidebars: value.hideSidebars === true,
    keywords: parseKeywords(value.keywords, { caseSensitive: value.caseSensitive === true }),
    caseSensitive: value.caseSensitive === true,
    hiddenTypes: [...new Set(Array.isArray(value.hiddenTypes) ? value.hiddenTypes.filter((type) => VALID_TYPES.has(type)) : [])],
    groupStatesByUid: normalizeGroupStatesByUid(value.groupStatesByUid, value.groupStates),
    cacheHours: clampNumber(value.cacheHours, 1, 72, DEFAULT_SETTINGS.cacheHours),
  };
}

function membershipForAuthor(authorId, authorGroupsMap) {
  if (!authorId || !authorGroupsMap) return null;
  if (authorGroupsMap instanceof Map) {
    const found = authorGroupsMap.get(String(authorId)) ?? authorGroupsMap.get(authorId);
    return found == null ? [] : [...found].map(String);
  }
  if (isPlainObject(authorGroupsMap)) {
    const found = authorGroupsMap[String(authorId)];
    return found == null ? [] : [...found].map(String);
  }
  return null;
}

export function evaluateGroup(authorId, authorGroupsMap, groupStates = {}) {
  const active = Object.entries(groupStates).filter(([, state]) => Number(state) === 1 || Number(state) === -1);
  if (!active.length) return true;

  const memberships = membershipForAuthor(authorId, authorGroupsMap);
  if (memberships == null) return true;
  const memberSet = new Set(memberships);
  const excluded = active.filter(([, state]) => Number(state) === -1).map(([id]) => String(id));
  if (excluded.some((id) => memberSet.has(id))) return false;

  const included = active.filter(([, state]) => Number(state) === 1).map(([id]) => String(id));
  return included.length === 0 || included.some((id) => memberSet.has(id));
}

export function keywordMatch(text, keywords, caseSensitive = false) {
  const normalizedKeywords = parseKeywords(keywords, { caseSensitive });
  if (!normalizedKeywords.length) return null;
  const haystack = String(text ?? "").slice(0, 20_000);
  const normalizedText = caseSensitive ? haystack : haystack.toLocaleLowerCase("zh-CN");
  return normalizedKeywords.find((keyword) => {
    const needle = caseSensitive ? keyword : keyword.toLocaleLowerCase("zh-CN");
    return normalizedText.includes(needle);
  }) ?? null;
}

export function evaluateCard(card, settings, context = {}) {
  const normalized = normalizeSettings(settings);
  if (!normalized.enabled) return { visible: true, reason: null };

  const identity = String(card?.identity ?? card?.dynamicId ?? "");
  const hiddenRecords = context.hiddenRecords ?? {};
  const sessionHidden = context.sessionHidden ?? new Set();
  if ((identity && hiddenRecords[identity]) || (identity && sessionHidden.has?.(identity))) {
    return { visible: false, reason: "manual" };
  }

  const uidKey = String(context.uid ?? "legacy");
  const groupStates = context.groupStates ?? normalized.groupStatesByUid[uidKey] ?? normalized.groupStatesByUid.legacy ?? {};
  // Display names are mutable and not unique. Group decisions require the
  // numeric account ID; cards without one remain visible (fail-open).
  const authorKey = card?.authorMid ? `m:${card.authorMid}` : null;
  if (!evaluateGroup(authorKey, context.authorGroupsMap, groupStates)) {
    return { visible: false, reason: "group" };
  }

  if (card?.typeKnown !== false && normalized.hiddenTypes.includes(card?.type)) {
    return { visible: false, reason: "type" };
  }

  const matchedKeyword = keywordMatch(card?.text, normalized.keywords, normalized.caseSensitive);
  if (matchedKeyword) return { visible: false, reason: "keyword", detail: matchedKeyword };

  return { visible: true, reason: null };
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value)).filter(Boolean))];
}

export function normalizeGroupCache(raw) {
  const value = isPlainObject(raw) ? raw : {};
  const groups = [];
  const memberships = {};

  for (const rawGroup of Array.isArray(value.groups) ? value.groups : []) {
    if (!isPlainObject(rawGroup) || rawGroup.id == null) continue;
    const group = {
      id: String(rawGroup.id),
      name: String(rawGroup.name ?? rawGroup.id).trim().slice(0, 80),
      count: Math.max(0, Number(rawGroup.count) || 0),
      loadedAt: Math.max(0, Number(rawGroup.loadedAt) || 0),
      memberMids: uniqueStrings(rawGroup.memberMids),
      memberNames: uniqueStrings(rawGroup.memberNames),
    };
    groups.push(group);
    for (const mid of group.memberMids) {
      const key = `m:${mid}`;
      memberships[key] ??= [];
      if (!memberships[key].includes(group.id)) memberships[key].push(group.id);
    }
    for (const name of group.memberNames) {
      const key = `n:${name}`;
      memberships[key] ??= [];
      if (!memberships[key].includes(group.id)) memberships[key].push(group.id);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    uid: value.uid == null ? null : String(value.uid),
    fetchedAt: Math.max(0, Number(value.fetchedAt) || 0),
    groups,
    memberships,
  };
}

export function pruneHiddenRecords(records, {
  now = Date.now(),
  ttlMs = HIDDEN_TTL_MS,
  maxEntries = HIDDEN_MAX_ENTRIES,
} = {}) {
  const entries = Array.isArray(records)
    ? records.map((item) => [String(item?.id ?? ""), Number(item?.timestamp ?? item?.hiddenAt ?? 0)])
    : Object.entries(isPlainObject(records) ? records : {}).map(([id, timestamp]) => [String(id), Number(timestamp)]);

  const sorted = entries
    .filter(([id, timestamp]) => id && Number.isFinite(timestamp) && timestamp > 0 && now - timestamp <= ttlMs)
    .sort((a, b) => b[1] - a[1]);
  const output = {};
  for (const [id, timestamp] of sorted) {
    if (!(id in output)) output[id] = timestamp;
    if (Object.keys(output).length >= Math.max(0, maxEntries)) break;
  }
  return output;
}

export function addWatchLater(list, item, { maxEntries = WATCH_LATER_MAX_ENTRIES } = {}) {
  if (!item || (!item.id && !item.url)) return Array.isArray(list) ? [...list] : [];
  const key = watchKey(item.url, item.dynamicId ?? item.id);
  if (!key) return Array.isArray(list) ? [...list] : [];
  const normalized = {
    id: key,
    url: String(item.url ?? ""),
    title: String(item.title ?? "未命名动态").trim().slice(0, 300),
    author: String(item.author ?? "未知作者").trim().slice(0, 100),
    time: String(item.time ?? "").trim().slice(0, 100),
    addedAt: Number(item.addedAt) || Date.now(),
  };
  const dynamicId = normalizeDynamicId(item.dynamicId ?? item.id);
  if (dynamicId) normalized.dynamicId = dynamicId;
  const aliasKeys = [...watchAliases(item)].slice(0, 20);
  if (aliasKeys.length) normalized.aliasKeys = aliasKeys;
  const previous = Array.isArray(list) ? list : [];
  return [normalized, ...previous.filter((entry) => !sameWatchItem(entry, normalized))]
    .slice(0, Math.max(0, maxEntries));
}

function normalizeDynamicId(value) {
  const match = String(value ?? "").trim().match(/^(?:d:)?(\d{5,})$/i);
  return match?.[1] ?? null;
}

function normalizeIdentityHint(value) {
  const source = String(value ?? "").trim();
  const dynamicId = normalizeDynamicId(source);
  if (dynamicId) return `d:${dynamicId}`;
  const bvid = source.match(/^BV[\dA-Za-z]{10}$/i)?.[0];
  if (bvid) return `BV${bvid.slice(2)}`;
  const avid = source.match(/^av(\d+)$/i)?.[1];
  return avid ? `av${avid}` : null;
}

/**
 * Return a stable, privacy-safe key for a Bilibili watch-later entry.
 * Known dynamic/video IDs win; URL-only entries ignore tracking queries and
 * fragments. Non-Bilibili and non-HTTPS URLs are rejected.
 */
export function watchKey(rawUrl, identityHint = null) {
  const hinted = normalizeIdentityHint(identityHint);
  if (hinted) return hinted;

  const extracted = extractIdFromUrl(rawUrl);
  if (extracted) return normalizeIdentityHint(extracted);

  try {
    const source = String(rawUrl ?? "").trim();
    if (!source) return null;
    const url = new URL(source, "https://t.bilibili.com/");
    const isBilibili = url.hostname === "bilibili.com" || url.hostname.endsWith(".bilibili.com");
    if (url.protocol !== "https:" || !isBilibili) return null;
    url.search = "";
    url.hash = "";
    return `u:${url.href}`;
  } catch {
    return null;
  }
}

function watchAliases(entry) {
  const keys = new Set();
  const hinted = watchKey(entry?.url, entry?.dynamicId ?? entry?.id);
  const urlOnly = watchKey(entry?.url);
  const idOnly = normalizeIdentityHint(entry?.id);
  if (hinted) keys.add(hinted);
  if (urlOnly) keys.add(urlOnly);
  if (idOnly) keys.add(idOnly);
  for (const alias of (Array.isArray(entry?.aliasKeys) ? entry.aliasKeys : []).slice(0, 20)) {
    const source = String(alias);
    const key = normalizeIdentityHint(source) ?? (source.startsWith("u:") ? watchKey(source.slice(2)) : watchKey(source));
    if (key) keys.add(key);
  }
  for (const aliasUrl of (Array.isArray(entry?.aliasUrls) ? entry.aliasUrls : []).slice(0, 20)) {
    const key = watchKey(aliasUrl);
    if (key) keys.add(key);
  }
  return keys;
}

export function sameWatchItem(left, right) {
  const leftDynamicId = normalizeDynamicId(left?.dynamicId ?? left?.id);
  const rightDynamicId = normalizeDynamicId(right?.dynamicId ?? right?.id);
  if (leftDynamicId && rightDynamicId && leftDynamicId !== rightDynamicId) return false;
  const leftKeys = watchAliases(left);
  if (!leftKeys.size) return false;
  for (const key of watchAliases(right)) {
    if (leftKeys.has(key)) return true;
  }
  return false;
}

export function extractIdFromUrl(url) {
  const value = String(url ?? "");
  const dynamic = value.match(/(?:\/opus\/|t\.bilibili\.com\/)(\d{5,})/i)?.[1];
  if (dynamic) return dynamic;
  const bvid = value.match(/\b(BV[\dA-Za-z]{10})\b/i)?.[1];
  if (bvid) return bvid;
  const avid = value.match(/\bav(\d+)\b/i)?.[1];
  return avid ? `av${avid}` : null;
}

export function classifyCardFromSignals(signals = {}) {
  signals ||= {};
  if (signals.forward) return "forward";
  if (signals.live) return "live";
  if (signals.pgc) return "pgc";
  if (signals.video) return "video";
  if (signals.image || signals.opus || signals.article) return "image";
  if (signals.other) return "other";
  return "unknown";
}

export function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
