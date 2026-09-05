import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";

const bundlePromise = build({
  entryPoints: [fileURLToPath(new URL("../src/main.js", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["chrome105", "firefox102"],
  logLevel: "silent",
}).then((result) => result.outputFiles[0].text);

const card = ({ did, mid, name, kind = "video", title }) => `
  <div class="bili-dyn-list__item" data-did="${did}">
    <div class="bili-dyn-item">
      <div class="bili-dyn-item__header" data-mid="${mid}">
        <div class="bili-dyn-title"><span class="bili-dyn-title__text">${name}</span></div>
        <div class="bili-dyn-time"><a href="/opus/${did}">刚刚</a></div>
        <div class="bili-dyn-item__more"></div>
      </div>
      <div class="bili-dyn-content">
        ${kind === "video"
          ? `<a class="bili-dyn-card-video" dyn-id="${did}" href="/video/BV1xx411c7mD"><span class="bili-dyn-card-video__title">${title}</span></a>`
          : `<div class="dyn-card-opus" dyn-id="${did}"><div class="dyn-card-opus__title">${title}</div></div>`}
      </div>
    </div>
  </div>`;

async function waitFor(assertion, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function apiResponse(data, { code = 0, message = "0", status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ code, message, data }),
  };
}

function savedSettings(window) {
  const raw = window.localStorage.getItem("__bilibili_timeline_focus_v1__:settings");
  return raw ? JSON.parse(raw) : null;
}

test("userscript mounts, filters, restores, enhances new cards, and survives SPA route replacement", async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (error) => jsErrors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "100000001", mid: "101", name: "视频作者", kind: "video", title: "视频标题" })}
      ${card({ did: "100000002", mid: "102", name: "图文作者", kind: "image", title: "图文标题" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const requests = [];
  window.fetch = async (url) => {
    requests.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: -101, message: "账号未登录", data: { isLogin: false } }),
    };
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");

  const source = await bundlePromise;
  window.eval(source);

  await waitFor(() => {
    assert.ok(window.document.getElementById("btf-root")?.shadowRoot);
    assert.equal(window.document.querySelectorAll(".btf-card-tools").length, 2);
  });
  for (const wrapper of window.document.querySelectorAll(".bili-dyn-list__item")) {
    const title = wrapper.querySelector(".bili-dyn-title");
    const author = title.querySelector(".bili-dyn-title__text");
    const toolbar = title.querySelector(":scope > .btf-card-tools");
    assert.ok(toolbar);
    assert.equal(toolbar.dataset.placement, "author");
    assert.equal(author.nextElementSibling, toolbar);
    assert.equal(wrapper.querySelector(".bili-dyn-item__header > .btf-card-tools"), null);
  }
  const root = window.document.getElementById("btf-root");
  const shadow = root.shadowRoot;
  assert.match(shadow.querySelector(".brand-status").textContent, /登录/);
  assert.equal(requests.filter((url) => url.includes("/x/web-interface/nav")).length, 1);
  assert.equal(requests.some((url) => url.includes("/x/relation/tags")), false);
  const launcher = shadow.querySelector(".launcher");
  const launcherIcon = launcher.querySelector("svg.launcher-icon");
  assert.ok(launcherIcon);
  assert.equal(launcher.getAttribute("aria-label"), "打开动态净览");
  assert.equal(launcherIcon.getAttribute("aria-hidden"), "true");
  assert.equal(launcherIcon.getAttribute("focusable"), "false");
  assert.equal(launcherIcon.querySelectorAll("linearGradient").length, 2);
  assert.equal(launcherIcon.querySelectorAll("stop").length, 9);
  assert.equal(launcherIcon.querySelectorAll("path").length, 2);
  for (const path of launcherIcon.querySelectorAll("path")) {
    const gradientId = path.getAttribute("fill").match(/^url\(#([^)]+)\)/)?.[1];
    assert.ok(gradientId);
    assert.ok(launcherIcon.querySelector(`#${gradientId}`));
  }
  assert.doesNotMatch(launcher.textContent, /滤/);

  launcher.click();
  assert.equal(root.dataset.open, "true");
  const keywords = shadow.querySelector(".keywords");
  keywords.value = "OpenAI";
  keywords.dispatchEvent(new window.Event("input", { bubbles: true }));
  // A render inside the debounce window must neither erase the draft nor
  // lowercase the spelling that will later be used in sensitive mode.
  shadow.querySelector(".enabled-switch").click();
  assert.equal(keywords.value, "OpenAI");
  shadow.querySelector(".enabled-switch").click();
  await waitFor(() => assert.deepEqual(savedSettings(window).keywords, ["OpenAI"]));
  keywords.value = "";
  keywords.dispatchEvent(new window.Event("input", { bubbles: true }));
  await waitFor(() => assert.deepEqual(savedSettings(window).keywords, []));
  shadow.querySelector("button[data-type='image']").click();
  await waitFor(() => {
    const wrappers = window.document.querySelectorAll(".bili-dyn-list__item");
    assert.equal(wrappers[0].hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(wrappers[1].dataset.btfHiddenReason, "type");
  });

  shadow.querySelector(".enabled-switch").click();
  await waitFor(() => assert.equal(window.document.querySelectorAll("[data-btf-hidden-reason]").length, 0));

  const template = window.document.createElement("template");
  template.innerHTML = card({ did: "100000003", mid: "103", name: "新作者", kind: "video", title: "新动态" });
  window.document.querySelector(".bili-dyn-list__items").append(template.content.firstElementChild);
  await waitFor(() => assert.equal(window.document.querySelectorAll(".btf-card-tools").length, 3));

  window.history.pushState({}, "", "/123456789");
  await waitFor(() => assert.equal(window.document.getElementById("btf-root"), null));
  assert.equal(window.document.querySelectorAll(".btf-card-tools").length, 0);
  assert.equal(window.document.querySelectorAll("[data-btf-card-tools-host], [data-btf-card-author-slot]").length, 0);
  assert.equal(window.document.querySelectorAll("[data-btf-hidden-reason]").length, 0);

  window.history.pushState({}, "", "/");
  await waitFor(() => assert.ok(window.document.getElementById("btf-root")?.shadowRoot));
  await waitFor(() => assert.equal(window.document.querySelectorAll(".btf-card-tools").length, 3));
  assert.equal(window.document.querySelectorAll('[data-btf-card-tools-host="author"]').length, 3);
  assert.equal(window.document.querySelectorAll('[data-btf-card-author-slot="true"]').length, 3);
  assert.equal(window.document.querySelectorAll("#btf-root").length, 1);

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
  assert.deepEqual(jsErrors, []);
});

test("rapid route leave and return keeps one UI/tool set and settles aborted startup work", async () => {
  const virtualConsole = new VirtualConsole();
  const runtimeErrors = [];
  virtualConsole.on("jsdomError", (error) => runtimeErrors.push(error));
  virtualConsole.on("error", (...args) => runtimeErrors.push(args));

  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "200000001", mid: "201", name: "路由测试作者", kind: "video", title: "路由测试动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.addEventListener("error", (event) => runtimeErrors.push(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => runtimeErrors.push(event.reason));
  window.alert = () => assert.fail("the userscript must not use blocking alerts");

  const requests = [];
  window.fetch = (url, options = {}) => {
    requests.push(String(url));
    const requestNumber = requests.length;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = 0;
      const cleanup = () => options.signal?.removeEventListener("abort", onAbort);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        cleanup();
        // Reject on a later task so the return-route activation overlaps the
        // cancelled first activation instead of waiting for it to unwind.
        window.setTimeout(() => {
          reject(new window.DOMException("The operation was aborted", "AbortError"));
        }, 15);
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          ok: true,
          status: 200,
          json: async () => ({
            code: -101,
            message: "账号未登录",
            data: { isLogin: false },
          }),
        });
      }, requestNumber === 1 ? 250 : 0);
    });
  };

  const source = await bundlePromise;
  window.eval(source);

  await waitFor(() => {
    assert.equal(requests.length, 1);
    assert.equal(window.document.querySelectorAll("#btf-root").length, 1);
    assert.equal(window.document.querySelectorAll(".btf-card-tools").length, 1);
  });

  window.history.pushState({}, "", "/fast-away");
  await waitFor(() => {
    assert.equal(window.document.querySelectorAll("#btf-root").length, 0);
    assert.equal(window.document.querySelectorAll(".btf-card-tools").length, 0);
  });

  window.history.pushState({}, "", "/");
  await waitFor(() => {
    assert.equal(requests.length, 2);
    assert.equal(window.document.querySelectorAll("#btf-root").length, 1);
    assert.equal(window.document.querySelectorAll(".btf-card-tools").length, 1);
  });

  // Let the delayed AbortError from the first activation and all queued
  // mutation/animation callbacks settle before checking for duplicate state.
  await new Promise((resolve) => window.setTimeout(resolve, 80));
  assert.equal(window.document.querySelectorAll("#btf-root").length, 1);
  assert.equal(window.document.querySelectorAll("#btf-global-style").length, 1);
  const wrappers = window.document.querySelectorAll(".bili-dyn-list__item");
  assert.equal(wrappers.length, 1);
  assert.equal(wrappers[0].querySelectorAll(".btf-card-tools").length, 1);
  assert.deepEqual(runtimeErrors, []);

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("a hydrated author row moves one toolbar beside a linked name and preserves the nested more control", async () => {
  const virtualConsole = new VirtualConsole();
  const runtimeErrors = [];
  virtualConsole.on("jsdomError", (error) => runtimeErrors.push(error));
  virtualConsole.on("error", (...args) => runtimeErrors.push(args));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      <div class="bili-dyn-list__item" data-did="290000001"><div class="bili-dyn-item">
        <div class="bili-dyn-item__header" data-mid="291">
          <a class="author-link" href="//space.bilibili.com/291"><span class="bili-dyn-title__text">嵌套菜单作者</span></a>
          <div class="bili-dyn-time"><a href="/opus/290000001">刚刚</a></div>
          <div class="header-actions"><div class="bili-dyn-item__more"></div></div>
        </div>
        <div class="bili-dyn-content">
          <a class="bili-dyn-card-video" href="/video/BV1ag411c7mN">
            <span class="bili-dyn-card-video__title">嵌套菜单动态</span>
          </a>
        </div>
      </div></div>
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.addEventListener("error", (event) => runtimeErrors.push(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => runtimeErrors.push(event.reason));
  window.eval(await bundlePromise);

  await waitFor(() => {
    const wrapper = window.document.querySelector(".bili-dyn-list__item");
    const header = wrapper.querySelector(".bili-dyn-item__header");
    const toolbar = wrapper.querySelector(".btf-card-tools");
    assert.ok(toolbar);
    assert.equal(toolbar.parentElement, header);
    assert.equal(toolbar.dataset.placement, "header");
    assert.equal(header.querySelector(".author-link").contains(toolbar), false);
    assert.equal(header.lastElementChild, toolbar);
    assert.equal(toolbar.querySelectorAll("button").length, 2);
    assert.ok(header.querySelector(".header-actions > .bili-dyn-item__more"));
    const shadow = window.document.getElementById("btf-root").shadowRoot;
    assert.equal(shadow.querySelector('[data-stat="visible"]').textContent, "1");
  });

  const wrapper = window.document.querySelector(".bili-dyn-list__item");
  const header = wrapper.querySelector(".bili-dyn-item__header");
  const authorLink = header.querySelector(".author-link");
  const title = window.document.createElement("div");
  title.className = "bili-dyn-title";
  authorLink.before(title);
  title.append(authorLink);
  const badge = window.document.createElement("span");
  badge.className = "author-badge";
  badge.textContent = "认证";
  title.append(badge);

  await waitFor(() => {
    const toolbar = wrapper.querySelector(".btf-card-tools");
    assert.equal(wrapper.querySelectorAll(".btf-card-tools").length, 1);
    assert.equal(toolbar.parentElement, title);
    assert.equal(toolbar.dataset.placement, "author");
    assert.equal(toolbar.previousElementSibling, authorLink);
    assert.equal(toolbar.nextElementSibling, badge);
    assert.equal(authorLink.contains(toolbar), false);
    assert.equal(header.lastElementChild?.className, "header-actions");
    assert.ok(header.querySelector(".header-actions > .bili-dyn-item__more"));
  });
  assert.deepEqual(runtimeErrors, []);

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("one malformed card is fail-open while the rest of its batch still enhances and counts", async () => {
  const virtualConsole = new VirtualConsole();
  const runtimeErrors = [];
  const warnings = [];
  virtualConsole.on("jsdomError", (error) => runtimeErrors.push(error));
  virtualConsole.on("error", (...args) => runtimeErrors.push(args));
  virtualConsole.on("warn", (...args) => warnings.push(args));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items"></div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.localStorage.setItem("__bilibili_timeline_focus_v1__:settings", JSON.stringify({
    hiddenTypes: ["video"],
  }));
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.addEventListener("error", (event) => runtimeErrors.push(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => runtimeErrors.push(event.reason));
  window.eval(await bundlePromise);

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow);
    assert.match(shadow.querySelector(".brand-status").textContent, /登录/);
  });
  const template = window.document.createElement("template");
  template.innerHTML = `
    ${card({ did: "295000001", mid: "296", name: "异常卡作者", kind: "video", title: "异常卡" }).replace(
      'class="bili-dyn-list__item"',
      'class="bili-dyn-list__item" data-btf-hidden-reason="stale"',
    )}
    ${card({ did: "295000002", mid: "297", name: "正常卡作者", kind: "video", title: "正常卡" })}`;
  const faulty = template.content.children[0];
  const healthy = template.content.children[1];
  const injectedError = new Error("synthetic per-card update failure");
  const nativeQuerySelector = faulty.querySelector;
  Object.defineProperty(faulty, "querySelector", {
    configurable: true,
    value(selector) {
      if (selector === ".btf-card-action[data-action='watch']") throw injectedError;
      return nativeQuerySelector.call(this, selector);
    },
  });
  window.document.querySelector(".bili-dyn-list__items").append(faulty, healthy);

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow);
    assert.equal(faulty.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(faulty.querySelectorAll(".btf-card-tools").length, 1);
    assert.equal(healthy.querySelectorAll(".btf-card-tools").length, 1);
    assert.equal(healthy.dataset.btfHiddenReason, "type");
    assert.equal(shadow.querySelector('[data-stat="visible"]').textContent, "1");
    assert.equal(shadow.querySelector('[data-stat="hidden"]').textContent, "1");
  });
  assert.equal(
    warnings.filter(([message]) => String(message).includes("单张动态处理失败")).length,
    1,
  );
  assert.equal(warnings.find(([message]) => String(message).includes("单张动态处理失败"))?.[1], injectedError);

  // The signature was stored before updateWatchButton threw. Removing the
  // trigger and queueing the same semantic model must retry instead of taking
  // the signature+toolbar fast path.
  delete faulty.querySelector;
  faulty.querySelector(".bili-dyn-content").classList.add("retry-with-same-model");
  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root").shadowRoot;
    assert.equal(faulty.dataset.btfHiddenReason, "type");
    assert.equal(faulty.querySelectorAll(".btf-card-tools").length, 1);
    assert.equal(shadow.querySelector('[data-stat="visible"]').textContent, "0");
    assert.equal(shadow.querySelector('[data-stat="hidden"]').textContent, "2");
  });
  assert.equal(warnings.filter(([message]) => String(message).includes("单张动态处理失败")).length, 1);
  assert.deepEqual(runtimeErrors, []);

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("group rows use left-click inclusion and right-click exclusion with clean toggles", async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (error) => jsErrors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "300000001", mid: "101", name: "分组成员", kind: "video", title: "成员动态" })}
      ${card({ did: "300000002", mid: "102", name: "非分组成员", kind: "video", title: "非成员动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const requests = [];
  const firstMemberPage = Array.from({ length: 50 }, (_, index) => ({
    mid: index === 0 ? 101 : 1_000 + index,
    uname: index === 0 ? "分组成员" : `填充成员${index}`,
  }));
  window.fetch = async (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed.href);
    if (parsed.pathname === "/x/web-interface/nav") {
      return apiResponse({ isLogin: true, mid: 9001, uname: "测试账号" });
    }
    if (parsed.pathname === "/x/relation/tags") {
      return apiResponse([
        { tagid: 10, name: "学习组", count: 51 },
        { tagid: 20, name: "空分组", count: 0 },
      ]);
    }
    if (parsed.pathname === "/x/relation/tag") {
      const tagId = parsed.searchParams.get("tagid");
      const page = Number(parsed.searchParams.get("pn"));
      if (tagId === "10" && page === 1) return apiResponse(firstMemberPage);
      if (tagId === "10" && page === 2) {
        return apiResponse([{ mid: 9_999, uname: "第二页成员" }]);
      }
      if (tagId === "20" && page === 1) return apiResponse([]);
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");

  window.eval(await bundlePromise);
  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow);
    assert.equal(shadow.querySelectorAll(".group-row").length, 2);
    assert.equal(shadow.querySelector(".refresh-groups").disabled, false);
  }, 2_000);

  const root = window.document.getElementById("btf-root");
  const shadow = root.shadowRoot;
  const memberCard = window.document.querySelector('[data-did="300000001"]');
  const nonMemberCard = window.document.querySelector('[data-did="300000002"]');
  shadow.querySelector('.group-row[data-group-id="10"]').click();

  await waitFor(() => {
    const pageRequests = requests
      .map((url) => new URL(url))
      .filter((url) => url.pathname === "/x/relation/tag" && url.searchParams.get("tagid") === "10");
    assert.deepEqual(pageRequests.map((url) => url.searchParams.get("pn")), ["1", "2"]);
    assert.equal(memberCard.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(nonMemberCard.dataset.btfHiddenReason, "group");
    assert.equal(
      shadow.querySelector('.group-row[data-group-id="10"]').getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(shadow.querySelector('.group-row[data-group-id="10"]').dataset.state, "1");
    assert.equal(shadow.querySelector('.group-row[data-group-id="10"] .group-state').textContent, "包含");
  }, 2_000);

  // Clicking the selected state again returns it to neutral and restores cards.
  shadow.querySelector('.group-row[data-group-id="10"]').click();
  await waitFor(() => {
    assert.equal(memberCard.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(nonMemberCard.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(
      shadow.querySelector('.group-row[data-group-id="10"]').getAttribute("aria-pressed"),
      "false",
    );
  });

  // Keyboard-invoked context menus remain native and never change state.
  const keyboardMenuEvent = new window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  const neutralRow = shadow.querySelector('.group-row[data-group-id="10"]');
  assert.equal(neutralRow.dispatchEvent(keyboardMenuEvent), true);
  assert.equal(neutralRow.dataset.state, "0");

  const touchMenuEvent = new window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
  });
  Object.defineProperty(touchMenuEvent, "pointerType", { value: "touch" });
  assert.equal(neutralRow.dispatchEvent(touchMenuEvent), true);
  assert.equal(neutralRow.dataset.state, "0");

  // Right-click selects exclusion, prevents the native menu, and uses the
  // same-state gesture again to return to neutral.
  const exclusionEvent = new window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
  });
  assert.equal(shadow.querySelector('.group-row[data-group-id="10"]').dispatchEvent(exclusionEvent), false);
  await waitFor(() => {
    const row = shadow.querySelector('.group-row[data-group-id="10"]');
    assert.equal(row.dataset.state, "-1");
    assert.equal(row.getAttribute("aria-pressed"), "true");
    assert.equal(row.querySelector(".group-state").textContent, "排除");
    assert.equal(shadow.activeElement, row);
    assert.equal(memberCard.dataset.btfHiddenReason, "group");
    assert.equal(nonMemberCard.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(savedSettings(window).groupStatesByUid["9001"]["10"], -1);
  });

  const cancelExclusionEvent = new window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
  });
  assert.equal(shadow.querySelector('.group-row[data-group-id="10"]').dispatchEvent(cancelExclusionEvent), false);
  await waitFor(() => {
    const row = shadow.querySelector('.group-row[data-group-id="10"]');
    assert.equal(row.dataset.state, "0");
    assert.equal(row.getAttribute("aria-pressed"), "false");
    assert.equal(memberCard.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(nonMemberCard.hasAttribute("data-btf-hidden-reason"), false);
  });

  // Shift+Enter exposes the right-click action to keyboard users.
  const keyboardExclusionEvent = new window.KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  const keyboardRow = shadow.querySelector('.group-row[data-group-id="10"]');
  assert.equal(keyboardRow.getAttribute("aria-keyshortcuts"), "Enter Space Shift+Enter Shift+Space");
  assert.equal(keyboardRow.dispatchEvent(keyboardExclusionEvent), false);
  await waitFor(() => {
    assert.equal(shadow.querySelector('.group-row[data-group-id="10"]').dataset.state, "-1");
    assert.equal(memberCard.dataset.btfHiddenReason, "group");
  });
  const keyboardCancelEvent = new window.KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  assert.equal(shadow.querySelector('.group-row[data-group-id="10"]').dispatchEvent(keyboardCancelEvent), false);
  await waitFor(() => {
    assert.equal(shadow.querySelector('.group-row[data-group-id="10"]').dataset.state, "0");
    assert.equal(memberCard.hasAttribute("data-btf-hidden-reason"), false);
  });

  // A zero count is only a hint: selecting the group must still probe page 1.
  shadow.querySelector('.group-row[data-group-id="20"]').click();
  await waitFor(() => {
    const emptyGroupRequests = requests
      .map((url) => new URL(url))
      .filter((url) => url.pathname === "/x/relation/tag" && url.searchParams.get("tagid") === "20");
    assert.deepEqual(emptyGroupRequests.map((url) => url.searchParams.get("pn")), ["1"]);
    const button = shadow.querySelector('.group-row[data-group-id="20"]');
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-pressed"), "true");
  });
  shadow.querySelector('.group-row[data-group-id="20"]').click();
  await waitFor(() => {
    assert.equal(memberCard.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(nonMemberCard.hasAttribute("data-btf-hidden-reason"), false);
  });

  const stored = savedSettings(window);
  assert.deepEqual(stored.groupStatesByUid["9001"] ?? {}, {});
  assert.deepEqual(jsErrors, []);
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("cancelling during a chunked refilter does not start a stale group request", async () => {
  const cards = Array.from({ length: 41 }, (_, index) => card({
    did: String(330_000_000 + index),
    mid: String(3300 + index),
    name: `竞态作者${index}`,
    kind: "video",
    title: `竞态动态${index}`,
  })).join("");
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">${cards}</div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const uid = "93300";
  let memberRequestCount = 0;
  window.document.cookie = `DedeUserID=${uid}; Path=/`;
  window.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/x/web-interface/nav") {
      return apiResponse({ isLogin: true, mid: uid, uname: "竞态测试账号" });
    }
    if (parsed.pathname === "/x/relation/tags") {
      return apiResponse([{ tagid: 39, name: "竞态分组", count: 1 }]);
    }
    if (parsed.pathname === "/x/relation/tag") {
      memberRequestCount += 1;
      return apiResponse([{ mid: 3300, uname: "竞态作者0" }]);
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.eval(await bundlePromise);

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow?.querySelector('.group-row[data-group-id="39"]'));
  }, 2_000);
  const shadow = window.document.getElementById("btf-root").shadowRoot;
  const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const frameQueue = [];
  window.requestAnimationFrame = (callback) => {
    frameQueue.push(callback);
    return frameQueue.length;
  };

  shadow.querySelector('.group-row[data-group-id="39"]').click();
  shadow.querySelector('.group-row[data-group-id="39"]').click();
  assert.equal(memberRequestCount, 0);
  assert.equal(savedSettings(window).groupStatesByUid[uid]?.["39"], undefined);

  for (let turn = 0; turn < 5 && frameQueue.length; turn += 1) {
    const callbacks = frameQueue.splice(0);
    for (const callback of callbacks) callback(window.performance.now());
    await Promise.resolve();
  }
  await waitFor(() => {
    const row = shadow.querySelector('.group-row[data-group-id="39"]');
    assert.equal(row.dataset.state, "0");
    assert.equal(row.hasAttribute("aria-busy"), false);
    assert.equal(memberRequestCount, 0);
  });

  window.requestAnimationFrame = originalRequestAnimationFrame;
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("group-state focus survives optimistic, loading, success, and rollback renders", async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (error) => jsErrors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "340000001", mid: "341", name: "焦点测试作者", kind: "video", title: "焦点测试动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const uid = "93401";
  let releaseSuccess = null;
  let releaseFailure = null;
  let cancelRequestStarted = false;
  window.document.cookie = `DedeUserID=${uid}; Path=/`;
  window.fetch = (url, options = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/x/web-interface/nav") {
      return Promise.resolve(apiResponse({ isLogin: true, mid: uid, uname: "键盘测试账号" }));
    }
    if (parsed.pathname === "/x/relation/tags") {
      return Promise.resolve(apiResponse([
        { tagid: 41, name: "成功分组", count: 1 },
        { tagid: 42, name: "失败分组", count: 1 },
        { tagid: 43, name: "取消分组", count: 1 },
      ]));
    }
    if (parsed.pathname === "/x/relation/tag" && parsed.searchParams.get("tagid") === "41") {
      return new Promise((resolve) => {
        releaseSuccess = () => resolve(apiResponse([{ mid: 341, uname: "焦点测试作者" }]));
      });
    }
    if (parsed.pathname === "/x/relation/tag" && parsed.searchParams.get("tagid") === "42") {
      return new Promise((resolve) => {
        releaseFailure = () => resolve(apiResponse({}));
      });
    }
    if (parsed.pathname === "/x/relation/tag" && parsed.searchParams.get("tagid") === "43") {
      cancelRequestStarted = true;
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          reject(new window.DOMException("The operation was aborted", "AbortError"));
        }, { once: true });
      });
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.eval(await bundlePromise);

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow);
    assert.equal(shadow.querySelectorAll(".group-row").length, 3);
  }, 2_000);
  const shadow = window.document.getElementById("btf-root").shadowRoot;
  shadow.querySelector(".launcher").click();
  await waitFor(() => assert.equal(shadow.activeElement, shadow.querySelector(".group-search")));

  const selector = (groupId) => `.group-row[data-group-id="${groupId}"]`;
  const assertFocused = (groupId, expectedState) => {
    const active = shadow.activeElement;
    assert.ok(active?.matches(".group-row"));
    assert.equal(active.dataset.groupId, String(groupId));
    assert.equal(active.dataset.state, String(expectedState));
    return active;
  };

  const successInitial = shadow.querySelector(selector(41));
  successInitial.focus();
  assert.equal(assertFocused(41, 0), successInitial);
  successInitial.click();
  const successOptimistic = assertFocused(41, 1);
  assert.notEqual(successOptimistic, successInitial);
  assert.equal(successOptimistic.getAttribute("aria-pressed"), "true");
  await waitFor(() => {
    assert.equal(typeof releaseSuccess, "function");
    assert.equal(shadow.querySelector('.group-row[data-group-id="41"]').getAttribute("aria-busy"), "true");
    assert.equal(assertFocused(41, 1).disabled, false);
  });
  releaseSuccess();
  await waitFor(() => {
    assert.equal(shadow.querySelector('.group-row[data-group-id="41"]').hasAttribute("aria-busy"), false);
    assert.equal(assertFocused(41, 1).getAttribute("aria-pressed"), "true");
  });

  const failureInitial = shadow.querySelector(selector(42));
  failureInitial.focus();
  assert.equal(assertFocused(42, 0), failureInitial);
  failureInitial.click();
  const failureOptimistic = assertFocused(42, 1);
  assert.notEqual(failureOptimistic, failureInitial);
  assert.equal(failureOptimistic.getAttribute("aria-pressed"), "true");
  await waitFor(() => {
    assert.equal(typeof releaseFailure, "function");
    assert.equal(shadow.querySelector('.group-row[data-group-id="42"]').getAttribute("aria-busy"), "true");
    assert.equal(assertFocused(42, 1).disabled, false);
  });
  releaseFailure();
  await waitFor(() => {
    assert.equal(shadow.querySelector('.group-row[data-group-id="42"]').hasAttribute("aria-busy"), false);
    assert.equal(assertFocused(42, 0).getAttribute("aria-pressed"), "false");
    assert.equal(savedSettings(window).groupStatesByUid[uid]["42"], undefined);
  }, 2_000);

  const cancelInitial = shadow.querySelector(selector(43));
  cancelInitial.focus();
  cancelInitial.click();
  assertFocused(43, 1);
  await waitFor(() => {
    assert.equal(cancelRequestStarted, true);
    assert.equal(shadow.querySelector('.group-row[data-group-id="43"]').getAttribute("aria-busy"), "true");
    assert.equal(assertFocused(43, 1).disabled, false);
    assert.match(shadow.querySelector(".brand-status").textContent, /正在读取/);
  });
  const cancelWhileLoading = assertFocused(43, 1);
  cancelWhileLoading.click();
  await waitFor(() => {
    const row = shadow.querySelector('.group-row[data-group-id="43"]');
    assert.equal(row.hasAttribute("aria-busy"), false);
    assert.equal(assertFocused(43, 0).getAttribute("aria-pressed"), "false");
    assert.equal(shadow.querySelector(".brand-status").textContent, "已取消该分组条件");
  });

  const clearGroups = shadow.querySelector(".clear-groups");
  clearGroups.focus();
  clearGroups.click();
  await waitFor(() => {
    assert.equal(shadow.activeElement, clearGroups);
    assert.equal(shadow.querySelector(".brand-status").textContent, "已清空分组条件");
    assert.equal(shadow.querySelectorAll('.group-row[aria-busy="true"]').length, 0);
    assert.equal(shadow.querySelectorAll('.group-row[aria-pressed="true"]').length, 0);
  });

  assert.deepEqual(jsErrors, []);
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("an aborted stale member request follows its same-group replacement instead of rolling back", async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (error) => jsErrors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "345000001", mid: "3451", name: "replacement 成员", kind: "video", title: "成员动态" })}
      ${card({ did: "345000002", mid: "3452", name: "replacement 组外", kind: "video", title: "组外动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const uid = "93402";
  let tagsCount = 0;
  const memberResolvers = [];
  window.document.cookie = `DedeUserID=${uid}; Path=/`;
  window.fetch = (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/x/web-interface/nav") {
      return Promise.resolve(apiResponse({ isLogin: true, mid: uid, uname: "replacement 账号" }));
    }
    if (parsed.pathname === "/x/relation/tags") {
      tagsCount += 1;
      return Promise.resolve(apiResponse([{ tagid: 44, name: "replacement 分组", count: 1 }]));
    }
    if (parsed.pathname === "/x/relation/tag" && parsed.searchParams.get("tagid") === "44") {
      // Intentionally ignore options.signal. The stale request therefore
      // resolves after mergeTags has aborted it and installed a replacement.
      return new Promise((resolve) => {
        memberResolvers.push(() => resolve(apiResponse([{ mid: 3451, uname: "replacement 成员" }])));
      });
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.eval(await bundlePromise);

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow?.querySelector('.group-row[data-group-id="44"]'));
    assert.equal(tagsCount, 1);
  }, 2_000);
  const shadow = window.document.getElementById("btf-root").shadowRoot;
  shadow.querySelector('.group-row[data-group-id="44"]').click();
  await waitFor(() => {
    assert.equal(memberResolvers.length, 1);
    assert.equal(savedSettings(window).groupStatesByUid[uid]["44"], 1);
    assert.equal(shadow.querySelector('.group-row[data-group-id="44"]').getAttribute("aria-busy"), "true");
  });

  shadow.querySelector(".refresh-groups").click();
  await waitFor(() => {
    assert.equal(tagsCount, 2);
    assert.equal(memberResolvers.length, 2);
    assert.equal(shadow.querySelector('.group-row[data-group-id="44"]').getAttribute("aria-busy"), "true");
  });

  memberResolvers[0]();
  await new Promise((resolve) => window.setTimeout(resolve, 40));
  assert.equal(savedSettings(window).groupStatesByUid[uid]["44"], 1);
  assert.equal(shadow.querySelector('.group-row[data-group-id="44"]').getAttribute("aria-pressed"), "true");
  assert.equal(shadow.querySelector('.group-row[data-group-id="44"]').getAttribute("aria-busy"), "true");
  assert.doesNotMatch(shadow.querySelector(".toast-message").textContent, /已取消条件/);

  memberResolvers[1]();
  const memberCard = window.document.querySelector('[data-did="345000001"]');
  const outsiderCard = window.document.querySelector('[data-did="345000002"]');
  await waitFor(() => {
    assert.equal(savedSettings(window).groupStatesByUid[uid]["44"], 1);
    assert.equal(shadow.querySelector('.group-row[data-group-id="44"]').hasAttribute("aria-busy"), false);
    assert.equal(shadow.querySelector('.group-row[data-group-id="44"]').getAttribute("aria-pressed"), "true");
    assert.equal(memberCard.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(outsiderCard.dataset.btfHiddenReason, "group");
  }, 2_000);

  const storedCache = JSON.parse(window.localStorage.getItem(`__bilibili_timeline_focus_v1__:groups:${uid}`));
  assert.deepEqual(storedCache.groups[0].memberMids, ["3451"]);
  assert.deepEqual(jsErrors, []);
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("malformed successful tags data preserves cached groups and active conditions", async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (error) => jsErrors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "350000001", mid: "601", name: "缓存组成员", kind: "video", title: "成员动态" })}
      ${card({ did: "350000002", mid: "602", name: "缓存组外作者", kind: "video", title: "组外动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const uid = "93003";
  const prefix = "__bilibili_timeline_focus_v1__";
  window.document.cookie = `DedeUserID=${uid}; Path=/`;
  window.localStorage.setItem(`${prefix}:settings`, JSON.stringify({
    groupStatesByUid: { [uid]: { 71: 1 } },
  }));
  window.localStorage.setItem(`${prefix}:groups:${uid}`, JSON.stringify({
    schemaVersion: 1,
    uid,
    // Force a network refresh while retaining a fresh per-group member cache.
    fetchedAt: 1,
    groups: [{
      id: "71",
      name: "缓存保留组",
      count: 1,
      loadedAt: Date.now(),
      memberMids: ["601"],
      memberNames: ["缓存组成员"],
    }],
  }));

  const requests = [];
  let releaseMalformedTags = null;
  let tagRequestCount = 0;
  window.fetch = (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed.href);
    if (parsed.pathname === "/x/web-interface/nav") {
      return Promise.resolve(apiResponse({ isLogin: true, mid: uid, uname: "缓存账号" }));
    }
    if (parsed.pathname === "/x/relation/tags") {
      tagRequestCount += 1;
      if (tagRequestCount === 1) {
        return new Promise((resolve) => {
          releaseMalformedTags = () => resolve(apiResponse({}));
        });
      }
      // An array envelope is still wholly invalid if even one entry lacks a
      // usable tagid; it must never be treated as an empty/partial tag list.
      return Promise.resolve(apiResponse([{}]));
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");

  window.eval(await bundlePromise);
  const cachedMember = window.document.querySelector('[data-did="350000001"]');
  const cachedOutsider = window.document.querySelector('[data-did="350000002"]');
  await waitFor(() => {
    assert.equal(typeof releaseMalformedTags, "function");
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow);
    assert.equal(shadow.querySelectorAll(".group-row").length, 1);
    assert.equal(cachedMember.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(cachedOutsider.dataset.btfHiddenReason, "group");
  }, 2_000);
  releaseMalformedTags();

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root").shadowRoot;
    assert.equal(shadow.querySelector(".brand-status").dataset.kind, "warning");
    assert.equal(shadow.querySelectorAll(".group-row").length, 1);
    assert.match(shadow.querySelector(".group-name").textContent, /缓存保留组/);
    assert.equal(
      shadow.querySelector('.group-row[data-group-id="71"]').getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(cachedMember.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(cachedOutsider.dataset.btfHiddenReason, "group");
  }, 2_000);

  // Exercise the second successful-but-malformed shape through manual refresh.
  window.document.getElementById("btf-root").shadowRoot.querySelector(".refresh-groups").click();
  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root").shadowRoot;
    assert.equal(tagRequestCount, 2);
    assert.equal(shadow.querySelector(".brand-status").dataset.kind, "warning");
    assert.equal(shadow.querySelectorAll(".group-row").length, 1);
    assert.match(shadow.querySelector(".group-name").textContent, /缓存保留组/);
    assert.equal(
      shadow.querySelector('.group-row[data-group-id="71"]').getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(cachedMember.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(cachedOutsider.dataset.btfHiddenReason, "group");
  }, 2_000);

  const storedCache = JSON.parse(window.localStorage.getItem(`${prefix}:groups:${uid}`));
  assert.deepEqual(storedCache.groups.map((group) => group.id), ["71"]);
  assert.deepEqual(storedCache.groups[0].memberMids, ["601"]);
  assert.equal(savedSettings(window).groupStatesByUid[uid]["71"], 1);
  assert.equal(
    requests.filter((url) => new URL(url).pathname === "/x/relation/tag").length,
    0,
  );
  assert.deepEqual(jsErrors, []);
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("malformed successful member data rolls the selected group state back fail-open", async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (error) => jsErrors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "400000001", mid: "401", name: "回滚测试作者", kind: "video", title: "回滚测试动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const requests = [];
  let releaseMemberFailure = null;
  window.fetch = (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed.href);
    if (parsed.pathname === "/x/web-interface/nav") {
      return Promise.resolve(apiResponse({ isLogin: true, mid: 9002, uname: "回滚账号" }));
    }
    if (parsed.pathname === "/x/relation/tags") {
      return Promise.resolve(apiResponse([
        { tagid: 31, name: "暂时失败组", count: 1 },
        { tagid: 32, name: "其他组", count: 1 },
      ]));
    }
    if (parsed.pathname === "/x/relation/tag" && parsed.searchParams.get("tagid") === "31") {
      return new Promise((resolve) => {
        releaseMemberFailure = () => resolve(apiResponse({}));
      });
    }
    if (parsed.pathname === "/x/relation/tag" && parsed.searchParams.get("tagid") === "32") {
      return Promise.resolve(apiResponse([{ uname: "缺少MID" }, {}]));
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");

  window.eval(await bundlePromise);
  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow);
    assert.equal(shadow.querySelectorAll(".group-row").length, 2);
  }, 2_000);

  const shadow = window.document.getElementById("btf-root").shadowRoot;
  const wrapper = window.document.querySelector('[data-did="400000001"]');
  shadow.querySelector('.group-row[data-group-id="31"]').click();

  // Confirm the optimistic selection was saved before resolving the request.
  await waitFor(() => {
    assert.equal(typeof releaseMemberFailure, "function");
    assert.equal(savedSettings(window).groupStatesByUid["9002"]["31"], 1);
    assert.equal(
      shadow.querySelector('.group-row[data-group-id="31"]').getAttribute("aria-pressed"),
      "true",
    );
  });
  releaseMemberFailure();

  await waitFor(() => {
    const storedState = savedSettings(window).groupStatesByUid["9002"] ?? {};
    assert.equal(storedState[31], undefined);
    const button = shadow.querySelector('.group-row[data-group-id="31"]');
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(shadow.querySelector(".brand-status").dataset.kind, "warning");
    assert.match(shadow.querySelector(".toast-message").textContent, /已取消条件/);
  }, 2_000);

  // An array is not usable merely because it is non-empty: name-only and
  // empty entries cannot power MID-only group decisions.
  shadow.querySelector('.group-row[data-group-id="32"]').click();
  await waitFor(() => {
    const storedState = savedSettings(window).groupStatesByUid["9002"] ?? {};
    assert.equal(storedState[32], undefined);
    assert.equal(shadow.querySelector('.group-row[data-group-id="32"]').getAttribute("aria-pressed"), "false");
    assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false);
  }, 2_000);

  assert.equal(
    requests.filter((url) => new URL(url).pathname === "/x/relation/tag").length,
    2,
  );
  assert.deepEqual(jsErrors, []);
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("a repeated full member page is incomplete and rolls a new condition back fail-open", async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (error) => jsErrors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "450000001", mid: "1000", name: "重复页中的成员", kind: "video", title: "成员动态" })}
      ${card({ did: "450000002", mid: "2000", name: "非成员", kind: "video", title: "非成员动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const uid = "94004";
  const requests = [];
  const repeatedFullPage = Array.from({ length: 50 }, (_, index) => ({
    mid: 1_000 + index,
    uname: `重复分页成员${index}`,
  }));
  window.fetch = async (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed.href);
    if (parsed.pathname === "/x/web-interface/nav") {
      return apiResponse({ isLogin: true, mid: uid, uname: "重复分页账号" });
    }
    if (parsed.pathname === "/x/relation/tags") {
      return apiResponse([{ tagid: 33, name: "重复分页组", count: 100 }]);
    }
    if (parsed.pathname === "/x/relation/tag" && parsed.searchParams.get("tagid") === "33") {
      return apiResponse(repeatedFullPage);
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.eval(await bundlePromise);

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow?.querySelector('.group-row[data-group-id="33"]'));
  }, 2_000);
  const shadow = window.document.getElementById("btf-root").shadowRoot;
  const wrappers = [...window.document.querySelectorAll(".bili-dyn-list__item")];
  shadow.querySelector('.group-row[data-group-id="33"]').click();

  await waitFor(() => {
    const memberRequests = requests
      .map((url) => new URL(url))
      .filter((url) => url.pathname === "/x/relation/tag" && url.searchParams.get("tagid") === "33");
    assert.deepEqual(memberRequests.map((url) => url.searchParams.get("pn")), ["1", "2"]);
    assert.equal(
      shadow.querySelector('.group-row[data-group-id="33"]').getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(shadow.querySelector(".brand-status").dataset.kind, "warning");
    assert.match(shadow.querySelector(".toast-message").textContent, /已取消条件/);
    for (const wrapper of wrappers) {
      assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false);
    }
    assert.equal(savedSettings(window).groupStatesByUid[uid]?.["33"], undefined);
  }, 3_000);

  assert.deepEqual(jsErrors, []);
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("a short second member page with zero new mids is incomplete and fail-open", async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (error) => jsErrors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "460000001", mid: "3000", name: "第一页成员", kind: "video", title: "成员动态" })}
      ${card({ did: "460000002", mid: "4000", name: "非成员", kind: "video", title: "非成员动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const uid = "95005";
  const requests = [];
  const firstPage = Array.from({ length: 50 }, (_, index) => ({
    mid: 3_000 + index,
    uname: `第一页成员${index}`,
  }));
  const duplicateShortPage = firstPage.slice(7, 17);
  window.fetch = async (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed.href);
    if (parsed.pathname === "/x/web-interface/nav") {
      return apiResponse({ isLogin: true, mid: uid, uname: "短重复页账号" });
    }
    if (parsed.pathname === "/x/relation/tags") {
      return apiResponse([{ tagid: 34, name: "短重复页分组", count: 60 }]);
    }
    if (parsed.pathname === "/x/relation/tag" && parsed.searchParams.get("tagid") === "34") {
      return apiResponse(parsed.searchParams.get("pn") === "1" ? firstPage : duplicateShortPage);
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.eval(await bundlePromise);

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow?.querySelector('.group-row[data-group-id="34"]'));
  }, 2_000);
  const shadow = window.document.getElementById("btf-root").shadowRoot;
  const wrappers = [...window.document.querySelectorAll(".bili-dyn-list__item")];
  shadow.querySelector('.group-row[data-group-id="34"]').click();

  await waitFor(() => {
    const memberRequests = requests
      .map((url) => new URL(url))
      .filter((url) => url.pathname === "/x/relation/tag" && url.searchParams.get("tagid") === "34");
    assert.deepEqual(memberRequests.map((url) => url.searchParams.get("pn")), ["1", "2"]);
    assert.equal(
      shadow.querySelector('.group-row[data-group-id="34"]').getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(shadow.querySelector(".brand-status").dataset.kind, "warning");
    assert.match(shadow.querySelector(".toast-message").textContent, /已取消条件/);
    for (const wrapper of wrappers) {
      assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false);
    }
    assert.equal(savedSettings(window).groupStatesByUid[uid]?.["34"], undefined);
  }, 3_000);

  assert.deepEqual(jsErrors, []);
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("duplicate mids within one full member page roll the condition back fail-open", async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (error) => jsErrors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "495000001", mid: "5000", name: "重复 MID 成员", kind: "video", title: "重复成员动态" })}
      ${card({ did: "495000002", mid: "6000", name: "组外作者", kind: "video", title: "组外动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const uid = "95006";
  const requests = [];
  const duplicatePage = Array.from({ length: 50 }, (_, index) => ({
    mid: 5_000 + index % 25,
    uname: `页内重复成员${index % 25}`,
  }));
  window.document.cookie = `DedeUserID=${uid}; Path=/`;
  window.fetch = async (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed.href);
    if (parsed.pathname === "/x/web-interface/nav") {
      return apiResponse({ isLogin: true, mid: uid, uname: "页内重复账号" });
    }
    if (parsed.pathname === "/x/relation/tags") {
      return apiResponse([{ tagid: 35, name: "页内重复分组", count: 50 }]);
    }
    if (parsed.pathname === "/x/relation/tag" && parsed.searchParams.get("tagid") === "35") {
      return apiResponse(parsed.searchParams.get("pn") === "1" ? duplicatePage : []);
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.eval(await bundlePromise);

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow?.querySelector('.group-row[data-group-id="35"]'));
  }, 2_000);
  const shadow = window.document.getElementById("btf-root").shadowRoot;
  shadow.querySelector('.group-row[data-group-id="35"]').click();
  await waitFor(() => {
    assert.equal(shadow.querySelector('.group-row[data-group-id="35"]').getAttribute("aria-pressed"), "false");
    assert.equal(shadow.querySelector(".brand-status").dataset.kind, "warning");
    assert.match(shadow.querySelector(".toast-message").textContent, /已取消条件/);
    for (const wrapper of window.document.querySelectorAll(".bili-dyn-list__item")) {
      assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false);
    }
    assert.equal(savedSettings(window).groupStatesByUid[uid]?.["35"], undefined);
  }, 2_000);

  const memberPages = requests
    .map((url) => new URL(url))
    .filter((url) => url.pathname === "/x/relation/tag")
    .map((url) => url.searchParams.get("pn"));
  assert.deepEqual(memberPages, ["1"]);
  assert.deepEqual(jsErrors, []);
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("a hydrated unknown card is re-evaluated when it becomes a known other type", async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div class="bili-dyn-list"><div class="bili-dyn-list__items">
      <div class="bili-dyn-list__item"><div class="bili-dyn-item">
        <div class="bili-dyn-item__header" data-mid="501">
          <span class="bili-dyn-title__text">延迟水合作者</span><div class="bili-dyn-item__more"></div>
        </div>
        <div class="pending-content">延迟正文</div>
      </div></div>
    </div></div>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.eval(await bundlePromise);

  await waitFor(() => assert.equal(window.document.querySelectorAll(".btf-card-tools").length, 1));
  const root = window.document.getElementById("btf-root");
  const shadow = root.shadowRoot;
  const wrapper = window.document.querySelector(".bili-dyn-list__item");
  shadow.querySelector(".launcher").click();
  shadow.querySelector("button[data-type='other']").click();
  await waitFor(() => assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false));

  // The framework reuses the same wrapper and only changes a class as content
  // hydrates. `typeKnown` must participate in the incremental signature.
  const content = wrapper.querySelector(".pending-content");
  content.className = "bili-dyn-content";
  await waitFor(() => assert.equal(wrapper.dataset.btfHiddenReason, "type"));

  content.className = "bili-dyn-content dyn-card-opus";
  const trustedTarget = window.document.createElement("span");
  content.append(trustedTarget);
  await waitFor(() => {
    assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(wrapper.querySelector("[data-action='watch']").disabled, true);
  });
  // Some cards expose their target by setting only data-url after hydration.
  trustedTarget.setAttribute("data-url", "/opus/500000001");
  await waitFor(() => assert.equal(wrapper.querySelector("[data-action='watch']").disabled, false));

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("a session-hidden card stays hidden when its unstable fingerprint changes", async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div class="bili-dyn-list"><div class="bili-dyn-list__items">
      <div class="bili-dyn-list__item"><div class="bili-dyn-item">
        <div class="bili-dyn-item__header" data-mid="601">
          <span class="bili-dyn-title__text">无外层ID作者</span>
          <div class="bili-dyn-time">刚刚</div><div class="bili-dyn-item__more"></div>
        </div>
        <div class="bili-dyn-content">
          <a class="bili-dyn-card-video" href="/video/BV1xx411c7mD">
            <span class="bili-dyn-card-video__title">同一动态的强链接</span>
          </a>
          <span class="engagement">互动数 1</span>
        </div>
      </div></div>
    </div></div>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.eval(await bundlePromise);

  const wrapper = window.document.querySelector(".bili-dyn-list__item");
  await waitFor(() => assert.ok(wrapper.querySelector("[data-action='hide']")));
  wrapper.querySelector("[data-action='hide']").click();
  await waitFor(() => assert.equal(wrapper.dataset.btfHiddenReason, "manual"));

  wrapper.querySelector(".bili-dyn-time").textContent = "1分钟前";
  wrapper.querySelector(".engagement").textContent = "互动数 999";
  await new Promise((resolve) => window.setTimeout(resolve, 40));
  assert.equal(wrapper.dataset.btfHiddenReason, "manual");

  const shadow = window.document.getElementById("btf-root").shadowRoot;
  shadow.querySelector(".launcher").click();
  shadow.querySelector(".enabled-switch").click();
  await waitFor(() => assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false));
  shadow.querySelector(".enabled-switch").click();
  await waitFor(() => assert.equal(wrapper.dataset.btfHiddenReason, "manual"));

  // If hydration later yields a stable ID, Undo must remove the migrated
  // persistent record as well as the original session fingerprint.
  wrapper.setAttribute("data-did", "600000001");
  await waitFor(() => {
    const hidden = JSON.parse(window.localStorage.getItem("__bilibili_timeline_focus_v1__:hidden:anonymous") || "{}");
    assert.ok(hidden["d:600000001"]);
  });
  shadow.querySelector(".toast-action").click();
  await waitFor(() => assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false));
  const hidden = JSON.parse(window.localStorage.getItem("__bilibili_timeline_focus_v1__:hidden:anonymous") || "{}");
  assert.equal(hidden["d:600000001"], undefined);

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("identical id-less cards keep session hide scoped to the operated wrapper", async () => {
  const duplicate = `
    <div class="bili-dyn-list__item"><div class="bili-dyn-item">
      <div class="bili-dyn-item__header" data-mid="605">
        <span class="bili-dyn-title__text">完全相同作者</span>
        <div class="bili-dyn-time">刚刚</div><div class="bili-dyn-item__more"></div>
      </div>
      <div class="bili-dyn-content">
        <a class="bili-dyn-card-video" href="/video/BV1ah411c7mP">
          <span class="bili-dyn-card-video__title">完全相同正文</span>
        </a>
      </div>
    </div></div>`;
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div class="bili-dyn-list"><div class="bili-dyn-list__items">${duplicate}${duplicate}</div></div>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.eval(await bundlePromise);

  const wrappers = window.document.querySelectorAll(".bili-dyn-list__item");
  await waitFor(() => assert.equal(window.document.querySelectorAll(".btf-card-tools").length, 2));
  wrappers[0].querySelector("[data-action='hide']").click();
  await waitFor(() => {
    assert.equal(wrappers[0].dataset.btfHiddenReason, "manual");
    assert.equal(wrappers[1].hasAttribute("data-btf-hidden-reason"), false);
  });

  // Force both identical models through decision evaluation again. A global
  // fingerprint Set would incorrectly transfer the first wrapper's decision.
  const shadow = window.document.getElementById("btf-root").shadowRoot;
  shadow.querySelector(".enabled-switch").click();
  await waitFor(() => assert.equal(window.document.querySelectorAll("[data-btf-hidden-reason]").length, 0));
  shadow.querySelector(".enabled-switch").click();
  await waitFor(() => {
    assert.equal(wrappers[0].dataset.btfHiddenReason, "manual");
    assert.equal(wrappers[1].hasAttribute("data-btf-hidden-reason"), false);
  });

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("a reused session-hidden wrapper releases a different author without persisting the new id", async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div class="bili-dyn-list"><div class="bili-dyn-list__items">
      <div class="bili-dyn-list__item"><div class="bili-dyn-item">
        <div class="bili-dyn-item__header" data-mid="611">
          <span class="bili-dyn-title__text">复用前作者 A</span>
          <div class="bili-dyn-time">刚刚</div><div class="bili-dyn-item__more"></div>
        </div>
        <div class="bili-dyn-content">
          <a class="bili-dyn-card-video" href="/video/BV1xx411c7mD">
            <span class="bili-dyn-card-video__title">作者 A 的动态</span>
          </a>
        </div>
      </div></div>
    </div></div>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.eval(await bundlePromise);

  const wrapper = window.document.querySelector(".bili-dyn-list__item");
  await waitFor(() => assert.ok(wrapper.querySelector("[data-action='hide']")));
  wrapper.querySelector("[data-action='hide']").click();
  await waitFor(() => assert.equal(wrapper.dataset.btfHiddenReason, "manual"));

  // A virtual list reuses the node for an unrelated author who shares the same
  // video. The common BV alias must not outweigh the conflicting author MID.
  wrapper.dataset.did = "610000002";
  const header = wrapper.querySelector(".bili-dyn-item__header");
  header.dataset.mid = "612";
  header.querySelector(".bili-dyn-title__text").textContent = "复用后作者 B";
  header.querySelector(".bili-dyn-time").innerHTML = '<a href="/opus/610000002">刚刚</a>';
  const video = wrapper.querySelector(".bili-dyn-card-video");
  video.querySelector(".bili-dyn-card-video__title").textContent = "作者 B 的动态";

  await waitFor(() => assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false));
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  const hidden = JSON.parse(window.localStorage.getItem("__bilibili_timeline_focus_v1__:hidden:anonymous") || "{}");
  assert.equal(hidden["d:610000002"], undefined);

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("a reused wrapper with the same author but a different trusted URL releases session hide", async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div class="bili-dyn-list"><div class="bili-dyn-list__items">
      <div class="bili-dyn-list__item"><div class="bili-dyn-item">
        <div class="bili-dyn-item__header" data-mid="621">
          <span class="bili-dyn-title__text">同一作者</span>
          <div class="bili-dyn-time">刚刚</div><div class="bili-dyn-item__more"></div>
        </div>
        <div class="bili-dyn-content">
          <a class="bili-dyn-card-video" href="/video/BV1xx411c7mD">
            <span class="bili-dyn-card-video__title">复用前动态</span>
          </a>
        </div>
      </div></div>
    </div></div>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.eval(await bundlePromise);

  const wrapper = window.document.querySelector(".bili-dyn-list__item");
  await waitFor(() => assert.ok(wrapper.querySelector("[data-action='hide']")));
  wrapper.querySelector("[data-action='hide']").click();
  await waitFor(() => assert.equal(wrapper.dataset.btfHiddenReason, "manual"));

  wrapper.dataset.did = "620000002";
  wrapper.querySelector(".bili-dyn-time").innerHTML = '<a href="/opus/620000002">刚刚</a>';
  const video = wrapper.querySelector(".bili-dyn-card-video");
  video.href = "/video/BV1zz411c7mF";
  video.querySelector(".bili-dyn-card-video__title").textContent = "同作者的另一条动态";

  await waitFor(() => assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false));
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  const hidden = JSON.parse(window.localStorage.getItem("__bilibili_timeline_focus_v1__:hidden:anonymous") || "{}");
  assert.equal(hidden["d:620000002"], undefined);

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("undo removes a migrated hidden id after the wrapper is released for reuse", async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div class="bili-dyn-list"><div class="bili-dyn-list__items">
      <div class="bili-dyn-list__item"><div class="bili-dyn-item">
        <div class="bili-dyn-item__header" data-mid="631">
          <span class="bili-dyn-title__text">撤销迁移作者 A</span>
          <div class="bili-dyn-time">刚刚</div><div class="bili-dyn-item__more"></div>
        </div>
        <div class="bili-dyn-content">
          <a class="bili-dyn-card-video" href="/video/BV1ae411c7mL">
            <span class="bili-dyn-card-video__title">等待稳定 ID 的动态 A</span>
          </a>
        </div>
      </div></div>
    </div></div>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.eval(await bundlePromise);

  const storageKey = "__bilibili_timeline_focus_v1__:hidden:anonymous";
  const readHidden = () => JSON.parse(window.localStorage.getItem(storageKey) || "{}");
  const wrapper = window.document.querySelector(".bili-dyn-list__item");
  await waitFor(() => assert.ok(wrapper.querySelector("[data-action='hide']")));
  wrapper.querySelector("[data-action='hide']").click();
  await waitFor(() => assert.equal(wrapper.dataset.btfHiddenReason, "manual"));

  // Shared BV evidence identifies this as hydration of A, so its new stable ID
  // is persisted and must be owned by the still-live Undo action.
  wrapper.dataset.did = "630000001";
  await waitFor(() => {
    assert.ok(readHidden()["d:630000001"]);
    assert.equal(wrapper.dataset.btfHiddenReason, "manual");
  });

  // Reuse then releases the wrapper's WeakMap tracking before the six-second
  // toast expires. Undo must use its own migration token, not the WeakMap.
  wrapper.dataset.did = "630000002";
  const header = wrapper.querySelector(".bili-dyn-item__header");
  header.dataset.mid = "632";
  header.querySelector(".bili-dyn-title__text").textContent = "复用作者 B";
  header.querySelector(".bili-dyn-time").innerHTML = '<a href="/opus/630000002">刚刚</a>';
  const video = wrapper.querySelector(".bili-dyn-card-video");
  video.href = "/video/BV1af411c7mM";
  video.querySelector(".bili-dyn-card-video__title").textContent = "复用后的动态 B";
  await waitFor(() => {
    assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false);
    assert.ok(readHidden()["d:630000001"]);
    assert.equal(readHidden()["d:630000002"], undefined);
  });

  const shadow = window.document.getElementById("btf-root").shadowRoot;
  assert.equal(shadow.querySelector(".toast-action").hidden, false);
  shadow.querySelector(".toast-action").click();
  await waitFor(() => {
    assert.equal(readHidden()["d:630000001"], undefined);
    assert.equal(readHidden()["d:630000002"], undefined);
    assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false);
  });

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("keyboard undo toast pauses timeout while focused and restores focus deterministically", async () => {
  const virtualConsole = new VirtualConsole();
  const runtimeErrors = [];
  virtualConsole.on("jsdomError", (error) => runtimeErrors.push(error));
  virtualConsole.on("error", (...args) => runtimeErrors.push(args));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "640000001", mid: "641", name: "键盘撤销作者", kind: "video", title: "键盘撤销动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.addEventListener("error", (event) => runtimeErrors.push(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => runtimeErrors.push(event.reason));
  window.eval(await bundlePromise);

  const wrapper = window.document.querySelector(".bili-dyn-list__item");
  await waitFor(() => {
    assert.ok(wrapper.querySelector("[data-action='hide']"));
    assert.match(window.document.getElementById("btf-root").shadowRoot.querySelector(".brand-status").textContent, /登录/);
  });
  const shadow = window.document.getElementById("btf-root").shadowRoot;
  shadow.querySelector(".launcher").click();
  await waitFor(() => assert.equal(shadow.activeElement, shadow.querySelector(".group-search")));

  const originalSetTimeout = window.setTimeout;
  const nativeSetTimeout = originalSetTimeout.bind(window);
  const toastDelays = [];
  window.setTimeout = (callback, delay = 0, ...args) => {
    const numericDelay = Number(delay) || 0;
    if (numericDelay === 6000) toastDelays.push(numericDelay);
    return nativeSetTimeout(callback, numericDelay === 6000 ? 45 : numericDelay, ...args);
  };

  const hideButton = wrapper.querySelector("[data-action='hide']");
  hideButton.focus();
  hideButton.click();
  await waitFor(() => {
    assert.equal(shadow.activeElement, shadow.querySelector(".toast-action"));
    assert.equal(shadow.querySelector(".toast").classList.contains("show"), true);
  });
  await new Promise((resolve) => nativeSetTimeout(resolve, 80));
  assert.equal(shadow.activeElement, shadow.querySelector(".toast-action"));
  assert.equal(shadow.querySelector(".toast").classList.contains("show"), true);

  shadow.querySelector(".toast-action").click();
  await waitFor(() => {
    assert.equal(window.document.activeElement, hideButton);
    assert.equal(wrapper.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(shadow.querySelector(".toast").classList.contains("show"), false);
  });

  hideButton.focus();
  hideButton.click();
  await waitFor(() => assert.equal(shadow.activeElement, shadow.querySelector(".toast-action")));
  shadow.querySelector(".group-search").focus();
  await new Promise((resolve) => nativeSetTimeout(resolve, 80));
  assert.equal(shadow.querySelector(".toast").classList.contains("show"), false);
  assert.ok(toastDelays.length >= 3);

  // Show it once more, then let account isolation actively dismiss it while
  // it owns focus. Panel-open policy restores focus to the group search.
  hideButton.focus();
  hideButton.click();
  await waitFor(() => assert.equal(shadow.activeElement, shadow.querySelector(".toast-action")));
  window.document.cookie = "DedeUserID=96441; Path=/";
  window.dispatchEvent(new window.Event("pageshow"));
  await waitFor(() => {
    assert.equal(shadow.querySelector(".toast").classList.contains("show"), false);
    assert.equal(shadow.activeElement, shadow.querySelector(".group-search"));
  });

  window.setTimeout = originalSetTimeout;
  assert.deepEqual(runtimeErrors, []);
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("an account cookie switch discards a stale nav result before loading account data", async () => {
  const virtualConsole = new VirtualConsole();
  const runtimeErrors = [];
  virtualConsole.on("jsdomError", (error) => runtimeErrors.push(error));
  virtualConsole.on("error", (...args) => runtimeErrors.push(args));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "500000001", mid: "501", name: "账号竞态作者", kind: "video", title: "账号竞态动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const accountA = "91001";
  const accountB = "92002";
  window.document.cookie = `DedeUserID=${accountA}; Path=/`;
  assert.match(window.document.cookie, new RegExp(`DedeUserID=${accountA}`));

  const requests = [];
  let resolveStaleNav = null;
  let navCount = 0;
  window.fetch = (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed.href);
    if (parsed.pathname === "/x/web-interface/nav") {
      navCount += 1;
      if (navCount === 1) {
        return new Promise((resolve) => {
          resolveStaleNav = () => resolve(apiResponse({
            isLogin: true,
            mid: accountA,
            uname: "旧账号 A",
          }));
        });
      }
      return Promise.resolve(apiResponse({
        isLogin: true,
        mid: accountB,
        uname: "新账号 B",
      }));
    }
    if (parsed.pathname === "/x/relation/tags") {
      return Promise.resolve(apiResponse([
        { tagid: 70, name: "B 账号分组", count: 0 },
      ]));
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.addEventListener("error", (event) => runtimeErrors.push(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => runtimeErrors.push(event.reason));

  window.eval(await bundlePromise);
  await waitFor(() => {
    assert.equal(navCount, 1);
    assert.equal(typeof resolveStaleNav, "function");
  });

  // Switch accounts while the first nav request still belongs to account A.
  window.document.cookie = `DedeUserID=${accountB}; Path=/`;
  assert.match(window.document.cookie, new RegExp(`DedeUserID=${accountB}`));
  resolveStaleNav();

  await waitFor(() => {
    assert.equal(navCount, 2);
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow);
    assert.equal(shadow.querySelectorAll(".group-row").length, 1);
    assert.match(shadow.querySelector(".group-row .group-name").textContent, /B 账号分组/);
  }, 2_000);

  const prefix = "__bilibili_timeline_focus_v1__";
  const accountAKey = `${prefix}:groups:${accountA}`;
  const accountBKey = `${prefix}:groups:${accountB}`;
  const storedForB = JSON.parse(window.localStorage.getItem(accountBKey));
  assert.equal(storedForB.uid, accountB);
  assert.deepEqual(storedForB.groups.map((group) => group.name), ["B 账号分组"]);
  assert.equal(window.localStorage.getItem(accountAKey), null);
  assert.deepEqual(
    Object.keys(window.localStorage).filter((key) => key.includes(":groups:")).sort(),
    [accountBKey],
  );
  assert.equal(
    requests.filter((url) => new URL(url).pathname === "/x/relation/tags").length,
    1,
  );
  assert.deepEqual(runtimeErrors, []);

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("a provisional cookie account becomes confirmed and retries groups without changing uid", async () => {
  const virtualConsole = new VirtualConsole();
  const runtimeErrors = [];
  virtualConsole.on("jsdomError", (error) => runtimeErrors.push(error));
  virtualConsole.on("error", (...args) => runtimeErrors.push(args));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "790000001", mid: "791", name: "账号恢复作者", kind: "video", title: "账号恢复动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const uid = "97901";
  const prefix = "__bilibili_timeline_focus_v1__";
  let pageNow = 1_000_000;
  let navCount = 0;
  let tagsCount = 0;
  window.Date.now = () => pageNow;
  window.document.cookie = `DedeUserID=${uid}; Path=/`;
  window.fetch = (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/x/web-interface/nav") {
      navCount += 1;
      if (navCount === 1) return Promise.reject(new Error("initial nav network failure"));
      return Promise.resolve(apiResponse({ isLogin: true, mid: uid, uname: "已确认账号 A" }));
    }
    if (parsed.pathname === "/x/relation/tags") {
      tagsCount += 1;
      if (tagsCount === 1) return Promise.reject(new Error("initial tags network failure"));
      return Promise.resolve(apiResponse([{ tagid: 79, name: "恢复后的分组", count: 0 }]));
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.addEventListener("error", (event) => runtimeErrors.push(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => runtimeErrors.push(event.reason));
  window.eval(await bundlePromise);

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow);
    assert.equal(navCount, 1);
    assert.equal(tagsCount, 1);
    assert.equal(shadow.querySelector(".brand-status").dataset.kind, "warning");
    assert.equal(shadow.querySelectorAll(".group-row").length, 0);
    assert.equal(shadow.querySelector(".refresh-groups").disabled, false);
  }, 2_000);

  pageNow += 31_000;
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root").shadowRoot;
    assert.equal(navCount, 2);
    assert.equal(tagsCount, 2);
    assert.equal(shadow.querySelector(".brand-status").dataset.kind, "ready");
    assert.match(shadow.querySelector(".brand-status").textContent, /已同步 1 个关注分组/);
    assert.match(shadow.querySelector(".group-name").textContent, /恢复后的分组/);
  }, 2_000);

  const stored = JSON.parse(window.localStorage.getItem(`${prefix}:groups:${uid}`));
  assert.equal(stored.uid, uid);
  assert.deepEqual(stored.groups.map((group) => group.id), ["79"]);
  assert.deepEqual(
    Object.keys(window.localStorage).filter((key) => key.includes(":groups:")).sort(),
    [`${prefix}:groups:${uid}`],
  );
  assert.deepEqual(runtimeErrors, []);

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("watch-later identity survives tracking changes and later dynamic-id hydration", async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (error) => jsErrors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      <div class="bili-dyn-list__item">
        <div class="bili-dyn-item">
          <div class="bili-dyn-item__header" data-mid="801">
            <span class="bili-dyn-title__text">收藏测试作者</span>
            <div class="bili-dyn-time">刚刚</div>
            <div class="bili-dyn-item__more"></div>
          </div>
          <div class="bili-dyn-content">
            <a class="bili-dyn-card-video" href="/video/BV1xx411c7mD?spm_id_from=first#first">
              <span class="bili-dyn-card-video__title">收藏稳定键测试</span>
            </a>
          </div>
        </div>
      </div>
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.eval(await bundlePromise);

  const wrapper = window.document.querySelector(".bili-dyn-list__item");
  const link = wrapper.querySelector(".bili-dyn-card-video");
  const watchStorageKey = "__bilibili_timeline_focus_v1__:watch:anonymous";
  const readWatch = () => JSON.parse(window.localStorage.getItem(watchStorageKey) ?? "[]");
  const watchButton = () => wrapper.querySelector("button[data-action='watch']");

  await waitFor(() => {
    assert.ok(watchButton());
    assert.equal(watchButton().disabled, false);
    assert.match(window.document.getElementById("btf-root").shadowRoot.querySelector(".brand-status").textContent, /登录/);
  });
  watchButton().click();
  let firstKey;
  await waitFor(() => {
    const stored = readWatch();
    assert.equal(stored.length, 1);
    firstKey = stored[0].id;
    assert.doesNotMatch(firstKey, /[?#]/);
    assert.equal(watchButton().getAttribute("aria-pressed"), "true");
  });

  link.setAttribute("href", "/video/BV1xx411c7mD?spm_id_from=second&from_source=dynamic#later");
  await waitFor(() => {
    const stored = readWatch();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, firstKey);
    assert.equal(watchButton().getAttribute("aria-pressed"), "true");
  });
  watchButton().click();
  await waitFor(() => {
    assert.deepEqual(readWatch(), []);
    assert.equal(watchButton().getAttribute("aria-pressed"), "false");
  });

  // Save once more, then let the reused wrapper acquire a stable dynamic ID.
  watchButton().click();
  await waitFor(() => assert.equal(readWatch().length, 1));
  wrapper.dataset.did = "800000001";
  await waitFor(() => {
    assert.equal(readWatch().length, 1);
    assert.equal(watchButton().getAttribute("aria-pressed"), "true");
  });
  watchButton().click();
  await waitFor(() => {
    assert.deepEqual(readWatch(), []);
    assert.equal(watchButton().getAttribute("aria-pressed"), "false");
  });

  assert.deepEqual(jsErrors, []);
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("a BV-only watch survives simultaneous dynamic-id and opus-primary hydration", async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (error) => jsErrors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      <div class="bili-dyn-list__item"><div class="bili-dyn-item">
        <div class="bili-dyn-item__header" data-mid="821">
          <span class="bili-dyn-title__text">主链接迁移作者</span>
          <div class="bili-dyn-time">刚刚</div>
          <div class="bili-dyn-item__more"></div>
        </div>
        <div class="bili-dyn-content">
          <a class="bili-dyn-card-video" href="/video/BV1aa411c7mG?spm_id_from=dynamic#before">
            <span class="bili-dyn-card-video__title">BV 到动态详情迁移</span>
          </a>
        </div>
      </div></div>
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.eval(await bundlePromise);

  const wrapper = window.document.querySelector(".bili-dyn-list__item");
  const storageKey = "__bilibili_timeline_focus_v1__:watch:anonymous";
  const readWatch = () => JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
  const watchButton = () => wrapper.querySelector("button[data-action='watch']");
  await waitFor(() => {
    assert.ok(watchButton());
    assert.equal(watchButton().disabled, false);
  });

  watchButton().click();
  await waitFor(() => {
    assert.equal(readWatch().length, 1);
    assert.equal(readWatch()[0].id, "BV1aa411c7mG");
    assert.equal(watchButton().getAttribute("aria-pressed"), "true");
  });

  // The same hydration turn changes both the stable identity and URL priority:
  // the timestamp's opus URL now precedes the still-present BV alias.
  wrapper.dataset.did = "820000001";
  wrapper.querySelector(".bili-dyn-time").innerHTML = '<a href="/opus/820000001">刚刚</a>';
  await waitFor(() => {
    assert.equal(watchButton().getAttribute("aria-pressed"), "true");
    assert.equal(readWatch().length, 1);
  });

  watchButton().click();
  await waitFor(() => {
    assert.equal(watchButton().getAttribute("aria-pressed"), "false");
    assert.deepEqual(readWatch(), []);
  });

  assert.deepEqual(jsErrors, []);
  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("watch drawer removal moves focus to the next, previous, then close control", async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items"></div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const storageKey = "__bilibili_timeline_focus_v1__:watch:anonymous";
  window.localStorage.setItem(storageKey, JSON.stringify([
    { id: "BV1ab411c7mH", url: "https://www.bilibili.com/video/BV1ab411c7mH", title: "第一条", addedAt: 3 },
    { id: "BV1ac411c7mJ", url: "https://www.bilibili.com/video/BV1ac411c7mJ", title: "第二条", addedAt: 2 },
    { id: "BV1ad411c7mK", url: "https://www.bilibili.com/video/BV1ad411c7mK", title: "第三条", addedAt: 1 },
  ]));
  window.fetch = async () => apiResponse(null, { code: -101, message: "账号未登录" });
  window.eval(await bundlePromise);

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow);
    assert.match(shadow.querySelector(".open-watch").textContent, /（3）/);
  });
  const shadow = window.document.getElementById("btf-root").shadowRoot;
  shadow.querySelector(".launcher").click();
  shadow.querySelector(".open-watch").click();
  await waitFor(() => assert.equal(shadow.activeElement, shadow.querySelector(".close-watch")));

  let removes = shadow.querySelectorAll(".watch-remove");
  removes[0].focus();
  removes[0].click();
  await waitFor(() => {
    const focused = shadow.activeElement;
    assert.ok(focused?.matches(".watch-remove"));
    assert.equal(focused.getAttribute("aria-label"), "移除：第二条");
    assert.equal(shadow.querySelectorAll(".watch-remove").length, 2);
  });

  removes = shadow.querySelectorAll(".watch-remove");
  removes[1].focus();
  removes[1].click();
  await waitFor(() => {
    const focused = shadow.activeElement;
    assert.ok(focused?.matches(".watch-remove"));
    assert.equal(focused.getAttribute("aria-label"), "移除：第二条");
    assert.equal(shadow.querySelectorAll(".watch-remove").length, 1);
  });

  shadow.activeElement.click();
  await waitFor(() => {
    assert.equal(shadow.querySelectorAll(".watch-remove").length, 0);
    assert.equal(shadow.activeElement, shadow.querySelector(".close-watch"));
    assert.deepEqual(JSON.parse(window.localStorage.getItem(storageKey)), []);
  });

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("cookie account changes enter isolation before the replacement nav resolves", async () => {
  const virtualConsole = new VirtualConsole();
  const runtimeErrors = [];
  virtualConsole.on("jsdomError", (error) => runtimeErrors.push(error));
  virtualConsole.on("error", (...args) => runtimeErrors.push(args));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "810000001", mid: "811", name: "A 组成员", kind: "video", title: "A 账号手动隐藏" })}
      ${card({ did: "810000002", mid: "812", name: "A 组外作者", kind: "video", title: "A 账号分组隐藏" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const accountA = "98111";
  const accountB = "98222";
  const prefix = "__bilibili_timeline_focus_v1__";
  const now = Date.now();
  window.document.cookie = `DedeUserID=${accountA}; Path=/`;
  window.localStorage.setItem(`${prefix}:settings`, JSON.stringify({
    groupStatesByUid: { [accountA]: { 81: 1 } },
  }));
  window.localStorage.setItem(`${prefix}:groups:${accountA}`, JSON.stringify({
    schemaVersion: 1,
    uid: accountA,
    fetchedAt: now,
    groups: [{
      id: "81",
      name: "A 账号分组",
      count: 1,
      loadedAt: now,
      memberMids: ["811"],
      memberNames: ["A 组成员"],
    }],
  }));
  window.localStorage.setItem(`${prefix}:hidden:${accountA}`, JSON.stringify({
    "d:810000001": now,
  }));
  window.localStorage.setItem(`${prefix}:watch:${accountA}`, JSON.stringify([{
    id: "d:810000001",
    url: "https://www.bilibili.com/opus/810000001",
    title: "A 账号收藏",
    author: "A 组成员",
    addedAt: now,
  }]));

  const requests = [];
  let navCount = 0;
  let resolveAccountBNav = null;
  window.fetch = (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed.href);
    if (parsed.pathname === "/x/web-interface/nav") {
      navCount += 1;
      if (navCount === 1) {
        return Promise.resolve(apiResponse({ isLogin: true, mid: accountA, uname: "账号 A" }));
      }
      return new Promise((resolve) => {
        resolveAccountBNav = () => resolve(apiResponse({ isLogin: true, mid: accountB, uname: "账号 B" }));
      });
    }
    if (parsed.pathname === "/x/relation/tags") {
      return Promise.resolve(apiResponse([{ tagid: 82, name: "B 账号分组", count: 0 }]));
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.addEventListener("error", (event) => runtimeErrors.push(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => runtimeErrors.push(event.reason));
  window.eval(await bundlePromise);

  const manuallyHidden = window.document.querySelector('[data-did="810000001"]');
  const groupHidden = window.document.querySelector('[data-did="810000002"]');
  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow);
    assert.equal(manuallyHidden.dataset.btfHiddenReason, "manual");
    assert.equal(groupHidden.dataset.btfHiddenReason, "group");
    assert.match(shadow.querySelector(".open-watch").textContent, /（1）/);
    assert.match(shadow.querySelector(".group-name").textContent, /A 账号分组/);
    assert.equal(
      shadow.querySelector('.group-row[data-group-id="81"]').getAttribute("aria-pressed"),
      "true",
    );
  }, 2_000);

  window.document.cookie = `DedeUserID=${accountB}; Path=/`;
  window.dispatchEvent(new window.Event("pageshow"));
  await waitFor(() => {
    assert.equal(navCount, 2);
    assert.equal(typeof resolveAccountBNav, "function");
  });

  // Account B has not resolved yet. Account A's scoped data must already be
  // detached from both rendering and decisions during this uncertainty window.
  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root").shadowRoot;
    assert.equal(manuallyHidden.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(groupHidden.hasAttribute("data-btf-hidden-reason"), false);
    assert.match(shadow.querySelector(".open-watch").textContent, /（0）/);
    assert.equal(shadow.querySelectorAll(".group-row").length, 0);
    assert.equal(shadow.querySelector(".refresh-groups").disabled, true);
  }, 2_000);
  assert.equal(window.localStorage.getItem(`${prefix}:groups:${accountB}`), null);
  assert.equal(window.localStorage.getItem(`${prefix}:hidden:${accountB}`), null);
  assert.equal(window.localStorage.getItem(`${prefix}:watch:${accountB}`), null);

  resolveAccountBNav();
  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root").shadowRoot;
    assert.match(shadow.querySelector(".group-name").textContent, /B 账号分组/);
    assert.match(shadow.querySelector(".open-watch").textContent, /（0）/);
    assert.equal(manuallyHidden.hasAttribute("data-btf-hidden-reason"), false);
    assert.equal(groupHidden.hasAttribute("data-btf-hidden-reason"), false);
  }, 2_000);
  const storedBGroups = JSON.parse(window.localStorage.getItem(`${prefix}:groups:${accountB}`));
  assert.equal(storedBGroups.uid, accountB);
  assert.deepEqual(storedBGroups.groups.map((group) => group.name), ["B 账号分组"]);
  assert.equal(JSON.parse(window.localStorage.getItem(`${prefix}:watch:${accountA}`)).length, 1);
  assert.equal(Object.keys(JSON.parse(window.localStorage.getItem(`${prefix}:hidden:${accountA}`))).length, 1);
  assert.deepEqual(runtimeErrors, []);

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});

test("a second cookie change during deferred group refresh retries the newest account", async () => {
  const virtualConsole = new VirtualConsole();
  const runtimeErrors = [];
  virtualConsole.on("jsdomError", (error) => runtimeErrors.push(error));
  virtualConsole.on("error", (...args) => runtimeErrors.push(args));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor"><div class="bili-dyn-list"><div class="bili-dyn-list__items">
      ${card({ did: "830000001", mid: "831", name: "账号连续切换作者", kind: "video", title: "账号连续切换动态" })}
    </div></div></main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const accountA = "98331";
  const accountB = "98332";
  const accountC = "98333";
  const prefix = "__bilibili_timeline_focus_v1__";
  window.document.cookie = `DedeUserID=${accountA}; Path=/`;

  let navCount = 0;
  let tagsCount = 0;
  let resolveAccountBTags = null;
  window.fetch = (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/x/web-interface/nav") {
      navCount += 1;
      if (navCount === 1) return Promise.resolve(apiResponse({ isLogin: true, mid: accountA, uname: "账号 A" }));
      if (navCount === 2) return Promise.resolve(apiResponse({ isLogin: true, mid: accountB, uname: "账号 B" }));
      if (navCount === 3) return Promise.resolve(apiResponse({ isLogin: true, mid: accountC, uname: "账号 C" }));
      throw new Error(`Unexpected nav request #${navCount}`);
    }
    if (parsed.pathname === "/x/relation/tags") {
      tagsCount += 1;
      if (tagsCount === 1) {
        return Promise.resolve(apiResponse([{ tagid: 83, name: "A 账号分组", count: 0 }]));
      }
      if (tagsCount === 2) {
        return new Promise((resolve) => {
          resolveAccountBTags = () => resolve(apiResponse([{ tagid: 84, name: "B 账号过期分组", count: 0 }]));
        });
      }
      if (tagsCount === 3) {
        return Promise.resolve(apiResponse([{ tagid: 85, name: "C 账号分组", count: 0 }]));
      }
      throw new Error(`Unexpected tags request #${tagsCount}`);
    }
    throw new Error(`Unexpected API request: ${parsed.href}`);
  };
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.addEventListener("error", (event) => runtimeErrors.push(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => runtimeErrors.push(event.reason));
  window.eval(await bundlePromise);
  const accountCard = window.document.querySelector('[data-did="830000001"]');

  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root")?.shadowRoot;
    assert.ok(shadow);
    assert.equal(navCount, 1);
    assert.equal(tagsCount, 1);
    assert.match(shadow.querySelector(".group-name").textContent, /A 账号分组/);
  }, 2_000);

  window.document.cookie = `DedeUserID=${accountB}; Path=/`;
  window.dispatchEvent(new window.Event("pageshow"));
  await waitFor(() => {
    assert.equal(navCount, 2);
    assert.equal(tagsCount, 2);
    assert.equal(typeof resolveAccountBTags, "function");
  }, 2_000);

  // B has already passed nav and owns the still-pending refresh promise. A
  // second resume for C must quarantine B immediately and remember a recheck.
  window.document.cookie = `DedeUserID=${accountC}; Path=/`;
  window.dispatchEvent(new window.Event("pageshow"));
  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root").shadowRoot;
    assert.equal(shadow.querySelectorAll(".group-row").length, 0);
    assert.equal(shadow.querySelector(".refresh-groups").disabled, true);
    const hide = accountCard.querySelector("[data-action='hide']");
    const watch = accountCard.querySelector("[data-action='watch']");
    assert.equal(hide.disabled, true);
    assert.equal(hide.title, "正在确认账号");
    assert.equal(watch.disabled, true);
    assert.equal(watch.title, "正在确认账号");
  });

  resolveAccountBTags();
  await waitFor(() => {
    const shadow = window.document.getElementById("btf-root").shadowRoot;
    assert.equal(navCount, 3);
    assert.equal(tagsCount, 3);
    assert.equal(shadow.querySelectorAll(".group-row").length, 1);
    assert.match(shadow.querySelector(".group-name").textContent, /C 账号分组/);
    const hide = accountCard.querySelector("[data-action='hide']");
    const watch = accountCard.querySelector("[data-action='watch']");
    assert.equal(hide.disabled, false);
    assert.equal(hide.title, "隐藏");
    assert.equal(watch.disabled, false);
    assert.equal(watch.title, "加入本地稍后看");
  }, 3_000);

  assert.equal(window.localStorage.getItem(`${prefix}:groups:${accountB}`), null);
  const storedC = JSON.parse(window.localStorage.getItem(`${prefix}:groups:${accountC}`));
  assert.equal(storedC.uid, accountC);
  assert.deepEqual(storedC.groups.map((group) => group.name), ["C 账号分组"]);
  assert.deepEqual(runtimeErrors, []);

  window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  dom.window.close();
});
