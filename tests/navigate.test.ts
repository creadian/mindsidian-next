// Stage C spatial-navigation tests: navigate() is a pure function over the
// tree + layout result, so it runs without DOM. Covers toward/away from
// root on both flanks, up/down among siblings, flank climbing, fold, and
// the guarantee that navigation only reads (never mutates) its inputs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createNode, attachChild } from "../src/model/tree";
import type { MindNode } from "../src/model/types";
import { layoutTree, DEFAULT_LAYOUT_SETTINGS, Size } from "../src/view/layout";
import { navigate } from "../src/input/navigate";

const SIZE: Size = { w: 100, h: 40 };
const sizeOf = (): Size => SIZE;

/** R → (A → (A1, A2), B → (B1), C) — laid out to the right. */
function makeTree(): {
  root: MindNode;
  a: MindNode;
  a1: MindNode;
  a2: MindNode;
  b: MindNode;
  b1: MindNode;
  c: MindNode;
} {
  const root = createNode("R");
  const a = createNode("A");
  const a1 = createNode("A1");
  const a2 = createNode("A2");
  const b = createNode("B");
  const b1 = createNode("B1");
  const c = createNode("C");
  attachChild(root, a, 0);
  attachChild(a, a1, 0);
  attachChild(a, a2, 1);
  attachChild(root, b, 1);
  attachChild(b, b1, 0);
  attachChild(root, c, 2);
  return { root, a, a1, a2, b, b1, c };
}

function layoutOf(root: MindNode, direction: "right" | "left" | "centered" = "right") {
  return layoutTree(root, sizeOf, { ...DEFAULT_LAYOUT_SETTINGS, direction });
}

test("right flank: left goes to parent, right descends to a child", () => {
  const t = makeTree();
  const layout = layoutOf(t.root);
  assert.equal(navigate(t.a1, "left", layout), t.a);
  assert.equal(navigate(t.a, "left", layout), t.root);
  const child = navigate(t.a, "right", layout);
  assert.ok(child === t.a1 || child === t.a2);
});

test("root: arrows enter the matching flank", () => {
  const t = makeTree();
  const right = layoutOf(t.root, "right");
  assert.ok([t.a, t.b, t.c].includes(navigate(t.root, "right", right) as MindNode));
  assert.equal(navigate(t.root, "left", right), null); // nothing on the left

  const left = layoutOf(t.root, "left");
  assert.ok([t.a, t.b, t.c].includes(navigate(t.root, "left", left) as MindNode));
  assert.equal(navigate(t.root, "right", left), null);
});

test("left direction mirrors toward/away semantics", () => {
  const t = makeTree();
  const layout = layoutOf(t.root, "left");
  assert.equal(navigate(t.a1, "right", layout), t.a); // toward root
  const descend = navigate(t.a, "left", layout); // away from root
  assert.ok(descend === t.a1 || descend === t.a2);
});

test("up/down walk siblings and climb at the ends", () => {
  const t = makeTree();
  const layout = layoutOf(t.root);
  assert.equal(navigate(t.a, "down", layout), t.b);
  assert.equal(navigate(t.b, "down", layout), t.c);
  assert.equal(navigate(t.b, "up", layout), t.a);
  // At the last sibling of its level, climb: A2 down → B (parent's sibling).
  assert.equal(navigate(t.a2, "down", layout), t.b);
  // At the very top/bottom there is nowhere to go.
  assert.equal(navigate(t.a, "up", layout), null);
  assert.equal(navigate(t.c, "down", layout), null);
});

test("collapsed nodes cannot be descended into", () => {
  const t = makeTree();
  t.a.collapsed = true;
  const layout = layoutOf(t.root);
  assert.equal(navigate(t.a, "right", layout), null);
});

test("navigation never mutates the tree", () => {
  const t = makeTree();
  const layout = layoutOf(t.root);
  const before = JSON.stringify(strip(t.root));
  navigate(t.a, "down", layout);
  navigate(t.root, "right", layout);
  navigate(t.a1, "left", layout);
  assert.equal(JSON.stringify(strip(t.root)), before);
});

/** Tree to a parent-free plain object (JSON-safe). */
function strip(node: MindNode): unknown {
  return {
    text: node.text,
    collapsed: node.collapsed,
    children: node.children.map(strip),
  };
}
