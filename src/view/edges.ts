// SVG edge layer (design §1 Stage B): ONE full-size <svg> sitting under the
// node divs inside the world container. One keyed <path> per parent→child
// edge, updated in place with raw path strings — no svg library. Each path
// carries the branch CSS variable so it picks up the branch color.

import type { MindNode } from "../model/types";
import type { LayoutResult, Size } from "./layout";
import { edgeAnchors } from "./layout";

const SVG_NS = "http://www.w3.org/2000/svg";

export class EdgeLayer {
  private svg: SVGSVGElement;
  /** child-node id → its incoming edge path (keyed updates, no rebuilds). */
  private paths = new Map<string, SVGPathElement>();

  constructor(worldEl: HTMLElement) {
    // A 1x1 svg at the world origin with overflow visible: paths are drawn
    // in world coordinates directly, no sizing/offset math to corrupt.
    // (1x1, not 0x0 — the SVG spec disables rendering entirely at width 0.)
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("mn-edges");
    this.svg.setAttribute("width", "1");
    this.svg.setAttribute("height", "1");
    worldEl.appendChild(this.svg);
  }

  /**
   * Sync all edges to the current layout. An edge exists for every laid-out
   * node except the root; edges of hidden (folded-away) nodes are removed.
   */
  update(
    root: MindNode,
    layout: LayoutResult,
    sizeOf: (id: string) => Size | undefined,
    branchColor: (branchIndex: number) => string
  ): void {
    const seen = new Set<string>();

    const visit = (parent: MindNode): void => {
      if (parent.collapsed) return;
      const parentPos = layout.positions.get(parent.id);
      const parentSize = sizeOf(parent.id);
      for (const child of parent.children) {
        const childPos = layout.positions.get(child.id);
        const childSize = sizeOf(child.id);
        if (parentPos && parentSize && childPos && childSize) {
          seen.add(child.id);
          let path = this.paths.get(child.id);
          if (!path) {
            path = document.createElementNS(SVG_NS, "path");
            path.classList.add("mn-edge");
            this.svg.appendChild(path);
            this.paths.set(child.id, path);
          }
          const a = edgeAnchors(parentPos, parentSize, childPos, childSize);
          path.setAttribute("d", bezier(a.x1, a.y1, a.x2, a.y2));
          // Root edges (to first-level nodes) are drawn thicker via CSS.
          path.classList.toggle("mn-edge-root", parent.parent === null);
          path.style.setProperty(
            "--mn-branch-color",
            branchColor(childPos.branchIndex)
          );
        }
        visit(child);
      }
    };
    visit(root);

    // Drop edges whose child is gone or hidden.
    for (const [id, path] of this.paths) {
      if (!seen.has(id)) {
        path.remove();
        this.paths.delete(id);
      }
    }
  }

  destroy(): void {
    this.svg.remove();
    this.paths.clear();
  }
}

/** Horizontal cubic bezier between two anchor points. */
function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}
