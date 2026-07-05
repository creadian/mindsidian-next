// Drop-target search for drag-to-reparent (F2). Pure geometry over the
// layout rects — no DOM, no obsidian imports, fully unit-testable.
//
// Why not elementFromPoint: nodes are ~26px tall with large gaps, so a
// pixel-exact hit was required and the drop arrows appeared unreliably —
// most of a drag path is over empty canvas. Nearest-rect search within a
// tolerance makes the indicator track continuously (v1's behavior).

export type DropKind = "child" | "before" | "after";

/** One candidate node rect, all coordinates in WORLD space. */
export interface CandidateRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which side of the root the node's children grow toward. */
  side: "left" | "right";
  isRoot: boolean;
}

/**
 * Nearest candidate within `tolerance` (clamped point-to-rect distance),
 * with the drop kind derived from v1's zone proportions:
 * root → always "child"; the outer quarter of the width on the
 * children-growth side (or anywhere beyond that edge) → "child";
 * otherwise above/below the vertical midpoint → "before"/"after".
 * Returns null when nothing is close enough (caller keeps the previous
 * target sticky).
 */
export function findDropTarget(
  px: number,
  py: number,
  rects: CandidateRect[],
  tolerance: number
): { id: string; kind: DropKind } | null {
  let best: CandidateRect | null = null;
  let bestDist = Infinity;
  for (const r of rects) {
    const dx = px < r.x ? r.x - px : px > r.x + r.w ? px - (r.x + r.w) : 0;
    const dy = py < r.y ? r.y - py : py > r.y + r.h ? py - (r.y + r.h) : 0;
    const d = Math.hypot(dx, dy);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  if (!best || bestDist > tolerance) return null;
  if (best.isRoot) return { id: best.id, kind: "child" };
  const inChildZone =
    best.side === "left"
      ? px <= best.x + best.w * 0.25
      : px >= best.x + best.w * 0.75;
  if (inChildZone) return { id: best.id, kind: "child" };
  return { id: best.id, kind: py < best.y + best.h / 2 ? "before" : "after" };
}
