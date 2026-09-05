import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("userscript metadata is installable, minimal, and version-aligned", async () => {
  const projectUrl = new URL("../", import.meta.url);
  const metadata = await readFile(new URL("src/userscript.meta.txt", projectUrl), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("package.json", projectUrl), "utf8"));
  const lines = metadata.trim().split(/\r?\n/);

  assert.equal(lines[0], "// ==UserScript==");
  assert.equal(lines.at(-1), "// ==/UserScript==");
  assert.match(metadata, /^\/\/ @match\s+https:\/\/t\.bilibili\.com\/\*$/m);
  assert.match(metadata, /^\/\/ @grant\s+none$/m);
  assert.match(metadata, /^\/\/ @inject-into\s+page$/m);
  assert.match(metadata, /^\/\/ @sandbox\s+raw$/m);
  assert.match(metadata, new RegExp(`^// @version\\s+${packageJson.version.replaceAll(".", "\\.")}$`, "m"));
  assert.doesNotMatch(metadata, /^\/\/ @require\b/m);
  assert.doesNotMatch(metadata, /^\/\/ @connect\b/m);
  const matchPatterns = lines
    .filter((line) => line.startsWith("// @match"))
    .map((line) => line.replace(/^\/\/ @match\s+/, ""));
  assert.ok(matchPatterns.length > 0);
  assert.ok(matchPatterns.every((pattern) => /^https?:\/\//.test(pattern)));
});
