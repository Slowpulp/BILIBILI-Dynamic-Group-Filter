import { classifyCardFromSignals, fnv1a } from "./core.js";
import { createContentSignals } from "./content-filter.js";

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

function cardTextWithoutOwnUi(card) {
  const textSource = card.cloneNode(true);
  textSource.querySelectorAll(".btf-card-tools, .btf-card-collapse-toggle, [data-btf-owned]").forEach((element) => element.remove());
  return String(textSource.innerText ?? textSource.textContent ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim()
    .slice(0, 20_000);
}

function elementHasText(root, selector, pattern) {
  for (const element of root.querySelectorAll(selector)) {
    const text = String(element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (pattern.test(text)) return true;
  }
  return false;
}

const PRODUCT_COMPONENT_SELECTOR = [
  ".bili-dyn-card-goods",
  ".bili-dyn-card-goods__item",
  ".dyn-card-goods",
  "[class*='goods-card']",
  "[class*='goods_card']",
  "[class*='product-card']",
  "[data-module='goods']",
  "[data-type='goods']",
  "[data-dyn-card-type='goods']",
].join(", ");
const PRODUCT_RECOMMENDATION_PATTERN = /up\s*主(?:的)?推荐|商品推荐/iu;
const EXACT_PRODUCT_RECOMMENDATION_PATTERN = /^(?:up\s*主(?:的)?推荐|商品推荐)$/iu;
const PURCHASE_BUTTON_PATTERN = /^(?:去看看|立即购买|去购买|购买|抢购|立即抢购|领取|领券)$/iu;

function elementText(element) {
  return String(element?.innerText ?? element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function hasExactProductLabel(root) {
  return elementHasText(root, "*", EXACT_PRODUCT_RECOMMENDATION_PATTERN);
}

function hasPurchaseControl(root) {
  return elementHasText(root, "a, button, [role='button']", PURCHASE_BUTTON_PATTERN);
}

function productComponentRoots(card) {
  const explicitRoots = [];
  if (card.matches?.(PRODUCT_COMPONENT_SELECTOR)) explicitRoots.push(card);
  card.querySelectorAll(PRODUCT_COMPONENT_SELECTOR).forEach((element) => explicitRoots.push(element));

  // Some current cards reuse the generic common-card shell for goods. Treat
  // one as a product component only when it contains both a standalone Bili
  // recommendation label and a purchase control. An article preview whose
  // title merely mentions “商品推荐算法” therefore stays a normal card.
  const genericRoots = [...card.querySelectorAll(".bili-dyn-card-common")]
    .filter((element) => hasExactProductLabel(element) && hasPurchaseControl(element));
  return [...new Set([...explicitRoots, ...genericRoots])];
}

const COMMERCE_HOSTS = Object.freeze([
  "mall.bilibili.com",
  "cm.bilibili.com",
  "taobao.com",
  "tmall.com",
  "jd.com",
  "meituan.com",
  "pinduoduo.com",
  "yangkeduo.com",
  "ele.me",
  "vip.com",
]);

function findCommerceHosts(card, baseUrl) {
  const hosts = [];
  for (const link of card.querySelectorAll("a[href]")) {
    try {
      const hostname = new URL(link.getAttribute("href"), baseUrl).hostname.toLocaleLowerCase("en-US");
      if (!COMMERCE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) continue;
      if (!hosts.includes(hostname)) hosts.push(hostname);
    } catch {
      // Ignore malformed or script-only href values.
    }
  }
  return hosts;
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

/**
 * Extracts only conservative DOM facts here; semantic classification remains
 * a pure operation in content-filter.js and can therefore be unit-tested.
 */
export function extractContentFilterSignals(wrapper, baseUrl = "https://t.bilibili.com/", knownText = null) {
  const card = wrapper.matches?.(SELECTORS.card) ? wrapper : wrapper.querySelector?.(SELECTORS.card) ?? wrapper;
  const text = typeof knownText === "string" ? knownText : cardTextWithoutOwnUi(card);
  const commerceHosts = findCommerceHosts(card, baseUrl);
  const productRoots = productComponentRoots(card);
  const hasProductComponent = productRoots.length > 0;
  const hasGiveawayModule = Boolean(card.querySelector([
    ".bili-dyn-card-lottery",
    ".dyn-card-lottery",
    "[class*='lottery-card']",
    "[data-module='lottery']",
    "[data-type='lottery']",
  ].join(", ")));

  return createContentSignals({
    text,
    hasProductComponent,
    hasProductRecommendationLabel: productRoots
      .some((element) => PRODUCT_RECOMMENDATION_PATTERN.test(elementText(element))),
    hasPurchaseButton: productRoots.some((element) => hasPurchaseControl(element)),
    hasCommerceLink: commerceHosts.length > 0,
    commerceHosts,
    hasGiveawayModule,
  });
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
  // Our own buttons live inside the card header. Exclude them from matching
  // and fingerprints so labels such as “隐藏” do not become content signals.
  const rawText = cardTextWithoutOwnUi(card);
  const dynamicId = extractDynamicId(wrapper, baseUrl);
  const relatedUrls = findTrustedUrls(wrapper, baseUrl);
  const discoveredUrl = relatedUrls[0] ?? "";
  const classification = classifyElement(wrapper);
  const contentSignals = extractContentFilterSignals(wrapper, baseUrl, rawText);
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
    contentSignals,
  };
}
