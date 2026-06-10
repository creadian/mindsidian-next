// Stage B layout tests: the layout engine is a pure function
// (tree, sizes, settings) → positions, so it is tested with fake measured
// sizes and no DOM. Covers all three directions, fold, spacing, branch
// indices, bounds, purity, and the edge-anchor helper.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createNode, attachChild, walk } from "../src/model/tree";
import type { MindNode } from "../src/model/types";
import {
  layoutTree,
  edgeAnchors,
  DEFAULT_LAYOUT_SETTINGS,
  LayoutSettings,
  Size,
} from "../src/view/layout";

const SIZE: Size = { w: 100, h: 40 };
const sizeOf = (): Size => SIZE;

function settings(overrides?: Partial<LayoutSettings>): LayoutSettings {
  return { ...DEFAULT_LAYOUT_SETTINGS, ...overrides };
}

/** Root with `texts.length` children; grandchildren via nested arrays. */
function buildTree(children: Array<string | [string, string[]]>): MindNode {
  const root = createNode("Root");
  for (const spec of children) {
    if (typeof spec === "string") {
      attachChild(root, createNode(spec), -1);
    } else {
      const child = createNode(spec[0]);
      attachChild(root, child, -1);
      for (const grand of spec[1]) attachChild(child, createNode(grand), -1);
    }
  }
  return root;
}

test("right direction: children sit one level right of the root", () => {
  const root = buildTree(["A", "B", "C"]);
  const s = settings({ direction: "right" });
  const { positions } = layoutTree(root, sizeOf, s);

  const rootPos = positions.get(root.id)!;
  assert.equal(rootPos.x, -SIZE.w / 2); // root centered on (0,0)
  assert.equal(rootPos.y, -SIZE.h / 2);

  for (const child of root.children) {
    const p = positions.get(child.id)!;
    assert.equal(p.x, rootPos.x + SIZE.w + s.rootLevelGap);
    assert.equal(p.side, "right");
  }
});

test("right direction: siblings keep document order, never overlap", () => {
  const root = buildTree(["A", "B", "C", "D"]);
  const { positions } = layoutTree(root, sizeOf, settings());
  const ys = root.children.map((c) => positions.get(c.id)!.y);
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i] >= ys[i - 1] + SIZE.h, "siblings overlap or out of order");
  }
});

test("parent is vertically centered on its children", () => {
  const root = buildTree([["A", ["a1", "a2", "a3"]]]);
  const { positions } = layoutTree(root, sizeOf, settings());
  const a = root.children[0];
  const aPos = positions.get(a.id)!;
  const first = positions.get(a.children[0].id)!;
  const last = positions.get(a.children[2].id)!;
  const childrenCenter = (first.y + last.y + SIZE.h) / 2;
  const aCenter = aPos.y + SIZE.h / 2;
  assert.ok(Math.abs(aCenter - childrenCenter) < 0.001);
});

test("fold: descendants of a collapsed node get no positions", () => {
  const root = buildTree([["A", ["a1", "a2"]], "B"]);
  root.children[0].collapsed = true;
  const { positions } = layoutTree(root, sizeOf, settings());
  assert.ok(positions.has(root.children[0].id));
  assert.equal(positions.has(root.children[0].children[0].id), false);
  assert.equal(positions.has(root.children[0].children[1].id), false);
  assert.ok(positions.has(root.children[1].id));
});

test("left direction mirrors right", () => {
  const root = buildTree(["A", ["B", ["b1"]], "C"]);
  const right = layoutTree(root, sizeOf, settings({ direction: "right" }));
  const left = layoutTree(root, sizeOf, settings({ direction: "left" }));
  walk(root, (n) => {
    const r = right.positions.get(n.id)!;
    const l = left.positions.get(n.id)!;
    // Mirroring around x = 0: left edge ↔ right edge swap.
    assert.ok(Math.abs(l.x - -(r.x + SIZE.w)) < 0.001, `mirror broken at ${n.text}`);
    assert.equal(l.y, r.y, `y differs at ${n.text}`);
  });
  assert.equal(left.positions.get(root.children[0].id)!.side, "left");
});

test("centered direction uses both sides and keeps document order per side", () => {
  const root = buildTree(["A", "B", "C", "D"]);
  const { positions } = layoutTree(root, sizeOf, settings({ direction: "centered" }));
  const sides = root.children.map((c) => positions.get(c.id)!.side);
  assert.ok(sides.includes("right") && sides.includes("left"));
  // Within each side, document order = top-to-bottom order.
  for (const side of ["right", "left"] as const) {
    const ys = root.children
      .filter((c) => positions.get(c.id)!.side === side)
      .map((c) => positions.get(c.id)!.y);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1]);
  }
});

test("centered with one child falls back to a single right side", () => {
  const root = buildTree(["only"]);
  const { positions } = layoutTree(root, sizeOf, settings({ direction: "centered" }));
  assert.equal(positions.get(root.children[0].id)!.side, "right");
});

