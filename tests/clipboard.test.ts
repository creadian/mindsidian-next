// Clipboard codec tests. Since alpha.13 the WRITE format is tab-indented
// markdown bullets (readable everywhere); DECODE accepts bullets, plain
// text, headings — and still v1's JSON payloads for backward compat.
// Fold state is deliberately NOT clipboard-worthy: collapsed is dropped
// on a markdown roundtrip (it survives only legacy JSON pastes).

import { test } from "node:test";
import assert from "node:assert/strict";

import { createNode, attachChild } from "../src/model/tree";
import type { MindNode } from "../src/model/types";
import { encodeSubtrees, decodeClipboard } from "../src/view/clipboard";

function subtree(): MindNode {
  const a = createNode("A **bold** [[link]]");
  const a1 = createNode("A1", { task: "todo" });
  const a2 = createNode("A2", { collapsed: true });
  const a2x = createNode("hidden child", { task: "done" });
  attachChild(a, a1, 0);
  attachChild(a, a2, 1);
  attachChild(a2, a2x, 0);
  return a;
}

/** Structure signature; `collapsed` intentionally excluded (not carried
 *  by the markdown clipboard format). */
function shape(n: MindNode): unknown {
  return {
    text: n.text,
    task: n.task,
    children: n.children.map(shape),
  };
}

test("copy is markdown bullets: tabs for depth, checkboxes for tasks", () => {
  const payload = encodeSubtrees([subtree()]);
  assert.equal(
    payload,
    "- A **bold** [[link]]\n\t- [ ] A1\n\t- A2\n\t\t- [x] hidden child"
  );
});

test("single subtree roundtrips through markdown bullets", () => {
  const original = subtree();
  const decoded = decodeClipboard(encodeSubtrees([original]));
  assert.ok(decoded);
  assert.equal(decoded.length, 1);
  assert.deepEqual(shape(decoded[0]), shape(original));
  // Fresh session ids — pasted nodes are new nodes.
  assert.notEqual(decoded[0].id, original.id);
  // Detached: ready for AddNodeCommand.
  assert.equal(decoded[0].parent, null);
});

test("multiple subtrees keep their order", () => {
  const one = subtree();
  const two = createNode("standalone");
  const decoded = decodeClipboard(encodeSubtrees([one, two]));
  assert.ok(decoded);
  assert.equal(decoded.length, 2);
  assert.deepEqual(shape(decoded[0]), shape(one));
  assert.equal(decoded[1].text, "standalone");
});

test("a fence node survives the clipboard byte-exact", () => {
  const fenceText = "```js\nif (x) {\n  y()\n}\n```";
  const parent = createNode("code");
  attachChild(parent, createNode(fenceText), 0);
  const decoded = decodeClipboard(encodeSubtrees([parent]));
  assert.ok(decoded);
  assert.equal(decoded[0].children[0].text, fenceText);
});

test("external 2-space-indented bullet list pastes as a nested subtree", () => {
  // What another note / a ChatGPT answer typically looks like.
  const decoded = decodeClipboard(
    "- Groceries\n  - [ ] Milk\n  - [x] Bread\n- Errands\n  - Post office"
  );
  assert.ok(decoded);
  assert.equal(decoded.length, 2);
  assert.equal(decoded[0].text, "Groceries");
  assert.equal(decoded[0].children[0].text, "Milk");
  assert.equal(decoded[0].children[0].task, "todo");
  assert.equal(decoded[0].children[1].task, "done");
  assert.equal(decoded[1].children[0].text, "Post office");
});

test("plain lines paste as sibling nodes; blank lines carry nothing", () => {
  const decoded = decodeClipboard("first\n\nsecond\nthird");
  assert.ok(decoded);
  assert.deepEqual(
    decoded.map((n) => n.text),
    ["first", "second", "third"]
  );
});

test("an outline with its own H1 pastes as one subtree", () => {
  const decoded = decodeClipboard("# Title\n- a\n- b");
  assert.ok(decoded);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].text, "Title");
  assert.equal(decoded[0].parent, null);
  assert.deepEqual(
    decoded[0].children.map((n) => n.text),
    ["a", "b"]
  );
});

test("v1 payloads (no taskState field) decode with parent links intact", () => {
  // Exactly what v0.5.47 writes: flat id/pid entries, isExpand, note.
  const v1 = JSON.stringify({
    type: "copyNode",
    text: [
      { id: "x1", text: "Parent", pid: null, isExpand: true, note: undefined },
      { id: "x2", text: "Child", pid: "x1", isExpand: false, note: undefined },
      { id: "x3", text: "Grandchild", pid: "x2", isExpand: true, note: undefined },
    ],
  });
  const decoded = decodeClipboard(v1);
  assert.ok(decoded);
  const root = decoded[0];
  assert.equal(root.text, "Parent");
  assert.equal(root.task, "none");
  assert.equal(root.children[0].text, "Child");
  assert.equal(root.children[0].collapsed, true); // legacy JSON keeps fold
  assert.equal(root.children[0].children[0].text, "Grandchild");
  assert.equal(root.children[0].children[0].parent, root.children[0]);
});

test("v2 copyNodes JSON envelope still decodes (pre-alpha.13 copies)", () => {
  const payload = JSON.stringify({
    type: "copyNodes",
    subtrees: [
      { type: "copyNode", text: [{ id: "a", text: "One", pid: null, isExpand: true }] },
      { type: "copyNode", text: [{ id: "b", text: "Two", pid: null, isExpand: true }] },
    ],
  });
  const decoded = decodeClipboard(payload);
  assert.ok(decoded);
  assert.deepEqual(
    decoded.map((n) => n.text),
    ["One", "Two"]
  );
});

test("non-payload JSON falls through to plain text, never throws", () => {
  const decoded = decodeClipboard('{"type":"something-else"}');
  assert.ok(decoded);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].text, '{"type":"something-else"}');
});

test("empty and blank clipboards decode to null", () => {
  assert.equal(decodeClipboard(""), null);
  assert.equal(decodeClipboard("   \n\n  "), null);
});

test("encoding nothing yields an empty payload", () => {
  assert.equal(encodeSubtrees([]), "");
});
