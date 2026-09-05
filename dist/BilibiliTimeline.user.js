// ==UserScript==
// @name         B站动态净览 - 分组筛选与阅读助手
// @namespace    bilibili-timeline-focus.local
// @version      2.1.1
// @description  按关注分组筛选B站动态，并提供包含/排除、关键词、类型过滤、本地隐藏、四角入口、模块折叠与字号缩放。
// @author       Local userscript project
// @license      MIT
// @match        https://t.bilibili.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @inject-into  page
// @sandbox      raw
// ==/UserScript==

(() => {
  // src/core.js
  var SCHEMA_VERSION = 2;
  var HIDDEN_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
  var HIDDEN_MAX_ENTRIES = 2e3;
  var WATCH_LATER_MAX_ENTRIES = 500;
  var FONT_SCALE_MIN = 80;
  var FONT_SCALE_MAX = 150;
  var FONT_SCALE_STEP = 10;
  var LAUNCHER_CORNERS = Object.freeze([
    "bottom-left",
    "bottom-right",
    "top-left",
    "top-right"
  ]);
  var COLLAPSIBLE_SECTIONS = Object.freeze([
    "groups",
    "types",
    "keywords",
    "layout"
  ]);
  var CARD_TYPES = Object.freeze([
    "video",
    "image",
    "forward",
    "live",
    "pgc",
    "other"
  ]);
  var DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    panelOpen: false,
    launcherCorner: "bottom-right",
    panelDirection: "auto",
    collapsedSections: [],
    fontScale: 100,
    theme: "auto",
    density: "comfortable",
    feedWidth: "default",
    hideSidebars: false,
    keywords: [],
    caseSensitive: false,
    hiddenTypes: [],
    groupStatesByUid: {},
    cacheHours: 6
  });
  var VALID_LAUNCHER_CORNERS = new Set(LAUNCHER_CORNERS);
  var VALID_COLLAPSIBLE_SECTIONS = new Set(COLLAPSIBLE_SECTIONS);
  var VALID_PANEL_DIRECTIONS = /* @__PURE__ */ new Set(["auto", "up", "down", "left", "right"]);
  var VALID_THEMES = /* @__PURE__ */ new Set(["auto", "light", "dark"]);
  var VALID_DENSITIES = /* @__PURE__ */ new Set(["comfortable", "compact"]);
  var VALID_WIDTHS = /* @__PURE__ */ new Set(["default", "wide"]);
  var VALID_TYPES = new Set(CARD_TYPES);
  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }
  function normalizeFontScale(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.fontScale;
    const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, parsed));
    return Math.round(clamped / FONT_SCALE_STEP) * FONT_SCALE_STEP;
  }
  function normalizeLegacyLauncherPosition(value) {
    if (!isPlainObject(value)) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y))
    };
  }
  function normalizeLauncherCorner(value, {
    launcherPosition = null,
    dock = "right"
  } = {}) {
    if (VALID_LAUNCHER_CORNERS.has(value)) return value;
    const legacyPosition = normalizeLegacyLauncherPosition(launcherPosition);
    if (legacyPosition) {
      const vertical = legacyPosition.y < 0.5 ? "top" : "bottom";
      const horizontal = legacyPosition.x < 0.5 ? "left" : "right";
      return `${vertical}-${horizontal}`;
    }
    return dock === "left" ? "bottom-left" : DEFAULT_SETTINGS.launcherCorner;
  }
  function normalizeCollapsedSections(value) {
    if (!Array.isArray(value)) return [];
    const selected = new Set(value.filter((section) => VALID_COLLAPSIBLE_SECTIONS.has(section)));
    return COLLAPSIBLE_SECTIONS.filter((section) => selected.has(section));
  }
  function normalizeGroupStates(raw) {
    if (!isPlainObject(raw)) return {};
    const output = {};
    for (const [key, value] of Object.entries(raw)) {
      const state2 = Number(value);
      if (state2 === 1 || state2 === -1) output[String(key)] = state2;
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
  function parseKeywords(input, { caseSensitive = false, maxEntries = 100, maxLength = 100 } = {}) {
    const source = Array.isArray(input) ? input : String(input ?? "").split(/\r?\n/);
    const seen = /* @__PURE__ */ new Set();
    const output = [];
    for (const item of source) {
      const trimmed = String(item ?? "").trim().slice(0, maxLength);
      if (!trimmed) continue;
      const comparisonKey = caseSensitive ? trimmed : trimmed.toLocaleLowerCase("zh-CN");
      if (seen.has(comparisonKey)) continue;
      seen.add(comparisonKey);
      output.push(trimmed);
      if (output.length >= maxEntries) break;
    }
    return output;
  }
  function normalizeSettings(raw) {
    const value = isPlainObject(raw) ? raw : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      enabled: value.enabled !== false,
      panelOpen: value.panelOpen === true,
      launcherCorner: normalizeLauncherCorner(value.launcherCorner, {
        launcherPosition: value.launcherPosition,
        dock: value.dock
      }),
      panelDirection: VALID_PANEL_DIRECTIONS.has(value.panelDirection) ? value.panelDirection : DEFAULT_SETTINGS.panelDirection,
      collapsedSections: normalizeCollapsedSections(value.collapsedSections),
      fontScale: normalizeFontScale(value.fontScale),
      theme: VALID_THEMES.has(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
      density: VALID_DENSITIES.has(value.density) ? value.density : DEFAULT_SETTINGS.density,
      feedWidth: VALID_WIDTHS.has(value.feedWidth) ? value.feedWidth : DEFAULT_SETTINGS.feedWidth,
      hideSidebars: value.hideSidebars === true,
      keywords: parseKeywords(value.keywords, { caseSensitive: value.caseSensitive === true }),
      caseSensitive: value.caseSensitive === true,
      hiddenTypes: [...new Set(Array.isArray(value.hiddenTypes) ? value.hiddenTypes.filter((type) => VALID_TYPES.has(type)) : [])],
      groupStatesByUid: normalizeGroupStatesByUid(value.groupStatesByUid, value.groupStates),
      cacheHours: clampNumber(value.cacheHours, 1, 72, DEFAULT_SETTINGS.cacheHours)
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
  function evaluateGroup(authorId, authorGroupsMap, groupStates = {}) {
    const active = Object.entries(groupStates).filter(([, state2]) => Number(state2) === 1 || Number(state2) === -1);
    if (!active.length) return true;
    const memberships = membershipForAuthor(authorId, authorGroupsMap);
    if (memberships == null) return true;
    const memberSet = new Set(memberships);
    const excluded = active.filter(([, state2]) => Number(state2) === -1).map(([id]) => String(id));
    if (excluded.some((id) => memberSet.has(id))) return false;
    const included = active.filter(([, state2]) => Number(state2) === 1).map(([id]) => String(id));
    return included.length === 0 || included.some((id) => memberSet.has(id));
  }
  function keywordMatch(text, keywords, caseSensitive = false) {
    const normalizedKeywords = parseKeywords(keywords, { caseSensitive });
    if (!normalizedKeywords.length) return null;
    const haystack = String(text ?? "").slice(0, 2e4);
    const normalizedText = caseSensitive ? haystack : haystack.toLocaleLowerCase("zh-CN");
    return normalizedKeywords.find((keyword) => {
      const needle = caseSensitive ? keyword : keyword.toLocaleLowerCase("zh-CN");
      return normalizedText.includes(needle);
    }) ?? null;
  }
  function evaluateCard(card, settings, context = {}) {
    const normalized = normalizeSettings(settings);
    if (!normalized.enabled) return { visible: true, reason: null };
    const identity = String(card?.identity ?? card?.dynamicId ?? "");
    const hiddenRecords = context.hiddenRecords ?? {};
    const sessionHidden = context.sessionHidden ?? /* @__PURE__ */ new Set();
    if (identity && hiddenRecords[identity] || identity && sessionHidden.has?.(identity)) {
      return { visible: false, reason: "manual" };
    }
    const uidKey = String(context.uid ?? "legacy");
    const groupStates = context.groupStates ?? normalized.groupStatesByUid[uidKey] ?? normalized.groupStatesByUid.legacy ?? {};
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
  function normalizeGroupCache(raw) {
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
        memberNames: uniqueStrings(rawGroup.memberNames)
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
      memberships
    };
  }
  function pruneHiddenRecords(records, {
    now = Date.now(),
    ttlMs = HIDDEN_TTL_MS,
    maxEntries = HIDDEN_MAX_ENTRIES
  } = {}) {
    const entries = Array.isArray(records) ? records.map((item) => [String(item?.id ?? ""), Number(item?.timestamp ?? item?.hiddenAt ?? 0)]) : Object.entries(isPlainObject(records) ? records : {}).map(([id, timestamp]) => [String(id), Number(timestamp)]);
    const sorted = entries.filter(([id, timestamp]) => id && Number.isFinite(timestamp) && timestamp > 0 && now - timestamp <= ttlMs).sort((a, b) => b[1] - a[1]);
    const output = {};
    for (const [id, timestamp] of sorted) {
      if (!(id in output)) output[id] = timestamp;
      if (Object.keys(output).length >= Math.max(0, maxEntries)) break;
    }
    return output;
  }
  function addWatchLater(list, item, { maxEntries = WATCH_LATER_MAX_ENTRIES } = {}) {
    if (!item || !item.id && !item.url) return Array.isArray(list) ? [...list] : [];
    const key = watchKey(item.url, item.dynamicId ?? item.id);
    if (!key) return Array.isArray(list) ? [...list] : [];
    const normalized = {
      id: key,
      url: String(item.url ?? ""),
      title: String(item.title ?? "未命名动态").trim().slice(0, 300),
      author: String(item.author ?? "未知作者").trim().slice(0, 100),
      time: String(item.time ?? "").trim().slice(0, 100),
      addedAt: Number(item.addedAt) || Date.now()
    };
    const dynamicId = normalizeDynamicId(item.dynamicId ?? item.id);
    if (dynamicId) normalized.dynamicId = dynamicId;
    const aliasKeys = [...watchAliases(item)].slice(0, 20);
    if (aliasKeys.length) normalized.aliasKeys = aliasKeys;
    const previous = Array.isArray(list) ? list : [];
    return [normalized, ...previous.filter((entry) => !sameWatchItem(entry, normalized))].slice(0, Math.max(0, maxEntries));
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
  function watchKey(rawUrl, identityHint = null) {
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
    const keys = /* @__PURE__ */ new Set();
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
  function sameWatchItem(left, right) {
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
  function extractIdFromUrl(url) {
    const value = String(url ?? "");
    const dynamic = value.match(/(?:\/opus\/|t\.bilibili\.com\/)(\d{5,})/i)?.[1];
    if (dynamic) return dynamic;
    const bvid = value.match(/\b(BV[\dA-Za-z]{10})\b/i)?.[1];
    if (bvid) return bvid;
    const avid = value.match(/\bav(\d+)\b/i)?.[1];
    return avid ? `av${avid}` : null;
  }
  function classifyCardFromSignals(signals = {}) {
    signals ||= {};
    if (signals.forward) return "forward";
    if (signals.live) return "live";
    if (signals.pgc) return "pgc";
    if (signals.video) return "video";
    if (signals.image || signals.opus || signals.article) return "image";
    if (signals.other) return "other";
    return "unknown";
  }
  function fnv1a(value) {
    let hash = 2166136261;
    for (const character of String(value ?? "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  // src/dom.js
  var SELECTORS = Object.freeze({
    list: ".bili-dyn-list__items",
    wrapper: ".bili-dyn-list__item",
    card: ".bili-dyn-item",
    authorName: ".bili-dyn-title__text",
    time: ".bili-dyn-time"
  });
  function extractMidFromHref(href) {
    const value = String(href ?? "");
    return value.match(/(?:https?:)?\/\/space\.bilibili\.com\/(\d+)/i)?.[1] ?? null;
  }
  function readAttributeMid(element) {
    if (!element) return null;
    const raw = element.getAttribute?.("data-mid") ?? element.dataset?.mid;
    return /^\d+$/.test(String(raw ?? "")) ? String(raw) : null;
  }
  function firstText(root, selectors) {
    for (const selector of selectors) {
      const text = root.querySelector(selector)?.textContent?.trim();
      if (text) return text;
    }
    return "";
  }
  function trustedBilibiliUrl(raw, baseUrl) {
    try {
      const url = new URL(raw, baseUrl);
      if (url.protocol !== "https:") return "";
      if (url.hostname !== "bilibili.com" && !url.hostname.endsWith(".bilibili.com")) return "";
      return url.href;
    } catch {
      return "";
    }
  }
  function dynamicIdFromUrl(url) {
    return String(url ?? "").match(/(?:\/opus\/|t\.bilibili\.com\/)(\d{5,})/i)?.[1] ?? null;
  }
  function collectCardWrappers(root) {
    if (!root || root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return [];
    const wrappers = [];
    if (root.matches?.(SELECTORS.wrapper)) wrappers.push(root);
    root.querySelectorAll?.(SELECTORS.wrapper).forEach((element) => wrappers.push(element));
    if (!wrappers.length && root.matches?.(SELECTORS.card)) wrappers.push(root.closest(SELECTORS.wrapper) ?? root);
    return [...new Set(wrappers)];
  }
  function extractAuthorMid(wrapper) {
    const card = wrapper.matches?.(SELECTORS.card) ? wrapper : wrapper.querySelector(SELECTORS.card) ?? wrapper;
    const header = card.querySelector(".bili-dyn-item__header");
    const directHeaderMid = readAttributeMid(header);
    if (directHeaderMid) return directHeaderMid;
    const prioritySelectors = [
      "[data-module='author'][data-mid]",
      ".bili-dyn-avatar[data-mid]",
      ".bili-dyn-item__following[data-mid]",
      "[data-mid]"
    ];
    for (const selector of prioritySelectors) {
      const target = header?.querySelector(selector);
      const mid = readAttributeMid(target);
      if (mid) return mid;
    }
    for (const link of header?.querySelectorAll("a[href*='space.bilibili.com/']") ?? []) {
      const mid = extractMidFromHref(link.getAttribute("href") ?? link.href);
      if (mid) return mid;
    }
    const vueMid = card.__vue__?.author?.mid ?? card.__vue__?.data?.modules?.module_author?.mid ?? wrapper.__vue__?.author?.mid;
    return /^\d+$/.test(String(vueMid ?? "")) ? String(vueMid) : null;
  }
  function extractDynamicId(wrapper, baseUrl = "https://t.bilibili.com/") {
    const card = wrapper.matches?.(SELECTORS.card) ? wrapper : wrapper.querySelector?.(SELECTORS.card);
    const direct = [
      wrapper.getAttribute?.("data-did"),
      wrapper.dataset?.did,
      card?.getAttribute?.("data-did"),
      card?.dataset?.did
    ].find((value) => /^\d{5,}$/.test(String(value ?? "")));
    if (direct) return String(direct);
    for (const element of card?.querySelectorAll?.(".bili-dyn-item__header .bili-dyn-time[href], .bili-dyn-item__header .bili-dyn-time a[href]") ?? []) {
      const raw = element.getAttribute("href");
      const id = dynamicIdFromUrl(trustedBilibiliUrl(raw, baseUrl));
      if (id) return id;
    }
    return null;
  }
  function classifyElement(wrapper) {
    const query = (selector) => Boolean(wrapper.querySelector(selector));
    const signals = {
      forward: query(".bili-dyn-content__forw, .bili-dyn-content__orig.reference"),
      live: query(".bili-dyn-card-live, [class*='dyn-card-live']"),
      pgc: query(".bili-dyn-card-pgc, .bili-dyn-card-subscription"),
      video: query(".bili-dyn-card-video, .bili-dyn-card-ugc"),
      image: query(".dyn-card-opus, .bili-album, .bili-dyn-card-article, .bili-dyn-card-common"),
      other: query(".bili-dyn-content, .bili-dyn-content__orig")
    };
    const type = classifyCardFromSignals(signals);
    return { type, typeKnown: type !== "unknown", signals };
  }
  function findTrustedUrls(wrapper, baseUrl = "https://t.bilibili.com/") {
    const selectors = [
      ".bili-dyn-time[href]",
      ".bili-dyn-time a[href]",
      "a.bili-dyn-card-video[href]",
      ".bili-dyn-card-video a[href]",
      "a.bili-dyn-card-ugc[href]",
      ".bili-dyn-card-ugc a[href]",
      "a.bili-dyn-card-live[href]",
      ".bili-dyn-card-live a[href]",
      "a.bili-dyn-card-pgc[href]",
      ".bili-dyn-card-pgc a[href]",
      "a.bili-dyn-card-subscription[href]",
      ".bili-dyn-card-subscription a[href]",
      "a.bili-dyn-card-article[href]",
      ".bili-dyn-card-article a[href]",
      ".dyn-card-opus[data-url]",
      ".dyn-card-opus [data-url]"
    ];
    const urls = [];
    for (const selector of selectors) {
      for (const element of wrapper.querySelectorAll(selector)) {
        const raw = element.getAttribute("href") ?? element.getAttribute("data-url");
        const trusted = raw ? trustedBilibiliUrl(raw, baseUrl) : "";
        if (trusted && !urls.includes(trusted)) urls.push(trusted);
      }
    }
    return urls;
  }
  function extractCardModel(wrapper, baseUrl = "https://t.bilibili.com/") {
    const card = wrapper.matches?.(SELECTORS.card) ? wrapper : wrapper.querySelector(SELECTORS.card) ?? wrapper;
    const header = card.querySelector(".bili-dyn-item__header");
    const authorName = firstText(header ?? card, [SELECTORS.authorName, "[data-module='author']", ".bili-dyn-title"]);
    const authorMid = extractAuthorMid(wrapper);
    const time = firstText(card, [SELECTORS.time]);
    const title = firstText(card, [
      ".bili-dyn-card-video__title",
      ".dyn-card-opus__title",
      ".bili-dyn-card-pgc__title",
      ".bili-dyn-card-live__title",
      ".bili-dyn-card-article__title"
    ]);
    const textSource = card.cloneNode(true);
    textSource.querySelectorAll(".btf-card-tools").forEach((element) => element.remove());
    const rawText = String(textSource.innerText ?? textSource.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 2e4);
    const dynamicId = extractDynamicId(wrapper, baseUrl);
    const relatedUrls = findTrustedUrls(wrapper, baseUrl);
    const discoveredUrl = relatedUrls[0] ?? "";
    const classification = classifyElement(wrapper);
    const fingerprint = fnv1a([authorMid, authorName, time, discoveredUrl, rawText.slice(0, 800)].join("|"));
    const identity = dynamicId ? `d:${dynamicId}` : `session:${fingerprint}`;
    return {
      wrapper,
      card,
      identity,
      dynamicId,
      persistable: Boolean(dynamicId),
      authorMid,
      authorName,
      time,
      title: title || rawText.slice(0, 120) || "未命名动态",
      text: rawText,
      primaryUrl: discoveredUrl || (dynamicId ? `https://www.bilibili.com/opus/${dynamicId}` : baseUrl),
      relatedUrls,
      linkKnown: Boolean(discoveredUrl || dynamicId),
      type: classification.type === "unknown" ? "other" : classification.type,
      typeKnown: classification.typeKnown
    };
  }

  // src/layout.js
  var PANEL_DIRECTIONS = Object.freeze(["down", "up", "right", "left"]);
  var LAUNCHER_CORNERS2 = /* @__PURE__ */ new Set(["bottom-left", "bottom-right", "top-left", "top-right"]);
  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function nonNegative(value, fallback) {
    return Math.max(0, finiteNumber(value, fallback));
  }
  function clamp(value, minimum, maximum) {
    if (maximum < minimum) return minimum;
    return Math.min(maximum, Math.max(minimum, value));
  }
  function launcherMetrics(options = {}) {
    const viewportWidth = nonNegative(options.viewportWidth, 0);
    const viewportHeight = nonNegative(options.viewportHeight, 0);
    const viewportLeft = finiteNumber(options.viewportLeft, 0);
    const viewportTop = finiteNumber(options.viewportTop, 0);
    const margin = nonNegative(options.margin, 12);
    const launcherSize = nonNegative(options.launcherSize, 48);
    return {
      viewportWidth,
      viewportHeight,
      viewportLeft,
      viewportTop,
      margin,
      launcherSize,
      minX: viewportLeft + margin,
      maxX: viewportLeft + viewportWidth - margin - launcherSize,
      minY: viewportTop + margin,
      maxY: viewportTop + viewportHeight - margin - launcherSize
    };
  }
  function clampLauncherPixels(pixels, options = {}) {
    const metrics = launcherMetrics(options);
    const source = pixels && typeof pixels === "object" ? pixels : {};
    return {
      x: clamp(finiteNumber(source.x, metrics.minX), metrics.minX, metrics.maxX),
      y: clamp(finiteNumber(source.y, metrics.minY), metrics.minY, metrics.maxY)
    };
  }
  function launcherCornerToPixels(corner, options = {}) {
    const metrics = launcherMetrics(options);
    const resolvedCorner = LAUNCHER_CORNERS2.has(corner) ? corner : "bottom-right";
    const compact = metrics.viewportWidth <= 720;
    const horizontalOffset = nonNegative(options.horizontalOffset, compact ? 10 : 18);
    const topOffset = nonNegative(options.topOffset, compact ? 68 : 76);
    const bottomOffset = nonNegative(options.bottomOffset, compact ? 12 : 22);
    const onLeft = resolvedCorner.endsWith("left");
    const onTop = resolvedCorner.startsWith("top");
    return clampLauncherPixels({
      x: onLeft ? metrics.viewportLeft + horizontalOffset : metrics.viewportLeft + metrics.viewportWidth - horizontalOffset - metrics.launcherSize,
      y: onTop ? metrics.viewportTop + topOffset : metrics.viewportTop + metrics.viewportHeight - bottomOffset - metrics.launcherSize
    }, options);
  }
  function panelCandidate(direction, anchor, panelWidth, panelHeight, gap) {
    const anchorRight = anchor.left + anchor.width;
    const anchorBottom = anchor.top + anchor.height;
    if (direction === "up") {
      return {
        left: anchor.left + (anchor.width - panelWidth) / 2,
        top: anchor.top - gap - panelHeight
      };
    }
    if (direction === "left") {
      return {
        left: anchor.left - gap - panelWidth,
        top: anchor.top + (anchor.height - panelHeight) / 2
      };
    }
    if (direction === "right") {
      return {
        left: anchorRight + gap,
        top: anchor.top + (anchor.height - panelHeight) / 2
      };
    }
    return {
      left: anchor.left + (anchor.width - panelWidth) / 2,
      top: anchorBottom + gap
    };
  }
  function placePanel({
    direction = "auto",
    anchor = {},
    panelWidth,
    panelHeight,
    viewportWidth,
    viewportHeight,
    viewportLeft = 0,
    viewportTop = 0,
    margin = 10,
    gap = 10
  } = {}) {
    const safeMargin = nonNegative(margin, 10);
    const safeGap = nonNegative(gap, 10);
    const safePanelWidth = nonNegative(panelWidth, 0);
    const safePanelHeight = nonNegative(panelHeight, 0);
    const safeViewportWidth = nonNegative(viewportWidth, 0);
    const safeViewportHeight = nonNegative(viewportHeight, 0);
    const safeViewportLeft = finiteNumber(viewportLeft, 0);
    const safeViewportTop = finiteNumber(viewportTop, 0);
    const viewportRight = safeViewportLeft + safeViewportWidth;
    const viewportBottom = safeViewportTop + safeViewportHeight;
    const safeAnchor = {
      left: finiteNumber(anchor?.left, 0),
      top: finiteNumber(anchor?.top, 0),
      width: nonNegative(anchor?.width, 0),
      height: nonNegative(anchor?.height, 0)
    };
    const anchorRight = safeAnchor.left + safeAnchor.width;
    const anchorBottom = safeAnchor.top + safeAnchor.height;
    const available = {
      up: safeAnchor.top - (safeViewportTop + safeMargin) - safeGap,
      down: viewportBottom - safeMargin - safeGap - anchorBottom,
      left: safeAnchor.left - (safeViewportLeft + safeMargin) - safeGap,
      right: viewportRight - safeMargin - safeGap - anchorRight
    };
    const required = {
      up: safePanelHeight,
      down: safePanelHeight,
      left: safePanelWidth,
      right: safePanelWidth
    };
    const requested = PANEL_DIRECTIONS.includes(direction) ? direction : null;
    let chosen = requested && available[requested] >= required[requested] ? requested : PANEL_DIRECTIONS.reduce((best, candidate2) => {
      const candidateFits = available[candidate2] >= required[candidate2];
      const bestFits = available[best] >= required[best];
      if (candidateFits !== bestFits) return candidateFits ? candidate2 : best;
      const candidateRatio = required[candidate2] > 0 ? available[candidate2] / required[candidate2] : available[candidate2];
      const bestRatio = required[best] > 0 ? available[best] / required[best] : available[best];
      return candidateRatio > bestRatio ? candidate2 : best;
    }, PANEL_DIRECTIONS[0]);
    const candidate = panelCandidate(
      chosen,
      safeAnchor,
      safePanelWidth,
      safePanelHeight,
      safeGap
    );
    return {
      left: clamp(candidate.left, safeViewportLeft + safeMargin, viewportRight - safeMargin - safePanelWidth),
      top: clamp(candidate.top, safeViewportTop + safeMargin, viewportBottom - safeMargin - safePanelHeight),
      direction: chosen
    };
  }

  // src/style.js
  var GLOBAL_STYLE = String.raw`
  html {
    --btf-card-accent: #006f9e;
    --btf-card-muted: #5f6670;
    --btf-card-text: #18191c;
    --btf-card-action-font-size: 12px;
    --btf-empty-font-size: 14px;
    --btf-card-icon-font-size: 13px;
  }

  html[data-theme="dark"],
  html.bili-dark {
    --btf-card-accent: #4cc9f0;
    --btf-card-muted: #b4bac2;
    --btf-card-text: #f1f2f3;
  }

  #btf-root {
    position: fixed;
    z-index: 2147483000;
    width: 48px;
    height: 48px;
    inset: auto 18px 22px auto;
    pointer-events: none;
  }

  .bili-dyn-list__item[data-btf-hidden-reason] {
    display: none !important;
  }

  .bili-dyn-item__header:has(> .btf-card-tools) {
    align-items: center;
  }

  [data-btf-card-tools-host="author"] {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    min-width: 0;
    max-width: 100%;
  }

  [data-btf-card-author-slot="true"] {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btf-card-tools {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 4px;
    margin-left: auto;
    margin-right: 6px;
    opacity: 0;
    transform: translateY(-2px);
    transition: opacity 150ms ease, transform 150ms ease;
  }

  .btf-card-tools[data-placement="author"] {
    margin-left: 8px;
    margin-right: 0;
  }

  .bili-dyn-item:hover .btf-card-tools,
  .bili-dyn-item:focus-within .btf-card-tools {
    opacity: 1;
    transform: translateY(0);
  }

  .btf-card-action {
    appearance: none;
    border: 1px solid var(--line_regular, #e3e5e7);
    border-radius: 999px;
    background: var(--bg1, #fff);
    color: var(--text2, #61666d);
    cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: var(--btf-card-action-font-size);
    line-height: 24px;
    height: 26px;
    padding: 0 9px;
    white-space: nowrap;
  }

  .btf-card-action:hover,
  .btf-card-action:focus-visible,
  .btf-card-action[aria-pressed="true"] {
    border-color: var(--btf-card-accent);
    color: var(--text1, var(--btf-card-text));
  }

  .btf-card-action:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  .btf-card-action:disabled {
    opacity: .48;
    cursor: not-allowed;
  }

  .btf-feed-empty {
    box-sizing: border-box;
    margin: 12px 0;
    padding: 26px 20px;
    width: 100%;
    border: 1px dashed var(--line_regular, #e3e5e7);
    border-radius: 10px;
    background: var(--bg1, #fff);
    color: var(--btf-card-muted);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: var(--btf-empty-font-size);
    line-height: 1.6;
    text-align: center;
  }

  html[data-btf-density="compact"] .bili-dyn-list__item {
    margin-bottom: 8px !important;
  }

  html[data-btf-density="compact"] .bili-dyn-item__main {
    padding-top: 14px !important;
    padding-bottom: 12px !important;
  }

  html[data-btf-width="wide"] .bili-dyn-list,
  html[data-btf-width="wide"] .bili-dyn-up-list {
    box-sizing: border-box;
    width: min(760px, calc(100vw - 48px)) !important;
  }

  html[data-btf-width="wide"] .bili-dyn-item {
    box-sizing: border-box;
    width: 100% !important;
  }

  html[data-btf-focus="true"] .bili-dyn-home--member .bili-dyn-sidebar,
  html[data-btf-focus="true"] .bili-dyn-home--member .bili-dyn-my-info,
  html[data-btf-focus="true"] .bili-dyn-home--member .bili-dyn-live-users {
    display: none !important;
  }

  html[data-btf-focus="true"] .bili-dyn-home--member {
    justify-content: center !important;
  }

  @media (max-width: 720px) {
    .btf-card-tools {
      opacity: 1;
      transform: none;
    }

    .btf-card-action {
      width: 28px;
      padding: 0;
      overflow: hidden;
    }

    .btf-card-action .btf-label { display: none; }
    .btf-card-action .btf-icon { font-size: var(--btf-card-icon-font-size); }
  }

  @media (hover: none), (pointer: coarse) {
    .btf-card-tools {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .btf-card-tools { transition: none; }
  }

  @media (prefers-color-scheme: dark) {
    html {
      --btf-card-accent: #4cc9f0;
      --btf-card-muted: #b4bac2;
      --btf-card-text: #f1f2f3;
    }
  }
`;
  var PANEL_STYLE = String.raw`
  :host {
    --accent: #006f9e;
    --accent-soft: #e8f7fc;
    --on-accent: #fff;
    --danger: #c7354b;
    --danger-soft: #fff0f2;
    --on-danger: #fff;
    --warning: #925700;
    --surface: rgba(255, 255, 255, .96);
    --surface-2: #f6f7f8;
    --line: #e3e5e7;
    --text: #18191c;
    --text-2: #61666d;
    --text-3: #5f6670;
    --shadow: 0 18px 55px rgba(20, 35, 50, .18), 0 4px 16px rgba(20, 35, 50, .1);
    color-scheme: light;
    font-size: var(--btf-ui-font-size, 12px);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }

  :host([data-theme="dark"]) {
    --accent: #4cc9f0;
    --accent-soft: #173844;
    --on-accent: #102a34;
    --danger: #ff8fa0;
    --danger-soft: #43262c;
    --on-danger: #39131a;
    --warning: #ffc45b;
    --surface: rgba(32, 34, 38, .97);
    --surface-2: #292c31;
    --line: #3d4047;
    --text: #f1f2f3;
    --text-2: #c9ccd0;
    --text-3: #91969d;
    --shadow: 0 18px 58px rgba(0, 0, 0, .42), 0 4px 16px rgba(0, 0, 0, .26);
    color-scheme: dark;
  }

  @media (prefers-color-scheme: dark) {
    :host([data-theme="auto"]) {
      --accent: #4cc9f0;
      --accent-soft: #173844;
      --on-accent: #102a34;
      --danger: #ff8fa0;
      --danger-soft: #43262c;
      --on-danger: #39131a;
      --warning: #ffc45b;
      --surface: rgba(32, 34, 38, .97);
      --surface-2: #292c31;
      --line: #3d4047;
      --text: #f1f2f3;
      --text-2: #c9ccd0;
      --text-3: #91969d;
      --shadow: 0 18px 58px rgba(0, 0, 0, .42), 0 4px 16px rgba(0, 0, 0, .26);
      color-scheme: dark;
    }
  }

  *, *::before, *::after { box-sizing: border-box; }

  button, input, textarea, select { font: inherit; }

  .launcher, .panel, .toast { pointer-events: auto; }

  button:focus-visible,
  input:focus-visible,
  textarea:focus-visible,
  select:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .launcher {
    position: relative;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border: 1px solid var(--line);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--accent);
    cursor: pointer;
    font-size: 20px;
    user-select: none;
    backdrop-filter: blur(16px);
    transition: transform 160ms ease, box-shadow 160ms ease;
  }

  .launcher:hover { transform: translateY(-2px); }

  .launcher-icon {
    display: block;
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    overflow: visible;
    pointer-events: none;
  }

  @media (forced-colors: active) {
    .launcher-icon path { fill: ButtonText; }
  }

  .launcher .badge {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border: 2px solid var(--surface);
    border-radius: 999px;
    background: var(--danger);
    color: var(--on-danger);
    font: 700 10px/14px system-ui, sans-serif;
  }

  .panel {
    position: fixed;
    display: none;
    width: min(340px, calc(100vw - 28px));
    max-height: min(760px, calc(100vh - 34px));
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
    backdrop-filter: blur(20px);
  }

  :host([data-open="true"]) .launcher { display: none; }
  :host([data-open="true"]) .panel { display: flex; flex-direction: column; }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 58px;
    padding: 10px 12px 10px 16px;
    border-bottom: 1px solid var(--line);
  }

  .brand-mark {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    border-radius: 10px;
    background: linear-gradient(135deg, #006f9e, #5c4ad1);
    color: #fff;
    font-size: 1.333em;
    font-weight: 800;
    box-shadow: 0 6px 16px rgba(0, 174, 236, .22);
    box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 28%, transparent);
  }

  .brand { min-width: 0; flex: 1; }
  .brand-title { margin: 0; font-size: 1.25em; line-height: 1.333; font-weight: 750; }
  .brand-status { margin: 1px 0 0; color: var(--text-3); font-size: .917em; line-height: 1.455; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .icon-button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    font-size: 1.333em;
  }

  .icon-button:hover { background: var(--surface-2); color: var(--text); }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 7px;
    padding: 11px 13px 7px;
  }

  .stat {
    padding: 8px 7px;
    border-radius: 11px;
    background: var(--surface-2);
    text-align: center;
  }

  .stat strong { display: block; font-size: 1.333em; line-height: 1.25; font-variant-numeric: tabular-nums; }
  .stat span { color: var(--text-3); font-size: .833em; }
  .stat.hidden strong { color: var(--danger); }
  .stat.unknown strong { color: var(--warning); }

  .scroll-area {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--line) transparent;
    padding: 6px 13px 14px;
  }

  .section {
    margin-top: 9px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }

  .section:first-child { margin-top: 0; border-top: 0; }
  .section-title { margin: 0; font: inherit; }
  .section-toggle {
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 28px;
    padding: 2px 0;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    text-align: left;
  }
  .section-title-label { min-width: 0; flex: 1; font-size: 1em; font-weight: 700; line-height: 1.4; }
  .section-title-trailing { min-width: 0; max-width: 68%; display: flex; align-items: center; justify-content: flex-end; gap: 9px; }
  .section-hint { min-width: 0; overflow: hidden; color: var(--text-3); font-size: .833em; text-overflow: ellipsis; white-space: nowrap; }
  .section-chevron {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(45deg);
    transition: transform 180ms ease;
  }
  .section-toggle:hover { color: var(--text); }
  .section-collapse {
    display: grid;
    grid-template-rows: 1fr;
    opacity: 1;
    visibility: visible;
    transition: grid-template-rows 180ms ease, opacity 140ms ease, visibility 0s linear 0s;
  }
  .section-content { min-height: 0; overflow: hidden; }
  .section-content-inner { min-width: 0; padding-top: 9px; }
  .collapsible-section[data-collapsed="true"] .section-collapse {
    grid-template-rows: 0fr;
    opacity: 0;
    visibility: hidden;
    transition: grid-template-rows 180ms ease, opacity 140ms ease, visibility 0s linear 0s;
  }
  .collapsible-section[data-collapsed="true"] .section-hint { display: none; }
  .collapsible-section[data-collapsed="true"] .section-chevron { transform: rotate(-45deg); }

  .switch-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .switch-copy strong { display: block; font-size: 1.083em; }
  .switch-copy span { display: block; margin-top: 2px; color: var(--text-3); font-size: .833em; }

  .switch {
    position: relative;
    width: 38px;
    height: 22px;
    flex: 0 0 auto;
    border: 0;
    border-radius: 999px;
    background: var(--line);
    cursor: pointer;
    transition: background 160ms ease;
  }

  .switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,.22);
    transition: transform 160ms ease;
  }

  .switch[aria-checked="true"] { background: var(--accent); }
  .switch[aria-checked="true"]::after { transform: translateX(16px); }

  .search,
  .keywords,
  select {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text);
  }

  .search { min-height: 34px; padding: 0 10px; font-size: 1em; }
  .keywords { min-height: 66px; resize: vertical; padding: 8px 10px; font-size: 1em; line-height: 1.5; }
  .search::placeholder, .keywords::placeholder { color: var(--text-3); }

  .group-gesture-help {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 10px;
    margin: 6px 2px 0;
    color: var(--text-3);
    font-size: .833em;
    line-height: 1.5;
  }

  .group-gesture-help span::before {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 4px;
    border-radius: 50%;
    background: var(--line);
    content: "";
    vertical-align: 1px;
  }

  .group-gesture-help .include-gesture::before { background: var(--accent); }
  .group-gesture-help .exclude-gesture::before { background: var(--danger); }

  .groups {
    display: grid;
    gap: 6px;
    max-height: 204px;
    margin-top: 8px;
    overflow: auto;
    scrollbar-width: thin;
  }

  .group-row {
    width: 100%;
    appearance: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 5px 8px 5px 10px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: border-color 120ms ease, background-color 120ms ease;
  }

  .group-row[data-state="0"]:hover { border-color: var(--text-3); background: var(--surface); }
  .group-row[data-state="1"] { border-color: var(--accent); background: var(--accent-soft); }
  .group-row[data-state="-1"] { border-color: var(--danger); background: var(--danger-soft); }
  .group-row.loading { cursor: progress; }
  .group-row.loading[data-state="0"] { border-color: var(--accent); }
  .group-row[data-state="-1"]:focus-visible { outline-color: var(--danger); }
  .group-name { min-width: 0; }
  .group-name strong { display: block; overflow: hidden; color: var(--text); font-size: 1em; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .group-name span { color: var(--text-3); font-size: .833em; }

  .group-state {
    min-width: 42px;
    padding: 3px 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 76%, transparent);
    color: var(--text-3);
    font-size: .833em;
    font-weight: 650;
    text-align: center;
  }

  .group-row[data-state="1"] .group-state { color: var(--accent); }
  .group-row[data-state="-1"] .group-state { color: var(--danger); }

  .empty-groups { padding: 18px 8px; color: var(--text-3); font-size: 1em; text-align: center; }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-2);
    cursor: pointer;
    font-size: .917em;
  }

  .chip[aria-pressed="true"] { border-color: var(--danger); background: var(--danger-soft); color: var(--danger); }

  .inline-check { display: inline-flex; align-items: center; gap: 6px; margin-top: 7px; color: var(--text-2); font-size: .917em; }
  .inline-check input { accent-color: var(--accent); }

  .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .field span { display: block; margin: 0 0 4px 2px; color: var(--text-3); font-size: .833em; }
  .field select { min-height: 32px; padding: 0 8px; font-size: .917em; }

  :host([data-font-size="large"]) .settings-grid { grid-template-columns: 1fr; }

  .font-toolbar {
    display: grid;
    grid-template-areas: "label label label value" "minus slider plus value";
    grid-template-columns: 32px minmax(72px, 1fr) 32px auto;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: var(--surface-2);
  }

  .font-toolbar-label { grid-area: label; color: var(--text-3); font-size: .833em; }
  .font-decrease { grid-area: minus; }
  .font-scale { grid-area: slider; width: 100%; min-width: 0; accent-color: var(--accent); cursor: pointer; }
  .font-increase { grid-area: plus; }
  .font-reset { grid-area: value; align-self: stretch; min-width: 47px; }
  .font-step,
  .font-reset {
    min-height: 30px;
    padding: 0 7px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-2);
    cursor: pointer;
    font-size: .917em;
  }
  .font-step:hover,
  .font-reset:hover { border-color: var(--accent); color: var(--accent); }
  .font-step:disabled,
  .font-reset:disabled { opacity: .48; cursor: default; }
  .font-scale-value { font-variant-numeric: tabular-nums; }

  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
  .button {
    min-height: 31px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--surface);
    color: var(--text-2);
    cursor: pointer;
    font-size: .917em;
  }

  .button:hover { border-color: var(--accent); color: var(--accent); }
  .button.primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
  .button.danger:hover { border-color: var(--danger); color: var(--danger); }
  .button:disabled { opacity: .5; cursor: wait; }

  .panel-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 43px;
    padding: 7px 13px;
    border-top: 1px solid var(--line);
    color: var(--text-3);
    font-size: .833em;
  }

  .footer-link { border: 0; background: transparent; color: var(--accent); cursor: pointer; font-size: .833em; }

  .drawer {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: none;
    flex-direction: column;
    background: var(--surface);
  }

  .drawer.open { display: flex; }
  .drawer-header { display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 10px 12px 10px 16px; border-bottom: 1px solid var(--line); }
  .drawer-header h2 { flex: 1; margin: 0; font-size: 1.25em; }
  .watch-list { flex: 1; overflow: auto; padding: 10px 12px; }
  .watch-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 10px 4px; border-bottom: 1px solid var(--line); }
  .watch-item a { overflow: hidden; color: var(--text); font-size: 1em; font-weight: 600; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
  .watch-item a:hover { color: var(--accent); }
  .watch-meta { margin-top: 4px; overflow: hidden; color: var(--text-3); font-size: .833em; text-overflow: ellipsis; white-space: nowrap; }
  .watch-remove { align-self: center; border: 0; background: transparent; color: var(--text-3); cursor: pointer; font-size: 1.333em; }
  .watch-remove:hover { color: var(--danger); }
  .watch-empty { padding: 48px 12px; color: var(--text-3); font-size: 1em; line-height: 1.7; text-align: center; }

  .toast {
    position: absolute;
    right: 0;
    bottom: 58px;
    display: none;
    align-items: center;
    gap: 9px;
    max-width: 300px;
    padding: 9px 10px 9px 12px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text-2);
    font-size: .917em;
  }

  :host([data-edge-x="left"]) .toast { left: 0; right: auto; }
  :host([data-edge-y="top"]) .toast { top: 58px; bottom: auto; }
  .toast.show { display: flex; }
  .toast button { border: 0; background: transparent; color: var(--accent); cursor: pointer; }

  @media (max-width: 720px) {
    .groups { max-height: 180px; }
    .toast { position: fixed; left: 14px !important; right: 14px !important; top: auto !important; bottom: 76px; max-width: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
  }
`;

  // src/main.js
  var VERSION = "2.1.1";
  var STORAGE_PREFIX = "__bilibili_timeline_focus_v1__";
  var ROOT_ID = "btf-root";
  var GLOBAL_STYLE_ID = "btf-global-style";
  var PAGE_URL = "https://t.bilibili.com/";
  var API_ORIGIN = "https://api.bilibili.com";
  var GROUP_PAGE_SIZE = 50;
  var GROUP_MAX_PAGES = 100;
  var INSTANCE_KEY = "__BILIBILI_TIMELINE_FOCUS_INSTANCE__";
  var LAUNCHER_SIZE = 48;
  var LAUNCHER_MARGIN = 12;
  var PANEL_MARGIN = 10;
  var PANEL_GAP = 10;
  var TYPE_LABELS = Object.freeze({
    video: "视频",
    image: "图文",
    forward: "转发",
    live: "直播",
    pgc: "番剧影视",
    other: "其他"
  });
  var ApiError = class extends Error {
    constructor(message, { code = null, status = null, cause = null } = {}) {
      super(message, { cause });
      this.name = "ApiError";
      this.code = code;
      this.status = status;
    }
  };
  var Storage = {
    key(name) {
      return `${STORAGE_PREFIX}:${name}`;
    },
    read(name, fallback) {
      try {
        const raw = localStorage.getItem(this.key(name));
        return raw == null ? fallback : JSON.parse(raw);
      } catch (error) {
        console.warn("[动态净览] 本地设置读取失败", error);
        return fallback;
      }
    },
    write(name, value) {
      try {
        localStorage.setItem(this.key(name), JSON.stringify(value));
        return true;
      } catch (error) {
        console.warn("[动态净览] 本地设置保存失败", error);
        return false;
      }
    },
    remove(name) {
      try {
        localStorage.removeItem(this.key(name));
      } catch (error) {
        console.warn("[动态净览] 本地设置删除失败", error);
      }
    }
  };
  var BilibiliApi = class {
    async request(path, { signal, timeoutMs = 15e3 } = {}) {
      const controller = new AbortController();
      const abortFromParent = () => controller.abort(signal?.reason);
      if (signal?.aborted) abortFromParent();
      else signal?.addEventListener("abort", abortFromParent, { once: true });
      const timeout = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
      try {
        const response = await fetch(new URL(path, API_ORIGIN), {
          method: "GET",
          credentials: "include",
          mode: "cors",
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new ApiError(`HTTP ${response.status}`, { status: response.status });
        }
        let payload;
        try {
          payload = await response.json();
        } catch (cause) {
          throw new ApiError("接口返回了非 JSON 内容", { status: response.status, cause });
        }
        if (!payload || Number(payload.code) !== 0) {
          throw new ApiError(String(payload?.message || `B站接口错误 ${payload?.code ?? "unknown"}`), {
            code: Number(payload?.code),
            status: response.status
          });
        }
        return payload.data;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (controller.signal.aborted) {
          const timedOut = controller.signal.reason === "timeout";
          throw new ApiError(timedOut ? "请求超时" : "请求已取消", {
            code: timedOut ? "TIMEOUT" : "ABORTED",
            cause: error
          });
        }
        throw new ApiError("网络请求失败", { code: "NETWORK", cause: error });
      } finally {
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromParent);
      }
    }
    nav(options) {
      return this.request("/x/web-interface/nav", options);
    }
    async tags(options) {
      const data = await this.request("/x/relation/tags", options);
      const valid = Array.isArray(data) && data.every((tag) => {
        if (!tag || typeof tag !== "object" || Array.isArray(tag)) return false;
        return /^-?\d+$/.test(String(tag.tagid ?? ""));
      });
      if (!valid) {
        throw new ApiError("关注分组接口数据格式已变化", { code: "SHAPE" });
      }
      return data;
    }
    async tagMembers(tagId, expectedCount, { signal } = {}) {
      const members = [];
      const seen = /* @__PURE__ */ new Set();
      let previousPageSignature = null;
      for (let page = 1; page <= GROUP_MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
          tagid: String(tagId),
          pn: String(page),
          ps: String(GROUP_PAGE_SIZE)
        });
        const data = await this.request(`/x/relation/tag?${params}`, { signal });
        if (!Array.isArray(data)) {
          throw new ApiError("分组成员接口数据格式已变化", { code: "SHAPE" });
        }
        const list = data;
        const structurallyValid = list.every((member) => member && typeof member === "object" && !Array.isArray(member) && /^\d+$/.test(String(member.mid ?? "")));
        if (!structurallyValid) {
          throw new ApiError("分组成员接口数据格式已变化", { code: "SHAPE" });
        }
        const pageMids = list.map((member) => String(member.mid));
        if (new Set(pageMids).size !== pageMids.length) {
          throw new ApiError("分组成员单页包含重复账号", { code: "PAGINATION_INCOMPLETE" });
        }
        const pageSignature = [...pageMids].sort().join("|");
        if (list.length === GROUP_PAGE_SIZE && pageSignature === previousPageSignature) {
          throw new ApiError("分组成员分页返回了重复的完整页", { code: "PAGINATION_INCOMPLETE" });
        }
        previousPageSignature = pageSignature;
        const sizeBeforePage = seen.size;
        for (const member of list) {
          const mid = String(member?.mid ?? "");
          const name = String(member?.uname ?? "").trim();
          if (seen.has(mid)) continue;
          seen.add(mid);
          members.push({ mid, name });
        }
        if (list.length > 0 && seen.size === sizeBeforePage) {
          throw new ApiError("分组成员分页没有返回新成员", { code: "PAGINATION_INCOMPLETE" });
        }
        if (list.length < GROUP_PAGE_SIZE) break;
        if (page === GROUP_MAX_PAGES) {
          throw new ApiError(`分组成员超过 ${GROUP_MAX_PAGES * GROUP_PAGE_SIZE} 条分页上限`, {
            code: "PAGINATION_INCOMPLETE"
          });
        }
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      return members;
    }
  };
  var state = {
    api: new BilibiliApi(),
    settings: normalizeSettings(Storage.read("settings", DEFAULT_SETTINGS)),
    uid: null,
    loggedIn: null,
    accountReady: false,
    accountCheckPromise: null,
    accountRecheckPending: false,
    lastAccountCheckAt: 0,
    cookieUidSnapshot: cookieUid(),
    accountRecheckTimer: 0,
    groupCache: normalizeGroupCache(null),
    authorGroupsMap: {},
    hiddenRecords: {},
    watchLater: [],
    sessionHiddenWrappers: /* @__PURE__ */ new WeakSet(),
    sessionHiddenStableIds: /* @__PURE__ */ new WeakMap(),
    sessionHiddenOrigins: /* @__PURE__ */ new WeakMap(),
    groupLoads: /* @__PURE__ */ new Map(),
    root: null,
    shadow: null,
    ui: {},
    list: null,
    listObserver: null,
    bodyObserver: null,
    pendingCards: /* @__PURE__ */ new Set(),
    scanFrame: 0,
    bindFrame: 0,
    refilterToken: 0,
    cardSignatures: /* @__PURE__ */ new WeakMap(),
    cardErrors: /* @__PURE__ */ new WeakSet(),
    emptyNotice: null,
    status: { kind: "idle", message: "正在启动…" },
    stats: { total: 0, visible: 0, hidden: 0, unknown: 0 },
    toastTimer: 0,
    toastUndo: null,
    keywordTimer: 0,
    keywordDraft: null,
    resetArmedUntil: 0,
    clearHiddenArmedUntil: 0,
    resetTimer: 0,
    clearHiddenTimer: 0,
    routeActive: false,
    routeGeneration: 0,
    routeController: null,
    destroyed: false,
    historyHooks: [],
    drawerReturnFocus: null,
    launcherAnchor: null,
    panelResolvedDirection: null,
    panelFrame: 0,
    panelResizeObserver: null
  };
  function isFeedRoute() {
    return location.hostname === "t.bilibili.com" && location.pathname === "/";
  }
  function cookieUid() {
    return document.cookie.match(/(?:^|;\s*)DedeUserID=(\d+)/)?.[1] ?? null;
  }
  function accountKey(kind) {
    return `${kind}:${state.uid || "anonymous"}`;
  }
  function currentGroupStates() {
    const key = String(state.uid ?? "anonymous");
    state.settings.groupStatesByUid[key] ??= {};
    return state.settings.groupStatesByUid[key];
  }
  function activeGroupIds() {
    const validIds = new Set(state.groupCache.groups.map((group) => group.id));
    return Object.entries(currentGroupStates()).filter(([id, value]) => validIds.has(String(id)) && (Number(value) === 1 || Number(value) === -1)).map(([id]) => String(id));
  }
  function areActiveGroupsReady() {
    const active = activeGroupIds();
    if (!active.length) return true;
    const byId = new Map(state.groupCache.groups.map((group) => [group.id, group]));
    return active.every((id) => Number(byId.get(id)?.loadedAt) > 0);
  }
  function saveSettings() {
    state.settings = normalizeSettings(state.settings);
    Storage.write("settings", state.settings);
  }
  function commitKeywordDraft({ refilter = true } = {}) {
    if (state.keywordDraft == null) return false;
    window.clearTimeout(state.keywordTimer);
    state.keywordTimer = 0;
    state.settings.keywords = parseKeywords(state.keywordDraft, { caseSensitive: state.settings.caseSensitive });
    state.keywordDraft = null;
    saveSettings();
    if (refilter) void refilterAll();
    return true;
  }
  function saveGroupCache() {
    if (!state.uid) return;
    state.groupCache = normalizeGroupCache(state.groupCache);
    Storage.write(accountKey("groups"), state.groupCache);
  }
  function saveHiddenRecords() {
    state.hiddenRecords = pruneHiddenRecords(state.hiddenRecords);
    Storage.write(accountKey("hidden"), state.hiddenRecords);
  }
  function saveWatchLater() {
    Storage.write(accountKey("watch"), state.watchLater);
  }
  function sanitizeWatchLater(raw) {
    if (!Array.isArray(raw)) return [];
    let output = [];
    for (const item of raw.slice(0, 1e3).reverse()) {
      if (!item || typeof item !== "object" || !item.id && !item.url) continue;
      output = addWatchLater(output, item);
    }
    return output;
  }
  function loadAccountData() {
    state.groupCache = normalizeGroupCache(Storage.read(accountKey("groups"), null));
    state.hiddenRecords = pruneHiddenRecords(Storage.read(accountKey("hidden"), {}));
    state.watchLater = sanitizeWatchLater(Storage.read(accountKey("watch"), []));
    rebuildMembershipMap();
  }
  function abortGroupLoads() {
    for (const controller of state.groupLoads.values()) controller.abort();
    state.groupLoads.clear();
  }
  function resetAccountForDetection() {
    abortGroupLoads();
    state.uid = null;
    state.loggedIn = null;
    state.accountReady = false;
    state.clearHiddenArmedUntil = 0;
    state.sessionHiddenWrappers = /* @__PURE__ */ new WeakSet();
    state.sessionHiddenStableIds = /* @__PURE__ */ new WeakMap();
    state.sessionHiddenOrigins = /* @__PURE__ */ new WeakMap();
    state.groupCache = normalizeGroupCache(null);
    state.hiddenRecords = {};
    state.watchLater = [];
    rebuildMembershipMap();
  }
  function clearAccountScopedCardUi() {
    for (const wrapper of document.querySelectorAll(SELECTORS.wrapper)) {
      const reason = wrapper.dataset.btfHiddenReason;
      if (reason === "manual" || reason === "group") delete wrapper.dataset.btfHiddenReason;
      const watch = wrapper.querySelector(".btf-card-action[data-action='watch']");
      const hide = wrapper.querySelector(".btf-card-action[data-action='hide']");
      if (hide) {
        hide.disabled = true;
        hide.title = "正在确认账号";
        hide.setAttribute("aria-label", hide.title);
      }
      if (watch) {
        watch.disabled = true;
        watch.setAttribute("aria-pressed", "false");
        watch.title = "正在确认账号";
        watch.setAttribute("aria-label", watch.title);
        watch.querySelector(".btf-icon").textContent = "☆";
      }
    }
    updateStats();
  }
  function quarantineAccountChange(observedCookie = cookieUid()) {
    if (observedCookie === state.cookieUidSnapshot && !state.accountReady) return false;
    resetAccountForDetection();
    state.cookieUidSnapshot = observedCookie;
    state.lastAccountCheckAt = 0;
    hideToast();
    window.clearTimeout(state.clearHiddenTimer);
    state.clearHiddenTimer = 0;
    state.clearHiddenArmedUntil = 0;
    if (state.ui.clearHidden) state.ui.clearHidden.textContent = "恢复本地隐藏";
    clearAccountScopedCardUi();
    setStatus("loading", "检测到账号变化，正在隔离并重新同步…");
    renderUi();
    void refilterAll();
    return true;
  }
  function transitionAccount(nextUid, loggedIn) {
    const normalizedUid = nextUid == null || nextUid === "" ? null : String(nextUid);
    const identityChanged = state.uid !== normalizedUid;
    const sessionStatusChanged = state.loggedIn !== loggedIn;
    const shouldReload = identityChanged || !state.accountReady;
    if (identityChanged) {
      abortGroupLoads();
      state.sessionHiddenWrappers = /* @__PURE__ */ new WeakSet();
      state.sessionHiddenStableIds = /* @__PURE__ */ new WeakMap();
      state.sessionHiddenOrigins = /* @__PURE__ */ new WeakMap();
      hideToast();
      state.clearHiddenArmedUntil = 0;
      window.clearTimeout(state.clearHiddenTimer);
      state.clearHiddenTimer = 0;
      if (state.ui.clearHidden) state.ui.clearHidden.textContent = "恢复本地隐藏";
    }
    state.uid = normalizedUid;
    state.loggedIn = loggedIn;
    state.accountReady = true;
    if (shouldReload) loadAccountData();
    return shouldReload || sessionStatusChanged;
  }
  function requireCurrentAccount() {
    if (!state.accountReady) {
      showToast("正在确认账号，请稍后再试");
      return false;
    }
    if (cookieUid() !== state.cookieUidSnapshot) {
      queueAccountRecheck();
      showToast("检测到账号状态变化，正在重新同步");
      return false;
    }
    return true;
  }
  function queueAccountRecheck() {
    const currentCookie = cookieUid();
    if (currentCookie === state.cookieUidSnapshot) return;
    quarantineAccountChange(currentCookie);
    state.accountRecheckPending = true;
    if (state.accountRecheckTimer || state.accountCheckPromise) return;
    state.accountRecheckTimer = window.setTimeout(() => {
      state.accountRecheckTimer = 0;
      recheckAccountOnResume();
    }, 250);
  }
  function retryAccountCheckSoon() {
    if (state.accountRecheckTimer || !state.routeActive || state.destroyed) return;
    state.accountRecheckPending = true;
    state.accountRecheckTimer = window.setTimeout(() => {
      state.accountRecheckTimer = 0;
      recheckAccountOnResume();
    }, 0);
  }
  function accountCookieStillCurrent(expectedCookie = state.cookieUidSnapshot) {
    const current = cookieUid();
    const matches = current === expectedCookie && state.cookieUidSnapshot === expectedCookie;
    if (!matches) queueAccountRecheck();
    return matches;
  }
  function rebuildMembershipMap() {
    state.groupCache = normalizeGroupCache(state.groupCache);
    state.authorGroupsMap = state.groupCache.memberships;
  }
  function ensureGlobalStyle() {
    let style = document.getElementById(GLOBAL_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = GLOBAL_STYLE_ID;
      style.textContent = GLOBAL_STYLE;
      (document.head || document.documentElement).append(style);
    }
  }
  function staticPanelMarkup() {
    return `
    <style>${PANEL_STYLE}</style>
    <button class="launcher" type="button" aria-label="打开动态净览" aria-controls="btf-panel" aria-expanded="false" title="打开动态净览（入口位置可在设置中选择）">
      <svg class="launcher-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="btf-launcher-funnel-gradient" x1="2" y1="3" x2="16" y2="25" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#17d9b8"></stop>
            <stop offset=".24" stop-color="#00b7f0"></stop>
            <stop offset=".47" stop-color="#3887ff"></stop>
            <stop offset=".67" stop-color="#8b3dff"></stop>
            <stop offset=".84" stop-color="#e527d7"></stop>
            <stop offset="1" stop-color="#ff6471"></stop>
          </linearGradient>
          <linearGradient id="btf-launcher-sparkle-gradient" x1="18" y1="15" x2="25" y2="23" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#d91ee9"></stop>
            <stop offset=".52" stop-color="#ff2d96"></stop>
            <stop offset="1" stop-color="#ff9b24"></stop>
          </linearGradient>
        </defs>
        <path fill="url(#btf-launcher-funnel-gradient) #006f9e" d="M3.5 4h17c.82 0 1.24.99.66 1.57l-5.93 5.93a3.2 3.2 0 0 0-.94 2.27v7.9c0 .82-.89 1.33-1.6.91l-2.03-1.2a1.8 1.8 0 0 1-.89-1.55v-6.06c0-.85-.34-1.67-.94-2.27L2.84 5.57C2.26 4.99 2.67 4 3.5 4Z"></path>
        <path fill="url(#btf-launcher-sparkle-gradient) #e527d7" d="M21.45 15.25c.36 1.84 1.8 3.28 3.64 3.64-1.84.36-3.28 1.8-3.64 3.64-.36-1.84-1.8-3.28-3.64-3.64 1.84-.36 3.28-1.8 3.64-3.64Z"></path>
      </svg>
      <span class="badge" hidden>0</span>
    </button>
    <section class="panel" id="btf-panel" role="dialog" aria-label="B站动态净览筛选器" aria-hidden="true">
      <header class="panel-header">
        <div class="brand-mark" aria-hidden="true">净</div>
        <div class="brand">
          <h2 class="brand-title">动态净览</h2>
          <p class="brand-status" aria-live="polite">正在启动…</p>
        </div>
        <button class="icon-button collapse" type="button" aria-label="收起面板" title="收起">×</button>
      </header>
      <div class="stats" aria-label="筛选统计">
        <div class="stat"><strong data-stat="visible">0</strong><span>显示</span></div>
        <div class="stat hidden"><strong data-stat="hidden">0</strong><span>隐藏</span></div>
        <div class="stat unknown"><strong data-stat="unknown">0</strong><span>待识别</span></div>
      </div>
      <div class="scroll-area">
        <section class="section">
          <div class="switch-row">
            <div class="switch-copy"><strong>启用筛选</strong><span>关闭后立即恢复所有卡片</span></div>
            <button class="switch enabled-switch" type="button" role="switch" aria-label="启用筛选" aria-checked="true"></button>
          </div>
        </section>
        <section class="section collapsible-section" data-section-id="groups">
          <h3 class="section-title">
            <button class="section-toggle" id="btf-toggle-groups" type="button" data-section-id="groups" aria-expanded="true" aria-controls="btf-section-groups">
              <span class="section-title-label">关注分组</span>
              <span class="section-title-trailing"><span class="section-hint">包含取并集 · 排除优先</span><span class="section-chevron" aria-hidden="true"></span></span>
            </button>
          </h3>
          <div class="section-collapse" id="btf-section-groups" role="region" aria-labelledby="btf-toggle-groups" aria-hidden="false">
            <div class="section-content"><div class="section-content-inner">
              <input class="search group-search" type="search" placeholder="搜索分组" aria-label="搜索关注分组">
              <div class="group-gesture-help" id="btf-group-help">
                <span class="include-gesture">左键包含</span><span class="exclude-gesture">右键排除</span><span>同键再次点击取消</span>
              </div>
              <div class="groups" aria-live="polite"></div>
            </div></div>
          </div>
        </section>
        <section class="section collapsible-section" data-section-id="types">
          <h3 class="section-title">
            <button class="section-toggle" id="btf-toggle-types" type="button" data-section-id="types" aria-expanded="true" aria-controls="btf-section-types">
              <span class="section-title-label">隐藏内容类型</span>
              <span class="section-title-trailing"><span class="section-hint">未知类型会保留</span><span class="section-chevron" aria-hidden="true"></span></span>
            </button>
          </h3>
          <div class="section-collapse" id="btf-section-types" role="region" aria-labelledby="btf-toggle-types" aria-hidden="false">
            <div class="section-content"><div class="section-content-inner">
              <div class="chips type-chips"></div>
            </div></div>
          </div>
        </section>
        <section class="section collapsible-section" data-section-id="keywords">
          <h3 class="section-title">
            <button class="section-toggle" id="btf-toggle-keywords" type="button" data-section-id="keywords" aria-expanded="true" aria-controls="btf-section-keywords">
              <span class="section-title-label">关键词屏蔽</span>
              <span class="section-title-trailing"><span class="section-hint">每行一个 · 普通文本</span><span class="section-chevron" aria-hidden="true"></span></span>
            </button>
          </h3>
          <div class="section-collapse" id="btf-section-keywords" role="region" aria-labelledby="btf-toggle-keywords" aria-hidden="false">
            <div class="section-content"><div class="section-content-inner">
              <textarea class="keywords" maxlength="10099" placeholder="例如：抽奖&#10;带货&#10;剧透" aria-label="关键词屏蔽规则"></textarea>
              <label class="inline-check"><input class="case-sensitive" type="checkbox">区分大小写</label>
            </div></div>
          </div>
        </section>
        <section class="section collapsible-section" data-section-id="layout">
          <h3 class="section-title">
            <button class="section-toggle" id="btf-toggle-layout" type="button" data-section-id="layout" aria-expanded="true" aria-controls="btf-section-layout">
              <span class="section-title-label">界面与布局</span>
              <span class="section-title-trailing"><span class="section-chevron" aria-hidden="true"></span></span>
            </button>
          </h3>
          <div class="section-collapse" id="btf-section-layout" role="region" aria-labelledby="btf-toggle-layout" aria-hidden="false">
            <div class="section-content"><div class="section-content-inner">
              <div class="settings-grid">
                <label class="field"><span>主题</span><select class="theme"><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
                <label class="field"><span>入口位置</span><select class="launcher-corner"><option value="bottom-left">左下角</option><option value="bottom-right">右下角</option><option value="top-left">左上角</option><option value="top-right">右上角</option></select></label>
                <label class="field"><span>展开方向</span><select class="panel-direction"><option value="auto">自动避让</option><option value="up">向上优先</option><option value="down">向下优先</option><option value="left">向左优先</option><option value="right">向右优先</option></select></label>
                <label class="field"><span>卡片密度</span><select class="density"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
                <label class="field"><span>信息流宽度</span><select class="feed-width"><option value="default">原始</option><option value="wide">加宽</option></select></label>
              </div>
              <div class="font-toolbar" role="group" aria-label="界面字体大小">
                <span class="font-toolbar-label">界面字号</span>
                <button class="font-step font-decrease" type="button" aria-label="缩小界面字体" title="缩小字体">A−</button>
                <input class="font-scale" id="btf-font-scale" type="range" min="${FONT_SCALE_MIN}" max="${FONT_SCALE_MAX}" step="${FONT_SCALE_STEP}" aria-label="界面字体大小">
                <button class="font-step font-increase" type="button" aria-label="放大界面字体" title="放大字体">A+</button>
                <button class="font-reset" type="button" aria-label="恢复默认字体大小" title="恢复 100%"><output class="font-scale-value" for="btf-font-scale">100%</output></button>
              </div>
              <label class="inline-check"><input class="hide-sidebars" type="checkbox">专注模式：隐藏动态页侧栏</label>
              <div class="actions">
                <button class="button primary refresh-groups" type="button">刷新分组</button>
                <button class="button clear-groups" type="button">清空分组条件</button>
                <button class="button clear-hidden" type="button">恢复本地隐藏</button>
                <button class="button export-settings" type="button">导出设置</button>
                <button class="button import-settings" type="button">导入设置</button>
                <button class="button danger reset-settings" type="button">恢复默认</button>
                <input class="import-file" type="file" accept="application/json,.json" hidden>
              </div>
            </div></div>
          </div>
        </section>
      </div>
      <footer class="panel-footer">
        <span class="cache-info">v${VERSION}</span>
        <button class="footer-link open-watch" type="button" aria-controls="btf-watch-drawer" aria-expanded="false">本地稍后看（0）</button>
      </footer>
      <section class="drawer" id="btf-watch-drawer" role="region" aria-label="本地稍后看" aria-hidden="true">
        <header class="drawer-header"><h2>本地稍后看</h2><button class="icon-button close-watch" type="button" aria-label="关闭本地稍后看">×</button></header>
        <div class="watch-list"></div>
      </section>
    </section>
    <div class="toast" role="status"><span class="toast-message"></span><button class="toast-action" type="button" hidden>撤销</button></div>
  `;
  }
  function mountUi() {
    if (state.root?.isConnected) return;
    ensureGlobalStyle();
    document.getElementById(ROOT_ID)?.remove();
    const root = document.createElement("div");
    root.id = ROOT_ID;
    const shadow = root.attachShadow({ mode: "open" });
    shadow.innerHTML = staticPanelMarkup();
    document.body.append(root);
    state.root = root;
    state.shadow = shadow;
    state.ui = {
      launcher: shadow.querySelector(".launcher"),
      badge: shadow.querySelector(".badge"),
      panel: shadow.querySelector(".panel"),
      scrollArea: shadow.querySelector(".scroll-area"),
      stats: shadow.querySelector(".stats"),
      panelHeader: shadow.querySelector(".panel-header"),
      panelFooter: shadow.querySelector(".panel-footer"),
      status: shadow.querySelector(".brand-status"),
      collapse: shadow.querySelector(".collapse"),
      enabled: shadow.querySelector(".enabled-switch"),
      sectionToggles: [...shadow.querySelectorAll(".section-toggle[data-section-id]")],
      groups: shadow.querySelector(".groups"),
      groupSearch: shadow.querySelector(".group-search"),
      typeChips: shadow.querySelector(".type-chips"),
      keywords: shadow.querySelector(".keywords"),
      caseSensitive: shadow.querySelector(".case-sensitive"),
      theme: shadow.querySelector(".theme"),
      launcherCorner: shadow.querySelector(".launcher-corner"),
      panelDirection: shadow.querySelector(".panel-direction"),
      fontScale: shadow.querySelector(".font-scale"),
      fontDecrease: shadow.querySelector(".font-decrease"),
      fontIncrease: shadow.querySelector(".font-increase"),
      fontReset: shadow.querySelector(".font-reset"),
      fontScaleValue: shadow.querySelector(".font-scale-value"),
      density: shadow.querySelector(".density"),
      feedWidth: shadow.querySelector(".feed-width"),
      hideSidebars: shadow.querySelector(".hide-sidebars"),
      refreshGroups: shadow.querySelector(".refresh-groups"),
      clearGroups: shadow.querySelector(".clear-groups"),
      clearHidden: shadow.querySelector(".clear-hidden"),
      exportSettings: shadow.querySelector(".export-settings"),
      importSettings: shadow.querySelector(".import-settings"),
      importFile: shadow.querySelector(".import-file"),
      resetSettings: shadow.querySelector(".reset-settings"),
      cacheInfo: shadow.querySelector(".cache-info"),
      openWatch: shadow.querySelector(".open-watch"),
      drawer: shadow.querySelector(".drawer"),
      closeWatch: shadow.querySelector(".close-watch"),
      watchList: shadow.querySelector(".watch-list"),
      toast: shadow.querySelector(".toast"),
      toastMessage: shadow.querySelector(".toast-message"),
      toastAction: shadow.querySelector(".toast-action")
    };
    bindUiEvents();
    if (typeof window.ResizeObserver === "function") {
      state.panelResizeObserver = new window.ResizeObserver(() => schedulePanelPosition());
      state.panelResizeObserver.observe(state.ui.panel);
    }
    renderTypeChips();
    renderUi();
  }
  function viewportSize() {
    const visualViewport = window.visualViewport;
    return {
      left: Number(visualViewport?.offsetLeft) || 0,
      top: Number(visualViewport?.offsetTop) || 0,
      width: Math.max(1, Number(visualViewport?.width) || Number(window.innerWidth) || 1),
      height: Math.max(1, Number(visualViewport?.height) || Number(window.innerHeight) || 1)
    };
  }
  function applyLauncherPixels(pixels) {
    if (!state.root) return;
    const viewport = viewportSize();
    const next = clampLauncherPixels(pixels, {
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      viewportLeft: viewport.left,
      viewportTop: viewport.top,
      margin: LAUNCHER_MARGIN,
      launcherSize: LAUNCHER_SIZE
    });
    state.root.style.left = `${next.x}px`;
    state.root.style.top = `${next.y}px`;
    state.root.style.right = "auto";
    state.root.style.bottom = "auto";
    state.root.dataset.edgeX = next.x + LAUNCHER_SIZE / 2 <= viewport.left + viewport.width / 2 ? "left" : "right";
    state.root.dataset.edgeY = next.y + LAUNCHER_SIZE / 2 <= viewport.top + viewport.height / 2 ? "top" : "bottom";
    state.launcherAnchor = {
      left: next.x,
      top: next.y,
      width: LAUNCHER_SIZE,
      height: LAUNCHER_SIZE
    };
  }
  function applyLauncherPosition() {
    if (!state.root) return;
    const viewport = viewportSize();
    state.root.dataset.launcherCorner = state.settings.launcherCorner;
    applyLauncherPixels(launcherCornerToPixels(state.settings.launcherCorner, {
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      viewportLeft: viewport.left,
      viewportTop: viewport.top,
      margin: LAUNCHER_MARGIN,
      launcherSize: LAUNCHER_SIZE
    }));
  }
  function positionPanel() {
    const { panel } = state.ui;
    if (!panel || !state.root?.isConnected || !state.settings.panelOpen || !state.launcherAnchor) return;
    const viewport = viewportSize();
    const maximumWidth = Math.max(1, viewport.width - PANEL_MARGIN * 2);
    const maximumHeight = Math.max(1, viewport.height - PANEL_MARGIN * 2);
    panel.style.maxWidth = `${maximumWidth}px`;
    panel.style.maxHeight = `${maximumHeight}px`;
    const rect = panel.getBoundingClientRect();
    const panelWidth = Math.min(maximumWidth, Math.max(1, Number(rect.width) || Math.min(340, maximumWidth)));
    const panelHeight = Math.min(maximumHeight, Math.max(1, Number(rect.height) || Math.min(760, maximumHeight)));
    const placement = placePanel({
      direction: state.panelResolvedDirection ?? state.settings.panelDirection,
      anchor: state.launcherAnchor,
      panelWidth,
      panelHeight,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      viewportLeft: viewport.left,
      viewportTop: viewport.top,
      margin: PANEL_MARGIN,
      gap: PANEL_GAP
    });
    panel.style.left = `${placement.left}px`;
    panel.style.top = `${placement.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.dataset.direction = placement.direction;
    state.panelResolvedDirection = placement.direction;
  }
  function schedulePanelPosition() {
    if (state.panelFrame || !state.settings.panelOpen || !state.root) return;
    const root = state.root;
    const generation = state.routeGeneration;
    state.panelFrame = requestAnimationFrame(() => {
      state.panelFrame = 0;
      if (root !== state.root || !root.isConnected || generation !== state.routeGeneration) return;
      positionPanel();
    });
  }
  function isSectionCollapsed(sectionId) {
    return state.settings.collapsedSections.includes(sectionId);
  }
  function preferredPanelFocusTarget() {
    if (!isSectionCollapsed("groups") && state.ui.groupSearch?.isConnected) {
      return state.ui.groupSearch;
    }
    return state.ui.sectionToggles?.find((toggle) => toggle.dataset.sectionId === "groups") ?? state.ui.enabled;
  }
  function renderCollapsibleSections() {
    const activeElement = state.shadow?.activeElement;
    for (const toggle of state.ui.sectionToggles ?? []) {
      const sectionId = toggle.dataset.sectionId;
      const collapsed = isSectionCollapsed(sectionId);
      const section = toggle.closest(".collapsible-section");
      const content = state.shadow?.getElementById(toggle.getAttribute("aria-controls"));
      if (!section || !content) continue;
      if (collapsed && activeElement && content.contains(activeElement)) {
        toggle.focus({ preventScroll: true });
      }
      section.dataset.collapsed = String(collapsed);
      toggle.setAttribute("aria-expanded", String(!collapsed));
      const label = toggle.querySelector(".section-title-label")?.textContent?.trim() || "模块";
      toggle.title = `${collapsed ? "展开" : "收起"}${label}`;
      content.setAttribute("aria-hidden", String(collapsed));
      content.toggleAttribute("inert", collapsed);
    }
  }
  function toggleCollapsibleSection(sectionId) {
    if (!COLLAPSIBLE_SECTIONS.includes(sectionId)) return;
    const collapsed = new Set(state.settings.collapsedSections);
    if (collapsed.has(sectionId)) collapsed.delete(sectionId);
    else collapsed.add(sectionId);
    state.settings.collapsedSections = COLLAPSIBLE_SECTIONS.filter((id) => collapsed.has(id));
    saveSettings();
    renderCollapsibleSections();
    schedulePanelPosition();
  }
  function handleViewportChange() {
    if (!state.root?.isConnected) return;
    state.panelResolvedDirection = null;
    applyLauncherPosition();
    schedulePanelPosition();
  }
  function bindUiEvents() {
    const ui = state.ui;
    ui.launcher.addEventListener("click", () => setPanelOpen(true));
    for (const toggle of ui.sectionToggles) {
      toggle.addEventListener("click", () => toggleCollapsibleSection(toggle.dataset.sectionId));
      const content = state.shadow.getElementById(toggle.getAttribute("aria-controls"));
      content?.addEventListener("transitionend", (event) => {
        if (event.target === content && event.propertyName === "grid-template-rows") {
          schedulePanelPosition();
        }
      });
    }
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);
    ui.collapse.addEventListener("click", () => setPanelOpen(false));
    ui.enabled.addEventListener("click", () => {
      state.settings.enabled = !state.settings.enabled;
      saveSettings();
      renderUi();
      void refilterAll();
    });
    ui.groupSearch.addEventListener("input", () => renderGroups(ui.groupSearch.value));
    const applyGroupGesture = async (row, desired) => {
      try {
        await setGroupState(row.dataset.groupId, desired);
      } catch (error) {
        reportRuntimeError("更新分组筛选失败", error);
      }
    };
    ui.groups.addEventListener("click", (event) => {
      const row = event.target.closest(".group-row[data-group-id]");
      if (!row || event.button !== 0) return;
      void applyGroupGesture(row, 1);
    });
    ui.groups.addEventListener("contextmenu", (event) => {
      const row = event.target.closest(".group-row[data-group-id]");
      const fromTouch = event.pointerType === "touch" || event.sourceCapabilities?.firesTouchEvents === true;
      if (!row || event.button !== 2 || fromTouch) return;
      event.preventDefault();
      row.focus({ preventScroll: true });
      void applyGroupGesture(row, -1);
    });
    ui.groups.addEventListener("keydown", (event) => {
      const row = event.target.closest(".group-row[data-group-id]");
      if (!row || !event.shiftKey || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      void applyGroupGesture(row, -1);
    });
    ui.typeChips.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-type]");
      if (!button) return;
      const type = button.dataset.type;
      const hidden = new Set(state.settings.hiddenTypes);
      if (hidden.has(type)) hidden.delete(type);
      else hidden.add(type);
      state.settings.hiddenTypes = [...hidden];
      saveSettings();
      renderTypeChips();
      void refilterAll();
    });
    ui.keywords.addEventListener("input", () => {
      state.keywordDraft = ui.keywords.value;
      window.clearTimeout(state.keywordTimer);
      state.keywordTimer = window.setTimeout(() => commitKeywordDraft(), 220);
    });
    ui.caseSensitive.addEventListener("change", () => {
      state.settings.caseSensitive = ui.caseSensitive.checked;
      state.keywordDraft = ui.keywords.value;
      commitKeywordDraft();
    });
    for (const [element, property] of [
      [ui.theme, "theme"],
      [ui.launcherCorner, "launcherCorner"],
      [ui.panelDirection, "panelDirection"],
      [ui.density, "density"],
      [ui.feedWidth, "feedWidth"]
    ]) {
      element.addEventListener("change", () => {
        state.settings[property] = element.value;
        saveSettings();
        if (property === "launcherCorner" || property === "panelDirection") {
          state.panelResolvedDirection = null;
        }
        applyLayoutSettings();
      });
    }
    ui.fontScale.addEventListener("input", () => setFontScale(ui.fontScale.value, { persist: false }));
    ui.fontScale.addEventListener("change", () => setFontScale(ui.fontScale.value));
    ui.fontDecrease.addEventListener("click", () => setFontScale(state.settings.fontScale - FONT_SCALE_STEP));
    ui.fontIncrease.addEventListener("click", () => setFontScale(state.settings.fontScale + FONT_SCALE_STEP));
    ui.fontReset.addEventListener("click", () => setFontScale(100));
    ui.hideSidebars.addEventListener("change", () => {
      state.settings.hideSidebars = ui.hideSidebars.checked;
      saveSettings();
      applyLayoutSettings();
    });
    ui.refreshGroups.addEventListener("click", () => {
      void refreshGroups({ force: true }).catch((error) => reportRuntimeError("刷新分组失败", error));
    });
    ui.clearGroups.addEventListener("click", () => {
      if (!requireCurrentAccount()) return;
      state.settings.groupStatesByUid[String(state.uid ?? "anonymous")] = {};
      abortGroupLoads();
      setStatus("ready", "已清空分组条件");
      saveSettings();
      renderGroups(ui.groupSearch.value);
      void refilterAll();
      showToast("已清空分组条件");
    });
    ui.clearHidden.addEventListener("click", () => {
      void clearHiddenRecords().catch((error) => reportRuntimeError("恢复隐藏记录失败", error));
    });
    ui.exportSettings.addEventListener("click", exportSettings);
    ui.importSettings.addEventListener("click", () => ui.importFile.click());
    ui.importFile.addEventListener("change", importSettings);
    ui.resetSettings.addEventListener("click", resetSettings);
    ui.openWatch.addEventListener("click", () => openWatchDrawer(true));
    ui.closeWatch.addEventListener("click", () => openWatchDrawer(false));
    ui.toastAction.addEventListener("click", () => {
      const undo = state.toastUndo;
      hideToast();
      undo?.();
    });
    ui.toast.addEventListener("focusin", () => window.clearTimeout(state.toastTimer));
    ui.toast.addEventListener("focusout", () => queueMicrotask(() => {
      if (ui.toast.classList.contains("show") && !ui.toast.contains(state.shadow?.activeElement)) {
        scheduleToastHide(state.toastUndo ? 6e3 : 3200);
      }
    }));
    document.addEventListener("keydown", handleGlobalKeydown);
  }
  function setPanelOpen(open) {
    const shouldOpen = Boolean(open);
    if (!shouldOpen && state.ui.drawer?.classList.contains("open")) {
      openWatchDrawer(false, { restoreFocus: false });
    }
    if (state.settings.panelOpen !== shouldOpen) state.panelResolvedDirection = null;
    state.settings.panelOpen = shouldOpen;
    saveSettings();
    renderUi();
    window.setTimeout(() => {
      if (shouldOpen) preferredPanelFocusTarget()?.focus();
      else state.ui.launcher?.focus();
    }, 0);
  }
  function handleGlobalKeydown(event) {
    if (!state.root?.isConnected) return;
    if (event.key === "Escape") {
      if (state.ui.drawer?.classList.contains("open")) openWatchDrawer(false);
      else if (state.settings.panelOpen) setPanelOpen(false);
      return;
    }
  }
  function setStatus(kind, message) {
    state.status = { kind, message: String(message) };
    if (state.ui.status) {
      state.ui.status.textContent = state.status.message;
      state.ui.status.dataset.kind = kind;
    }
  }
  function renderUi() {
    if (!state.root) return;
    state.root.dataset.open = String(state.settings.panelOpen);
    state.root.dataset.theme = state.settings.theme;
    state.root.dataset.panelDirection = state.settings.panelDirection;
    state.ui.launcher.setAttribute("aria-expanded", String(state.settings.panelOpen));
    state.ui.panel.setAttribute("aria-hidden", String(!state.settings.panelOpen));
    state.ui.enabled.setAttribute("aria-checked", String(state.settings.enabled));
    state.ui.status.textContent = state.status.message;
    state.ui.keywords.value = state.keywordDraft ?? state.settings.keywords.join("\n");
    state.ui.caseSensitive.checked = state.settings.caseSensitive;
    state.ui.theme.value = state.settings.theme;
    state.ui.launcherCorner.value = state.settings.launcherCorner;
    state.ui.panelDirection.value = state.settings.panelDirection;
    state.ui.density.value = state.settings.density;
    state.ui.feedWidth.value = state.settings.feedWidth;
    state.ui.hideSidebars.checked = state.settings.hideSidebars;
    state.ui.refreshGroups.disabled = !state.accountReady || state.loggedIn === false;
    renderCollapsibleSections();
    renderGroups(state.ui.groupSearch.value);
    renderTypeChips();
    renderStats();
    renderCacheInfo();
    renderWatchLater();
    renderFontScaleControls();
    applyLayoutSettings();
  }
  function renderFontScaleControls() {
    if (!state.ui.fontScale) return;
    const scale = normalizeFontScale(state.settings.fontScale);
    state.ui.fontScale.value = String(scale);
    state.ui.fontScale.setAttribute("aria-valuetext", `${scale}%`);
    state.ui.fontScaleValue.textContent = `${scale}%`;
    state.ui.fontDecrease.disabled = scale <= FONT_SCALE_MIN;
    state.ui.fontIncrease.disabled = scale >= FONT_SCALE_MAX;
    state.ui.fontReset.disabled = scale === 100;
  }
  function setFontScale(value, { persist = true } = {}) {
    state.settings.fontScale = normalizeFontScale(value);
    if (persist) saveSettings();
    renderFontScaleControls();
    applyLayoutSettings();
  }
  function renderTypeChips() {
    const container = state.ui.typeChips;
    if (!container) return;
    if (!container.childElementCount) {
      for (const [type, label] of Object.entries(TYPE_LABELS)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chip";
        button.dataset.type = type;
        button.textContent = label;
        container.append(button);
      }
    }
    for (const button of container.querySelectorAll("button[data-type]")) {
      button.setAttribute("aria-pressed", String(state.settings.hiddenTypes.includes(button.dataset.type)));
    }
  }
  function renderGroups(search = "") {
    const container = state.ui.groups;
    if (!container) return;
    const active = state.shadow?.activeElement;
    const focusedGroupId = active?.matches?.(".group-row[data-group-id]") && container.contains(active) ? active.dataset.groupId : null;
    container.replaceChildren();
    const needle = String(search).trim().toLocaleLowerCase("zh-CN");
    const groups = state.groupCache.groups.filter((group) => !needle || group.name.toLocaleLowerCase("zh-CN").includes(needle));
    if (!groups.length) {
      const empty = document.createElement("div");
      empty.className = "empty-groups";
      empty.textContent = state.loggedIn === false ? "登录 B 站后可读取关注分组；其他筛选仍可使用。" : state.groupCache.groups.length ? "没有匹配的分组" : "暂无分组数据";
      container.append(empty);
      if (focusedGroupId) state.ui.groupSearch?.focus({ preventScroll: true });
      return;
    }
    const states = currentGroupStates();
    for (const group of groups) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "group-row";
      row.dataset.groupId = group.id;
      const groupState = Number(states[group.id]) === 1 ? 1 : Number(states[group.id]) === -1 ? -1 : 0;
      const stateText = groupState === 1 ? "包含" : groupState === -1 ? "排除" : "未选择";
      row.dataset.state = String(groupState);
      row.setAttribute("aria-pressed", String(groupState !== 0));
      row.setAttribute("aria-describedby", "btf-group-help");
      row.setAttribute("aria-label", `${group.name}，当前${stateText}。回车或空格切换包含，Shift 加回车或空格切换排除`);
      row.setAttribute("aria-keyshortcuts", "Enter Space Shift+Enter Shift+Space");
      row.title = "左键：包含 · 右键：排除 · 同键再次点击：取消";
      if (state.groupLoads.has(group.id)) {
        row.classList.add("loading");
        row.setAttribute("aria-busy", "true");
      }
      const name = document.createElement("span");
      name.className = "group-name";
      const strong = document.createElement("strong");
      strong.textContent = group.name;
      strong.title = group.name;
      const count = document.createElement("span");
      count.textContent = state.groupLoads.has(group.id) ? "正在读取成员…" : `${group.count} 人${group.loadedAt ? " · 已缓存" : ""}`;
      name.append(strong, count);
      const stateLabel = document.createElement("span");
      stateLabel.className = "group-state";
      stateLabel.textContent = stateText;
      row.append(name, stateLabel);
      container.append(row);
    }
    if (focusedGroupId) {
      const replacement = [...container.querySelectorAll(".group-row[data-group-id]")].find((row) => row.dataset.groupId === focusedGroupId);
      (replacement ?? state.ui.groupSearch)?.focus({ preventScroll: true });
    }
  }
  function renderStats() {
    if (!state.shadow) return;
    for (const [key, value] of Object.entries({
      visible: state.stats.visible,
      hidden: state.stats.hidden,
      unknown: state.stats.unknown
    })) {
      const element = state.shadow.querySelector(`[data-stat='${key}']`);
      if (element) element.textContent = String(value);
    }
    state.ui.badge.textContent = String(state.stats.hidden);
    state.ui.badge.hidden = state.stats.hidden === 0;
  }
  function renderCacheInfo() {
    if (!state.ui.cacheInfo) return;
    const age = Date.now() - Number(state.groupCache.fetchedAt || 0);
    const suffix = state.groupCache.fetchedAt ? age < 6e4 ? "刚刚同步" : age < 36e5 ? `${Math.floor(age / 6e4)} 分钟前同步` : `${Math.floor(age / 36e5)} 小时前同步` : "分组未同步";
    state.ui.cacheInfo.textContent = `v${VERSION} · ${suffix}`;
  }
  function applyLayoutSettings() {
    const html = document.documentElement;
    html.dataset.btfDensity = state.settings.density;
    html.dataset.btfWidth = state.settings.feedWidth;
    html.dataset.btfFocus = String(state.settings.hideSidebars);
    const scale = normalizeFontScale(state.settings.fontScale);
    html.style.setProperty("--btf-card-action-font-size", `${12 * scale / 100}px`);
    html.style.setProperty("--btf-empty-font-size", `${14 * scale / 100}px`);
    html.style.setProperty("--btf-card-icon-font-size", `${13 * scale / 100}px`);
    if (state.root) {
      state.root.dataset.theme = state.settings.theme;
      state.root.dataset.panelDirection = state.settings.panelDirection;
      state.root.dataset.fontSize = scale >= 130 ? "large" : "normal";
      state.root.style.setProperty("--btf-ui-font-size", `${12 * scale / 100}px`);
      applyLauncherPosition();
      positionPanel();
      schedulePanelPosition();
    }
  }
  function clearLayoutSettings() {
    const html = document.documentElement;
    delete html.dataset.btfDensity;
    delete html.dataset.btfWidth;
    delete html.dataset.btfFocus;
    html.style.removeProperty("--btf-card-action-font-size");
    html.style.removeProperty("--btf-empty-font-size");
    html.style.removeProperty("--btf-card-icon-font-size");
  }
  async function setGroupState(groupId, desired) {
    if (!requireCurrentAccount()) return;
    if (!state.uid) {
      showToast("登录 B 站后才能使用关注分组");
      return;
    }
    const generation = state.routeGeneration;
    const expectedUid = state.uid;
    const expectedCookie = state.cookieUidSnapshot;
    const stillCurrent = () => state.routeActive && generation === state.routeGeneration && state.uid === expectedUid && accountCookieStillCurrent(expectedCookie) && Boolean(state.ui.groups);
    const states = currentGroupStates();
    const previous = Number(states[groupId]) || 0;
    const next = previous === desired ? 0 : desired;
    if (next === 0) {
      delete states[groupId];
      state.groupLoads.get(groupId)?.abort();
      state.groupLoads.delete(groupId);
      saveSettings();
      setStatus(state.groupLoads.size ? "loading" : "ready", state.groupLoads.size ? "其他分组仍在读取…" : "已取消该分组条件");
      renderGroups(state.ui.groupSearch.value);
      await refilterAll();
      return;
    }
    states[groupId] = next;
    saveSettings();
    renderGroups(state.ui.groupSearch.value);
    await refilterAll();
    if (!stillCurrent() || Number(currentGroupStates()[groupId]) !== next) return;
    const loaded = await ensureGroupLoaded(groupId);
    if (!stillCurrent()) return;
    if (!loaded && !state.groupCache.groups.find((group) => group.id === groupId)?.loadedAt) {
      const liveStates = currentGroupStates();
      if (Number(liveStates[groupId]) === next) {
        delete liveStates[groupId];
        saveSettings();
        showToast("该分组暂时无法读取，已取消条件");
      }
    }
    renderGroups(state.ui.groupSearch.value);
    await refilterAll();
  }
  async function ensureGroupLoaded(groupId, { force = false } = {}) {
    if (!state.routeActive || state.destroyed || !state.uid) return false;
    const group = state.groupCache.groups.find((item) => item.id === String(groupId));
    if (!group) return false;
    const maximumAge = state.settings.cacheHours * 36e5;
    const cacheFresh = group.loadedAt && Date.now() - Number(group.loadedAt) < maximumAge;
    if (cacheFresh && !force) return true;
    const existing = state.groupLoads.get(group.id);
    if (existing && !existing.signal.aborted) return existing.promise;
    if (existing) state.groupLoads.delete(group.id);
    const controller = new AbortController();
    const generation = state.routeGeneration;
    const expectedUid = state.uid;
    const expectedCookie = state.cookieUidSnapshot;
    const hadCachedMembers = Number(group.loadedAt) > 0;
    state.groupLoads.set(group.id, controller);
    const followReplacementOrFallback = () => {
      const replacement = state.groupLoads.get(group.id);
      if (replacement && replacement !== controller && !replacement.signal.aborted && state.routeActive && generation === state.routeGeneration && state.uid === expectedUid && accountCookieStillCurrent(expectedCookie)) {
        return replacement.promise;
      }
      return hadCachedMembers;
    };
    const run = (async () => {
      renderGroups(state.ui.groupSearch?.value || "");
      setStatus("loading", `正在读取“${group.name}”成员…`);
      try {
        const members = await state.api.tagMembers(group.id, group.count, { signal: controller.signal });
        if (controller.signal.aborted) return followReplacementOrFallback();
        if (!state.routeActive || generation !== state.routeGeneration || state.uid !== expectedUid || !accountCookieStillCurrent(expectedCookie)) {
          return hadCachedMembers;
        }
        const currentGroup = state.groupCache.groups.find((item) => item.id === group.id);
        if (!currentGroup) return false;
        if (group.count > 0 && members.length === 0) {
          throw new ApiError("分组人数与成员列表不一致", { code: "EMPTY_MEMBERS" });
        }
        currentGroup.memberMids = members.map((member) => member.mid).filter(Boolean);
        currentGroup.memberNames = members.map((member) => member.name).filter(Boolean);
        currentGroup.loadedAt = Date.now();
        saveGroupCache();
        rebuildMembershipMap();
        setStatus("ready", `“${group.name}”已就绪`);
        return true;
      } catch (error) {
        if (error.code === "ABORTED") {
          return followReplacementOrFallback();
        }
        if (!accountCookieStillCurrent(expectedCookie)) return hadCachedMembers;
        if (error.code === -101 && state.routeActive && generation === state.routeGeneration && state.uid === expectedUid) {
          transitionAccount(null, false);
          setStatus("login", "登录状态已失效；关键词和类型筛选仍可使用");
          renderUi();
          void refilterAll();
          return false;
        }
        if (error.code !== "ABORTED" && state.routeActive && generation === state.routeGeneration && state.uid === expectedUid) {
          setStatus("warning", friendlyApiMessage(error, hadCachedMembers ? "分组成员更新失败，继续使用缓存" : "分组成员读取失败"));
        }
        return hadCachedMembers;
      } finally {
        if (state.groupLoads.get(group.id) === controller) state.groupLoads.delete(group.id);
        if (state.routeActive && generation === state.routeGeneration && state.uid === expectedUid && accountCookieStillCurrent(expectedCookie) && state.ui.groups) {
          renderGroups(state.ui.groupSearch?.value || "");
        }
      }
    })();
    controller.promise = run;
    return run;
  }
  async function ensureActiveGroups({ force = false } = {}) {
    const ids = activeGroupIds();
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor];
        cursor += 1;
        await ensureGroupLoaded(id, { force });
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, ids.length) }, worker));
    const byId = new Map(state.groupCache.groups.map((group) => [group.id, group]));
    const maximumAge = state.settings.cacheHours * 36e5;
    return {
      unavailableIds: ids.filter((id) => Number(byId.get(id)?.loadedAt) <= 0),
      staleIds: ids.filter((id) => {
        const loadedAt = Number(byId.get(id)?.loadedAt) || 0;
        return loadedAt > 0 && Date.now() - loadedAt >= maximumAge;
      })
    };
  }
  function setGroupReadinessStatus(successMessage, readiness) {
    const nameFor = (id) => state.groupCache.groups.find((group) => group.id === id)?.name ?? id;
    if (readiness.unavailableIds.length) {
      const names = readiness.unavailableIds.slice(0, 2).map(nameFor).join("、");
      setStatus("warning", `${names}${readiness.unavailableIds.length > 2 ? "等" : ""}暂未生效，相关内容已安全放行`);
      return false;
    }
    if (readiness.staleIds.length) {
      const names = readiness.staleIds.slice(0, 2).map(nameFor).join("、");
      setStatus("warning", `${names}${readiness.staleIds.length > 2 ? "等" : ""}更新失败，正在使用旧缓存`);
      return true;
    }
    setStatus("ready", successMessage);
    return true;
  }
  function mergeTags(tags) {
    abortGroupLoads();
    const previous = new Map(state.groupCache.groups.map((group) => [group.id, group]));
    const groups = (Array.isArray(tags) ? tags : []).map((tag) => {
      const id = String(tag?.tagid ?? "");
      const cached = previous.get(id);
      const count = Math.max(0, Number(tag?.count) || 0);
      const membershipMayHaveChanged = Boolean(cached) && cached.count !== count;
      return {
        id,
        name: String(tag?.name ?? id),
        count,
        loadedAt: membershipMayHaveChanged ? 0 : Number(cached?.loadedAt) || 0,
        memberMids: membershipMayHaveChanged ? [] : cached?.memberMids ?? [],
        memberNames: membershipMayHaveChanged ? [] : cached?.memberNames ?? []
      };
    }).filter((group) => group.id);
    state.groupCache = normalizeGroupCache({
      uid: state.uid,
      fetchedAt: Date.now(),
      groups
    });
    const validIds = new Set(groups.map((group) => group.id));
    const states = currentGroupStates();
    let settingsChanged = false;
    for (const id of Object.keys(states)) {
      if (!validIds.has(id)) {
        delete states[id];
        settingsChanged = true;
      }
    }
    if (settingsChanged) saveSettings();
    rebuildMembershipMap();
    saveGroupCache();
  }
  function friendlyApiMessage(error, fallback) {
    if (error?.code === -101) return "请先登录 B 站；关键词和类型筛选仍可使用";
    if (error?.status === 412 || error?.code === -352 || error?.code === -401) return "B站请求受限，已停止重试并保留缓存";
    if (error?.code === "TIMEOUT") return "B站接口响应超时，已保留缓存";
    if (error?.code === "NETWORK") return "当前网络不可用，已保留缓存";
    if (["SHAPE", "EMPTY_MEMBERS", "PAGINATION_INCOMPLETE"].includes(error?.code)) return "B站接口数据异常，已保留缓存并安全放行";
    return `${fallback}：${error?.message || "未知错误"}`;
  }
  function reportRuntimeError(context, error) {
    if (error?.code === "ABORTED" || error?.name === "AbortError") return;
    console.error(`[动态净览] ${context}`, error);
    if (state.routeActive) setStatus("error", `${context}，请刷新页面重试`);
  }
  async function refreshGroups({ force = false, generation = state.routeGeneration } = {}) {
    if (!state.routeActive || generation !== state.routeGeneration) return false;
    if (!requireCurrentAccount()) return false;
    if (!state.uid) {
      setStatus("login", "请先登录 B 站；其他筛选仍可使用");
      renderUi();
      return false;
    }
    const expectedUid = state.uid;
    const expectedCookie = state.cookieUidSnapshot;
    const cacheAge = Date.now() - Number(state.groupCache.fetchedAt || 0);
    const cacheFresh = state.groupCache.groups.length && cacheAge < state.settings.cacheHours * 36e5;
    if (!force && cacheFresh) {
      const readiness = await ensureActiveGroups();
      if (!state.routeActive || generation !== state.routeGeneration || state.uid !== expectedUid || !accountCookieStillCurrent(expectedCookie)) return false;
      const usable = setGroupReadinessStatus(`已载入 ${state.groupCache.groups.length} 个关注分组`, readiness);
      renderUi();
      await refilterAll();
      return usable;
    }
    if (state.ui.refreshGroups) state.ui.refreshGroups.disabled = true;
    setStatus("loading", "正在同步关注分组…");
    try {
      const tags = await state.api.tags({ signal: state.routeController?.signal });
      if (!state.routeActive || generation !== state.routeGeneration || state.uid !== expectedUid || !accountCookieStillCurrent(expectedCookie)) return false;
      mergeTags(tags);
      const readiness = await ensureActiveGroups({ force });
      if (!state.routeActive || generation !== state.routeGeneration || state.uid !== expectedUid || !accountCookieStillCurrent(expectedCookie)) return false;
      const usable = setGroupReadinessStatus(`已同步 ${state.groupCache.groups.length} 个关注分组`, readiness);
      renderUi();
      await refilterAll();
      return usable;
    } catch (error) {
      if (error.code === "ABORTED") return false;
      if (!state.routeActive || generation !== state.routeGeneration || state.uid !== expectedUid || !accountCookieStillCurrent(expectedCookie)) return false;
      if (error.code === -101) transitionAccount(null, false);
      setStatus("warning", friendlyApiMessage(error, "关注分组同步失败"));
      renderUi();
      await refilterAll();
      return false;
    } finally {
      if (state.ui.refreshGroups) state.ui.refreshGroups.disabled = false;
    }
  }
  async function detectAccount({ signal } = {}) {
    const generation = state.routeGeneration;
    const cookieAtStart = cookieUid();
    let nextUid;
    let nextLoggedIn;
    let warning = null;
    try {
      const nav = await state.api.nav({ signal });
      if (!nav?.isLogin || !nav?.mid) {
        nextUid = null;
        nextLoggedIn = false;
      } else {
        nextUid = String(nav.mid);
        nextLoggedIn = true;
      }
    } catch (error) {
      if (error.code === "ABORTED") return { completed: false, changed: false, retry: false };
      if (error.code === -101) {
        nextUid = null;
        nextLoggedIn = false;
      } else {
        nextUid = cookieAtStart;
        nextLoggedIn = cookieAtStart ? null : false;
        warning = friendlyApiMessage(error, "登录状态检查失败");
      }
    }
    if (signal?.aborted || !state.routeActive || generation !== state.routeGeneration) {
      return { completed: false, changed: false, retry: false };
    }
    const cookieAtCommit = cookieUid();
    if (cookieAtCommit !== cookieAtStart) {
      return { completed: false, changed: false, retry: true };
    }
    const changed = transitionAccount(nextUid, nextLoggedIn);
    state.cookieUidSnapshot = cookieAtCommit;
    state.lastAccountCheckAt = Date.now();
    if (warning) setStatus("warning", warning);
    return { completed: true, changed };
  }
  function queueCards(elements) {
    if (!state.routeActive || state.destroyed) return;
    for (const element of elements) {
      if (element?.nodeType === 1) state.pendingCards.add(element);
    }
    if (state.scanFrame) return;
    state.scanFrame = requestAnimationFrame(flushCardQueue);
  }
  function flushCardQueue() {
    state.scanFrame = 0;
    if (!state.routeActive || state.destroyed) {
      state.pendingCards.clear();
      return;
    }
    const batch = [...state.pendingCards];
    state.pendingCards.clear();
    for (const wrapper of batch) processCardSafely(wrapper);
    updateStats();
  }
  function processCardSafely(wrapper, options) {
    try {
      processCard(wrapper, options);
      state.cardErrors.delete(wrapper);
      return true;
    } catch (error) {
      if (wrapper?.dataset) {
        delete wrapper.dataset.btfHiddenReason;
        delete wrapper.dataset.btfAuthorKnown;
      }
      state.cardSignatures.delete(wrapper);
      if (wrapper && !state.cardErrors.has(wrapper)) {
        state.cardErrors.add(wrapper);
        console.warn("[动态净览] 单张动态处理失败，已放行并继续处理后续卡片", error);
      }
      return false;
    }
  }
  function processCard(wrapper, { force = false } = {}) {
    if (!wrapper?.isConnected || !wrapper.matches?.(SELECTORS.wrapper)) return;
    const model = extractCardModel(wrapper, location.href);
    const signature = [
      model.identity,
      model.authorMid,
      model.authorName,
      model.type,
      model.typeKnown,
      model.linkKnown,
      model.primaryUrl,
      model.relatedUrls.join(","),
      fnv1a(model.text)
    ].join("|");
    const existingToolbar = wrapper.querySelector(".btf-card-tools");
    if (!force && state.cardSignatures.get(wrapper) === signature && existingToolbar && cardToolbarPlacementIsCurrent(wrapper, existingToolbar)) return;
    state.cardSignatures.set(wrapper, signature);
    wrapper.dataset.btfAuthorKnown = String(Boolean(model.authorMid));
    enhanceCard(wrapper);
    applyCardDecision(wrapper, model);
    updateWatchButton(wrapper, model);
  }
  function hiddenOriginFromModel(model) {
    return {
      identity: model.identity,
      persistable: model.persistable,
      authorMid: model.authorMid || null,
      url: model.linkKnown ? model.primaryUrl : "",
      aliasUrls: model.relatedUrls,
      migratedIdentity: model.persistable ? model.identity : null
    };
  }
  function hiddenWrapperIsContinuous(origin, model, trackedStableIdentity) {
    if (!origin) return false;
    if (trackedStableIdentity) return model.persistable && model.identity === trackedStableIdentity;
    if (origin.persistable) return model.persistable && model.identity === origin.identity;
    const originMid = origin.authorMid || null;
    const nextMid = model.authorMid || null;
    if (originMid && nextMid && originMid !== nextMid) return false;
    const originHasUrl = Boolean(origin.url);
    const nextHasUrl = Boolean(model.linkKnown);
    if (originHasUrl && nextHasUrl) {
      return sameWatchItem(origin, {
        url: model.primaryUrl,
        dynamicId: model.dynamicId,
        aliasUrls: model.relatedUrls
      });
    }
    if (originHasUrl !== nextHasUrl) return false;
    if (originMid && nextMid) return originMid === nextMid;
    if (model.persistable || originMid !== nextMid) return false;
    return true;
  }
  function applyCardDecision(wrapper, model) {
    if (!state.settings.enabled) {
      delete wrapper.dataset.btfHiddenReason;
      return;
    }
    if (state.sessionHiddenWrappers.has(wrapper)) {
      const trackedStableIdentity = state.sessionHiddenStableIds.get(wrapper);
      const origin = state.sessionHiddenOrigins.get(wrapper);
      if (!hiddenWrapperIsContinuous(origin, model, trackedStableIdentity)) {
        state.sessionHiddenWrappers.delete(wrapper);
        state.sessionHiddenStableIds.delete(wrapper);
        state.sessionHiddenOrigins.delete(wrapper);
      } else {
        if (model.persistable && !state.hiddenRecords[model.identity]) {
          state.hiddenRecords[model.identity] = Date.now();
          state.sessionHiddenStableIds.set(wrapper, model.identity);
          origin.migratedIdentity = model.identity;
          saveHiddenRecords();
        }
        wrapper.dataset.btfHiddenReason = "manual";
        return;
      }
    }
    const groupMap = areActiveGroupsReady() ? state.authorGroupsMap : null;
    const decision = evaluateCard(model, state.settings, {
      uid: state.uid,
      groupStates: currentGroupStates(),
      authorGroupsMap: groupMap,
      hiddenRecords: state.hiddenRecords
    });
    if (decision.visible) delete wrapper.dataset.btfHiddenReason;
    else wrapper.dataset.btfHiddenReason = decision.reason;
  }
  function actionButton(icon, label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btf-card-action";
    button.dataset.action = action;
    button.title = label;
    button.setAttribute("aria-label", label);
    const iconSpan = document.createElement("span");
    iconSpan.className = "btf-icon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.textContent = icon;
    const labelSpan = document.createElement("span");
    labelSpan.className = "btf-label";
    labelSpan.textContent = label;
    button.append(iconSpan, document.createTextNode(" "), labelSpan);
    return button;
  }
  function clearCardToolPlacement(root) {
    for (const host of root?.querySelectorAll?.("[data-btf-card-tools-host]") ?? []) {
      delete host.dataset.btfCardToolsHost;
    }
    for (const slot of root?.querySelectorAll?.("[data-btf-card-author-slot]") ?? []) {
      delete slot.dataset.btfCardAuthorSlot;
    }
  }
  function authorTitlePlacement(header) {
    const authorName = header.querySelector(SELECTORS.authorName);
    const title = authorName?.closest(".bili-dyn-title, [data-module='title']");
    if (!authorName || !title || title === header || !header.contains(title) || title.closest("a, button, label, [role='button'], [role='link']")) {
      return null;
    }
    let authorSlot = authorName;
    while (authorSlot.parentElement && authorSlot.parentElement !== title) {
      authorSlot = authorSlot.parentElement;
    }
    return authorSlot.parentElement === title ? { title, authorSlot } : null;
  }
  function cardToolbarPlacementIsCurrent(wrapper, toolbar) {
    const card = wrapper.querySelector(SELECTORS.card) ?? wrapper;
    const header = card.querySelector(".bili-dyn-item__header");
    if (!header) return false;
    const placement = authorTitlePlacement(header);
    if (placement) {
      return toolbar.dataset.placement === "author" && toolbar.parentElement === placement.title && toolbar.previousElementSibling === placement.authorSlot && placement.title.dataset.btfCardToolsHost === "author" && placement.authorSlot.dataset.btfCardAuthorSlot === "true";
    }
    return toolbar.dataset.placement === "header" && toolbar.parentElement === header;
  }
  function placeCardToolbar(wrapper, header, toolbar) {
    clearCardToolPlacement(wrapper);
    const placement = authorTitlePlacement(header);
    if (placement) {
      placement.title.dataset.btfCardToolsHost = "author";
      placement.authorSlot.dataset.btfCardAuthorSlot = "true";
      toolbar.dataset.placement = "author";
      placement.title.insertBefore(toolbar, placement.authorSlot.nextSibling);
      return;
    }
    toolbar.dataset.placement = "header";
    const more = header.querySelector(".bili-dyn-item__more");
    header.insertBefore(toolbar, more?.parentElement === header ? more : null);
  }
  function enhanceCard(wrapper) {
    const card = wrapper.querySelector(SELECTORS.card) ?? wrapper;
    const header = card.querySelector(".bili-dyn-item__header");
    if (!header) return;
    let toolbar = wrapper.querySelector(".btf-card-tools");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "btf-card-tools";
      toolbar.setAttribute("role", "group");
      toolbar.setAttribute("aria-label", "动态净览本地操作");
      const hide = actionButton("×", "隐藏", "hide");
      const watch = actionButton("☆", "本地稍后看", "watch");
      toolbar.append(hide, watch);
      toolbar.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        if (button.dataset.action === "hide") hideCard(wrapper, { focusUndo: event.detail === 0 });
        if (button.dataset.action === "watch") toggleWatchLater(wrapper);
      });
    }
    placeCardToolbar(wrapper, header, toolbar);
    wrapper.dataset.btfEnhanced = "true";
  }
  function hideCard(wrapper, { focusUndo = false } = {}) {
    if (!requireCurrentAccount()) return;
    const model = extractCardModel(wrapper, location.href);
    const hiddenOrigin = hiddenOriginFromModel(model);
    state.sessionHiddenWrappers.add(wrapper);
    state.sessionHiddenOrigins.set(wrapper, hiddenOrigin);
    if (model.persistable) {
      state.hiddenRecords[model.identity] = Date.now();
      state.sessionHiddenStableIds.set(wrapper, model.identity);
      saveHiddenRecords();
    }
    applyCardDecision(wrapper, model);
    updateStats();
    showToast(model.persistable ? "已在本机隐藏这条动态" : "本次浏览中已隐藏（未找到稳定动态 ID）", () => {
      delete state.hiddenRecords[model.identity];
      const migratedIdentity = hiddenOrigin.migratedIdentity;
      if (migratedIdentity) delete state.hiddenRecords[migratedIdentity];
      state.sessionHiddenWrappers.delete(wrapper);
      state.sessionHiddenStableIds.delete(wrapper);
      state.sessionHiddenOrigins.delete(wrapper);
      saveHiddenRecords();
      processCard(wrapper, { force: true });
      updateStats();
      if (focusUndo) window.setTimeout(() => wrapper.querySelector(".btf-card-action[data-action='hide']")?.focus(), 0);
    });
    if (focusUndo) window.setTimeout(() => state.ui.toastAction?.focus(), 0);
  }
  function watchItemFromModel(model) {
    return {
      id: watchKey(model.primaryUrl, model.dynamicId),
      dynamicId: model.dynamicId || void 0,
      url: model.primaryUrl,
      aliasUrls: model.relatedUrls,
      title: model.title,
      author: model.authorName || "未知作者",
      time: model.time,
      addedAt: Date.now()
    };
  }
  function toggleWatchLater(wrapper) {
    if (!requireCurrentAccount()) return;
    const model = extractCardModel(wrapper, location.href);
    if (!model.linkKnown) {
      showToast("这条动态没有可确认的详情链接，暂时无法加入稍后看");
      return;
    }
    const item = watchItemFromModel(model);
    const index = state.watchLater.findIndex((entry) => sameWatchItem(entry, item));
    if (index >= 0) {
      state.watchLater.splice(index, 1);
      showToast("已从本地稍后看移除");
    } else {
      state.watchLater = addWatchLater(state.watchLater, item);
      showToast("已加入本地稍后看");
    }
    saveWatchLater();
    updateWatchButton(wrapper, model);
    renderWatchLater();
  }
  function updateWatchButton(wrapper, model = extractCardModel(wrapper, location.href)) {
    const button = wrapper.querySelector(".btf-card-action[data-action='watch']");
    const hide = wrapper.querySelector(".btf-card-action[data-action='hide']");
    if (!button && !hide) return;
    if (!state.accountReady) {
      if (hide) {
        hide.disabled = true;
        hide.title = "正在确认账号";
        hide.setAttribute("aria-label", hide.title);
      }
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-pressed", "false");
        button.title = "正在确认账号";
        button.setAttribute("aria-label", button.title);
        button.querySelector(".btf-icon").textContent = "☆";
      }
      return;
    }
    if (hide) {
      hide.disabled = false;
      hide.title = "隐藏";
      hide.setAttribute("aria-label", hide.title);
    }
    if (!button) return;
    if (!model.linkKnown) {
      button.disabled = true;
      button.setAttribute("aria-pressed", "false");
      button.title = "未找到可确认的详情链接";
      button.setAttribute("aria-label", button.title);
      button.querySelector(".btf-icon").textContent = "☆";
      return;
    }
    button.disabled = false;
    const item = watchItemFromModel(model);
    const saved = state.watchLater.some((entry) => sameWatchItem(entry, item));
    button.setAttribute("aria-pressed", String(saved));
    button.title = saved ? "从本地稍后看移除" : "加入本地稍后看";
    button.setAttribute("aria-label", button.title);
    button.querySelector(".btf-icon").textContent = saved ? "★" : "☆";
  }
  function safeBilibiliUrl(raw) {
    try {
      const url = new URL(raw, PAGE_URL);
      return url.protocol === "https:" && (url.hostname === "bilibili.com" || url.hostname.endsWith(".bilibili.com")) ? url.href : PAGE_URL;
    } catch {
      return PAGE_URL;
    }
  }
  function renderWatchLater({ focusIndex = null } = {}) {
    if (!state.ui.watchList) return;
    state.ui.openWatch.textContent = `本地稍后看（${state.watchLater.length}）`;
    state.ui.watchList.replaceChildren();
    if (!state.watchLater.length) {
      const empty = document.createElement("div");
      empty.className = "watch-empty";
      empty.textContent = "还没有内容。把鼠标移到动态卡片上，点击“☆ 本地稍后看”即可收藏到这台设备。";
      state.ui.watchList.append(empty);
      if (focusIndex != null) state.ui.closeWatch?.focus({ preventScroll: true });
      return;
    }
    for (const item of state.watchLater) {
      const row = document.createElement("article");
      row.className = "watch-item";
      const body = document.createElement("div");
      const link = document.createElement("a");
      link.href = safeBilibiliUrl(item.url);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.title || "未命名动态";
      link.title = item.title || "未命名动态";
      const meta = document.createElement("div");
      meta.className = "watch-meta";
      meta.textContent = [item.author, item.time].filter(Boolean).join(" · ");
      body.append(link, meta);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "watch-remove";
      remove.textContent = "×";
      remove.title = "移除";
      remove.setAttribute("aria-label", `移除：${item.title || "未命名动态"}`);
      remove.addEventListener("click", () => {
        if (!requireCurrentAccount()) return;
        const removedIndex = state.watchLater.findIndex((entry) => sameWatchItem(entry, item));
        state.watchLater = state.watchLater.filter((entry) => !sameWatchItem(entry, item));
        saveWatchLater();
        renderWatchLater({ focusIndex: Math.max(0, Math.min(removedIndex, state.watchLater.length - 1)) });
        document.querySelectorAll(`${SELECTORS.wrapper}[data-btf-enhanced='true']`).forEach((wrapper) => updateWatchButton(wrapper));
      });
      row.append(body, remove);
      state.ui.watchList.append(row);
    }
    if (focusIndex != null) {
      const removeButtons = state.ui.watchList.querySelectorAll(".watch-remove");
      removeButtons[Math.min(focusIndex, removeButtons.length - 1)]?.focus({ preventScroll: true });
    }
  }
  function openWatchDrawer(open, { restoreFocus = true } = {}) {
    const shouldOpen = Boolean(open);
    if (!state.ui.drawer) return;
    if (shouldOpen) state.drawerReturnFocus = state.shadow?.activeElement ?? state.ui.openWatch;
    state.ui.drawer.classList.toggle("open", shouldOpen);
    state.ui.drawer.setAttribute("aria-hidden", String(!shouldOpen));
    state.ui.openWatch?.setAttribute("aria-expanded", String(shouldOpen));
    for (const element of [state.ui.panelHeader, state.ui.stats, state.ui.scrollArea, state.ui.panelFooter]) {
      if (!element) continue;
      element.inert = shouldOpen;
      if (shouldOpen) element.setAttribute("aria-hidden", "true");
      else element.removeAttribute("aria-hidden");
    }
    if (shouldOpen) {
      renderWatchLater();
      window.setTimeout(() => state.ui.closeWatch?.focus(), 0);
    } else if (restoreFocus) {
      const target = state.drawerReturnFocus;
      state.drawerReturnFocus = null;
      window.setTimeout(() => target?.isConnected && target.focus(), 0);
    }
  }
  function showToast(message, undo = null) {
    if (!state.ui.toastMessage || !state.ui.toastAction || !state.ui.toast) return;
    window.clearTimeout(state.toastTimer);
    state.toastUndo = undo;
    state.ui.toastMessage.textContent = String(message);
    state.ui.toastAction.hidden = typeof undo !== "function";
    state.ui.toast.classList.add("show");
    if (!state.ui.toast.contains(state.shadow?.activeElement)) scheduleToastHide(undo ? 6e3 : 3200);
  }
  function scheduleToastHide(delay) {
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(hideToast, delay);
  }
  function hideToast({ restoreFocus = true } = {}) {
    const hadFocus = Boolean(state.ui.toast?.contains(state.shadow?.activeElement));
    window.clearTimeout(state.toastTimer);
    state.toastTimer = 0;
    state.ui.toast?.classList.remove("show");
    state.toastUndo = null;
    if (hadFocus && restoreFocus) {
      const target = state.ui.drawer?.classList.contains("open") ? state.ui.closeWatch : state.settings.panelOpen ? preferredPanelFocusTarget() : state.ui.launcher;
      window.setTimeout(() => target?.isConnected && target.focus(), 0);
    }
  }
  function exportSettings() {
    commitKeywordDraft();
    const payload = {
      product: "B站动态净览",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      settings: state.settings
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bilibili-timeline-focus-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1e3);
    showToast("设置已导出（不含隐藏记录和稍后看）");
  }
  async function importSettings(event) {
    const [file] = event.target.files ?? [];
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      window.clearTimeout(state.keywordTimer);
      state.keywordTimer = 0;
      state.keywordDraft = null;
      state.settings = normalizeSettings(payload?.settings ?? payload);
      state.settings.panelOpen = true;
      state.panelResolvedDirection = null;
      saveSettings();
      renderUi();
      await ensureActiveGroups();
      await refilterAll();
      showToast("设置导入成功");
    } catch (error) {
      console.warn("[动态净览] 设置导入失败", error);
      showToast("设置文件无效，未做更改");
    }
  }
  async function clearHiddenRecords() {
    if (!requireCurrentAccount()) return;
    const now = Date.now();
    if (now > state.clearHiddenArmedUntil) {
      state.clearHiddenArmedUntil = now + 3500;
      state.ui.clearHidden.textContent = "再次点击确认";
      showToast("再次点击“恢复本地隐藏”以恢复当前账号的全部隐藏动态");
      window.clearTimeout(state.clearHiddenTimer);
      state.clearHiddenTimer = window.setTimeout(() => {
        state.clearHiddenTimer = 0;
        if (Date.now() > state.clearHiddenArmedUntil && state.ui.clearHidden) {
          state.ui.clearHidden.textContent = "恢复本地隐藏";
        }
      }, 3600);
      return;
    }
    state.hiddenRecords = {};
    state.sessionHiddenWrappers = /* @__PURE__ */ new WeakSet();
    state.sessionHiddenStableIds = /* @__PURE__ */ new WeakMap();
    state.sessionHiddenOrigins = /* @__PURE__ */ new WeakMap();
    Storage.remove(accountKey("hidden"));
    window.clearTimeout(state.clearHiddenTimer);
    state.clearHiddenTimer = 0;
    state.clearHiddenArmedUntil = 0;
    state.ui.clearHidden.textContent = "恢复本地隐藏";
    await refilterAll();
    showToast("已恢复当前账号在本机隐藏的动态");
  }
  async function resetSettings() {
    const now = Date.now();
    if (now > state.resetArmedUntil) {
      state.resetArmedUntil = now + 3500;
      state.ui.resetSettings.textContent = "再次点击确认";
      showToast("再次点击“恢复默认”以确认；隐藏记录和稍后看会保留");
      window.clearTimeout(state.resetTimer);
      state.resetTimer = window.setTimeout(() => {
        state.resetTimer = 0;
        if (Date.now() > state.resetArmedUntil && state.ui.resetSettings) state.ui.resetSettings.textContent = "恢复默认";
      }, 3600);
      return;
    }
    const panelOpen = true;
    window.clearTimeout(state.keywordTimer);
    state.keywordTimer = 0;
    state.keywordDraft = null;
    state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, panelOpen });
    state.panelResolvedDirection = null;
    saveSettings();
    window.clearTimeout(state.resetTimer);
    state.resetTimer = 0;
    state.resetArmedUntil = 0;
    state.ui.resetSettings.textContent = "恢复默认";
    renderUi();
    await refilterAll();
    showToast("设置已恢复默认");
  }
  async function refilterAll() {
    const token = ++state.refilterToken;
    const generation = state.routeGeneration;
    const wrappers = [...document.querySelectorAll(SELECTORS.wrapper)];
    let index = 0;
    return new Promise((resolve) => {
      const run = () => {
        if (state.destroyed || !state.routeActive || token !== state.refilterToken || generation !== state.routeGeneration) {
          resolve(false);
          return;
        }
        const end = Math.min(index + 40, wrappers.length);
        for (; index < end; index += 1) processCardSafely(wrappers[index], { force: true });
        if (index < wrappers.length) requestAnimationFrame(run);
        else {
          updateStats();
          resolve(true);
        }
      };
      run();
    });
  }
  function updateStats() {
    const wrappers = [...document.querySelectorAll(SELECTORS.wrapper)];
    const hidden = wrappers.filter((wrapper) => wrapper.hasAttribute("data-btf-hidden-reason")).length;
    const groupFiltering = activeGroupIds().length > 0;
    const unknown = groupFiltering ? wrappers.filter((wrapper) => wrapper.dataset.btfAuthorKnown === "false").length : 0;
    state.stats = {
      total: wrappers.length,
      visible: wrappers.length - hidden,
      hidden,
      unknown
    };
    renderStats();
    updateEmptyNotice();
  }
  function updateEmptyNotice() {
    if (!state.list?.isConnected) return;
    const shouldShow = state.settings.enabled && state.stats.total > 0 && state.stats.visible === 0;
    if (!shouldShow) {
      state.emptyNotice?.remove();
      state.emptyNotice = null;
      return;
    }
    if (!state.emptyNotice?.isConnected) {
      const notice = document.createElement("div");
      notice.className = "btf-feed-empty";
      notice.textContent = "当前条件下没有匹配的动态。可在“动态净览”中清空条件，或继续向下滚动加载更多。";
      state.list.insertAdjacentElement("afterend", notice);
      state.emptyNotice = notice;
    }
  }
  function bindList() {
    state.bindFrame = 0;
    if (!state.routeActive || state.destroyed) return;
    const list = document.querySelector(SELECTORS.list);
    if (!list) {
      setStatus(state.loggedIn === false ? "login" : "waiting", state.loggedIn === false ? "请先登录 B 站；其他筛选仍可使用" : "正在等待动态列表…");
      return;
    }
    if (state.list === list && state.listObserver) return;
    state.listObserver?.disconnect();
    state.list = list;
    state.listObserver = new MutationObserver((mutations) => {
      const wrappers = [];
      for (const mutation of mutations) {
        const targetElement = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        if (targetElement?.closest?.(".btf-card-tools")) continue;
        if (mutation.type === "attributes" || mutation.type === "characterData") {
          const closest = targetElement?.closest?.(SELECTORS.wrapper);
          if (closest) wrappers.push(closest);
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 3) {
            const closest2 = node.parentElement?.closest?.(SELECTORS.wrapper);
            if (closest2) wrappers.push(closest2);
            continue;
          }
          if (node.nodeType !== 1 || node.closest?.(".btf-card-tools")) continue;
          const closest = node.closest?.(SELECTORS.wrapper);
          if (closest) wrappers.push(closest);
          wrappers.push(...collectCardWrappers(node));
        }
      }
      if (wrappers.length) queueCards(wrappers);
    });
    state.listObserver.observe(list, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-mid", "data-did", "data-url", "dyn-id", "href", "class"]
    });
    queueCards(collectCardWrappers(list));
    if (state.loggedIn !== false && state.status.kind === "waiting") setStatus("ready", "动态列表已连接");
  }
  function queueBindList() {
    if (state.bindFrame || !state.routeActive) return;
    state.bindFrame = requestAnimationFrame(bindList);
  }
  function observePage() {
    state.bodyObserver?.disconnect();
    state.bodyObserver = new MutationObserver((mutations) => {
      queueAccountRecheck();
      if (!state.list?.isConnected) {
        queueBindList();
        return;
      }
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && (node.matches?.(SELECTORS.list) || node.querySelector?.(SELECTORS.list))) {
            queueBindList();
            return;
          }
        }
      }
    });
    state.bodyObserver.observe(document.body, { childList: true, subtree: true });
  }
  function clearOurCardChanges() {
    document.querySelectorAll(SELECTORS.wrapper).forEach((wrapper) => {
      delete wrapper.dataset.btfHiddenReason;
      delete wrapper.dataset.btfEnhanced;
      delete wrapper.dataset.btfAuthorKnown;
      wrapper.querySelector(".btf-card-tools")?.remove();
      clearCardToolPlacement(wrapper);
    });
    state.emptyNotice?.remove();
    state.emptyNotice = null;
  }
  async function activateRoute() {
    if (state.routeActive || state.destroyed) return;
    const generation = ++state.routeGeneration;
    state.routeActive = true;
    state.routeController?.abort();
    state.routeController = new AbortController();
    resetAccountForDetection();
    mountUi();
    observePage();
    bindList();
    setStatus("loading", "正在检查登录状态…");
    const accountPromise = detectAccount({ signal: state.routeController.signal });
    state.accountCheckPromise = accountPromise;
    let accountResult;
    try {
      accountResult = await accountPromise;
    } finally {
      if (state.accountCheckPromise === accountPromise) state.accountCheckPromise = null;
    }
    if (!accountResult.completed || !state.routeActive || generation !== state.routeGeneration) {
      if (accountResult.retry && state.routeActive && generation === state.routeGeneration) retryAccountCheckSoon();
      return;
    }
    renderUi();
    await refilterAll();
    if (!state.routeActive || generation !== state.routeGeneration) return;
    if (state.loggedIn === false) {
      setStatus("login", "请先登录 B 站；其他筛选仍可使用");
      return;
    }
    await refreshGroups({ generation });
  }
  function suspendRoute() {
    if (!state.routeActive) return;
    commitKeywordDraft({ refilter: false });
    state.routeGeneration += 1;
    state.refilterToken += 1;
    state.routeActive = false;
    state.routeController?.abort();
    state.routeController = null;
    state.listObserver?.disconnect();
    state.listObserver = null;
    state.bodyObserver?.disconnect();
    state.bodyObserver = null;
    state.list = null;
    abortGroupLoads();
    if (state.scanFrame) cancelAnimationFrame(state.scanFrame);
    if (state.bindFrame) cancelAnimationFrame(state.bindFrame);
    if (state.panelFrame) cancelAnimationFrame(state.panelFrame);
    state.scanFrame = 0;
    state.bindFrame = 0;
    state.panelFrame = 0;
    state.launcherAnchor = null;
    state.panelResolvedDirection = null;
    state.panelResizeObserver?.disconnect();
    state.panelResizeObserver = null;
    state.pendingCards.clear();
    window.clearTimeout(state.keywordTimer);
    window.clearTimeout(state.toastTimer);
    window.clearTimeout(state.accountRecheckTimer);
    window.clearTimeout(state.resetTimer);
    window.clearTimeout(state.clearHiddenTimer);
    state.keywordTimer = 0;
    state.toastTimer = 0;
    state.accountRecheckTimer = 0;
    state.resetTimer = 0;
    state.clearHiddenTimer = 0;
    state.resetArmedUntil = 0;
    state.clearHiddenArmedUntil = 0;
    state.toastUndo = null;
    state.accountReady = false;
    state.accountRecheckPending = false;
    clearOurCardChanges();
    clearLayoutSettings();
    document.removeEventListener("keydown", handleGlobalKeydown);
    window.removeEventListener("resize", handleViewportChange);
    window.removeEventListener("orientationchange", handleViewportChange);
    window.visualViewport?.removeEventListener("resize", handleViewportChange);
    window.visualViewport?.removeEventListener("scroll", handleViewportChange);
    state.root?.remove();
    state.root = null;
    state.shadow = null;
    state.ui = {};
  }
  function reconcileRoute() {
    if (isFeedRoute()) {
      void activateRoute().catch((error) => reportRuntimeError("动态页初始化失败", error));
    } else suspendRoute();
  }
  function recheckAccountOnResume() {
    if (document.hidden || !state.routeActive || state.destroyed) return;
    const currentCookie = cookieUid();
    const cookieChanged = currentCookie !== state.cookieUidSnapshot;
    if (cookieChanged) quarantineAccountChange(currentCookie);
    if (state.accountCheckPromise) {
      if (cookieChanged || !state.accountReady) state.accountRecheckPending = true;
      return;
    }
    if (state.accountReady && !cookieChanged && Date.now() - state.lastAccountCheckAt < 3e4) return;
    state.accountRecheckPending = false;
    const generation = state.routeGeneration;
    const promise = (async () => {
      const result = await detectAccount({ signal: state.routeController?.signal });
      if (!result.completed || !state.routeActive || generation !== state.routeGeneration) {
        if (result.retry && state.routeActive && generation === state.routeGeneration) retryAccountCheckSoon();
        return;
      }
      renderUi();
      if (result.changed) {
        await refilterAll();
        if (!state.accountReady || !state.routeActive || generation !== state.routeGeneration) return;
        if (state.uid) await refreshGroups({ generation });
        else {
          setStatus("login", "请先登录 B 站；其他筛选仍可使用");
        }
      }
    })().catch((error) => reportRuntimeError("重新检查账号失败", error)).finally(() => {
      if (state.accountCheckPromise === promise) state.accountCheckPromise = null;
      if (state.routeActive && !state.destroyed && (state.accountRecheckPending || !state.accountReady)) {
        state.accountRecheckPending = false;
        retryAccountCheckSoon();
      }
    });
    state.accountCheckPromise = promise;
  }
  function installRouteHooks() {
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      const wrapped = function(...args) {
        const result = original.apply(this, args);
        queueMicrotask(reconcileRoute);
        return result;
      };
      history[method] = wrapped;
      state.historyHooks.push({ method, original, wrapped });
    }
    window.addEventListener("popstate", reconcileRoute);
    window.addEventListener("hashchange", reconcileRoute);
    window.addEventListener("pageshow", recheckAccountOnResume);
    document.addEventListener("visibilitychange", recheckAccountOnResume);
  }
  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    suspendRoute();
    window.removeEventListener("popstate", reconcileRoute);
    window.removeEventListener("hashchange", reconcileRoute);
    window.removeEventListener("pageshow", recheckAccountOnResume);
    document.removeEventListener("visibilitychange", recheckAccountOnResume);
    document.removeEventListener("keydown", handleGlobalKeydown);
    for (const { method, original, wrapped } of state.historyHooks) {
      if (history[method] === wrapped) history[method] = original;
    }
    document.getElementById(GLOBAL_STYLE_ID)?.remove();
    clearLayoutSettings();
    if (window[INSTANCE_KEY]?.destroy === destroy) delete window[INSTANCE_KEY];
  }
  async function start() {
    if (window.top !== window.self) return;
    window[INSTANCE_KEY]?.destroy?.();
    window[INSTANCE_KEY] = { destroy, version: VERSION };
    installRouteHooks();
    if (document.readyState === "loading") {
      await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
    }
    reconcileRoute();
  }
  start().catch((error) => {
    console.error("[动态净览] 启动失败", error);
    setStatus("error", "脚本启动失败，页面内容未被更改");
  });
})();
