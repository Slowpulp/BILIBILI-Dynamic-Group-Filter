import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import {
  SELECTORS,
  classifyElement,
  collectCardWrappers,
  extractAuthorMid,
  extractCardModel,
  extractDynamicId,
  extractMidFromHref,
  findPrimaryUrl,
  findTrustedUrls,
} from "../src/dom.js";

function domFor(content) {
  return new JSDOM(`<!doctype html><html><body><div class="bili-dyn-list__items">${content}</div></body></html>`, {
    url: "https://t.bilibili.com/",
  });
}

test("extracts a current-style video card without framework internals", () => {
  const dom = domFor(`
    <div class="bili-dyn-list__item" data-did="123456789012345678">
      <div class="bili-dyn-item">
        <div class="bili-dyn-item__header">
          <div class="bili-dyn-title"><span class="bili-dyn-title__text">测试UP</span></div>
          <div class="bili-dyn-time"><a href="/opus/123456789012345678">刚刚</a></div>
          <div class="bili-dyn-item__following" data-mid="42"></div>
        </div>
        <div class="bili-dyn-content"><a class="bili-dyn-card-video" dyn-id="123456789012345678" href="https://www.bilibili.com/video/BV1xx411c7mD"><span class="bili-dyn-card-video__title">视频标题</span></a></div>
      </div>
    </div>`);
  const wrapper = dom.window.document.querySelector(SELECTORS.wrapper);
  const model = extractCardModel(wrapper, dom.window.location.href);
  assert.equal(model.dynamicId, "123456789012345678");
  assert.equal(model.identity, "d:123456789012345678");
  assert.equal(model.authorMid, "42");
  assert.equal(model.authorName, "测试UP");
  assert.equal(model.type, "video");
  assert.equal(model.typeKnown, true);
  assert.equal(model.title, "视频标题");
  assert.equal(model.primaryUrl, "https://t.bilibili.com/opus/123456789012345678");
  assert.equal(model.persistable, true);
});

test("uses author space links before the Vue fallback", () => {
  const dom = domFor(`
    <div class="bili-dyn-list__item">
      <div class="bili-dyn-item"><div class="bili-dyn-item__header">
        <a href="//space.bilibili.com/888"><span class="bili-dyn-title__text">公开链接作者</span></a>
      </div><div class="dyn-card-opus"><div class="dyn-card-opus__title">图文</div></div></div>
    </div>`);
  const wrapper = dom.window.document.querySelector(SELECTORS.wrapper);
  wrapper.querySelector(SELECTORS.card).__vue__ = { author: { mid: 999 } };
  assert.equal(extractAuthorMid(wrapper), "888");
  assert.equal(extractCardModel(wrapper).type, "image");
});

test("Vue author is only a fail-safe and unknown cards remain non-persistable", () => {
  const dom = domFor(`
    <div class="bili-dyn-list__item"><div class="bili-dyn-item">
      <div class="bili-dyn-item__header"><span class="bili-dyn-title__text">延迟卡片</span></div>
      <div class="bili-dyn-content">普通文字</div>
    </div></div>`);
  const wrapper = dom.window.document.querySelector(SELECTORS.wrapper);
  const card = wrapper.querySelector(SELECTORS.card);
  card.__vue__ = { data: { modules: { module_author: { mid: "777" } } } };
  assert.equal(extractAuthorMid(wrapper), "777");
  const model = extractCardModel(wrapper);
  assert.match(model.identity, /^session:/);
  assert.equal(model.persistable, false);
  assert.equal(model.type, "other");
});

test("forward classification wins and the outer author is selected", () => {
  const dom = domFor(`
    <div class="bili-dyn-list__item">
      <div class="bili-dyn-item"><div class="bili-dyn-item__header" data-mid="100"><span class="bili-dyn-title__text">转发者</span></div>
      <div class="bili-dyn-content__forw"><a href="//space.bilibili.com/200">原作者</a><a class="bili-dyn-card-video" href="/video/BV1xx411c7mD">视频</a></div></div>
    </div>`);
  const wrapper = dom.window.document.querySelector(SELECTORS.wrapper);
  const model = extractCardModel(wrapper);
  assert.equal(model.authorMid, "100");
  assert.equal(model.type, "forward");
});

