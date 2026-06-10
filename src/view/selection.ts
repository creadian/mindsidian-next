// Selection state (design §1 Stage C): single + multi selection held on the
// view instance — pure data, no DOM (the controller paints the CSS classes).
// Includes the prune-to-top-ancestors helper used by group move/delete/copy
// so a selected ancestor never duplicates its selected descendants.
// The root node is never multi-selectable.

import type { MindNode } from "../model/types";
import { isDescendantOf } from "../model/tree";

export class Selection {
  /** The single "current" node (keyboard target). */
  private primaryId: string | null = null;
  /** Multi-selection (always includes the primary while multi is active). */
  private multiIds = new Set<string>();

  get primary(): string | null {
    return this.primaryId;
  }

  /** All selected ids: the multi set, or the primary alone, or empty. */
  get ids(): string[] {
    if (this.multiIds.size > 0) return [...this.multiIds];
    return this.primaryId ? [this.primaryId] : [];
  }

  get isMulti(): boolean {
    return this.multiIds.size > 1;
  }

  isSelected(id: string): boolean {
    return this.multiIds.has(id) || this.primaryId === id;
  }

  /** Plain select: collapse any multi-selection to this one node. */
  select(id: string): void {
    this.primaryId = id;
    this.multiIds.clear();
  }

  /**
   * Shift-click behavior: toggle a node in the multi-selection, seeding
   * from the current single selection (A selected + shift-click B ⇒ {A,B}).
   * `isRoot` nodes are refused — the root is never multi-selectable.
   */
  toggleMulti(id: string, isRoot: boolean): void {
    if (isRoot) return;
    if (this.multiIds.size === 0 && this.primaryId && this.primaryId !== id) {
      this.multiIds.add(this.primaryId);
    }
    if (this.multiIds.has(id)) {
      this.multiIds.delete(id);
    } else {
      this.multiIds.add(id);
      this.primaryId = id;
    }
    // Dropping back to one node = plain single selection.
    if (this.multiIds.size === 1) {
      this.primaryId = [...this.multiIds][0];
      this.multiIds.clear();
    }
    if (this.multiIds.size > 0 && (!this.primaryId || !this.multiIds.has(this.primaryId))) {
      this.primaryId = [...this.multiIds][0];
    }
  }

  /** Marquee: replace the whole multi set (root ids must be pre-filtered). */
  setMulti(ids: string[]): void {
    this.multiIds = new Set(ids);
    if (this.multiIds.size === 1) {
      this.primaryId = ids[0];
      this.multiIds.clear();
      return;
    }
    if (this.multiIds.size > 0 && (!this.primaryId || !this.multiIds.has(this.primaryId))) {
      this.primaryId = ids[0];
    }
  }

  /** Collapse a multi-selection to the primary node (Escape ladder step). */
  collapseToPrimary(): void {
    this.multiIds.clear();
  }

  clear(): void {
    this.primaryId = null;
    this.multiIds.clear();
  }

  /** Drop ids that no longer exist (after undo/redo/external reload). */
  pruneTo(index: Map<string, MindNode>): void {
    for (const id of [...this.multiIds]) {
      if (!index.has(id)) this.multiIds.delete(id);
    }
    if (this.primaryId && !index.has(this.primaryId)) this.primaryId = null;
    if (this.multiIds.size === 1) {
      this.primaryId = [...this.multiIds][0];
      this.multiIds.clear();
    }
  }
}

/**
 * Reduce a set of nodes to its top ancestors: any node whose ancestor is
 * also in the set is dropped. Document order is preserved. Used by group
 * drag, multi-delete, copy and cut so subtrees are never doubled.
 */
export function pruneToTopAncestors(nodes: MindNode[]): MindNode[] {
  const set = new Set(nodes);
  return nodes.filter((node) => {
    let ancestor = node.parent;
    while (ancestor) {
      if (set.has(ancestor)) return false;
      ancestor = ancestor.parent;
    }
    return true;
  });
}
