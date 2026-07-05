// Regression tests for the 2026-07-05 audit fix round:
// EC10a commit-time text normalization, EC12 task demotion at heading
// depth, the multi-select group-move index plan, corruption-proof format
// toggles, and full numeric settings validation.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDocument, normalizeBulletText } from "../src/model/parse";
import { serializeDocument } from "../src/model/serialize";
import {
  attachChild,
  buildIndex,
  createNode,
  planGroupMove,
  treesEqual,
  cloneSubtree,
} from "../src/model/tree";
import { CompositeCommand, History, MoveNodeCommand, TreeContext } from "../src/model/commands";
import {
  applyHighlight,
  hasHighlight,
  stripHighlight,
  toggleMarker,
} from "../src/model/format";
import { mergeSettings, DEFAULT_SETTINGS } from "../src/settings";
import type { MindDocument, MindNode, ModelSettings, TaskState } from "../src/model/types";
import { DEFAULT_MODEL_SETTINGS } from "../src/model/types";

const PLUGIN_DATA: ModelSettings = { headLevel: 2, foldStatePersistence: "plugin-data" };

function makeDoc(root: MindNode): MindDocument {
  return { prefix: "", suffix: "", root, originalText: "", synthesizedRoot: false };
}

function chain(rootText: string, ...children: MindNode[]): MindDocument {
  const root = createNode(rootText);
  children.forEach((c, i) => attachChild(root, c, i));
  return makeDoc(root);
}

/** The view's save self-check: serialize → parse → serialize is a fixed point. */
function selfCheckPasses(doc: MindDocument, settings: ModelSettings): boolean {
  const once = serializeDocument(doc, settings);
  const reparsed = parseDocument(once, "fallback");
  if (!reparsed.ok) return false;
  return serializeDocument(reparsed.doc, settings) === once;
}

// ------------------------------------------------------- EC10a normalization

test("normalizeBulletText: design cases", () => {
  assert.equal(normalizeBulletText("- bar"), "bar");
  assert.equal(normalizeBulletText("- - bar"), "bar");
  assert.equal(normalizeBulletText("- -"), "-");
  assert.equal(normalizeBulletText("-"), "-");
  assert.equal(normalizeBulletText("* bar"), "* bar");
  assert.equal(normalizeBulletText("1. x"), "1. x");
  assert.equal(normalizeBulletText("bar"), "bar");
  assert.equal(normalizeBulletText(""), "");
  assert.equal(normalizeBulletText("[ ] task-like"), "[ ] task-like");
});

test("normalizeBulletText: multi-line normalizes per line, fences untouched", () => {
  assert.equal(normalizeBulletText("a\n- b"), "a\nb");
  assert.equal(normalizeBulletText("- x\nplain"), "x\nplain");
  const fence = "```js\nif (x) {\n  y()\n}\n```";
  assert.equal(normalizeBulletText(fence), fence);
});

test("normalizeBulletText: strict fold-id suffixes strip (metadata, not text)", () => {
  assert.equal(normalizeBulletText("b ^aaaaaaaa-bbbb-cccc"), "b");
  assert.equal(
    normalizeBulletText("x ^aaaaaaaa-bbbb-cccc ^bbbbbbbb-cccc-dddd"),
    "x"
  );
  // Non-8-4-4 user block refs are TEXT and must survive (contract B2).
  assert.equal(normalizeBulletText("keep ^my-anchor"), "keep ^my-anchor");
  // Fence: only the last line can carry the suffix; body stays byte-exact.
  assert.equal(
    normalizeBulletText("```js\ncode\n``` ^aaaaaaaa-bbbb-cccc"),
    "```js\ncode\n```"
  );
});

const CORPUS = [
  "- bar",
  "- - deep chain",
  "-",
  "- -",
  "* item",
  "+ item",
  "1. thing",
  "> quote line",
  "#tag here",
  "## looks like heading",
  "text with | pipe $ math `code` [[link#head|alias]]",
  "block ref keeper ^my-anchor",
  "--- rule text",
  "ends with dash -",
  "",
  // multi-line (clipboard-paste path) — Codex fix-review finding: the
  // E9 split emits one bullet per line, so EVERY line must normalize.
  "a\n- b",
  "- x\n- - y\nplain",
  "first\n\nlast",
  "```js\nif (x) {\n  y()\n}\n```",
  // fold-id-shaped suffixes (Codex sign-off round 2): parse strips them
  // as metadata, so they cannot survive as text in any fold mode.
  "b ^aaaaaaaa-bbbb-cccc",
  "x ^aaaaaaaa-bbbb-cccc ^bbbbbbbb-cccc-dddd",
  "a\nb ^aaaaaaaa-bbbb-cccc",
  "```js\ncode\n``` ^aaaaaaaa-bbbb-cccc",
];

