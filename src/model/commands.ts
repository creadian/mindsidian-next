// Undoable command objects + history. Commands mutate THE TREE ONLY —
// no selection, no DOM, no timers. Each command knows how to apply and
// revert itself; History keeps undo/redo stacks (50 steps, per view).
// The caller (the view layer) owns selection and edit orchestration.

import type { MindNode, TaskState } from "./types";
import {
  attachChild,
  detachChild,
  isDescendantOf,
  moveNode,
  walk,
} from "./tree";

/** Everything a command needs: the root and the live id → node index. */
export interface TreeContext {
  root: MindNode;
  index: Map<string, MindNode>;
}

export interface Command {
  apply(ctx: TreeContext): void;
  revert(ctx: TreeContext): void;
}

function nodeOf(ctx: TreeContext, id: string): MindNode {
  const node = ctx.index.get(id);
  if (!node) throw new Error(`Unknown node id: ${id}`);
  return node;
}

/** Insert a (detached) node under a parent at a sibling index. */
export class AddNodeCommand implements Command {
  constructor(
    private readonly parentId: string,
    private readonly childIndex: number,
    private readonly node: MindNode
  ) {}
  apply(ctx: TreeContext): void {
    attachChild(nodeOf(ctx, this.parentId), this.node, this.childIndex, ctx.index);
  }
  revert(ctx: TreeContext): void {
    detachChild(this.node, ctx.index);
  }
}

/** Remove a subtree (kept in memory so undo can reattach it). */
export class RemoveNodeCommand implements Command {
  private removed: MindNode | null = null;
  private parentId = "";
  private childIndex = 0;
  constructor(private readonly nodeId: string) {}
  apply(ctx: TreeContext): void {
    const node = nodeOf(ctx, this.nodeId);
    if (!node.parent) throw new Error("Cannot remove the root node.");
    this.parentId = node.parent.id;
    this.childIndex = detachChild(node, ctx.index);
    this.removed = node;
  }
  revert(ctx: TreeContext): void {
    if (!this.removed) return;
    attachChild(nodeOf(ctx, this.parentId), this.removed, this.childIndex, ctx.index);
  }
}

/** Change a node's text. */
export class ChangeTextCommand implements Command {
  private before = "";
  constructor(private readonly nodeId: string, private readonly text: string) {}
  apply(ctx: TreeContext): void {
    const node = nodeOf(ctx, this.nodeId);
    this.before = node.text;
    node.text = this.text;
  }
  revert(ctx: TreeContext): void {
    nodeOf(ctx, this.nodeId).text = this.before;
  }
}

/** Move a node to a new parent / sibling position (cycle-checked). */
export class MoveNodeCommand implements Command {
  private oldParentId = "";
  private oldIndex = 0;
  constructor(
    private readonly nodeId: string,
    private readonly newParentId: string,
    private readonly newIndex: number
  ) {}
  apply(ctx: TreeContext): void {
    const node = nodeOf(ctx, this.nodeId);
    const target = nodeOf(ctx, this.newParentId);
    if (!node.parent) throw new Error("Cannot move the root node.");
    if (isDescendantOf(target, node)) {
      throw new Error("Cycle: cannot move a node into its own subtree.");
    }
    this.oldParentId = node.parent.id;
    this.oldIndex = node.parent.children.indexOf(node);
    moveNode(node, target, this.newIndex);
  }
  revert(ctx: TreeContext): void {
    moveNode(nodeOf(ctx, this.nodeId), nodeOf(ctx, this.oldParentId), this.oldIndex);
  }
}

/** Several commands as ONE history step (group drag, multi-delete, paste). */
export class CompositeCommand implements Command {
  private appliedCount = 0;
  constructor(private readonly commands: Command[]) {}
  apply(ctx: TreeContext): void {
    this.appliedCount = 0;
    for (const cmd of this.commands) {
      cmd.apply(ctx);
      this.appliedCount++;
    }
  }
  revert(ctx: TreeContext): void {
    for (let i = this.appliedCount - 1; i >= 0; i--) {
      this.commands[i].revert(ctx);
    }
  }
}

/** Fold or unfold a node. */
export class SetCollapsedCommand implements Command {
  private before = false;
  constructor(private readonly nodeId: string, private readonly collapsed: boolean) {}
  apply(ctx: TreeContext): void {
    const node = nodeOf(ctx, this.nodeId);
    this.before = node.collapsed;
    node.collapsed = this.collapsed;
  }
  revert(ctx: TreeContext): void {
    nodeOf(ctx, this.nodeId).collapsed = this.before;
  }
}

/** Set a node's task checkbox state. */
export class SetTaskCommand implements Command {
  private before: TaskState = "none";
  constructor(private readonly nodeId: string, private readonly task: TaskState) {}
  apply(ctx: TreeContext): void {
    const node = nodeOf(ctx, this.nodeId);
    this.before = node.task;
    node.task = this.task;
  }
  revert(ctx: TreeContext): void {
    nodeOf(ctx, this.nodeId).task = this.before;
  }
}

/** Paste subtrees as children of a target node (one history step). */
export class PasteCommand implements Command {
  private composite: CompositeCommand;
  constructor(targetId: string, subtrees: MindNode[], startIndex: number) {
    this.composite = new CompositeCommand(
      subtrees.map((tree, i) => new AddNodeCommand(targetId, startIndex + i, tree))
    );
  }
  apply(ctx: TreeContext): void {
    this.composite.apply(ctx);
  }
  revert(ctx: TreeContext): void {
    this.composite.revert(ctx);
  }
}

/** Undo/redo history — capped, per view instance. */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  constructor(private readonly ctx: TreeContext, private readonly cap = 50) {}

  /** Run a command and record it. Throws before recording on failure. */
  execute(command: Command): void {
    command.apply(this.ctx);
    this.undoStack.push(command);
    if (this.undoStack.length > this.cap) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.revert(this.ctx);
    this.redoStack.push(command);
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.apply(this.ctx);
    this.undoStack.push(command);
    return true;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }
  get redoDepth(): number {
    return this.redoStack.length;
  }
}

/** Rebuild an id index in place (used after bulk operations in tests). */
export function reindex(ctx: TreeContext): void {
  ctx.index.clear();
  walk(ctx.root, (n) => ctx.index.set(n.id, n));
}
