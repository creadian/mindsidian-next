// Model purity gate (design §1 Stage A): nothing in src/model/ may import
// from "obsidian" or touch the DOM — the whole core must run in plain node.
// Also enforces the no-module-level-mutable-state rule (no top-level let/var).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MODEL_DIR = join(__dirname, "..", "src", "model");

function modelFiles(): Array<{ name: string; content: string }> {
  return readdirSync(MODEL_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((name) => ({ name, content: readFileSync(join(MODEL_DIR, name), "utf8") }));
}

test("src/model/ never imports obsidian", () => {
  for (const { name, content } of modelFiles()) {
    assert.equal(
      /from\s+["']obsidian["']/.test(content),
      false,
      `${name} imports obsidian`
    );
  }
});

test("src/model/ never touches the DOM", () => {
  for (const { name, content } of modelFiles()) {
    assert.equal(/\bdocument\./.test(content), false, `${name} uses document.`);
    assert.equal(/\bwindow\./.test(content), false, `${name} uses window.`);
  }
});

test("src/model/ has no module-level mutable state", () => {
  for (const { name, content } of modelFiles()) {
    for (const line of content.split("\n")) {
      assert.equal(
        /^(let|var)\s/.test(line),
        false,
        `${name} declares top-level mutable state: ${line.trim()}`
      );
    }
  }
});
