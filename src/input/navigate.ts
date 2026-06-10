// Pure spatial arrow-key navigation (design §1 Stage C, keyboard.ts spec):
// given the current node, an arrow direction, and the layout result, pick
// the next node to select. Works on parent/children arrays — O(siblings) —
// plus the layout's side info for left/right semantics around the root.
// No DOM, no obsidian: fully unit-testable (tests/navigate.test.ts).

import type { MindNode } from "../model/types";
import type { LayoutResult } from "../view/layout";

export type ArrowDirection = "up" | "down" | "left" | "right";

/**
 * Resolve an arrow press to the next node, or null when there is nowhere
 * to go. Never looks at the viewport — selection moves, the view doesn't
 * (the B2 fix: navigation must not pan or zoom).
 *
 * Semantics (matches v1's spatial nav, simplified to tree walks):
 * - toward the root  = select the parent
 * - away from root   = select the middle visible child (auto-descend)
 * - up / down        = previous / next sibling on the same side; when at
 *   the first/last sibling, climb to the parent's previous/next sibling's
 *   nearest child (so up/down walks the whole flank naturally).
 */
export function navigate(
  current: MindNode,
  direction: ArrowDirection,
  layout: LayoutResult
): MindNode | null {
  const pos = layout.positions.get(current.id);
  const side = pos?.side ?? "right";

  if (direction === "left" || direction === "right") {
    // Root: go to the first visible child on that flank.
    if (!current.parent) {
      return firstChildOnSide(current, direction, layout);
    }
    const towardRoot = side === "right" ? "left" : "right";
    if (direction === towardRoot) return current.parent;
    return middleVisibleChild(current, layout);
  }

  // up / down — within the visible flank.
  const delta = direction === "up" ? -1 : 1;
  let node: MindNode = current;
  while (node.parent) {
    const siblings = visibleSiblingsOnSide(node, layout);
    const at = siblings.indexOf(node);
    const next = siblings[at + delta];
    if (next) {
      // Coming from below (up): land on the visually nearest node of that
      // subtree — its own box, which the layout centers on the subtree.
      return next;
    }
    node = node.parent; // climb and try the parent's siblings
  }
  return null;
}

/** Children of the parent that are laid out (visible) on the node's side. */
function visibleSiblingsOnSide(node: MindNode, layout: LayoutResult): MindNode[] {
  const parent = node.parent;
  if (!parent) return [node];
  const side = layout.positions.get(node.id)?.side;
  return parent.children.filter((c) => {
    const p = layout.positions.get(c.id);
    return p !== undefined && (side === undefined || p.side === side);
  });
}

/** First visible child of the root on the given flank (for root + arrows). */
function firstChildOnSide(
  root: MindNode,
  side: "left" | "right",
  layout: LayoutResult
): MindNode | null {
  const candidates = root.children.filter(
    (c) => layout.positions.get(c.id)?.side === side
  );
  return candidates[Math.floor((candidates.length - 1) / 2)] ?? null;
}

/** The middle visible child — feels closest when descending into a fan. */
function middleVisibleChild(node: MindNode, layout: LayoutResult): MindNode | null {
  if (node.collapsed) return null;
  const visible = node.children.filter((c) => layout.positions.has(c.id));
  return visible[Math.floor((visible.length - 1) / 2)] ?? null;
}
