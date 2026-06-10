// MindNode construction and structural operations: id generation, the
// id → node index (maintained on every mutation — no tree searches at
// runtime), insert/remove/move with cycle checks, depth computation,
// deep equality, and the text-path helpers for plugin-data fold persistence.

import type { MindNode, TaskState } from "./types";

/** Random 8-4-4 lowercase hex id — same shape v0.5.47 generates. */
export function newId(): string {
  const s4 = () =>
    (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
  return s4() + s4() + "-" + s4() + "-" + s4();
}

/** The strict fold-id shape (contract B1). Anything else is node text. */
export const FOLD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}$/;

/** Create a fresh node. */
export function createNode(
  text: string,
  options?: { id?: string; task?: TaskState; collapsed?: boolean }
): MindNode {
  return {
    id: options?.id ?? newId(),
    text,
    task: options?.task ?? "none",
    collapsed: options?.collapsed ?? false,
    children: [],
    parent: null,
  };
}

/** Depth-first walk in document order (root first). */
export function walk(root: MindNode, fn: (node: MindNode, depth: number) => void): void {
  const visit = (node: MindNode, depth: number) => {
    fn(node, depth);
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(root, 0);
}

/** Build the id → node index for a whole tree. */
export function buildIndex(root: MindNode): Map<string, MindNode> {
  const index = new Map<string, MindNode>();
  walk(root, (n) => index.set(n.id, n));
  return index;
}

/** Node depth: root = 0, its children = 1, … */
export function depthOf(node: MindNode): number {
  let depth = 0;
  let current = node.parent;
  while (current) {
    depth++;
    current = current.parent;
  }
  return depth;
}

/** True if `node` is `ancestor` or sits anywhere below it. */
export function isDescendantOf(node: MindNode, ancestor: MindNode): boolean {
  let current: MindNode | null = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

/** Attach `child` under `parent` at `index` (appends when out of range). */
export function attachChild(
  parent: MindNode,
  child: MindNode,
  index: number,
  indexMap?: Map<string, MindNode>
): void {
  if (isDescendantOf(parent, child)) {
    throw new Error("Cycle: cannot attach a node under its own descendant.");
  }
  child.parent = parent;
  const at = index < 0 || index > parent.children.length ? parent.children.length : index;
  parent.children.splice(at, 0, child);
  if (indexMap) walk(child, (n) => indexMap.set(n.id, n));
}

/** Detach a node from its parent; returns its old sibling index. */
export function detachChild(node: MindNode, indexMap?: Map<string, MindNode>): number {
  const parent = node.parent;
  if (!parent) throw new Error("Cannot detach the root node.");
  const at = parent.children.indexOf(node);
  parent.children.splice(at, 1);
  node.parent = null;
  if (indexMap) walk(node, (n) => indexMap.delete(n.id));
  return at;
}

/** Move a node under a new parent at the given sibling index. */
export function moveNode(node: MindNode, newParent: MindNode, index: number): void {
  if (!node.parent) throw new Error("Cannot move the root node.");
  if (isDescendantOf(newParent, node)) {
    throw new Error("Cycle: cannot move a node into its own subtree.");
  }
  const oldParent = node.parent;
  const oldIndex = oldParent.children.indexOf(node);
  oldParent.children.splice(oldIndex, 1);
  // Moving forward within the same sibling list shifts indices by one.
  let at = index;
  if (oldParent === newParent && oldIndex < index) at -= 1;
  node.parent = newParent;
  const max = newParent.children.length;
  newParent.children.splice(at < 0 || at > max ? max : at, 0, node);
}

/** Deep copy of a subtree (fresh objects, same ids). */
export function cloneSubtree(node: MindNode): MindNode {
  const copy = createNode(node.text, {
    id: node.id,
    task: node.task,
    collapsed: node.collapsed,
  });
  for (const child of node.children) {
    const childCopy = cloneSubtree(child);
    childCopy.parent = copy;
    copy.children.push(childCopy);
  }
  return copy;
}

/** Structural deep equality on the persisted fields (ids excluded —
 *  expanded nodes get fresh ids each session, so ids are not "data"). */
export function treesEqual(a: MindNode, b: MindNode): boolean {
  if (a.text !== b.text || a.task !== b.task || a.collapsed !== b.collapsed) return false;
  if (a.children.length !== b.children.length) return false;
  for (let i = 0; i < a.children.length; i++) {
    if (!treesEqual(a.children[i], b.children[i])) return false;
  }
  return true;
}

// ---- Text-path helpers for the "plugin-data" fold persistence mode ----
// A collapsed node is remembered as "Root > A > B" in plugin data so the
// markdown stays clean (contract §1.5 / T23).

const PATH_SEPARATOR = " > ";

function pathOf(node: MindNode): string {
  const parts: string[] = [];
  let current: MindNode | null = node;
  while (current) {
    parts.unshift(current.text.trim());
    current = current.parent;
  }
  return parts.join(PATH_SEPARATOR);
}

/** Collect text-paths of every collapsed node that has children. */
export function collectCollapsedPaths(root: MindNode): string[] {
  const out: string[] = [];
  walk(root, (n) => {
    if (n.collapsed && n.children.length > 0) out.push(pathOf(n));
  });
  return out;
}

/** Re-apply saved collapsed text-paths onto a freshly parsed tree. */
export function applyCollapsedPaths(root: MindNode, paths: string[]): void {
  const set = new Set(paths);
  walk(root, (n) => {
    if (set.has(pathOf(n))) n.collapsed = true;
  });
}