test("subtree boundary gap adds extra space next to branchy siblings", () => {
  const plainRoot = buildTree(["A", "B"]);
  const branchyRoot = buildTree([["A", ["a1"]], "B"]);
  const s = settings({ siblingGap: 8, rootSiblingGap: 8, subtreeGap: 30 });

  const gapOf = (root: MindNode): number => {
    const { positions } = layoutTree(root, sizeOf, s);
    const a = positions.get(root.children[0].id)!;
    const b = positions.get(root.children[1].id)!;
    return b.y - (a.y + SIZE.h);
  };
  // Leaf–leaf neighbors: base gap only. Branchy neighbor: base + subtreeGap.
  assert.equal(gapOf(plainRoot), 8);
  // A's subtree is taller than A itself, so measure spacing between the
  // subtree envelopes via total extent instead of the boxes directly.
  const { positions } = layoutTree(branchyRoot, sizeOf, s);
  const aTop = positions.get(branchyRoot.children[0].id)!.y;
  const bTop = positions.get(branchyRoot.children[1].id)!.y;
  // Extent of A's subtree = max(own h, child h) = 40 → gap = 8 + 30.
  assert.equal(bTop - aTop, SIZE.h + 8 + 30);
});

test("branch indices: first-level children numbered, descendants inherit", () => {
  const root = buildTree([["A", ["a1"]], ["B", ["b1"]]]);
  const { positions } = layoutTree(root, sizeOf, settings());
  assert.equal(positions.get(root.id)!.branchIndex, -1);
  assert.equal(positions.get(root.children[0].id)!.branchIndex, 0);
  assert.equal(positions.get(root.children[0].children[0].id)!.branchIndex, 0);
  assert.equal(positions.get(root.children[1].id)!.branchIndex, 1);
  assert.equal(positions.get(root.children[1].children[0].id)!.branchIndex, 1);
});

test("bounds contain every positioned box", () => {
  const root = buildTree(["A", ["B", ["b1", "b2"]], "C"]);
  const { positions, bounds } = layoutTree(root, sizeOf, settings({ direction: "centered" }));
  for (const [, p] of positions) {
    assert.ok(p.x >= bounds.minX && p.x + SIZE.w <= bounds.maxX);
    assert.ok(p.y >= bounds.minY && p.y + SIZE.h <= bounds.maxY);
  }
});

test("layout is pure: repeatable and does not mutate the tree", () => {
  const root = buildTree([["A", ["a1", "a2"]], "B"]);
  const snapshot: string[] = [];
  walk(root, (n, d) => snapshot.push(`${d}:${n.id}:${n.text}:${n.collapsed}`));

  const first = layoutTree(root, sizeOf, settings());
  const second = layoutTree(root, sizeOf, settings());
  assert.deepEqual([...first.positions], [...second.positions]);

  const after: string[] = [];
  walk(root, (n, d) => after.push(`${d}:${n.id}:${n.text}:${n.collapsed}`));
  assert.deepEqual(after, snapshot);
});

test("unknown sizes fall back instead of breaking layout", () => {
  const root = buildTree(["A"]);
  const { positions } = layoutTree(root, () => undefined, settings());
  assert.equal(positions.size, 2); // root + A still placed
});

test("edge anchors: right-side child connects right edge → left edge", () => {
  const parent = { x: 0, y: 0, side: "right" as const, branchIndex: 0 };
  const child = { x: 200, y: 100, side: "right" as const, branchIndex: 0 };
  const a = edgeAnchors(parent, SIZE, child, SIZE);
  assert.deepEqual(a, { x1: 100, y1: 20, x2: 200, y2: 120 });

  const childL = { x: -300, y: 100, side: "left" as const, branchIndex: 0 };
  const b = edgeAnchors(parent, SIZE, childL, SIZE);
  assert.deepEqual(b, { x1: 0, y1: 20, x2: -200, y2: 120 });
});

test("src/view/layout.ts stays DOM- and obsidian-free (pure)", () => {
  const content = readFileSync(
    join(__dirname, "..", "src", "view", "layout.ts"),
    "utf8"
  );
  assert.equal(/from\s+["']obsidian["']/.test(content), false);
  assert.equal(/\bdocument\./.test(content), false);
  assert.equal(/\bwindow\./.test(content), false);
});

test("1000-node synthetic tree lays out fast (full relayout budget)", () => {
  // Acceptance B says a 1000-node map must open in ~1.5s total; the pure
  // layout pass gets a generous 200ms slice of that budget here.
  const root = createNode("Root");
  let parents: MindNode[] = [root];
  let made = 1;
  while (made < 1000) {
    const next: MindNode[] = [];
    for (const p of parents) {
      for (let i = 0; i < 4 && made < 1000; i++) {
        const child = createNode(`node ${made++}`);
        attachChild(p, child, -1);
        next.push(child);
      }
    }
    parents = next;
  }
  const start = process.hrtime.bigint();
  const { positions } = layoutTree(root, sizeOf, settings());
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(positions.size, 1000);
  assert.ok(ms < 200, `layout took ${ms.toFixed(1)}ms`);
});
