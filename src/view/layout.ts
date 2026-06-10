// Pure tree layout (design §1 Stage B): (tree, measured sizes, settings) →
// positions. No DOM, no obsidian — fully unit-testable. Supports right /
// left / centered directions, skips children of collapsed nodes (fold),
// and assigns each first-level subtree a stable branch index for coloring.
// The prototype always does a FULL relayout (design priority rule 4).

import type { MindNode } from "../model/types";

/** Which way branches grow from the root. */
export type LayoutDirection = "right" | "left" | "centered";

/** Measured box of a rendered node (read from the DOM before layout runs). */
export interface Size {
  w: number;
  h: number;
}

/** Layout output for one node. Coordinates are the box's top-left corner
 *  in world space (the pan/zoom container's coordinate system). */
export interface NodeLayout {
  x: number;
  y: number;
  /** Which side of the root this node hangs on (drives edge anchors). */
  side: "left" | "right";
  /** Index of the node's first-level ancestor among root.children
   *  (root itself = -1). Drives branch colors. */
  branchIndex: number;
}

/** Whole-tree layout result. Nodes hidden under a collapsed ancestor are
 *  simply absent from `positions`. */
export interface LayoutResult {
  positions: Map<string, NodeLayout>;
  /** Bounding box of all positioned nodes (for recenter / fit). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Spacing knobs — all come from settings, never hardcoded at call sites.
 *  Defaults mirror v1's constants (levelDis 40 / nodeDis 8 / firstLevelDis
 *  80 / firstNodeDis 20) plus the new subtree-boundary gap (wishlist #4). */
export interface LayoutSettings {
  direction: LayoutDirection;
  /** Horizontal gap between a parent and its children. */
  levelGap: number;
  /** Horizontal gap between the root and its direct children. */
  rootLevelGap: number;
  /** Vertical gap between adjacent sibling subtrees. */
  siblingGap: number;
  /** Vertical gap between the root's direct child subtrees. */
  rootSiblingGap: number;
  /** EXTRA vertical gap added between neighbors when either neighbor has
   *  visible children — keeps separate branches visually apart. */
  subtreeGap: number;
}

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  direction: "right",
  levelGap: 40,
  rootLevelGap: 80,
  siblingGap: 8,
  rootSiblingGap: 20,
  subtreeGap: 12,
};

/** Size lookup. Unknown ids fall back to a sane box so layout never breaks
 *  mid-render (e.g. an image still loading). */
export type SizeLookup = (id: string) => Size | undefined;

const FALLBACK_SIZE: Size = { w: 120, h: 32 };

/**
 * Lay out the whole tree. The root's box is centered on world (0, 0).
 * Pure: reads the tree, writes nothing, same input → same output.
 */
