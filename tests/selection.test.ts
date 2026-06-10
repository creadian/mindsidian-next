// Stage C selection tests: the Selection state machine is pure data (no
// DOM), so its rules are unit-tested — shift-click seeding/toggling, the
// root never entering a multi-selection, marquee set replacement, pruning
// after undo, and prune-to-top-ancestors for group operations.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createNode, attachChild, buildIndex } from "../src/model/tree";
import type { MindNode } from "../src/model/types";
import { Selection, pruneToTopAncestors } from "../src/view/selection";

function makeTree(): { root: MindNode; a: MindNode; a1: MindNode; b: MindNode } {
  const root = createNode("R");
  const a = createNode("A");
  const a1 = createNode("A1");
  const b = createNode("B");
  attachChild(root, a, 0);
  attachChild(a, a1, 0);
  attachChild(root, b, 1);
  return { root, a, a1, b };
}

test("shift-click seeds the multi set from the single selection", () => {
  const sel = new Selection();
  sel.select("a");
  sel.toggleMulti("b", false);
  assert.deepEqual(new Set(sel.ids), new Set(["a", "b"]));
  assert.equal(sel.isMulti, true);
});

test("toggling a multi member off can collapse back to single", () => {
  const sel = new Selection();
  sel.select("a");
  sel.toggleMulti("b", false);
  sel.toggleMulti("b", false); // off again
  assert.deepEqual(sel.ids, ["a"]);
  assert.equal(sel.isMulti, false);
});

test("the root is never multi-selectable", () => {
  const sel = new Selection();
  sel.select("a");
  sel.toggleMulti("root", true);
  assert.deepEqual(sel.ids, ["a"]);
});

test("plain select collapses a multi-selection", () => {
  const sel = new Selection();
  sel.select("a");
  sel.toggleMulti("b", false);
  sel.select("c");
  assert.deepEqual(sel.ids, ["c"]);
  assert.equal(sel.isMulti, false);
});

test("marquee setMulti replaces the whole set; single hit = single select", () => {
  const sel = new Selection();
  sel.setMulti(["a", "b", "c"]);
  assert.equal(sel.isMulti, true);
  sel.setMulti(["b"]);
  assert.deepEqual(sel.ids, ["b"]);
  assert.equal(sel.isMulti, false);
});

test("pruneTo drops ids that no longer exist in the index", () => {
  const t = makeTree();
  const index = buildIndex(t.root);
  const sel = new Selection();
  sel.setMulti([t.a.id, t.b.id, "gone-1", "gone-2"]);
  sel.pruneTo(index);
  assert.deepEqual(new Set(sel.ids), new Set([t.a.id, t.b.id]));
});

test("collapseToPrimary keeps exactly the primary (Escape ladder)", () => {
  const sel = new Selection();
  sel.select("a");
  sel.toggleMulti("b", false); // primary is now b
  sel.collapseToPrimary();
  assert.deepEqual(sel.ids, ["b"]);
});

test("pruneToTopAncestors drops selected descendants of selected nodes", () => {
  const t = makeTree();
  assert.deepEqual(pruneToTopAncestors([t.a, t.a1, t.b]), [t.a, t.b]);
  assert.deepEqual(pruneToTopAncestors([t.a1, t.b]), [t.a1, t.b]);
  assert.deepEqual(pruneToTopAncestors([t.root, t.a, t.a1]), [t.root]);
});
