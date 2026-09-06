export const CONTENT_SIGNAL_VERSION = 1;

export const CONTENT_FILTER_CATEGORIES = Object.freeze([
  "promotion",
  "giveaway",
]);

const PLATFORM_PATTERNS = Object.freeze([
  ["美团", /美团/iu],
  ["淘宝/天猫", /淘宝|桃宝|某宝|天猫|淘特/iu],
  ["京东", /京东|京喜/iu],
  ["拼多多", /拼多多|多多买菜/iu],
  ["抖音商城", /抖音(?:商城|小店)/iu],
  ["快手小店", /快手(?:小店|商城)/iu],
  ["饿了么", /饿了么/iu],
  ["唯品会", /唯品会/iu],
  ["苏宁", /苏宁(?:易购)?/iu],
  ["得物", /得物(?:app)?/iu],
]);

const APP_SEARCH_PATTERN = /(?:(?:app|客户端|平台)\s*(?:内|里)?\s*(?:搜|搜索|查找)|(?:快去|打开|上)\s*(?:美团|淘宝|桃宝|某宝|天猫|京东|拼多多|抖音|快手|饿了么|唯品会|苏宁|得物)\s*(?:app|客户端)?\s*(?:搜|搜索|查找)|(?:美团|淘宝|桃宝|某宝|天猫|京东|拼多多|抖音|快手|饿了么|唯品会|苏宁|得物)\s*(?:app|客户端)?\s*(?:搜|搜索|查找))/iu;
const PROMOTION_CODE_PATTERN = /(?:口令|暗号|密令|券码|助力码|邀请码|复制|(?:搜|搜索|查找)(?:索)?)[^,，。!！?？;；\n]{0,12}(?:[a-z\d]{5,24}|￥[^￥\s]{3,30}￥)|(?:\d{0,2}\s*)?copy\s*这条(?:信息|消息)[^,，。!！?？;；\n]{0,24}[a-z\d]{7,30}/iu;
const COUPON_PATTERN = /优惠券|代金券|满减|折扣券|补贴|无门槛|红包|返现|立减|券后|领券|\d+(?:\.\d+)?\s*元?券/iu;
const PRICE_PATTERN = /(?:￥|¥)\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*(?:元|块)(?:\s*(?:起|到手))?|(?:到手|仅需|低至|秒杀价|活动价|券后价)[^,，。!！?？;；\n]{0,10}\d+(?:\.\d{1,2})?/iu;
const URGENCY_PATTERN = /大漏|薅羊毛|秒杀|快冲|手慢无|限时|疯抢|抢到就是赚|赶紧冲|疯狂放水|神价|白菜价/iu;
const COMMERCIAL_CTA_PATTERN = /立即购买|去看看|去购买|去抢购|立即抢购|下单|包邮|同款|购买链接|商品链接|快去[^,，。!！?？;；\n]{0,12}(?:搜|买|领)/iu;
const GIVEAWAY_MENTION_PATTERN = /抽奖|开奖|中奖|获奖/iu;
const STRONG_GIVEAWAY_PATTERN = /(?:互动抽奖|福利抽奖|抽奖活动|转发抽奖)(?!\s*(?:机制|教程|分析|设计|是否|新闻|报道))|(?:给|为)[^,，。!！?？;；\n]{0,8}(?:大家|粉丝)[^,，。!！?？;；\n]{0,5}抽(?:一个|一位|一名|取|送)|抽(?:一|二|三|四|五|六|七|八|九|十|\d+|几|若干)(?:个|位|名|份)|(?:^|[^\p{L}\p{N}])(?:(?:本次|本期|今日|今天)\s*)?抽奖\s*[:：]/iu;
const PARTICIPATION_CUE_PATTERN = /即可参与|可参与|参与(?:本次)?抽奖|参加(?:本次)?抽奖|抽奖条件|参与条件|参与(?:方式|规则|要求)/iu;
const DRAW_INFO_PATTERN = /(?:周[一二三四五六日天]|星期[一二三四五六日天]|今天|今日|今晚|明天|明日|\d+\s*天后|\d{1,2}\s*[月/-]\s*\d{1,2}\s*(?:日|号)?)[^,，。!！?？;；\n]{0,10}开奖|开奖(?:时间|日期)|(?:届时|准时|随机|统一)\s*开奖|截止[^,，。!！?？;；\n]{0,16}(?:参与|抽奖)|获奖名单|抽奖结果/iu;
const PRIZE_PATTERN = /奖品|赠送|送出|(?:抽(?:取|出)?|送(?:出)?)[^,，。!！?？;；\n]{0,8}(?:一|二|三|四|五|六|七|八|九|十|\d+|几|若干)(?:份|个|位|名|台|套)|(?:现金|红包|兑换码|激活码|周边|会员|游戏)[^,，。!！?？;；\n]{0,8}(?:奖品|赠送|送出)/iu;
const DISCUSSION_CONTEXT_PATTERN = /讨论|分析|机制|教程|如何|是否|为什么|科普|防骗|诈骗|骗局|新闻|报道/iu;
const COMMERCIAL_DISCUSSION_PATTERN = /讨论|分析|机制|设计|体验|评测|测评|数据库|发展史|科普|反诈|新闻|报道/iu;
const EDUCATIONAL_COMMERCIAL_CONTEXT_PATTERN = /教程|讨论|分析|机制|设计|体验|评测|测评|科普|研究|说明/iu;
const EXPLANATORY_EXAMPLE_PATTERN = /示例|举例|例子|仅作(?:演示|说明|测试)|用于(?:演示|说明|测试)|测试(?:商品|数据|字段|页面|用例)|(?:字段|文案|页面|功能)(?:只是|仅是|作为)?(?:示例|测试)|如何(?:设计|实现)|设计思路/iu;
const SAFETY_WARNING_PATTERN = /反诈|谨防|警惕|避坑|曝光|揭露|(?:骗局|诈骗|骗术|虚假)(?:提醒|警示|曝光|揭露|分析)|(?:请勿|不要|别)(?:参与|购买|下单|复制|搜索|相信)/iu;
const EXPLICIT_CODE_CUE_PATTERN = /口令|暗号|密令|券码|助力码|邀请码|(?:\d{0,2}\s*)?copy\s*这条(?:信息|消息)/iu;
const ACTIONABLE_PURCHASE_PATTERN = /立即购买|去购买|去抢购|立即抢购|立即下单|下单购买|购买链接|商品链接|点击[^,，。!！?？;；\n]{0,10}(?:购买|下单|领券)|快去[^,，。!！?？;；\n]{0,12}(?:买|领券)|领券[^,，。!！?？;；\n]{0,8}(?:下单|购买)/iu;
const GIVEAWAY_SAFETY_PATTERN = /抽奖(?:套路|骗局|骗术|话术)|套路(?:揭秘|曝光|分析)|揭秘[^,，。!！?？;；\n]{0,12}(?:抽奖|话术)|警惕[^,，。!！?？;；\n]{0,12}(?:抽奖|开奖|中奖|话术)|(?:反诈|防骗|避坑|曝光|揭露)[^,，。!！?？;；\n]{0,12}(?:抽奖|开奖|中奖|套路|话术)|(?:这种|此类)(?:抽奖|开奖|中奖)?话术[^,，。!！?？;；\n]{0,8}(?:要)?警惕/iu;