export function layoutTree(
  root: MindNode,
  sizeOf: SizeLookup,
  settings: LayoutSettings
): LayoutResult {
  const positions = new Map<string, NodeLayout>();
  const size = (n: MindNode): Size => sizeOf(n.id) ?? FALLBACK_SIZE;
  const kids = (n: MindNode): MindNode[] => (n.collapsed ? [] : n.children);

  // ---- pass 1: subtree extents (vertical space each subtree needs) ----
  const gapBetween = (a: MindNode, b: MindNode, base: number): number => {
    const eitherHasKids = kids(a).length > 0 || kids(b).length > 0;
    return base + (eitherHasKids ? settings.subtreeGap : 0);
  };

  const heights = new Map<string, number>();
  const subtreeHeight = (n: MindNode): number => {
    const cached = heights.get(n.id);
    if (cached !== undefined) return cached;
    const own = size(n).h;
    const children = kids(n);
    let h = own;
    if (children.length > 0) {
      let sum = 0;
      for (let i = 0; i < children.length; i++) {
        sum += subtreeHeight(children[i]);
        if (i < children.length - 1) {
          sum += gapBetween(children[i], children[i + 1], settings.siblingGap);
        }
      }
      h = Math.max(own, sum);
    }
    heights.set(n.id, h);
    return h;
  };

  // ---- pass 2: place boxes ----
  const rootSize = size(root);
  positions.set(root.id, {
    x: -rootSize.w / 2,
    y: -rootSize.h / 2,
    side: settings.direction === "left" ? "left" : "right",
    branchIndex: -1,
  });

  /** Place `node`'s children stacked around centerY, growing toward `side`. */
  const placeChildren = (
    node: MindNode,
    nodeX: number,
    centerY: number,
    side: "left" | "right",
    levelGap: number,
    siblingGap: number,
    branchOf: (child: MindNode, i: number) => number
  ): void => {
    const children = kids(node);
    if (children.length === 0) return;
    let total = 0;
    for (let i = 0; i < children.length; i++) {
      total += subtreeHeight(children[i]);
      if (i < children.length - 1) {
        total += gapBetween(children[i], children[i + 1], siblingGap);
      }
    }
    const nodeW = size(node).w;
    let cursor = centerY - total / 2;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childSize = size(child);
      const childCenterY = cursor + subtreeHeight(child) / 2;
      const childX =
        side === "right"
          ? nodeX + nodeW + levelGap
          : nodeX - levelGap - childSize.w;
      const branchIndex = branchOf(child, i);
      positions.set(child.id, {
        x: childX,
        y: childCenterY - childSize.h / 2,
        side,
        branchIndex,
      });
      placeChildren(
        child,
        childX,
        childCenterY,
        side,
        settings.levelGap,
        settings.siblingGap,
        () => branchIndex // descendants inherit the first-level branch index
      );
      cursor += subtreeHeight(child);
      if (i < children.length - 1) {
        cursor += gapBetween(child, children[i + 1], siblingGap);
      }
    }
  };

  const rootChildren = kids(root);
  const firstLevelBranch = (child: MindNode): number =>
    root.children.indexOf(child); // document-order index, stable across folds

  if (settings.direction === "centered" && rootChildren.length > 1) {
    // Split first-level subtrees into a right and a left group, balanced by
    // the vertical space they need, keeping document order within each side.
    const { right, left } = splitForCentered(rootChildren, subtreeHeight);
    const sided: Array<[MindNode[], "left" | "right"]> = [
      [right, "right"],
      [left, "left"],
    ];
    for (const [group, side] of sided) {
      if (group.length === 0) continue;
      // Place each side as if it were the root's full child list.
      // (Per-subtree extents are independent of the grouping, so the
      // heights cache stays valid.)
      const sideRoot: MindNode = { ...root, children: group, collapsed: false };
      placeChildren(
        sideRoot,
        -rootSize.w / 2,
        0,
        side,
        settings.rootLevelGap,
        settings.rootSiblingGap,
        (child) => firstLevelBranch(child)
      );
    }
  } else {
    const side: "left" | "right" =
      settings.direction === "left" ? "left" : "right";
    placeChildren(
      root,
      -rootSize.w / 2,
      0,
      side,
      settings.rootLevelGap,
      settings.rootSiblingGap,
      (child) => firstLevelBranch(child)
    );
  }

  // ---- bounds ----
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [id, p] of positions) {
    const s = sizeOf(id) ?? FALLBACK_SIZE;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + s.w > maxX) maxX = p.x + s.w;
    if (p.y + s.h > maxY) maxY = p.y + s.h;
  }
  if (positions.size === 0) minX = minY = maxX = maxY = 0;

  return { positions, bounds: { minX, minY, maxX, maxY } };
}

/** Balanced split for the centered direction: fill the right side until it
 *  holds at least half the total extent, the rest goes left. Document order
 *  is preserved inside each side. */
function splitForCentered(
  children: MindNode[],
  extentOf: (n: MindNode) => number
): { right: MindNode[]; left: MindNode[] } {
  const total = children.reduce((sum, c) => sum + extentOf(c), 0);
  const right: MindNode[] = [];
  const left: MindNode[] = [];
  let rightSum = 0;
  for (const child of children) {
    if (rightSum < total / 2) {
      right.push(child);
      rightSum += extentOf(child);
    } else {
      left.push(child);
    }
  }
  // Never leave one side empty when there are 2+ children.
  if (left.length === 0 && right.length > 1) left.push(right.pop()!);
  return { right, left };
}

/** Edge anchor points for parent→child connectors, derived from layout.
 *  Right-side child: leave the parent's right edge, enter the child's left
 *  edge (mirrored for left-side children). Pure helper used by edges.ts. */
export function edgeAnchors(
  parentPos: NodeLayout,
  parentSize: Size,
  childPos: NodeLayout,
  childSize: Size
): { x1: number; y1: number; x2: number; y2: number } {
  const y1 = parentPos.y + parentSize.h / 2;
  const y2 = childPos.y + childSize.h / 2;
  if (childPos.side === "right") {
    return { x1: parentPos.x + parentSize.w, y1, x2: childPos.x, y2 };
  }
  return { x1: parentPos.x, y1, x2: childPos.x + childSize.w, y2 };
}
