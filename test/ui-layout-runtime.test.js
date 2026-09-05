import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";

const SETTINGS_KEY = "__bilibili_timeline_focus_v1__:settings";
const bundlePromise = build({
  entryPoints: [fileURLToPath(new URL("../src/main.js", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["chrome105", "firefox102"],
  logLevel: "silent",
}).then((result) => result.outputFiles[0].text);

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

function savedSettings(window) {
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  return raw ? JSON.parse(raw) : null;
}

function pointerEvent(window, type, {
  pointerId = 1,
  clientX = 0,
  clientY = 0,
  button = 0,
} = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button,
  });
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: pointerId },
    isPrimary: { configurable: true, value: true },
    pointerType: { configurable: true, value: "mouse" },
  });
  return event;
}

function mouseClick(window, element) {
  element.dispatchEvent(new window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    detail: 1,
  }));
}

async function createRuntime({ settings = null, visualViewportState = null } = {}) {
  const virtualConsole = new VirtualConsole();
  const runtimeErrors = [];
  virtualConsole.on("jsdomError", (error) => runtimeErrors.push(error));
  virtualConsole.on("error", (...args) => runtimeErrors.push(args));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <main class="bili-dyn-home--visitor">
      <div class="bili-dyn-list"><div class="bili-dyn-list__items"></div></div>
    </main>
  </body></html>`, {
    url: "https://t.bilibili.com/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  Object.defineProperties(window, {
    innerWidth: { configurable: true, value: 900 },
    innerHeight: { configurable: true, value: 700 },
  });
  let visualViewport = null;
  if (visualViewportState) {
    visualViewport = new window.EventTarget();
    Object.defineProperties(visualViewport, {
      offsetLeft: { configurable: true, get: () => visualViewportState.left },
      offsetTop: { configurable: true, get: () => visualViewportState.top },
      width: { configurable: true, get: () => visualViewportState.width },
      height: { configurable: true, get: () => visualViewportState.height },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: visualViewport });
  }
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ code: -101, message: "账号未登录", data: { isLogin: false } }),
  });
  if (settings) window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  window.eval(await bundlePromise);
  await waitFor(() => assert.ok(window.document.getElementById("btf-root")?.shadowRoot));
  const root = window.document.getElementById("btf-root");
  return { dom, window, root, shadow: root.shadowRoot, runtimeErrors, visualViewport };
}

function destroyRuntime(runtime) {
  runtime.window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  runtime.dom.window.close();
  assert.deepEqual(runtime.runtimeErrors, []);
}

test("launcher corner selector supports four fixed positions and restores the saved corner after a fresh load", async () => {
  const runtime = await createRuntime();
  const { window, root, shadow } = runtime;
  const expected = {
    "bottom-left": { left: 18, top: 630, edgeX: "left", edgeY: "bottom" },
    "bottom-right": { left: 834, top: 630, edgeX: "right", edgeY: "bottom" },
    "top-left": { left: 18, top: 76, edgeX: "left", edgeY: "top" },
    "top-right": { left: 834, top: 76, edgeX: "right", edgeY: "top" },
  };
  const inwardDirections = {
    "bottom-left": new Set(["up", "right"]),
    "bottom-right": new Set(["up", "left"]),
    "top-left": new Set(["down", "right"]),
    "top-right": new Set(["down", "left"]),
  };
  const panel = shadow.querySelector(".panel");
  panel.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 260,
    bottom: 180,
    width: 260,
    height: 180,
    x: 0,
    y: 0,
    toJSON() {},
  });
  assert.equal(root.dataset.launcherCorner, "bottom-right");
  shadow.querySelector(".launcher").click();
  const corner = shadow.querySelector(".launcher-corner");
  for (const [value, placement] of Object.entries(expected)) {
    corner.value = value;
    corner.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(savedSettings(window).launcherCorner, value);
    assert.equal(Number.parseFloat(root.style.left), placement.left);
    assert.equal(Number.parseFloat(root.style.top), placement.top);
    assert.equal(root.dataset.launcherCorner, value);
    assert.equal(root.dataset.edgeX, placement.edgeX);
    assert.equal(root.dataset.edgeY, placement.edgeY);
    assert.ok(inwardDirections[value].has(panel.dataset.direction), `${value} opens ${panel.dataset.direction}`);
    assert.ok(Number.parseFloat(panel.style.left) >= 10);
    assert.ok(Number.parseFloat(panel.style.left) + 260 <= 890);
    assert.ok(Number.parseFloat(panel.style.top) >= 10);
    assert.ok(Number.parseFloat(panel.style.top) + 180 <= 690);
  }

  corner.value = "top-left";
  corner.dispatchEvent(new window.Event("change", { bubbles: true }));
  const persistedSettings = savedSettings(window);
  assert.equal("launcherPosition" in persistedSettings, false);

  destroyRuntime(runtime);

  const restored = await createRuntime({ settings: persistedSettings });
  assert.equal(restored.root.dataset.launcherCorner, "top-left");
  assert.equal(Number.parseFloat(restored.root.style.left), 18);
  assert.equal(Number.parseFloat(restored.root.style.top), 76);
  assert.equal(restored.shadow.querySelector(".launcher-corner").value, "top-left");
  destroyRuntime(restored);

  const migrated = await createRuntime({
    settings: { launcherPosition: { x: 0.1, y: 0.9 }, dock: "right" },
  });
  assert.equal(migrated.root.dataset.launcherCorner, "bottom-left");
  assert.equal(Number.parseFloat(migrated.root.style.left), 18);
  assert.equal(Number.parseFloat(migrated.root.style.top), 630);
  assert.equal(migrated.shadow.querySelector(".launcher-corner").value, "bottom-left");
  destroyRuntime(migrated);
});

test("pointer drags and arrow keys cannot move a fixed corner, while resize and click remain functional", async () => {
  const visualViewportState = { left: 0, top: 0, width: 900, height: 700 };
  const runtime = await createRuntime({
    settings: { launcherCorner: "top-right" },
    visualViewportState,
  });
  const { window, root, shadow, visualViewport } = runtime;
  const launcher = shadow.querySelector(".launcher");
  const startX = Number.parseFloat(root.style.left) + 24;
  const startY = Number.parseFloat(root.style.top) + 24;

  launcher.dispatchEvent(pointerEvent(window, "pointerdown", { clientX: startX, clientY: startY }));
  window.dispatchEvent(pointerEvent(window, "pointermove", { clientX: startX - 300, clientY: startY + 300 }));
  window.dispatchEvent(pointerEvent(window, "pointerup", { clientX: startX - 300, clientY: startY + 300 }));
  launcher.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }));
  assert.equal(Number.parseFloat(root.style.left), 834);
  assert.equal(Number.parseFloat(root.style.top), 76);
  assert.equal(savedSettings(window).launcherCorner, "top-right");
  assert.equal(launcher.hasAttribute("aria-keyshortcuts"), false);
  assert.doesNotMatch(launcher.title, /拖动|方向键/);

  const panel = shadow.querySelector(".panel");
  panel.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 260,
    bottom: 180,
    width: 260,
    height: 180,
    x: 0,
    y: 0,
    toJSON() {},
  });
  mouseClick(window, launcher);
  assert.equal(root.dataset.open, "true");

  visualViewportState.width = 700;
  visualViewportState.height = 500;
  visualViewport.dispatchEvent(new window.Event("resize"));
  assert.equal(Number.parseFloat(root.style.left), 640);
  assert.equal(Number.parseFloat(root.style.top), 68);
  assert.equal(root.dataset.launcherCorner, "top-right");
  await waitFor(() => assert.ok(Number.parseFloat(panel.style.left) + 260 <= 690));
  assert.ok(Number.parseFloat(panel.style.left) >= 10);
  assert.ok(Number.parseFloat(panel.style.top) >= 10);
  assert.ok(Number.parseFloat(panel.style.top) + 180 <= 490);

  visualViewportState.left = 120;
  visualViewportState.top = 45;
  visualViewport.dispatchEvent(new window.Event("scroll"));
  assert.equal(Number.parseFloat(root.style.left), 760);
  assert.equal(Number.parseFloat(root.style.top), 113);
  await waitFor(() => assert.equal(Number.parseFloat(panel.style.left), 490));
  assert.ok(Number.parseFloat(panel.style.left) + 260 <= 810);
  assert.ok(Number.parseFloat(panel.style.top) >= 55);
  assert.ok(Number.parseFloat(panel.style.top) + 180 <= 535);

  Object.assign(visualViewportState, { left: 0, top: 0, width: 900, height: 700 });
  window.dispatchEvent(new window.Event("orientationchange"));
  assert.equal(Number.parseFloat(root.style.left), 834);
  assert.equal(Number.parseFloat(root.style.top), 76);
  await waitFor(() => assert.equal(Number.parseFloat(panel.style.left), 564));
  assert.ok(Number.parseFloat(panel.style.left) + 260 <= 890);

  destroyRuntime(runtime);
});

test("four modules collapse independently, preserve controls and focus, and restore together", async () => {
  const runtime = await createRuntime({
    settings: {
      collapsedSections: ["keywords", "groups"],
      hiddenTypes: ["video"],
      keywords: ["抽奖"],
    },
  });
  const { window, root, shadow } = runtime;
  const toggles = new Map(
    [...shadow.querySelectorAll(".section-toggle[data-section-id]")]
      .map((toggle) => [toggle.dataset.sectionId, toggle]),
  );
  assert.deepEqual([...toggles.keys()], ["groups", "types", "keywords", "layout"]);

  for (const sectionId of toggles.keys()) {
    const toggle = toggles.get(sectionId);
    const content = shadow.getElementById(toggle.getAttribute("aria-controls"));
    const initiallyCollapsed = sectionId === "groups" || sectionId === "keywords";
    assert.equal(toggle.tagName, "BUTTON");
    assert.equal(toggle.getAttribute("aria-expanded"), String(!initiallyCollapsed));
    assert.equal(content.getAttribute("aria-hidden"), String(initiallyCollapsed));
    assert.equal(content.hasAttribute("inert"), initiallyCollapsed);
    assert.equal(toggle.closest(".collapsible-section").dataset.collapsed, String(initiallyCollapsed));
  }

  shadow.querySelector(".launcher").click();
  await waitFor(() => assert.equal(shadow.activeElement, toggles.get("groups")));

  const videoChip = shadow.querySelector('.type-chips [data-type="video"]');
  assert.equal(videoChip.getAttribute("aria-pressed"), "true");
  videoChip.focus();
  toggles.get("types").click();
  assert.equal(shadow.activeElement, toggles.get("types"));
  assert.deepEqual(savedSettings(window).collapsedSections, ["groups", "types", "keywords"]);

  toggles.get("types").click();
  assert.equal(videoChip.getAttribute("aria-pressed"), "true", "folding must not reset feature state");
  assert.equal(shadow.querySelector(".keywords").value, "抽奖");
  toggles.get("types").click();
  toggles.get("layout").click();
  assert.deepEqual(savedSettings(window).collapsedSections, ["groups", "types", "keywords", "layout"]);
  assert.equal(shadow.querySelectorAll('.collapsible-section[data-collapsed="true"]').length, 4);

  const persistedSettings = savedSettings(window);
  destroyRuntime(runtime);

  const restored = await createRuntime({ settings: persistedSettings });
  for (const toggle of restored.shadow.querySelectorAll(".section-toggle[data-section-id]")) {
    const content = restored.shadow.getElementById(toggle.getAttribute("aria-controls"));
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(content.getAttribute("aria-hidden"), "true");
    assert.equal(content.hasAttribute("inert"), true);
  }
  restored.shadow.querySelector('[data-section-id="groups"].section-toggle').click();
  assert.deepEqual(savedSettings(restored.window).collapsedSections, ["types", "keywords", "layout"]);
  destroyRuntime(restored);
});

test("multi-section collapse keeps panel direction stable and recomputes its bounded position", async () => {
  const runtime = await createRuntime();
  const { root, shadow } = runtime;
  const panel = shadow.querySelector(".panel");
  panel.getBoundingClientRect = () => {
    const collapsedCount = shadow.querySelectorAll('.collapsible-section[data-collapsed="true"]').length;
    const height = 540 - collapsedCount * 100;
    return {
      left: 0,
      top: 0,
      right: 260,
      bottom: height,
      width: 260,
      height,
      x: 0,
      y: 0,
      toJSON() {},
    };
  };
  shadow.querySelector(".launcher").click();
  const resolvedDirection = panel.dataset.direction;
  const expandedTop = Number.parseFloat(panel.style.top);
  assert.ok(["up", "left"].includes(resolvedDirection));

  const toggles = [...shadow.querySelectorAll(".section-toggle[data-section-id]")];
  toggles[0].click();
  await waitFor(() => assert.equal(Number.parseFloat(panel.style.top), expandedTop + 100));
  for (const toggle of toggles.slice(1)) toggle.click();
  await waitFor(() => assert.equal(Number.parseFloat(panel.style.top), expandedTop + 400));
  assert.equal(panel.dataset.direction, resolvedDirection);
  assert.ok(Number.parseFloat(panel.style.left) >= 10);
  assert.ok(Number.parseFloat(panel.style.left) + 260 <= 890);
  assert.ok(Number.parseFloat(panel.style.top) >= 10);
  assert.ok(Number.parseFloat(panel.style.top) + 140 <= 690);
  assert.equal(root.dataset.open, "true");

  destroyRuntime(runtime);
});

test("panel direction and font toolbar update layout, accessibility state, boundaries, and persistence", async () => {
  const runtime = await createRuntime();
  const { window, root, shadow } = runtime;
  const launcher = shadow.querySelector(".launcher");
  const panel = shadow.querySelector(".panel");
  panel.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 260,
    bottom: 180,
    width: 260,
    height: 180,
    x: 0,
    y: 0,
    toJSON() {},
  });
  launcher.click();

  const direction = shadow.querySelector(".panel-direction");
  direction.value = "up";
  direction.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(savedSettings(window).panelDirection, "up");
  assert.equal(root.dataset.panelDirection, "up");
  assert.equal(panel.dataset.direction, "up");
  assert.ok(Number.parseFloat(panel.style.top) < Number.parseFloat(root.style.top));

  const range = shadow.querySelector(".font-scale");
  const decrease = shadow.querySelector(".font-decrease");
  const increase = shadow.querySelector(".font-increase");
  const reset = shadow.querySelector(".font-reset");
  const value = shadow.querySelector(".font-scale-value");

  decrease.click();
  assert.equal(range.value, "90");
  assert.equal(range.getAttribute("aria-valuetext"), "90%");
  assert.equal(value.textContent, "90%");
  assert.equal(root.style.getPropertyValue("--btf-ui-font-size"), "10.8px");
  assert.equal(window.document.documentElement.style.getPropertyValue("--btf-card-action-font-size"), "10.8px");
  assert.equal(savedSettings(window).fontScale, 90);

  increase.click();
  assert.equal(range.value, "100");
  assert.equal(savedSettings(window).fontScale, 100);
  assert.equal(reset.disabled, true);

  range.value = "150";
  range.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(range.getAttribute("aria-valuetext"), "150%");
  assert.equal(root.style.getPropertyValue("--btf-ui-font-size"), "18px");
  assert.equal(savedSettings(window).fontScale, 100, "input previews without persisting");
  range.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(savedSettings(window).fontScale, 150);
  assert.equal(increase.disabled, true);
  increase.click();
  assert.equal(range.value, "150");

  range.value = "80";
  range.dispatchEvent(new window.Event("input", { bubbles: true }));
  range.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(savedSettings(window).fontScale, 80);
  assert.equal(range.getAttribute("aria-valuetext"), "80%");
  assert.equal(decrease.disabled, true);
  decrease.click();
  assert.equal(range.value, "80");

  reset.click();
  assert.equal(range.value, "100");
  assert.equal(range.getAttribute("aria-valuetext"), "100%");
  assert.equal(value.textContent, "100%");
  assert.equal(root.style.getPropertyValue("--btf-ui-font-size"), "12px");
  assert.equal(savedSettings(window).fontScale, 100);
  assert.equal(reset.disabled, true);

  destroyRuntime(runtime);
});
