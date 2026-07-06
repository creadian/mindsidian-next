// nodeLineInDocument: the "Show in Markdown view" jump target. The line
// index must match where the node's first content line actually sits in
// the serialized document — verified here by parsing a document and
// checking the computed line against the real text.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDocument } from "../src/model/parse";
import { nodeLineInDocument, serializeDocument } from "../src/model/serialize";
import { walk } from "../src/model/tree";
import type { MindDocument, MindNode } from "../src/model/types";

function docOf(text: string): MindDocument {
  const result = parseDocument(text, "T");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return result.doc;
}

function findByText(doc: MindDocument, text: string): MindNode {
  let found: MindNode | null = null;
  walk(doc.root, (n) => {
    if (n.text === text) found = n;
  });
  assert.ok(found, `node "${text}" must exist`);
  return found as unknown as MindNode;
}

/** The computed line in the SERIALIZED document must start with the
 *  node's emitted first line (bullet marker/hashes + text). */
function assertLineMatches(doc: MindDocument, nodeText: string, expectPrefix: string): void {
  const node = findByText(doc, nodeText);
  const line = nodeLineInDocument(doc, node.id);
  assert.notEqual(line, null);
  const lines = serializeDocument(doc).split("\n");
  assert.ok(
    lines[line as number].trimStart().startsWith(expectPrefix),
    `line ${line} is "${lines[line as number]}", expected to start with "${expectPrefix}"`
  );
}

// Canonical form: no trailing newline (serializeBody trims the body).
const INPUT =
  "---\nmindmap-plugin: basic\n---\n\n# Root\n\n## Section A\n- alpha\n\t- [ ] beta\n\n## Section B\n- gamma";

test("bullet node line points at its bullet in the full document", () => {
  const doc = docOf(INPUT);
  assertLineMatches(doc, "alpha", "- alpha");
  assertLineMatches(doc, "beta", "- [ ] beta");
  assertLineMatches(doc, "gamma", "- gamma");
});

test("heading node line points at its heading; prefix lines counted", () => {
  const doc = docOf(INPUT);
  assertLineMatches(doc, "Section B", "## Section B");
  const root = findByText(doc, "Root");
  // Frontmatter is 4 lines (0..3) + blank → "# Root" sits on line 4.
  assert.equal(nodeLineInDocument(doc, root.id), 4);
});

test("fence node line points at its anchor bullet, not the blank line", () => {
  const fenceDoc = docOf("# R\n\n## H\n\n-\n  ```js\n  x()\n  ```\n\n- after\n");
  const fence = findByText(fenceDoc, "```js\nx()\n```");
  const line = nodeLineInDocument(fenceDoc, fence.id);
  const lines = serializeDocument(fenceDoc).split("\n");
  assert.equal(lines[line as number].trim(), "-");
});

test("unknown id yields null; lineMap does not alter the emission", () => {
  const doc = docOf(INPUT);
  assert.equal(nodeLineInDocument(doc, "no-such-id"), null);
  // Byte-identity must hold regardless of line tracking having run.
  assert.equal(serializeDocument(doc), INPUT);
});
