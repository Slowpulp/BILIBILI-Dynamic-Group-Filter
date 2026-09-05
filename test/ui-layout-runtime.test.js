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

async function createRuntime() {
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
  window.alert = () => assert.fail("the userscript must not use blocking alerts");
  window.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ code: -101, message: "账号未登录", data: { isLogin: false } }),
  });
  window.eval(await bundlePromise);
  await waitFor(() => assert.ok(window.document.getElementById("btf-root")?.shadowRoot));
  const root = window.document.getElementById("btf-root");
  return { dom, window, root, shadow: root.shadowRoot, runtimeErrors };
}

function destroyRuntime(runtime) {
  runtime.window.__BILIBILI_TIMELINE_FOCUS_INSTANCE__?.destroy();
  runtime.dom.window.close();
  assert.deepEqual(runtime.runtimeErrors, []);
}

test("launcher drag suppresses its mouse click, persists a normalized position, and restores it after SPA remount", async () => {
  const runtime = await createRuntime();
  const { window, root, shadow } = runtime;
  const launcher = shadow.querySelector(".launcher");
  const startLeft = Number.parseFloat(root.style.left);
  const startTop = Number.parseFloat(root.style.top);
  const startX = startLeft + 24;
  const startY = startTop + 24;

  launcher.dispatchEvent(pointerEvent(window, "pointerdown", { clientX: startX, clientY: startY }));
  window.dispatchEvent(pointerEvent(window, "pointermove", {
    clientX: startX - 240,
    clientY: startY - 200,
  }));
  window.dispatchEvent(pointerEvent(window, "pointerup", {
    clientX: startX - 240,
    clientY: startY - 200,
  }));

  const draggedLeft = Number.parseFloat(root.style.left);
  const draggedTop = Number.parseFloat(root.style.top);
  assert.equal(draggedLeft, startLeft - 240);
  assert.equal(draggedTop, startTop - 200);
  mouseClick(window, launcher);
  assert.notEqual(root.dataset.open, "true");

  const persisted = savedSettings(window).launcherPosition;
  assert.ok(persisted.x > 0 && persisted.x < 1);
  assert.ok(persisted.y > 0 && persisted.y < 1);
  assert.ok(Math.abs(persisted.x - ((draggedLeft - 12) / (900 - 24 - 48))) < 1e-9);
  assert.ok(Math.abs(persisted.y - ((draggedTop - 12) / (700 - 24 - 48))) < 1e-9);

  window.history.pushState({}, "", "/away");
  await waitFor(() => assert.equal(window.document.getElementById("btf-root"), null));
  window.history.pushState({}, "", "/");
  await waitFor(() => assert.ok(window.document.getElementById("btf-root")?.shadowRoot));
  const restoredRoot = window.document.getElementById("btf-root");
  assert.ok(Math.abs(Number.parseFloat(restoredRoot.style.left) - draggedLeft) < 1e-7);
  assert.ok(Math.abs(Number.parseFloat(restoredRoot.style.top) - draggedTop) < 1e-7);

  destroyRuntime(runtime);
});

test("sub-threshold pointer movement still clicks, and keyboard activation bypasses drag click suppression", async () => {
  const runtime = await createRuntime();
  const { window, root, shadow } = runtime;
  const launcher = shadow.querySelector(".launcher");
  const startX = Number.parseFloat(root.style.left) + 24;
  const startY = Number.parseFloat(root.style.top) + 24;

  launcher.dispatchEvent(pointerEvent(window, "pointerdown", { clientX: startX, clientY: startY }));
  window.dispatchEvent(pointerEvent(window, "pointermove", { clientX: startX + 3, clientY: startY + 2 }));
  window.dispatchEvent(pointerEvent(window, "pointerup", { clientX: startX + 3, clientY: startY + 2 }));
  mouseClick(window, launcher);
  assert.equal(root.dataset.open, "true");

  shadow.querySelector(".collapse").click();
  assert.equal(root.dataset.open, "false");
  const beforeKeyboardLeft = Number.parseFloat(root.style.left);
  launcher.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }));
  assert.equal(Number.parseFloat(root.style.left), beforeKeyboardLeft - 8);
  assert.ok(savedSettings(window).launcherPosition.x < 1);
  launcher.dispatchEvent(pointerEvent(window, "pointerdown", { pointerId: 2, clientX: startX, clientY: startY }));
  window.dispatchEvent(pointerEvent(window, "pointermove", {
    pointerId: 2,
    clientX: startX - 20,
    clientY: startY - 20,
  }));
  window.dispatchEvent(pointerEvent(window, "pointerup", {
    pointerId: 2,
    clientX: startX - 20,
    clientY: startY - 20,
  }));
  launcher.click();
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
