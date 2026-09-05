import test from "node:test";
import assert from "node:assert/strict";

import {
  clampLauncherPixels,
  launcherPixelsToPosition,
  launcherPositionToPixels,
  placePanel,
} from "../src/layout.js";

const VIEWPORT = {
  viewportWidth: 1000,
  viewportHeight: 800,
  margin: 12,
  launcherSize: 48,
};

test("launcher normalized positions make a stable round trip", () => {
  for (const position of [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.75 },
    { x: 1, y: 1 },
  ]) {
    const pixels = launcherPositionToPixels(position, VIEWPORT);
    const restored = launcherPixelsToPosition(pixels, VIEWPORT);
    assert.ok(Math.abs(restored.x - position.x) < 1e-12);
    assert.ok(Math.abs(restored.y - position.y) < 1e-12);
  }
});

test("launcher pixels and normalized positions are clamped to the usable viewport", () => {
  assert.deepEqual(
    clampLauncherPixels({ x: -100, y: 900 }, VIEWPORT),
    { x: 12, y: 740 },
  );
  assert.deepEqual(
    launcherPositionToPixels({ x: -2, y: 4 }, VIEWPORT),
    { x: 12, y: 740 },
  );
  assert.deepEqual(
    launcherPixelsToPosition({ x: -100, y: 900 }, VIEWPORT),
    { x: 0, y: 1 },
  );
  assert.deepEqual(
    launcherPositionToPixels({ x: 0, y: 1 }, {
      ...VIEWPORT,
      viewportLeft: 120,
      viewportTop: 45,
    }),
    { x: 132, y: 785 },
  );
});

test("null launcher position restores dock-aware legacy desktop and compact positions", () => {
  assert.deepEqual(
    launcherPositionToPixels(null, { ...VIEWPORT, dock: "right" }),
    { x: 934, y: 730 },
  );
  assert.deepEqual(
    launcherPositionToPixels(null, { ...VIEWPORT, dock: "left" }),
    { x: 18, y: 730 },
  );
  assert.deepEqual(
    launcherPositionToPixels(null, {
      viewportWidth: 600,
      viewportHeight: 500,
      dock: "right",
    }),
    { x: 540, y: 440 },
  );
});

test("placePanel supports all four explicit directions", () => {
  const base = {
    anchor: { left: 400, top: 300, width: 40, height: 40 },
    panelWidth: 200,
    panelHeight: 120,
    viewportWidth: 1000,
    viewportHeight: 800,
    margin: 10,
    gap: 10,
  };
  assert.deepEqual(placePanel({ ...base, direction: "up" }), {
    left: 320, top: 170, direction: "up",
  });
  assert.deepEqual(placePanel({ ...base, direction: "down" }), {
    left: 320, top: 350, direction: "down",
  });
  assert.deepEqual(placePanel({ ...base, direction: "left" }), {
    left: 190, top: 260, direction: "left",
  });
  assert.deepEqual(placePanel({ ...base, direction: "right" }), {
    left: 450, top: 260, direction: "right",
  });
});

test("placePanel auto chooses a fitting direction with the best available space", () => {
  const result = placePanel({
    direction: "auto",
    anchor: { left: 370, top: 500, width: 60, height: 40 },
    panelWidth: 240,
    panelHeight: 180,
    viewportWidth: 800,
    viewportHeight: 600,
  });
  assert.deepEqual(result, { left: 280, top: 310, direction: "up" });
});

test("placePanel avoids blocked explicit directions and clamps cross-axis edges", () => {
  const avoided = placePanel({
    direction: "up",
    anchor: { left: 4, top: 15, width: 40, height: 40 },
    panelWidth: 180,
    panelHeight: 100,
    viewportWidth: 500,
    viewportHeight: 400,
  });
  assert.deepEqual(avoided, { left: 10, top: 65, direction: "down" });

  const rightEdge = placePanel({
    direction: "down",
    anchor: { left: 470, top: 100, width: 20, height: 20 },
    panelWidth: 160,
    panelHeight: 100,
    viewportWidth: 500,
    viewportHeight: 400,
  });
  assert.deepEqual(rightEdge, { left: 330, top: 130, direction: "down" });

  const visualViewportOffset = placePanel({
    direction: "up",
    anchor: { left: 160, top: 100, width: 40, height: 40 },
    panelWidth: 280,
    panelHeight: 180,
    viewportWidth: 300,
    viewportHeight: 200,
    viewportLeft: 100,
    viewportTop: 50,
  });
  assert.equal(visualViewportOffset.left, 110);
  assert.equal(visualViewportOffset.top, 60);
});