test("card tools never affect extracted text, fallback title, or session fingerprint", () => {
  const dom = domFor(`
    <div class="bili-dyn-list__item">
      <div class="bili-dyn-item">
        <div class="bili-dyn-item__header" data-mid="42">
          <span class="bili-dyn-title__text">工具栏测试UP</span>
          <div class="bili-dyn-time">刚刚</div>
        </div>
        <div class="bili-dyn-content">正文唯一内容</div>
      </div>
    </div>`);
  const wrapper = dom.window.document.querySelector(SELECTORS.wrapper);
  const before = extractCardModel(wrapper, dom.window.location.href);

  const tools = dom.window.document.createElement("div");
  tools.className = "btf-card-tools";
  tools.innerHTML = `
    <button class="btf-card-action" data-action="hide">隐藏</button>
    <button class="btf-card-action" data-action="watch">本地稍后看</button>`;
  wrapper.querySelector(".bili-dyn-item__header").append(tools);

  const after = extractCardModel(wrapper, dom.window.location.href);
  assert.match(before.identity, /^session:/);
  assert.equal(after.text, before.text);
  assert.equal(after.title, before.title);
  assert.equal(after.identity, before.identity);
  assert.doesNotMatch(after.text, /隐藏|本地稍后看/);
  assert.doesNotMatch(after.title, /隐藏|本地稍后看/);
  dom.window.close();
});

test("body mentions and forwarded-original links are not mistaken for the outer author", () => {
  const cases = [
    {
      label: "body mention",
      content: `
        <div class="bili-dyn-list__item"><div class="bili-dyn-item">
          <div class="bili-dyn-item__header"><span class="bili-dyn-title__text">未知外层作者</span></div>
          <div class="bili-dyn-content">感谢 <a href="//space.bilibili.com/222">@正文提及用户</a></div>
        </div></div>`,
    },
    {
      label: "forwarded original author",
      content: `
        <div class="bili-dyn-list__item"><div class="bili-dyn-item">
          <div class="bili-dyn-item__header"><span class="bili-dyn-title__text">未知转发者</span></div>
          <div class="bili-dyn-content__forw"><a href="https://space.bilibili.com/333">原动态作者</a></div>
        </div></div>`,
    },
  ];

  for (const { label, content } of cases) {
    const dom = domFor(content);
    const wrapper = dom.window.document.querySelector(SELECTORS.wrapper);
    assert.equal(extractAuthorMid(wrapper), null, label);
    assert.equal(extractCardModel(wrapper).authorMid, null, label);
    dom.window.close();
  }
});

test("selector helpers tolerate fragments and protocol-relative links", () => {
  const dom = domFor(`<div class="bili-dyn-list__item"><div class="bili-dyn-item"><div class="dyn-card-opus"><a data-url="//www.bilibili.com/opus/987654321"></a></div></div></div>`);
  const document = dom.window.document;
  const list = document.querySelector(SELECTORS.list);
  const wrapper = document.querySelector(SELECTORS.wrapper);
  assert.deepEqual(collectCardWrappers(list), [wrapper]);
  assert.equal(extractMidFromHref("//space.bilibili.com/12345/dynamic"), "12345");
  // A body link can point at another/forwarded post and is not a stable ID for
  // the outer timeline card.
  assert.equal(extractDynamicId(wrapper), null);
  assert.equal(findPrimaryUrl(wrapper), "https://www.bilibili.com/opus/987654321");
  assert.equal(classifyElement(wrapper).type, "image");
  assert.deepEqual(collectCardWrappers(null), []);
});

test("typed video, live, PGC, and article cards expose only trusted Bilibili targets", () => {
  const dom = domFor(`<div class="bili-dyn-list__item"><div class="bili-dyn-item">
    <div class="bili-dyn-item__header"><span class="bili-dyn-title__text">作者</span></div>
    <a class="bili-dyn-card-video" href="//www.bilibili.com/video/BV1xx411c7mD?spm_id_from=test">视频</a>
    <div class="bili-dyn-card-live"><a href="https://live.bilibili.com/123">直播</a></div>
    <a class="bili-dyn-card-pgc" href="https://www.bilibili.com/bangumi/play/ep123">番剧</a>
    <a class="bili-dyn-card-article" href="https://www.bilibili.com/read/cv123">专栏</a>
    <a class="bili-dyn-card-live" href="https://example.com/not-trusted">站外</a>
  </div></div>`);
  const wrapper = dom.window.document.querySelector(SELECTORS.wrapper);
  assert.equal(findPrimaryUrl(wrapper), "https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=test");
  assert.deepEqual(findTrustedUrls(wrapper), [
    "https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=test",
    "https://live.bilibili.com/123",
    "https://www.bilibili.com/bangumi/play/ep123",
    "https://www.bilibili.com/read/cv123",
  ]);
  dom.window.close();
});

test("generic body links are not promoted to the current card URL", () => {
  const dom = domFor(`<div class="bili-dyn-list__item"><div class="bili-dyn-item">
    <div class="bili-dyn-item__header"><span class="bili-dyn-title__text">作者</span></div>
    <div class="bili-dyn-content">提到 <a href="/opus/987654321">另一条动态</a></div>
  </div></div>`);
  const wrapper = dom.window.document.querySelector(SELECTORS.wrapper);
  assert.equal(extractDynamicId(wrapper), null);
  assert.equal(findPrimaryUrl(wrapper), "");
  assert.equal(extractCardModel(wrapper).linkKnown, false);
  dom.window.close();
});