const GIVEAWAY_ACTION_PATTERNS = Object.freeze([
  ["关注", /关注/iu],
  ["转发", /转发/iu],
  ["评论", /评论/iu],
  ["点赞", /点赞/iu],
  ["三连", /三连/iu],
  ["@好友", /@\s*(?:好友|一位|两位|三位|\d+位)/iu],
]);

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim()
    .slice(0, 20_000);
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function detectedPlatforms(text) {
  return PLATFORM_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
}

function detectedGiveawayActions(text) {
  return GIVEAWAY_ACTION_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
}

function splitClauses(text) {
  return text
    .split(/[,，。.!！?？;；\n]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function hasParticipationCondition(text, actions, hasStrongGiveawayCall) {
  if (!actions.length) return false;
  let previousSegmentWasCall = false;
  return splitClauses(text).some((segment) => {
    if (DISCUSSION_CONTEXT_PATTERN.test(segment)) {
      previousSegmentWasCall = false;
      return false;
    }
    const actionCount = GIVEAWAY_ACTION_PATTERNS
      .filter(([, pattern]) => pattern.test(segment))
      .length;
    const segmentIsCall = STRONG_GIVEAWAY_PATTERN.test(segment);
    const explicitCondition = actionCount > 0 && PARTICIPATION_CUE_PATTERN.test(segment);
    const implicitCondition = hasStrongGiveawayCall
      && actionCount >= 2
      && (segmentIsCall || previousSegmentWasCall);
    previousSegmentWasCall = segmentIsCall;
    return explicitCondition || implicitCondition;
  });
}

/**
 * Converts text and conservative DOM facts into a serializable rule input.
 * This function never decides whether a card should be hidden.
 */
export function createContentSignals(input = {}) {
  const text = normalizeText(input.text);
  const platforms = detectedPlatforms(text);
  const giveawayActions = detectedGiveawayActions(text);
  const hasGiveawayMention = GIVEAWAY_MENTION_PATTERN.test(text);
  const hasStrongGiveawayCall = STRONG_GIVEAWAY_PATTERN.test(text);

  return {
    signalVersion: CONTENT_SIGNAL_VERSION,
    text,
    structured: {
      productComponent: input.hasProductComponent === true,
      // Recommendation labels are structural evidence only when the DOM
      // extractor found them inside a credible product component. Plain body
      // prose such as “商品推荐算法” must never manufacture this signal.
      productRecommendationLabel: input.hasProductRecommendationLabel === true,
      purchaseButton: input.hasPurchaseButton === true,
      commerceLink: input.hasCommerceLink === true,
      giveawayModule: input.hasGiveawayModule === true,
      commerceHosts: uniqueStrings(input.commerceHosts),
    },
    promotion: {
      platforms,
      appSearch: APP_SEARCH_PATTERN.test(text),
      promotionCode: PROMOTION_CODE_PATTERN.test(text),
      couponOrDiscount: COUPON_PATTERN.test(text),
      price: PRICE_PATTERN.test(text),
      urgency: URGENCY_PATTERN.test(text),
      commercialCallToAction: COMMERCIAL_CTA_PATTERN.test(text),
    },
    giveaway: {
      mention: hasGiveawayMention,
      strongCall: hasStrongGiveawayCall,
      participationCondition: hasParticipationCondition(text, giveawayActions, hasStrongGiveawayCall),
      actions: giveawayActions,
      drawInfo: DRAW_INFO_PATTERN.test(text),
      prize: PRIZE_PATTERN.test(text),
    },
  };
}

function isContentSignals(value) {
  return Boolean(value)
    && value.signalVersion === CONTENT_SIGNAL_VERSION
    && value.structured
    && value.promotion
    && value.giveaway;
}

function resultFor(category, confidence, score, reasons, reasonCodes) {
  const matched = confidence === "high" || confidence === "medium";
  return {
    category,
    matched,
    confidence,
    suggestedAction: confidence === "high" ? "hide" : confidence === "medium" ? "collapse" : "show",
    score,
    detail: reasons.join("；"),
    reasons,
    reasonCodes,
  };
}

function analyzePromotion(signals) {
  const { structured, promotion } = signals;
  const reasons = [];
  const reasonCodes = [];
  let score = 0;

  const addReason = (condition, points, code, label) => {
    if (!condition) return;
    score += points;
    reasonCodes.push(code);
    reasons.push(label);
  };

  addReason(structured.productComponent, 100, "product-component", "检测到明确的商品组件");
  addReason(structured.productRecommendationLabel, 45, "product-recommendation", "出现“UP主推荐/商品推荐”标识");
  addReason(structured.purchaseButton, 25, "purchase-button", "包含购买或查看商品按钮");
  addReason(structured.commerceLink, 35, "commerce-link", "包含已知购物平台链接");
  addReason(promotion.platforms.length > 0, 20, "commerce-platform", `提到购物平台：${promotion.platforms.join("、")}`);
  addReason(promotion.appSearch, 30, "app-search", "包含 App 搜索引导");
  addReason(promotion.promotionCode, 25, "promotion-code", "包含搜索口令或优惠码");
  addReason(promotion.couponOrDiscount, 20, "coupon-or-discount", "包含优惠券、满减或补贴信息");
  addReason(promotion.price, 15, "price", "包含明确价格信息");
  addReason(promotion.urgency, 8, "promotion-urgency", "包含促销催促话术");
  addReason(promotion.commercialCallToAction, 12, "commercial-cta", "包含购买或领取引导");

  const hasStructuredCommerce = structured.productComponent
    || structured.purchaseButton
    || structured.commerceLink;
  const safetyWarning = SAFETY_WARNING_PATTERN.test(signals.text) && !hasStructuredCommerce;
  if (safetyWarning) {
    return resultFor("promotion", "none", score, reasons, reasonCodes);
  }

  const clearlyExplanatory = EDUCATIONAL_COMMERCIAL_CONTEXT_PATTERN.test(signals.text)
    && EXPLANATORY_EXAMPLE_PATTERN.test(signals.text)
    && !hasStructuredCommerce
    && !EXPLICIT_CODE_CUE_PATTERN.test(signals.text)
    && !ACTIONABLE_PURCHASE_PATTERN.test(signals.text);
  if (clearlyExplanatory) {
    return resultFor("promotion", "none", score, reasons, reasonCodes);
  }

  const looksLikeDiscussion = COMMERCIAL_DISCUSSION_PATTERN.test(signals.text)
    && !hasStructuredCommerce
    && !EXPLICIT_CODE_CUE_PATTERN.test(signals.text)
    && !promotion.urgency
    && !promotion.commercialCallToAction;
  if (looksLikeDiscussion) {
    return resultFor("promotion", "none", score, reasons, reasonCodes);
  }

  const explicitProduct = structured.productComponent
    || (structured.productRecommendationLabel && (structured.purchaseButton || structured.commerceLink));
  const platformSearchSupport = [
    promotion.promotionCode,
    promotion.couponOrDiscount,
    promotion.price,
    promotion.urgency,
    promotion.commercialCallToAction,
  ].filter(Boolean).length;
  const platformSearchCombination = promotion.platforms.length > 0
    && promotion.appSearch
    && platformSearchSupport >= 2;
  const codeOfferCombination = promotion.appSearch
    && promotion.promotionCode
    && (promotion.couponOrDiscount || promotion.price);
  const denseOfferCombination = promotion.platforms.length > 0
    && promotion.promotionCode
    && promotion.couponOrDiscount
    && promotion.price;

  if (explicitProduct || platformSearchCombination || codeOfferCombination || denseOfferCombination) {
    return resultFor("promotion", "high", score, reasons, reasonCodes);
  }

  const semanticSignals = [
    promotion.platforms.length > 0,
    promotion.appSearch,
    promotion.promotionCode,
    promotion.couponOrDiscount,
    promotion.price,
    promotion.urgency,
    promotion.commercialCallToAction,
    structured.productRecommendationLabel,
    structured.purchaseButton,
    structured.commerceLink,
  ].filter(Boolean).length;
  const hasStrongCommercialCue = promotion.appSearch
    || promotion.promotionCode
    || structured.productRecommendationLabel
    || structured.purchaseButton
    || structured.commerceLink
    || (promotion.couponOrDiscount && promotion.price && promotion.urgency);
  const confidence = semanticSignals >= 3 && hasStrongCommercialCue ? "medium" : "none";
  return resultFor("promotion", confidence, score, reasons, reasonCodes);
}

function analyzeGiveaway(signals) {
  const { structured, giveaway } = signals;
  const reasons = [];
  const reasonCodes = [];
  let score = 0;

  const addReason = (condition, points, code, label) => {
    if (!condition) return;
    score += points;
    reasonCodes.push(code);
    reasons.push(label);
  };

  addReason(structured.giveawayModule, 45, "giveaway-module", "检测到互动抽奖组件");
  addReason(giveaway.strongCall, 35, "giveaway-call", "包含明确的抽奖发起话术");
  addReason(!giveaway.strongCall && giveaway.mention, 12, "giveaway-mention", "提到抽奖或开奖");
  addReason(giveaway.participationCondition, 30, "participation-condition", `包含参与条件${giveaway.actions.length ? `：${giveaway.actions.join("、")}` : ""}`);
  addReason(giveaway.drawInfo, 25, "draw-announcement", "包含开奖时间、截止信息或获奖公告");
  addReason(giveaway.prize, 10, "giveaway-prize", "包含奖品或赠送信息");

  const safetyOrDebunkingContext = GIVEAWAY_SAFETY_PATTERN.test(signals.text)
    && !structured.giveawayModule;
  if (safetyOrDebunkingContext) {
    return resultFor("giveaway", "none", score, reasons, reasonCodes);
  }

  const looksLikeDiscussion = DISCUSSION_CONTEXT_PATTERN.test(signals.text)
    && !structured.giveawayModule
    && !giveaway.participationCondition;
  if (looksLikeDiscussion) {
    return resultFor("giveaway", "none", score, reasons, reasonCodes);
  }

  const clearCall = structured.giveawayModule || giveaway.strongCall || giveaway.mention;
  if (clearCall && giveaway.participationCondition && giveaway.drawInfo) {
    return resultFor("giveaway", "high", score, reasons, reasonCodes);
  }

  const supportingSignals = [
    giveaway.participationCondition,
    giveaway.drawInfo,
    giveaway.prize,
  ].filter(Boolean).length;
  const medium = (structured.giveawayModule || giveaway.strongCall) && supportingSignals >= 1;
  return resultFor("giveaway", medium ? "medium" : "none", score, reasons, reasonCodes);
}

/**
 * Pure, explainable decision function. A single keyword is intentionally not
 * enough: only independent combinations become high-confidence or suspicious.
 */
export function analyzeContentSignals(input = {}) {
  const candidate = input?.contentSignals ?? input;
  const signals = isContentSignals(candidate) ? candidate : createContentSignals(candidate);
  const promotion = analyzePromotion(signals);
  const giveaway = analyzeGiveaway(signals);
  const matches = { promotion, giveaway };
  const matchedResults = [promotion, giveaway].filter((item) => item.matched);
  const confidenceRank = { none: 0, medium: 1, high: 2 };
  matchedResults.sort((left, right) => {
    const confidenceDelta = confidenceRank[right.confidence] - confidenceRank[left.confidence];
    if (confidenceDelta) return confidenceDelta;
    if (right.score !== left.score) return right.score - left.score;
    return left.category === "giveaway" ? -1 : 1;
  });
  const primary = matchedResults[0] ?? null;

  return {
    matched: Boolean(primary),
    category: primary?.category ?? null,
    categories: matchedResults.map((item) => item.category),
    confidence: primary?.confidence ?? "none",
    suggestedAction: primary?.suggestedAction ?? "show",
    score: primary?.score ?? 0,
    detail: primary?.detail ?? "",
    reasons: primary?.reasons ?? [],
    reasonCodes: primary?.reasonCodes ?? [],
    matches,
    signals,
  };
}
