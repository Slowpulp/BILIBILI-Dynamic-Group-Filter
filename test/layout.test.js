import test from "node:test";
import assert from "node:assert/strict";

import {
  clampLauncherPixels,
  launcherCornerToPixels,
  placePanel,
} from "../src/layout.js";

const VIEWPORT = {
  viewportWidth: 1000,
  viewportHeight: 800,
  margin: 12,
  launcherSize: 48,
};

test("launcher resolves to exactly four fixed viewport corners", () => {
  const expected = {
    "top-left": { x: 18, y: 76 },
    "top-right": { x: 934, y: 76 },
    "bottom-left": { x: 18, y: 730 },
    "bottom-right": { x: 934, y: 730 },
  };
  for (const [corner, pixels] of Object.entries(expected)) {
    assert.deepEqual(launcherCornerToPixels(corner, VIEWPORT), pixels);
  }
  assert.deepEqual(launcherCornerToPixels("center", VIEWPORT), expected["bottom-right"]);
});

test("launcher corners respect visual viewport offsets, compact sizing, and hard boundaries", () => {
  assert.deepEqual(
    clampLauncherPixels({ x: -100, y: 900 }, VIEWPORT),
    { x: 12, y: 740 },
  );
  assert.deepEqual(
    launcherCornerToPixels("top-left", {
      ...VIEWPORT,
      viewportLeft: 120,
      viewportTop: 45,
    }),
    { x: 138, y: 121 },
  );
  assert.deepEqual(
    launcherCornerToPixels("bottom-right", {
      viewportWidth: 600,
      viewportHeight: 500,
      margin: 12,
      launcherSize: 48,
    }),
    { x: 540, y: 440 },
  );
  assert.deepEqual(
    launcherCornerToPixels("top-right", {
      viewportWidth: 80,
      viewportHeight: 100,
      margin: 12,
      launcherSize: 48,
    }),
    { x: 20, y: 40 },
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

test("automatic panel placement opens inward from every launcher corner", () => {
  const viewport = {
    viewportWidth: 900,
    viewportHeight: 700,
    margin: 12,
    launcherSize: 48,
  };
  const inwardDirections = {
    "top-left": new Set(["down", "right"]),
    "top-right": new Set(["down", "left"]),
    "bottom-left": new Set(["up", "right"]),
    "bottom-right": new Set(["up", "left"]),
  };
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    const pixels = launcherCornerToPixels(corner, viewport);
    const anchor = { left: pixels.x, top: pixels.y, width: 48, height: 48 };
    const placement = placePanel({
      direction: "auto",
      anchor,
      panelWidth: 260,
      panelHeight: 180,
      viewportWidth: viewport.viewportWidth,
      viewportHeight: viewport.viewportHeight,
    });
    assert.ok(inwardDirections[corner].has(placement.direction), `${corner} uses ${placement.direction}`);
    assert.ok(placement.left >= 10 && placement.left + 260 <= 890, `${corner} horizontal boundary`);
    assert.ok(placement.top >= 10 && placement.top + 180 <= 690, `${corner} vertical boundary`);
  }
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
