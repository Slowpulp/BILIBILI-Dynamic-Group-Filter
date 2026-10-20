import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  analyzeContentSignals,
  createContentSignals,
} from "../src/content-filter.js";
const FLASH_SALE_PROMOTION_EXAMPLES = JSON.parse(readFileSync(
  new URL("./fixtures/promotion-examples.json", import.meta.url), "utf8",
));

test("an explicit product component is a high-confidence promotion", () => {
  const result = analyzeContentSignals(createContentSignals({
    text: "刘老杆东北黄糯玉米 16.9 元起",
    hasProductComponent: true,
    hasPurchaseButton: true,
  }));

  assert.equal(result.matched, true);
  assert.equal(result.category, "promotion");
  assert.equal(result.confidence, "high");
  assert.equal(result.suggestedAction, "hide");
  assert.ok(result.reasonCodes.includes("product-component"));
  assert.match(result.reasons.join(" "), /商品组件/);
});

test("platform, app-search, code, coupon and price form a high-confidence promotion", () => {
  const result = analyzeContentSignals({
    text: `大漏！白象方便面 1 块钱一袋！
      评论区抽一位粉丝补贴50买零食。
      美团和闪购25-25的券，快去美团app搜：332211`,
  });

  assert.equal(result.category, "promotion");
  assert.equal(result.confidence, "high");
  assert.equal(result.suggestedAction, "hide");
  assert.ok(result.matches.promotion.reasonCodes.includes("commerce-platform"));
  assert.ok(result.matches.promotion.reasonCodes.includes("app-search"));
  assert.ok(result.matches.promotion.reasonCodes.includes("promotion-code"));
  assert.ok(result.matches.promotion.reasonCodes.includes("coupon-or-discount"));
  assert.ok(result.matches.promotion.reasonCodes.includes("price"));
});

test("obfuscated Taobao spelling and Copy-message codes are recognized only as a combination", () => {
  const result = analyzeContentSignals({
    text: `大漏！袋装面低到 1.1 元一袋，评论区补贴 50 买零食。
      1Copy这条信息桃宝9(tZsZTgQDv5s)，快冲！`,
  });

  assert.equal(result.category, "promotion");
  assert.equal(result.confidence, "high");
  assert.ok(result.matches.promotion.reasonCodes.includes("commerce-platform"));
  assert.ok(result.matches.promotion.reasonCodes.includes("promotion-code"));
});

test("both reported flash-sale posts are high-confidence promotions using only visible text", () => {
  for (const { name, text } of FLASH_SALE_PROMOTION_EXAMPLES) {
    const result = analyzeContentSignals({ text });
    assert.equal(result.matches.promotion.confidence, "high", name);
    assert.equal(result.matches.promotion.suggestedAction, "hide", name);
    for (const code of ["commerce-platform", "app-search", "promotion-code", "coupon-or-discount"]) {
      assert.ok(result.matches.promotion.reasonCodes.includes(code), `${name}: ${code}`);
    }
    assert.equal(result.signals.structured.productComponent, false, name);
  }
});

test("platform search codes support flash-sale/home channels, homophones and full-width text", () => {
  const examples = [
    "美团APP闪购嗖：445566，直接领29-20神券。",
    "淘宝 App 首页 搜索：765432，25-25的券。",
    "快去美团嗖：889977，25-25的券。",
    "美团客户端外卖查找：556677，20元优惠券。",
    "美团ＡＰＰ闪购嗖：１２３４５６，２５－２５的券。",
    "淘宝app闪购栏目搜：987654，领取神券。",
  ];
  for (const text of examples) {
    const result = analyzeContentSignals({ text });
    assert.equal(result.matches.promotion.confidence, "high", text);
    assert.equal(result.signals.promotion.appSearch, true, text);
    assert.equal(result.signals.promotion.promotionCode, true, text);
    assert.equal(result.signals.promotion.couponOrDiscount, true, text);
  }
});

test("a contextual numeric search code still needs offer support for automatic hiding", () => {
  const result = analyzeContentSignals({ text: "美团APP闪购嗖：556677" });
  assert.equal(result.matches.promotion.confidence, "medium");
  assert.equal(result.matches.promotion.suggestedAction, "collapse");
});

