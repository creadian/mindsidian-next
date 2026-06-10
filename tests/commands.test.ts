// Command/undo invariants: every command undoes to a deep-equal tree,
// the id index stays consistent through mutations, cycles are refused,
// composite commands are one history step, and the 50-step cap holds.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AddNodeCommand,
  ChangeTextCommand,
  CompositeCommand,
  History,
  MoveNodeCommand,
  PasteCommand,
  RemoveNodeCommand,
  SetCollapsedCommand,
  SetTaskCommand,
  TreeContext,
} from "../src/model/commands";
import {
  buildIndex,
  cloneSubtree,
  createNode,
  attachChild,
  treesEqual,
} from "../src/model/tree";
import type { MindNode } from "../src/model/types";

/** Build a small fixed tree: R → (A → (A1, A2), B). */
function makeTree(): { ctx: TreeContext; root: MindNode } {
  const root = createNode("R", { id: "00000000-0000-0000" });
  const a = createNode("A", { id: "aaaaaaaa-0000-0000" });
  const a1 = createNode("A1", { id: "aaaaaaaa-1111-0000" });
  const a2 = createNode("A2", { id: "aaaaaaaa-2222-0000" });
  const b = createNode("B", { id: "bbbbbbbb-0000-0000" });
  attachChild(root, a, 0);
  attachChild(a, a1, 0);
  attachChild(a, a2, 1);
  attachChild(root, b, 1);
  return { ctx: { root, index: buildIndex(root) }, root };
}

test("add + undo restores a deep-equal tree and the index", () => {
  const { ctx, root } = makeTree();
  const before = cloneSubtree(root);
  const history = new History(ctx);

  const fresh = createNode("new child");
  history.execute(new AddNodeCommand("aaaaaaaa-0000-0000", 1, fresh));
  assert.equal(ctx.index.get(fresh.id), fresh);
  assert.equal(root.children[0].children[1].text, "new child");

  history.undo();
  assert.equal(treesEqual(root, before), true);
  assert.equal(ctx.index.has(fresh.id), false);

  history.redo();
  assert.equal(root.children[0].children[1].text, "new child");
});

test("remove keeps the subtree for undo, index updated both ways", () => {
  const { ctx, root } = makeTree();
  const before = cloneSubtree(root);
  const history = new History(ctx);

  history.execute(new RemoveNodeCommand("aaaaaaaa-0000-0000"));
  assert.equal(root.children.length, 1);
  assert.equal(ctx.index.has("aaaaaaaa-1111-0000"), false); // descendants too

  history.undo();
  assert.equal(treesEqual(root, before), true);
  assert.equal(ctx.index.has("aaaaaaaa-1111-0000"), true);
});

test("root cannot be removed", () => {
  const { ctx } = makeTree();
  assert.throws(() => new RemoveNodeCommand("00000000-0000-0000").apply(ctx));
});

test("change text / task / collapsed all undo cleanly", () => {
  const { ctx, root } = makeTree();
  const before = cloneSubtree(root);
  const history = new History(ctx);

  history.execute(new ChangeTextCommand("bbbbbbbb-0000-0000", "B renamed"));
  history.execute(new SetTaskCommand("aaaaaaaa-1111-0000", "todo"));
  history.execute(new SetCollapsedCommand("aaaaaaaa-0000-0000", true));
  assert.equal(root.children[1].text, "B renamed");
  assert.equal(root.children[0].children[0].task, "todo");
  assert.equal(root.children[0].collapsed, true);

  history.undo();
  history.undo();
  history.undo();
  assert.equal(treesEqual(root, before), true);
});

test("move within the same parent adjusts the index correctly", () => {
  const { ctx, root } = makeTree();
  const history = new History(ctx);
  // Move A (index 0) after B (to index 2 in [A, B]).
  history.execute(new MoveNodeCommand("aaaaaaaa-0000-0000", "00000000-0000-0000", 2));
  assert.deepEqual(
    root.children.map((c) => c.text),
    ["B", "A"]
  );
  history.undo();
  assert.deepEqual(
    root.children.map((c) => c.text),
    ["A", "B"]
  );
});

test("move into own subtree is refused (cycle check)", () => {
  const { ctx } = makeTree();
  assert.throws(() =>
    new MoveNodeCommand("aaaaaaaa-0000-0000", "aaaaaaaa-1111-0000", 0).apply(ctx)
  );
});

test("composite command is one history step and reverts in reverse", () => {
  const { ctx, root } = makeTree();
  const before = cloneSubtree(root);
  const history = new History(ctx);

  history.execute(
    new CompositeCommand([
      new ChangeTextCommand("aaaaaaaa-1111-0000", "renamed 1"),
      new MoveNodeCommand("bbbbbbbb-0000-0000", "aaaaaaaa-0000-0000", 0),
      new SetTaskCommand("aaaaaaaa-2222-0000", "done"),
    ])
  );
  assert.equal(history.undoDepth, 1);
  assert.equal(root.children.length, 1); // B moved under A

  history.undo();
  assert.equal(treesEqual(root, before), true);
});

test("paste inserts subtrees as children and undoes as one step", () => {
  const { ctx, root } = makeTree();
  const before = cloneSubtree(root);
  const history = new History(ctx);

  const sub1 = createNode("pasted 1");
  attachChild(sub1, createNode("pasted 1.1"), 0);
  const sub2 = createNode("pasted 2");
  history.execute(new PasteCommand("bbbbbbbb-0000-0000", [sub1, sub2], 0));

  const b = root.children[1];
  assert.deepEqual(
    b.children.map((c) => c.text),
    ["pasted 1", "pasted 2"]
  );
  assert.equal(ctx.index.has(sub1.children[0].id), true);

  history.undo();
  assert.equal(treesEqual(root, before), true);
});

test("history caps at 50 steps and redo clears on new command", () => {
  const { ctx } = makeTree();
  const history = new History(ctx, 50);
  for (let i = 0; i < 60; i++) {
    history.execute(new ChangeTextCommand("bbbbbbbb-0000-0000", `text ${i}`));
  }
  assert.equal(history.undoDepth, 50);

  history.undo();
  assert.equal(history.redoDepth, 1);
  history.execute(new ChangeTextCommand("bbbbbbbb-0000-0000", "fresh"));
  assert.equal(history.redoDepth, 0);
});

test("undo/redo round-trips the whole stack to a deep-equal tree", () => {
  const { ctx, root } = makeTree();
  const before = cloneSubtree(root);
  const history = new History(ctx);

  history.execute(new ChangeTextCommand("aaaaaaaa-0000-0000", "A2.0"));
  history.execute(new MoveNodeCommand("aaaaaaaa-2222-0000", "bbbbbbbb-0000-0000", 0));
  history.execute(new RemoveNodeCommand("aaaaaaaa-1111-0000"));
  const after = cloneSubtree(root);

  while (history.undo()) {
    /* drain */
  }
  assert.equal(treesEqual(root, before), true);
  while (history.redo()) {
    /* drain */
  }
  assert.equal(treesEqual(root, after), true);
});
