// Stage C clipboard codec tests: pure encode/decode in v1's JSON format.
// Roundtrip fidelity (text, order, fold, task), v1 payload compatibility,
// the copyNodes multi envelope, and graceful rejection of foreign clipboard
// content (never throws — bad input is just "not ours").

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

function shape(n: MindNode): unknown {
  return {
    text: n.text,
    task: n.task,
    collapsed: n.collapsed,
    children: n.children.map(shape),
  };
}

test("single subtree roundtrips through the copyNode format", () => {
  const original = subtree();
  const decoded = decodeClipboard(encodeSubtrees([original]));
  assert.ok(decoded);
  assert.equal(decoded.length, 1);
  assert.deepEqual(shape(decoded[0]), shape(original));
  // Fresh session ids — pasted nodes are new nodes.
  assert.notEqual(decoded[0].id, original.id);
});

test("multiple subtrees use the copyNodes envelope and keep order", () => {
  const one = subtree();
  const two = createNode("standalone");
  const payload = encodeSubtrees([one, two]);
  assert.equal(JSON.parse(payload).type, "copyNodes");
  const decoded = decodeClipboard(payload);
  assert.ok(decoded);
  assert.equal(decoded.length, 2);
  assert.deepEqual(shape(decoded[0]), shape(one));
  assert.equal(decoded[1].text, "standalone");
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
  assert.equal(root.children[0].collapsed, true);
  assert.equal(root.children[0].children[0].text, "Grandchild");
  assert.equal(root.children[0].children[0].parent, root.children[0]);
});

test("foreign clipboard content is rejected, never thrown", () => {
  assert.equal(decodeClipboard(""), null);
  assert.equal(decodeClipboard("plain text"), null);
  assert.equal(decodeClipboard("{not json"), null);
  assert.equal(decodeClipboard('{"type":"something-else"}'), null);
  assert.equal(decodeClipboard('{"type":"copyNode","text":"oops"}'), null);
  assert.equal(decodeClipboard('{"type":"copyNodes","subtrees":[{}]}'), null);
});

test("encoding nothing yields an empty payload", () => {
  assert.equal(encodeSubtrees([]), "");
});