test("ordinary flash-sale posts and unrelated numbers do not manufacture search-code evidence", () => {
  const examples = [
    "美团闪购今天送得嗖嗖快，订单号233233，优惠券省5元。",
    "闪购嗖：233233，25-25的券。",
    "嗖：233233，领25元优惠券。",
    "美团APP闪购嗖！233233，25-25的券。",
    "美团APP闪购嗖：1234，25-25的券。",
    "美团APP闪购嗖：1234567890123，25-25的券。",
    "美团APP闪购嗖：233233ABC，25-25的券。",
    "美团APP闪购嗖：123456.78，25-25的券。",
    "233233，美团闪购，25-25的券。",
    "神券",
  ];
  for (const text of examples) {
    const result = analyzeContentSignals({ text });
    assert.equal(result.signals.promotion.appSearch, false, text);
    assert.equal(result.signals.promotion.promotionCode, false, text);
    assert.equal(result.matches.promotion.suggestedAction, "show", text);
  }
});

test("flash-sale homophones retain safety, review and explanatory-example protections", () => {
  const examples = [
    "反诈提醒：美团APP闪购嗖：233233，29-20神券，请勿参与。",
    "警惕这类动态：美团嗖：445566，25-25的券。",
    "美团闪购搜索功能测评：美团APP闪购嗖：233233，29-20神券展示体验。",
    "教程：如何设计闪购页面？美团APP闪购嗖：233233，29-20神券只是测试用例。",
  ];
  for (const text of examples) {
    const result = analyzeContentSignals({ text });
    assert.equal(result.matches.promotion.confidence, "none", text);
    assert.equal(result.matches.promotion.suggestedAction, "show", text);
  }
});

test("a suspicious commercial combination is collapsible rather than auto-hidden", () => {
  const result = analyzeContentSignals({
    text: "淘宝口令 ABCDE123，限时快冲，同款购买链接在简介。",
  });

  assert.equal(result.category, "promotion");
  assert.equal(result.confidence, "medium");
  assert.equal(result.suggestedAction, "collapse");
});

test("coupon, concrete price and urgency make an unlabelled soft ad suspicious", () => {
  const result = analyzeContentSignals({
    text: "【大漏】元气森林气泡水 12 瓶到手 26 元，限时补贴，赶紧冲！",
  });

  assert.equal(result.category, "promotion");
  assert.equal(result.confidence, "medium");
  assert.equal(result.suggestedAction, "collapse");
  assert.match(result.detail, /补贴/);
});

test("ordinary price comparison and isolated platform mentions are not promotions", () => {
  const examples = [
    "这款手机售价 3999 元，京东和淘宝价格差不多，测评结论如下。",
    "今天讨论美团 APP 的搜索体验和信息无障碍设计。",
    "美团 APP 搜索里的优惠券和价格展示体验需要改进。",
    "优惠券系统的数据库应该如何设计？",
    "UP 主推荐大家认真阅读这篇反诈科普。",
    "请 Copy 这条信息 ABCDEFGHIJK 到文档备份，项目价格是 99 元。",
    "这篇文章讨论某宝的发展史与价格展示设计。",
  ];

  for (const text of examples) {
    const result = analyzeContentSignals({ text });
    assert.equal(result.matches.promotion.matched, false, text);
    assert.equal(result.matches.promotion.suggestedAction, "show", text);
  }
});

test("explicit safety warnings and ordinary product reviews override search-like tokens", () => {
  const examples = [
    "反诈教程！美团 App 搜索 332211，领取25元优惠券是骗局，请勿参与。",
    "手机评测：在京东 App 搜索 iPhone15。当前优惠券页面显示，到手价3999元。",
    "反诈教程:\n美团 App 搜索 332211, 领取25元优惠券是骗局; 请勿参与!",
    "手机测评：\n在京东 App 搜索 iPhone15；当前优惠券页面显示，到手价3999元！",
  ];

  for (const text of examples) {
    const result = analyzeContentSignals({ text });
    assert.equal(result.matches.promotion.matched, false, text);
    assert.equal(result.matches.promotion.suggestedAction, "show", text);
  }
});

test("a savings tutorial with a concrete app-search offer remains a promotion", () => {
  const examples = [
    "省钱教程：淘宝 APP 搜索零食，25元优惠券，券后9.9元。",
    "省钱教程:\n淘宝 APP 搜索零食, 25元优惠券; 券后9.9元!",
  ];

  for (const text of examples) {
    const result = analyzeContentSignals({ text });
    assert.equal(result.matches.promotion.confidence, "high", text);
    assert.equal(result.matches.promotion.suggestedAction, "hide", text);
  }
});

