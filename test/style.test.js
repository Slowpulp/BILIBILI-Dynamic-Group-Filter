import test from "node:test";
import assert from "node:assert/strict";
import { GLOBAL_STYLE, PANEL_STYLE } from "../src/style.js";

test("light palette and primary controls retain accessible contrast tokens", () => {
  const lightHost = PANEL_STYLE.slice(
    PANEL_STYLE.indexOf(":host {"),
    PANEL_STYLE.indexOf(':host([data-theme="dark"])'),
  );
  assert.match(lightHost, /--accent:\s*#006f9e;/);
  assert.match(lightHost, /--text-3:\s*#5f6670;/);
  assert.match(lightHost, /--on-accent:\s*#fff;/);
  assert.match(PANEL_STYLE, /\.button\.primary\s*\{[^}]*color:\s*var\(--on-accent\);/s);
});

test("group gesture states retain blue inclusion and red exclusion styling", () => {
  assert.match(PANEL_STYLE, /\.group-row\[data-state="1"\]\s*\{[^}]*border-color:\s*var\(--accent\);[^}]*background:\s*var\(--accent-soft\);/s);
  assert.match(PANEL_STYLE, /\.group-row\[data-state="-1"\]\s*\{[^}]*border-color:\s*var\(--danger\);[^}]*background:\s*var\(--danger-soft\);/s);
  assert.match(PANEL_STYLE, /\.group-row\[data-state="-1"\]:focus-visible\s*\{[^}]*outline-color:\s*var\(--danger\);/s);
});

test("gradient launcher SVG keeps a stable high-density icon size", () => {
  assert.match(PANEL_STYLE, /\.launcher-icon\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*overflow:\s*visible;[^}]*pointer-events:\s*none;/s);
  assert.match(PANEL_STYLE, /@media\s*\(forced-colors:\s*active\)\s*\{\s*\.launcher-icon path\s*\{\s*fill:\s*ButtonText;/s);
});

test("fixed-corner launcher remains an ordinary button beside a viewport-positioned panel", () => {
  assert.match(GLOBAL_STYLE, /#btf-root\s*\{[^}]*pointer-events:\s*none;/s);
  assert.match(PANEL_STYLE, /\.launcher\s*\{[^}]*cursor:\s*pointer;[^}]*user-select:\s*none;/s);
  assert.match(PANEL_STYLE, /\.launcher, \.panel, \.toast\s*\{\s*pointer-events:\s*auto;/s);
  assert.match(PANEL_STYLE, /\.panel\s*\{[^}]*position:\s*fixed;/s);
  assert.doesNotMatch(PANEL_STYLE, /data-dragging|cursor:\s*grab(?:bing)?|touch-action:\s*none/);
  assert.doesNotMatch(PANEL_STYLE, /data-dock/);
});

test("collapsible modules animate intrinsic height without leaving focusable layout gaps", () => {
  assert.match(PANEL_STYLE, /\.section-title\s*\{[^}]*margin:\s*0;[^}]*font:\s*inherit;/s);
  assert.match(PANEL_STYLE, /\.section-toggle\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;[^}]*cursor:\s*pointer;/s);
  assert.match(PANEL_STYLE, /\.section-collapse\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*1fr;[^}]*transition:\s*grid-template-rows\s+180ms/s);
  assert.match(PANEL_STYLE, /\.section-content\s*\{\s*min-height:\s*0;\s*overflow:\s*hidden;/s);
  assert.match(PANEL_STYLE, /\.collapsible-section\[data-collapsed="true"\] \.section-collapse\s*\{[^}]*grid-template-rows:\s*0fr;[^}]*visibility:\s*hidden;[^}]*visibility\s+0s\s+linear\s+0s;/s);
  assert.match(PANEL_STYLE, /\.collapsible-section\[data-collapsed="true"\] \.section-hint\s*\{\s*display:\s*none;/s);
  assert.match(PANEL_STYLE, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*transition-duration:\s*\.01ms\s*!important;/s);
});

test("font controls scale panel text without scaling the launcher icon", () => {
  assert.match(PANEL_STYLE, /:host\s*\{[^}]*font-size:\s*var\(--btf-ui-font-size, 12px\);/s);
  assert.match(PANEL_STYLE, /\.font-toolbar\s*\{[^}]*display:\s*grid;/s);
  assert.match(PANEL_STYLE, /:host\(\[data-font-size="large"\]\) \.settings-grid\s*\{\s*grid-template-columns:\s*1fr;/s);
  assert.match(PANEL_STYLE, /\.brand-title\s*\{[^}]*font-size:\s*1\.25em;/s);
  assert.match(PANEL_STYLE, /\.launcher\s*\{[^}]*font-size:\s*20px;/s);
});
