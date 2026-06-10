// T24 — property test: 500 random trees (depth ≤ 12, gnarly node texts:
// wikilinks, marks, pipes, dollars, backticks, emoji, umlauts, ^refs,
// tasks, fold states, fences, multi-line). serialize → parse → serialize
// must be a fixed point: pass 2 byte-identical to pass 1, every sample.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseBody } from "../src/model/parse";
import { serializeBody } from "../src/model/serialize";
import { createNode } from "../src/model/tree";
import type { MindNode, TaskState } from "../src/model/types";

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXT_POOL = [
  "plain node",
  "see [[Note#Heading]] and [[Other|alias]]",
  '<mark style="background:#A7E8A4;">highlighted</mark>',
  "pipes | in | text",
  "costs $60 and $100",
  "`inline code` here",
  "emoji 🌳 and more 🚀",
  "Umlaute: äöü ÄÖÜ ß",
  "block ref stays ^my-anchor",
  "url https://example.com/x?y=1",
  "==md highlight== and **bold** and _italic_",
  "#tag-like text",
  "> quoted line",
  "1. looks numbered",
  "Sub title",
  "trailing punctuation...",
  "multi\nline\ntext",
  "```js\nif (x) {\n  y(1)\n}\n```",
];

const TASKS: TaskState[] = ["none", "none", "none", "todo", "done"];

function randomTree(rand: () => number): MindNode {
  const root = createNode("Fuzz Root " + Math.floor(rand() * 1000));
  const build = (parent: MindNode, depth: number) => {
    if (depth > 12) return;
    const childCount = Math.floor(rand() * (depth === 0 ? 3 : 3.2));
    for (let i = 0; i < childCount + (depth === 0 ? 1 : 0); i++) {
      const text = TEXT_POOL[Math.floor(rand() * TEXT_POOL.length)];
      const node = createNode(text, {
        task: TASKS[Math.floor(rand() * TASKS.length)],
        collapsed: rand() < 0.15,
      });
      node.parent = parent;
      parent.children.push(node);
      if (rand() < 0.6) build(node, depth + 1);
    }
  };
  build(root, 0);
  return root;
}

test("T24: serialize → parse → serialize is a fixed point (500 trees)", () => {
  const rand = mulberry32(20260610);
  for (let sample = 0; sample < 500; sample++) {
    const tree = randomTree(rand);
    const pass1 = serializeBody(tree);
    const reparsed = parseBody(pass1, "fuzz-fallback");
    const pass2 = serializeBody(reparsed.root);
    assert.equal(
      pass2,
      pass1,
      `sample ${sample}: second serialization diverged\n--- pass1 ---\n${pass1}\n--- pass2 ---\n${pass2}`
    );
    // And a third pass for good measure — true idempotence.
    const pass3 = serializeBody(parseBody(pass2, "fuzz-fallback").root);
    assert.equal(pass3, pass2, `sample ${sample}: third pass diverged`);
  }
});