test("an explanatory promotion-rule example is not mistaken for a real offer", () => {
  const text = "教程：如何设计优惠券？美团App搜索测试商品，券后9.9元，限时字段只是示例。";
  const result = analyzeContentSignals({ text });

  assert.equal(result.matches.promotion.matched, false);
  assert.equal(result.matches.promotion.confidence, "none");
  assert.equal(result.matches.promotion.suggestedAction, "show");
});

test("giveaway call, participation condition and draw announcement form a high-confidence giveaway", () => {
  const result = analyzeContentSignals({
    text: `🎁互动抽奖：给大家抽一个昭和动画物语游戏。
      关注+转发即可参与，周日开奖。`,
  });

  assert.equal(result.matched, true);
  assert.equal(result.category, "giveaway");
  assert.equal(result.confidence, "high");
  assert.equal(result.suggestedAction, "hide");
  assert.deepEqual(result.signals.giveaway.actions, ["关注", "转发"]);
  assert.deepEqual(result.matches.giveaway.reasonCodes, [
    "giveaway-call",
    "participation-condition",
    "draw-announcement",
    "giveaway-prize",
  ]);
});

test("discussion on one sentence does not suppress a real giveaway after full-width punctuation or a line break", () => {
  const examples = [
    "教程更新！互动抽奖，关注+转发即可参与，周日开奖。",
    "视频制作教程更新\n互动抽奖：关注并转发即可参与；明日开奖。",
  ];

  for (const text of examples) {
    const result = analyzeContentSignals({ text });
    assert.equal(result.category, "giveaway", text);
    assert.equal(result.confidence, "high", text);
    assert.equal(result.suggestedAction, "hide", text);
  }
});

test("a labelled giveaway with implicit engagement rules is high confidence", () => {
  const examples = [
    "抽奖：关注+转发，送三份游戏兑换码，9月10日开奖。",
    "抽奖活动。参与规则：关注并转发；9月10日开奖。",
    "福利抽奖！参与方式: 关注 + 评论, 明日开奖。",
  ];

  for (const text of examples) {
    const result = analyzeContentSignals({ text });
    assert.equal(result.category, "giveaway", text);
    assert.equal(result.confidence, "high", text);
    assert.equal(result.suggestedAction, "hide", text);
    assert.equal(result.signals.giveaway.participationCondition, true, text);
  }
});

test("a probable giveaway without draw information is only suspicious", () => {
  const result = analyzeContentSignals({
    text: "福利抽奖！关注并转发即可参与，送出三份游戏兑换码。",
  });

  assert.equal(result.category, "giveaway");
  assert.equal(result.confidence, "medium");
  assert.equal(result.suggestedAction, "collapse");
});

test("a single giveaway keyword or discussion context never triggers filtering", () => {
  const examples = [
    "抽奖",
    "这期视频讨论抽奖机制是否公平。",
    "关注消费者权益，警惕虚假抽奖，开奖结果也可能伪造。",
    "昨天开奖了，但我只是转发一下相关新闻。",
    "互动抽奖机制分析：关注、转发和开奖三个环节应该如何设计？",
    "抽奖机制：关注+转发只是常见设计，9月10日开奖也只是示例。",
    "福利抽奖教程：分析关注、转发与开奖规则。",
  ];

  for (const text of examples) {
    const result = analyzeContentSignals({ text });
    assert.equal(result.matches.giveaway.matched, false, text);
    assert.equal(result.matches.giveaway.suggestedAction, "show", text);
  }
});

test("giveaway scam-debunking language is protected without a lottery component", () => {
  const text = "抽奖套路揭秘：关注+转发即可参与，周日开奖，看到这种话术要警惕。";
  const result = analyzeContentSignals({ text });

  assert.equal(result.signals.giveaway.participationCondition, true);
  assert.equal(result.signals.giveaway.drawInfo, true);
  assert.equal(result.matches.giveaway.matched, false);
  assert.equal(result.matches.giveaway.confidence, "none");
  assert.equal(result.matches.giveaway.suggestedAction, "show");
});

test("promotion and giveaway details remain independently queryable", () => {
  const result = analyzeContentSignals({
    text: "互动抽奖：关注并转发即可参与，明日开奖。美团 APP 搜 332211，领取 25 元优惠券。",
  });

  assert.equal(result.matches.promotion.confidence, "high");
  assert.equal(result.matches.giveaway.confidence, "high");
  assert.deepEqual(new Set(result.categories), new Set(["promotion", "giveaway"]));
  assert.equal(result.category, "promotion");
});
