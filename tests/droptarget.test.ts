// F2 drop-target search: nearest-rect within tolerance + v1 kind zones.

import { test } from "node:test";
import assert from "node:assert/strict";

import { findDropTarget, type CandidateRect } from "../src/input/dropTarget";

function rect(
  id: string,
  x: number,
  y: number,
  w = 120,
  h = 26,
  side: "left" | "right" = "right",
  isRoot = false
): CandidateRect {
  return { id, x, y, w, h, side, isRoot };
}

// Two stacked siblings with a 40px gap between them.
const upper = rect("upper", 0, 0);
const lower = rect("lower", 0, 66);

test("gap between siblings: nearer rect wins within tolerance", () => {
  // 10px below upper's bottom edge (26), 30px above lower's top (66).
  const hit = findDropTarget(60, 36, [upper, lower], 60);
  assert.equal(hit?.id, "upper");
  // 10px above lower's top edge.
  const hit2 = findDropTarget(60, 56, [upper, lower], 60);
  assert.equal(hit2?.id, "lower");
});

test("beyond tolerance: null (caller keeps the sticky target)", () => {
  assert.equal(findDropTarget(60, 300, [upper, lower], 60), null);
  assert.equal(findDropTarget(1000, 13, [upper], 24), null);
});

test("before/after split at half height (outside the child zone)", () => {
  // x=30 is in the left 25% of a right-growing node → never "child".
  assert.equal(findDropTarget(30, 5, [upper], 60)?.kind, "before");
  assert.equal(findDropTarget(30, 21, [upper], 60)?.kind, "after");
  // Points above/below the rect follow the midpoint rule too.
  assert.equal(findDropTarget(30, -8, [upper], 60)?.kind, "before");
  assert.equal(findDropTarget(30, 40, [upper], 60)?.kind, "after");
});

test("child zone: outer quarter on the growth side, mirrored for left", () => {
  // Right-growing: x >= 90 (of 120) is the child quarter.
  assert.equal(findDropTarget(95, 13, [upper], 60)?.kind, "child");
  assert.equal(findDropTarget(85, 13, [upper], 60)?.kind, "after");
  // Beyond the right edge entirely → still child.
  assert.equal(findDropTarget(130, 13, [upper], 60)?.kind, "child");
  // Left-growing node: mirrored.
  const leftNode = rect("l", 0, 0, 120, 26, "left");
  assert.equal(findDropTarget(25, 13, [leftNode], 60)?.kind, "child");
  assert.equal(findDropTarget(-8, 13, [leftNode], 60)?.kind, "child");
  assert.equal(findDropTarget(95, 13, [leftNode], 60)?.kind, "after");
});

test("root is always child", () => {
  const root = rect("root", 0, 0, 120, 26, "right", true);
  assert.equal(findDropTarget(5, 2, [root], 60)?.kind, "child");
  assert.equal(findDropTarget(115, 25, [root], 60)?.kind, "child");
});

test("caller contract: excluded ids are pre-filtered out of the rect list", () => {
  // pointer.ts filters drag.excluded before calling; with only the other
  // node present, the excluded one can never be returned.
  const hit = findDropTarget(60, 13, [lower], 200);
  assert.equal(hit?.id, "lower");
});
