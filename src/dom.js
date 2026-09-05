import { classifyCardFromSignals, fnv1a } from "./core.js";

export const SELECTORS = Object.freeze({
  list: ".bili-dyn-list__items",
  wrapper: ".bili-dyn-list__item",
  card: ".bili-dyn-item",
  authorName: ".bili-dyn-title__text",
  time: ".bili-dyn-time",
});

export function extractMidFromHref(href) {
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

function absoluteUrl(raw, baseUrl) {
  if (!raw) return "";
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return String(raw);
  }
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

export function collectCardWrappers(root) {
  if (!root || root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return [];
  const wrappers = [];
  if (root.matches?.(SELECTORS.wrapper)) wrappers.push(root);
  root.querySelectorAll?.(SELECTORS.wrapper).forEach((element) => wrappers.push(element));
  if (!wrappers.length && root.matches?.(SELECTORS.card)) wrappers.push(root.closest(SELECTORS.wrapper) ?? root);
  return [...new Set(wrappers)];
}

export function extractAuthorMid(wrapper) {
  const card = wrapper.matches?.(SELECTORS.card) ? wrapper : wrapper.querySelector(SELECTORS.card) ?? wrapper;
  const header = card.querySelector(".bili-dyn-item__header");
  const directHeaderMid = readAttributeMid(header);
  if (directHeaderMid) return directHeaderMid;
  const prioritySelectors = [
    "[data-module='author'][data-mid]",
    ".bili-dyn-avatar[data-mid]",
    ".bili-dyn-item__following[data-mid]",
    "[data-mid]",
  ];
  for (const selector of prioritySelectors) {
    const target = header?.querySelector(selector);
    const mid = readAttributeMid(target);
    if (mid) return mid;
  }

  // Only inspect the outer card header. Space links in the body can belong to
  // an @mention or to the original author of a forwarded post.
  for (const link of header?.querySelectorAll("a[href*='space.bilibili.com/']") ?? []) {
    const mid = extractMidFromHref(link.getAttribute("href") ?? link.href);
    if (mid) return mid;
  }

  // Current Bilibili still exposes this Vue 2 instance in page context. It is
  // intentionally the final fallback: every public DOM signal above wins.
  const vueMid = card.__vue__?.author?.mid
    ?? card.__vue__?.data?.modules?.module_author?.mid
    ?? wrapper.__vue__?.author?.mid;
  return /^\d+$/.test(String(vueMid ?? "")) ? String(vueMid) : null;
}

export function extractDynamicId(wrapper, baseUrl = "https://t.bilibili.com/") {
  const card = wrapper.matches?.(SELECTORS.card) ? wrapper : wrapper.querySelector?.(SELECTORS.card);
  const direct = [
    wrapper.getAttribute?.("data-did"),
    wrapper.dataset?.did,
    card?.getAttribute?.("data-did"),
    card?.dataset?.did,
  ].find((value) => /^\d{5,}$/.test(String(value ?? "")));
  if (direct) return String(direct);

  // A post linked from the body (or inside a forwarded card) is not the
  // identity of the outer timeline item. Only the outer timestamp is safe.
  for (const element of card?.querySelectorAll?.(".bili-dyn-item__header .bili-dyn-time[href], .bili-dyn-item__header .bili-dyn-time a[href]") ?? []) {
    const raw = element.getAttribute("href");
    const id = dynamicIdFromUrl(trustedBilibiliUrl(raw, baseUrl));
    if (id) return id;
  }
  return null;
}

export function classifyElement(wrapper) {
  const query = (selector) => Boolean(wrapper.querySelector(selector));
  const signals = {
    forward: query(".bili-dyn-content__forw, .bili-dyn-content__orig.reference"),
    live: query(".bili-dyn-card-live, [class*='dyn-card-live']"),
    pgc: query(".bili-dyn-card-pgc, .bili-dyn-card-subscription"),
    video: query(".bili-dyn-card-video, .bili-dyn-card-ugc"),
    image: query(".dyn-card-opus, .bili-album, .bili-dyn-card-article, .bili-dyn-card-common"),
    other: query(".bili-dyn-content, .bili-dyn-content__orig"),
  };
  const type = classifyCardFromSignals(signals);
  return { type, typeKnown: type !== "unknown", signals };
}

export function findTrustedUrls(wrapper, baseUrl = "https://t.bilibili.com/") {
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
    ".dyn-card-opus [data-url]",
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

export function findPrimaryUrl(wrapper, baseUrl = "https://t.bilibili.com/") {
  return findTrustedUrls(wrapper, baseUrl)[0] ?? "";
}

export function extractCardModel(wrapper, baseUrl = "https://t.bilibili.com/") {
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
    ".bili-dyn-card-article__title",
  ]);
  // Our own buttons live inside the card header. Exclude them from keyword
  // matching and fingerprints so rules such as “隐藏” do not match every card.
  const textSource = card.cloneNode(true);
  textSource.querySelectorAll(".btf-card-tools").forEach((element) => element.remove());
  const rawText = String(textSource.innerText ?? textSource.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 20_000);
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
    typeKnown: classification.typeKnown,
  };
}
