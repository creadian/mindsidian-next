// CommonMark-compatible fence handling (Codex review 2026-07-06, finding 1):
// ~~~ fences, longer openers (````), matching-length closers, and the
// fold-marker-carrying closer line. Before this fix, valid Markdown fences
// were silently shredded into bullet lines on the next save.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseBody, parseDocument, normalizeBulletText } from "../src/model/parse";
import { serializeBody, serializeDocument } from "../src/model/serialize";
import { splitRegions } from "../src/model/region";
import { createNode, attachChild, walk } from "../src/model/tree";
import type { MindNode } from "../src/model/types";
import { DEFAULT_MODEL_SETTINGS } from "../src/model/types";

function flatTexts(root: MindNode): string[] {
  const out: string[] = [];
  walk(root, (n) => out.push(n.text));
  return out;
}

/** Build Root > Section > [texts], serialize, reparse, assert the fence
 *  node survives byte-exact and the emission is a serialize fixed point. */
function assertFenceNodeRoundtrips(fenceText: string): void {
  const root = createNode("Root");
  const section = createNode("Section");
  attachChild(root, section, 0);
  attachChild(section, createNode(fenceText), 0);
  attachChild(section, createNode("after"), 1);
  const pass1 = serializeBody(root);
  const reparsed = parseBody(pass1, "Root");
  assert.equal(serializeBody(reparsed.root), pass1, "self-check must pass");
  assert.deepEqual(flatTexts(reparsed.root), ["Root", "Section", fenceText, "after"]);
}

test("~~~ fence node roundtrips byte-exact as one node", () => {
  assertFenceNodeRoundtrips("~~~python\ndef f():\n    return 1\n~~~");
});

test("4-backtick fence containing an inner ```js block stays one node", () => {
  // The inner ``` lines are shorter than the opener — they must neither
  // close the fence nor be split out as bullet lines.
  assertFenceNodeRoundtrips("````markdown\n```js\nx()\n```\n````");
});

test("backtick lines inside a ~~~ fence never close it", () => {
  assertFenceNodeRoundtrips("~~~\n```\nstill inside\n```\n~~~");
});

test("raw ~~~ fence in a body parses as one node, not bullet shrapnel", () => {
  const input = "# R\n- a\n~~~\ncode # here\n~~~\n- b";
  const { root } = parseBody(input, "R");
  assert.deepEqual(flatTexts(root), ["R", "a", "~~~\ncode # here\n~~~", "b"]);
  // First pass normalizes to canonical shape; from there it is a fixed point.
  const pass1 = serializeBody(root);
  const pass2 = serializeBody(parseBody(pass1, "R").root);
  assert.equal(pass2, pass1, "must be idempotent");
});

test("an unclosed ~~~ fence node is closed with tildes on emission", () => {
  const root = createNode("Root");
  const section = createNode("Section");
  attachChild(root, section, 0);
  attachChild(section, createNode("~~~js\ncode"), 0);
  attachChild(section, createNode("after"), 1);
  const pass1 = serializeBody(root);
  const reparsed = parseBody(pass1, "Root");
  assert.equal(serializeBody(reparsed.root), pass1, "self-check must pass");
  assert.deepEqual(flatTexts(reparsed.root), ["Root", "Section", "~~~js\ncode\n~~~", "after"]);
});

test("a ``` line with more backticks in its info string is not a fence", () => {
  // CommonMark: a backtick fence's info string may not contain backticks —
  // "``` `x` ```" is a paragraph with inline code. It must not open a
  // fence and swallow the lines after it.
  const input = "# R\n``` `x` ```\n- b";
  const { root } = parseBody(input, "R");
  assert.deepEqual(flatTexts(root), ["R", "``` `x` ```", "b"]);
});

test("collapsed fence node: fold marker on the closer line still closes", () => {
  // The serializer appends " ^id" to the LAST fence line in markdown fold
  // mode. The closer check must treat that as metadata — otherwise the
  // fence swallows the rest of the file on reparse.
  const fenceText = "```js\nx()\n```";
  const root = createNode("Root");
  const section = createNode("Section");
  attachChild(root, section, 0);
  const fenceNode = createNode(fenceText);
  fenceNode.collapsed = true;
  attachChild(section, fenceNode, 0);
  attachChild(fenceNode, createNode("child"), 0);
  attachChild(section, createNode("after"), 1);
  const pass1 = serializeBody(root, DEFAULT_MODEL_SETTINGS);
  assert.ok(pass1.includes(`\`\`\` ^${fenceNode.id}`), "fold marker rides the closer");
  const reparsed = parseBody(pass1, "Root");
  assert.equal(serializeBody(reparsed.root), pass1, "self-check must pass");
  assert.deepEqual(flatTexts(reparsed.root), ["Root", "Section", fenceText, "child", "after"]);
});

test("splitRegions: '# ' inside a ~~~ fence is never the root H1", () => {
  const input = "~~~txt\n# fake\n~~~\n\n# Real Root\n- a\n";
  const { prefix, body } = splitRegions(input);
  assert.equal(prefix, "~~~txt\n# fake\n~~~\n\n");
  assert.equal(body, "# Real Root\n- a\n");
});

test("splitRegions: inner ``` inside a ```` fence does not flip fence state", () => {
  const input = "````md\n```\n# fake\n```\n````\n# Real\n- a\n";
  const { prefix, body } = splitRegions(input);
  assert.equal(prefix, "````md\n```\n# fake\n```\n````\n");
  assert.equal(body, "# Real\n- a\n");
});

test("normalizeBulletText leaves a pure ~~~ fence untouched", () => {
  const fenceText = "~~~\n- looks like a bullet\n~~~";
  assert.equal(normalizeBulletText(fenceText), fenceText);
});

test("whole-document roundtrip with a ~~~ fence stays byte-identical", () => {
  const input =
    "---\nmindmap-plugin: basic\n---\n\n# Root\n\n## Section\n- a\n\n\t-\n\t  ~~~sh\n\t  echo hi\n\t  ~~~\n\n- b";
  const r1 = parseDocument(input, "Root");
  assert.equal(r1.ok, true);
  if (!r1.ok) throw new Error("unreachable");
  const pass1 = serializeDocument(r1.doc);
  assert.equal(pass1, input, "canonical ~~~ emission must roundtrip byte-exact");
});