test("normalizeBulletText: idempotent over the corpus", () => {
  for (const s of CORPUS) {
    const once = normalizeBulletText(s);
    assert.equal(normalizeBulletText(once), once, JSON.stringify(s));
  }
});

test("EC10a pin: normalized text always passes the save self-check (both fold modes)", () => {
  for (const s of CORPUS) {
    const node = createNode(normalizeBulletText(s));
    const section = createNode("H");
    attachChild(section, node, 0);
    const doc = chain("R", section);
    for (const settings of [DEFAULT_MODEL_SETTINGS, PLUGIN_DATA]) {
      assert.equal(
        selfCheckPasses(doc, settings),
        true,
        `${JSON.stringify(s)} with ${settings.foldStatePersistence}`
      );
    }
  }
});

test("EC10a: un-normalized leading-dash text fails the self-check (the bug this guards)", () => {
  const node = createNode("- poisoned");
  const section = createNode("H");
  attachChild(section, node, 0);
  const doc = chain("R", section);
  assert.equal(selfCheckPasses(doc, DEFAULT_MODEL_SETTINGS), false);
});

// ------------------------------------------------------- EC12 task demotion

function taskNode(text: string, task: TaskState): MindNode {
  return createNode(text, { task });
}

test("EC12: a task at heading depth serializes as a bullet, state preserved", () => {
  const doc = chain("R", taskNode("my todo", "todo"), createNode("plain"));
  const out = serializeDocument(doc, { headLevel: 4, foldStatePersistence: "markdown" });
  assert.match(out, /- \[ \] my todo/);
  assert.doesNotMatch(out, /^#{2,} my todo/m);
  const reparsed = parseDocument(out, "R");
  assert.equal(reparsed.ok, true);
  if (reparsed.ok) {
    const todo = reparsed.doc.root.children.find((n) => n.text === "my todo");
    assert.equal(todo?.task, "todo");
  }
});

test("EC12: idempotent in both fold modes, incl. fold marker on the demoted group", () => {
  const done = taskNode("done thing", "done");
  const folded = createNode("folded parent", { collapsed: true });
  attachChild(folded, createNode("hidden child"), 0);
  const doc = chain("R", done, folded);
  for (const mode of ["markdown", "plugin-data"] as const) {
    const settings: ModelSettings = { headLevel: 4, foldStatePersistence: mode };
    assert.equal(selfCheckPasses(doc, settings), true, mode);
  }
});

test("EC12 control: without tasks the same tree still emits headings", () => {
  const doc = chain("R", createNode("alpha"), createNode("beta"));
  const out = serializeDocument(doc, { headLevel: 4, foldStatePersistence: "markdown" });
  assert.match(out, /## alpha/);
  assert.match(out, /## beta/);
});

test("EC12 cascade: one task sibling demotes the whole group", () => {
  const doc = chain("R", taskNode("task", "todo"), createNode("plain sibling"));
  const out = serializeDocument(doc, { headLevel: 4, foldStatePersistence: "markdown" });
  assert.match(out, /- plain sibling/);
  assert.doesNotMatch(out, /## plain sibling/);
});

// ------------------------------------------------- group move index planning

function sibTree(): { ctx: TreeContext; parent: MindNode; byText: Map<string, MindNode> } {
  const root = createNode("R");
  const parent = createNode("P");
  attachChild(root, parent, 0);
  for (const t of ["A", "B", "C", "D", "E"]) {
    attachChild(parent, createNode(t), parent.children.length);
  }
  const byText = new Map(parent.children.map((n) => [n.text, n]));
  return { ctx: { root, index: buildIndex(root) }, parent, byText };
}

function applyPlan(
  ctx: TreeContext,
  parent: MindNode,
  nodes: MindNode[],
  anchor: MindNode | null
): History {
  const history = new History(ctx);
  const commands = planGroupMove(parent, nodes, anchor).map(
    (s) => new MoveNodeCommand(s.node.id, parent.id, s.index)
  );
  history.execute(new CompositeCommand(commands));
  return history;
}

test("group move: [B,C] after D yields A D B C E (was A D B E C)", () => {
  const { ctx, parent, byText } = sibTree();
  applyPlan(ctx, parent, [byText.get("B")!, byText.get("C")!], byText.get("D")!);
  assert.deepEqual(parent.children.map((n) => n.text), ["A", "D", "B", "C", "E"]);
});

test("group move: [B,C] before D is a no-op order", () => {
  const { ctx, parent, byText } = sibTree();
  // before D = anchor C (the element before D)
  applyPlan(ctx, parent, [byText.get("B")!, byText.get("C")!], byText.get("C")!.parent!.children[2]);
  assert.deepEqual(parent.children.map((n) => n.text), ["A", "B", "C", "D", "E"]);
});

test("group move: [D,E] to the front (anchor null)", () => {
  const { ctx, parent, byText } = sibTree();
  applyPlan(ctx, parent, [byText.get("D")!, byText.get("E")!], null);
  assert.deepEqual(parent.children.map((n) => n.text), ["D", "E", "A", "B", "C"]);
});

test("group move: undo restores the exact original order", () => {
  const { ctx, parent, byText } = sibTree();
  const before = cloneSubtree(ctx.root);
  const history = applyPlan(ctx, parent, [byText.get("E")!, byText.get("A")!], byText.get("B")!);
  assert.deepEqual(parent.children.map((n) => n.text), ["B", "E", "A", "C", "D"]);
  history.undo();
  assert.equal(treesEqual(ctx.root, before), true);
});

test("group move: cross-parent nodes insert cleanly", () => {
  const { ctx, parent } = sibTree();
  const other = createNode("X");
  attachChild(ctx.root, other, 1);
  ctx.index.set(other.id, other);
  applyPlan(ctx, parent, [other], parent.children[0]); // X after A
  assert.deepEqual(parent.children.map((n) => n.text), ["A", "X", "B", "C", "D", "E"]);
});

// --------------------------------------------------- format toggle safety

test("toggleMarker: two bold spans stay untouched (was mangled to 'a** and **b')", () => {
  const text = "**a** and **b**";
  assert.equal(toggleMarker(text, "**"), text);
});

test("toggleMarker: _snake_case_ still unwraps and wraps symmetrically", () => {
  assert.equal(toggleMarker("_snake_case_", "_"), "snake_case");
  assert.equal(toggleMarker("snake_case", "_"), "_snake_case_");
});

test("toggleMarker: plain wrap/unwrap roundtrip", () => {
  const wrapped = toggleMarker("hello", "**");
  assert.equal(wrapped, "**hello**");
  assert.equal(toggleMarker(wrapped, "**"), "hello");
});

test("highlight: two mark spans are never unwrapped or re-wrapped", () => {
  const twoSpans = '<mark style="background:#A7E8A4;">a</mark> mid <mark style="background:#A7E8A4;">b</mark>';
  assert.equal(hasHighlight(twoSpans), false);
  assert.equal(stripHighlight(twoSpans), twoSpans);
  assert.equal(applyHighlight(twoSpans, "#FFD580"), twoSpans);
});

test("highlight: whole-node wrap, recolor and strip still work", () => {
  const wrapped = applyHighlight("plain text", "#A7E8A4");
  assert.equal(wrapped, '<mark style="background:#A7E8A4;">plain text</mark>');
  assert.equal(hasHighlight(wrapped), true);
  const recolored = applyHighlight(wrapped, "#FFD580");
  assert.equal(recolored, '<mark style="background:#FFD580;">plain text</mark>');
  assert.equal(stripHighlight(recolored), "plain text");
});

// --------------------------------------------------- settings validation

test("mergeSettings: corrupted numerics clamp instead of flowing into layout", () => {
  const merged = mergeSettings({
    nodeMaxWidthDesktop: 0,
    nodeMaxWidthMobile: Number.NaN,
    levelGap: -5,
    siblingGap: Number.POSITIVE_INFINITY,
    subtreeGap: "junk" as unknown as number,
    mobileBarScale: 0,
  });
  assert.equal(merged.nodeMaxWidthDesktop, 100);
  assert.equal(merged.nodeMaxWidthMobile, DEFAULT_SETTINGS.nodeMaxWidthMobile);
  assert.equal(merged.levelGap, 4);
  assert.equal(merged.siblingGap, DEFAULT_SETTINGS.siblingGap); // non-finite → default
  assert.equal(merged.subtreeGap, DEFAULT_SETTINGS.subtreeGap);
  assert.equal(merged.mobileBarScale, 0.5);
});

test("mergeSettings: valid values pass through untouched", () => {
  const merged = mergeSettings({ levelGap: 60, siblingGap: 12, mobileBarScale: 1.5 });
  assert.equal(merged.levelGap, 60);
  assert.equal(merged.siblingGap, 12);
  assert.equal(merged.mobileBarScale, 1.5);
});
