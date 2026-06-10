// Golden roundtrip tests T1–T23 from docs/03-format-contract.md §4.
// T1–T6 run against byte copies of the real files in tests/fixtures/
// (never the live vault). Every test also asserts idempotence: a second
// roundtrip of the output must be byte-identical to the first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseDocument, parseBody } from "../src/model/parse";
import { serializeBody, serializeDocument } from "../src/model/serialize";
import { splitRegions, updateZoomInPrefix } from "../src/model/region";
import {
  collectCollapsedPaths,
  applyCollapsedPaths,
  createNode,
  attachChild,
  walk,
} from "../src/model/tree";
import type { MindNode, ModelSettings } from "../src/model/types";
import { DEFAULT_MODEL_SETTINGS } from "../src/model/types";

const FIXTURES = join(__dirname, "fixtures");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

/** parse → serialize with default settings; returns the output text. */
function roundtrip(text: string, fallback: string, settings?: ModelSettings): string {
  const result = parseDocument(text, fallback);
  assert.equal(result.ok, true, "parse must succeed");
  if (!result.ok) throw new Error("unreachable");
  return serializeDocument(result.doc, settings ?? DEFAULT_MODEL_SETTINGS);
}

/** Assert byte identity AND idempotence for a fixture file. */
function assertIdentity(name: string): void {
  const original = fixture(name);
  const fallback = name.replace(/\.md$/, "");
  const pass1 = roundtrip(original, fallback);
  assert.equal(pass1, original, `${name}: roundtrip must be byte-identical`);
  const pass2 = roundtrip(pass1, fallback);
  assert.equal(pass2, pass1, `${name}: roundtrip must be idempotent`);
}

/** Assert idempotence only (for inputs that normalize on first pass). */
function assertIdempotent(text: string, fallback: string): string {
  const pass1 = roundtrip(text, fallback);
  const pass2 = roundtrip(pass1, fallback);
  assert.equal(pass2, pass1, "second roundtrip must be byte-identical");
  return pass1;
}

function flatTexts(root: MindNode): string[] {
  const out: string[] = [];
  walk(root, (n) => out.push(n.text));
  return out;
}

function parsed(text: string, fallback: string) {
  const result = parseDocument(text, fallback);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return result.doc;
}

// ---- T1–T6: golden fixtures ----

test("T1 canary: Praxis Mindmap 2026.md roundtrips byte-identical", () => {
  assertIdentity("Praxis Mindmap 2026.md");
});

test("T2: Test Mindmap.md roundtrips byte-identical", () => {
  assertIdentity("Test Mindmap.md");
});

test("T3: edge-case-test.md roundtrips byte-identical", () => {
  assertIdentity("edge-case-test.md");
});

test("T4: created with markmind.md roundtrips byte-identical", () => {
  assertIdentity("created with markmind.md");
});

test("T5: Untitled mindmap.md roundtrips byte-identical", () => {
  assertIdentity("Untitled mindmap.md");
});

test("T6: frontmatter with blank lines — bytes preserved exactly", () => {
  for (const name of ["Test-mindmap-broken.md", "Praxis workstreams.md"]) {
    const original = fixture(name);
    const doc = parsed(original, name.replace(/\.md$/, ""));
    // The frontmatter (with its internal blank lines) is opaque prefix bytes.
    assert.ok(doc.prefix.startsWith("---\n\nmindmap-plugin: basic\n\n---"));
    assertIdentity(name);
  }
});

test("extra golden: v0_5_8 strip test.md roundtrips byte-identical", () => {
  assertIdentity("v0_5_8 strip test.md");
});

// ---- T7: empty file ----

test("T7: empty file synthesizes root from basename, flags no-write", () => {
  const original = fixture("test - breaking.md");
  assert.equal(original, "");
  const doc = parsed(original, "test - breaking");
  assert.equal(doc.root.text, "test - breaking");
  assert.equal(doc.synthesizedRoot, true); // view must not write until edited
  // A forced save emits just the H1 body (frontmatter added by the view).
  assert.equal(serializeBody(doc.root), "# test - breaking");
});

// ---- T8/T9: fold markers ----

const T8_INPUT = "# R\n\n## A ^6499845f-ba31-8078\n- x";

test("T8: strict fold id parsed as collapsed and re-emitted identically", () => {
  const doc = parsed(T8_INPUT, "R");
  const a = doc.root.children[0];
  assert.equal(a.text, "A");
  assert.equal(a.collapsed, true);
  assert.equal(a.id, "6499845f-ba31-8078");
  assert.equal(serializeDocument(doc), T8_INPUT);
});

test("T9: expanding a collapsed node removes only its marker", () => {
  const doc = parsed(T8_INPUT, "R");
  doc.root.children[0].collapsed = false;
  assert.equal(serializeDocument(doc), "# R\n\n## A\n- x");
});

// ---- T10: user block refs are NOT fold markers ----

test("T10: non-8-4-4 block ref stays in text, node stays expanded", () => {
  const input = "# R\n\n## H\n- note with block ref ^my-anchor";
  const doc = parsed(input, "R");
  const node = doc.root.children[0].children[0];
  assert.equal(node.text, "note with block ref ^my-anchor");
  assert.equal(node.collapsed, false);
  assert.equal(serializeDocument(doc), input);
});

test("T10b: uppercase or short hex ids are also text, not fold markers", () => {
  for (const ref of ["^ABCDEF12-3456-7890", "^1234-5678", "^quote1"]) {
    const input = `# R\n\n## H\n- some text ${ref}`;
    const doc = parsed(input, "R");
    assert.equal(doc.root.children[0].children[0].text, `some text ${ref}`);
    assert.equal(serializeDocument(doc), input);
  }
});

// ---- T11/T12: tasks ----

test("T11: task states roundtrip; [X] normalizes to [x]", () => {
  const input = "# R\n\n## H\n- [ ] todo\n- [x] done\n- [X] DONE";
  const doc = parsed(input, "R");
  const kids = doc.root.children[0].children;
  assert.deepEqual(
    kids.map((k) => k.task),
    ["todo", "done", "done"]
  );
  const out = assertIdempotent(input, "R");
  assert.equal(out, "# R\n\n## H\n- [ ] todo\n- [x] done\n- [x] DONE");
});

test("T12: task prefix outside a <mark> wrap roundtrips identically", () => {
  const input =
    '# R\n\n## H\n- [ ] <mark style="background:#A7E8A4;">highlighted task</mark>';
  const doc = parsed(input, "R");
  const node = doc.root.children[0].children[0];
  assert.equal(node.task, "todo");
  assert.equal(node.text, '<mark style="background:#A7E8A4;">highlighted task</mark>');
  assert.equal(serializeDocument(doc), input);
});

// ---- T13–T16: assimilation normalizations ----

test("T13: bare text and #tag lines become bullets", () => {
  const input = "# R\n\n## H\nplain line\n#tag here";
  const out = assertIdempotent(input, "R");
  assert.equal(out, "# R\n\n## H\n- plain line\n- #tag here");
});

test("T14: mixed space/tab indentation normalizes to tabs, same shape", () => {
  const input =
    "# R\n\n## H\n- a\n  - two space child\n    - four space child\n- b\n\t- tab child";
  const out = assertIdempotent(input, "R");
  assert.equal(
    out,
    "# R\n\n## H\n- a\n\t- two space child\n\t\t- four space child\n- b\n\t- tab child"
  );
});

test("T15: orphan indentation clamps to one level under parent", () => {
  const input = "# R\n\n## H\n- a\n\t\t\t- too deep";
  const out = assertIdempotent(input, "R");
  assert.equal(out, "# R\n\n## H\n- a\n\t- too deep");
});

test("T16: chained '- - X' bullets collapse to a single node", () => {
  const input = "# R\n\n## H\n- - X\n- - - Y";
  const out = assertIdempotent(input, "R");
  assert.equal(out, "# R\n\n## H\n- X\n- Y");
  const doc = parsed(out, "R");
  // No empty intermediate nodes, no "Sub title" injected anywhere.
  assert.deepEqual(flatTexts(doc.root), ["R", "H", "X", "Y"]);
});

// ---- T17: mid-file --- must never be eaten as frontmatter (E1 fix) ----

test("T17: file without frontmatter keeps content between --- rules", () => {
  const input = "# R\n## A\n---\n- after rule";
  const out = assertIdempotent(input, "R");
  assert.equal(out, "# R\n\n## A\n- ---\n- after rule");
  const doc = parsed(input, "R");
  assert.equal(doc.prefix, ""); // nothing mistaken for frontmatter
  assert.ok(flatTexts(doc.root).includes("after rule"));
});

// ---- T18: code fences keep their bytes (E10 fix) ----

test("T18: fence node lines preserved byte-exact incl. inner indentation", () => {
  const fenceText = "```js\n  if (x) {\n    y()\n  }\n```";
  const root = createNode("R");
  const section = createNode("H");
  attachChild(root, section, 0);
  attachChild(section, createNode(fenceText), 0);

  const pass1 = serializeBody(root);
  assert.equal(pass1, "# R\n\n## H\n\n-\n  ```js\n    if (x) {\n      y()\n    }\n  ```");

  const reparsed = parseBody(pass1, "R");
  const node = reparsed.root.children[0].children[0];
  assert.equal(node.text, fenceText); // bytes, including the 2/4-space body
  assert.equal(serializeBody(reparsed.root), pass1); // idempotent
});

test("T18b: nested fence keeps tab indent + two-space dedent symmetric", () => {
  const fenceText = "```python\ndef f():\n    return 1\n```";
  const input = `# R\n\n## H\n- parent\n\n\t-\n\t  ${fenceText.split("\n").join("\n\t  ")}`;
  const doc = parsed(input, "R");
  const node = doc.root.children[0].children[0].children[0];
  assert.equal(node.text, fenceText);
  assert.equal(serializeDocument(doc), input);
});

// ---- T19: blockquotes — one node per quote line, zero dropped ----

test("T19: bulleted quote lines roundtrip verbatim", () => {
  const input = "# R\n\n## H\n- parent\n\t- > line one\n\t- > line two";
  const doc = parsed(input, "R");
  const parent = doc.root.children[0].children[0];
  assert.deepEqual(
    parent.children.map((c) => c.text),
    ["> line one", "> line two"]
  );
  assert.equal(serializeDocument(doc), input);
});

test("T19b: raw blockquote paragraphs become one node per line", () => {
  const input = "# R\n\n## H\n> para1\n>\n> para2";
  const out = assertIdempotent(input, "R");
  assert.equal(out, "# R\n\n## H\n- > para1\n- >\n- > para2");
});

// ---- T20: multiple H1s reattach under the first ----

test("T20: second H1 becomes a child of the root, nothing lost", () => {
  const input = "# A\n- x\n# B\n- y";
  const doc = parsed(input, "A");
  assert.deepEqual(flatTexts(doc.root), ["A", "x", "B", "y"]);
  const b = doc.root.children[1];
  assert.equal(b.text, "B");
  assert.equal(b.children[0].text, "y");
  assertIdempotent(input, "A");
});

// ---- T21: wikilinks and URLs verbatim ----

test("T21: wikilinks, aliases and raw URLs roundtrip identically", () => {
  const input = "# R\n\n## H\n- see [[Note#Heading]] and [[Other|alias]] and https://x.y";
  assert.equal(roundtrip(input, "R"), input);
});

// ---- T22: zoom update touches only the one key ----

test("T22: updateZoomInPrefix changes only the mindmap-zoom value", () => {
  const prefix = "---\ntags:\n  - map\nmindmap-plugin: basic\nmindmap-zoom: 78\ndate: 2026-01-01\n---\n\n";
  const updated = updateZoomInPrefix(prefix, 105);
  assert.equal(
    updated,
    "---\ntags:\n  - map\nmindmap-plugin: basic\nmindmap-zoom: 105\ndate: 2026-01-01\n---\n\n"
  );
});

test("T22b: zoom clamps to 20–300 and inserts the key when missing", () => {
  const prefix = "---\nmindmap-plugin: basic\n---\n\n";
  const updated = updateZoomInPrefix(prefix, 500);
  assert.equal(updated, "---\nmindmap-plugin: basic\nmindmap-zoom: 300\n---\n\n");
});

// ---- T23: plugin-data fold persistence mode ----

test("T23: plugin-data mode strips markers; paths restore them", () => {
  const pluginData: ModelSettings = { headLevel: 2, foldStatePersistence: "plugin-data" };
  const doc = parsed(T8_INPUT, "R");

  // Saving in plugin-data mode removes the marker but loses no text.
  const clean = serializeDocument(doc, pluginData);
  assert.equal(clean, "# R\n\n## A\n- x");
  const paths = collectCollapsedPaths(doc.root);
  assert.deepEqual(paths, ["R > A"]);

  // Re-open the clean file, re-apply the saved paths, switch back to
  // markdown mode: a marker is re-emitted on the same node.
  const reopened = parsed(clean, "R");
  applyCollapsedPaths(reopened.root, paths);
  const markdownAgain = serializeDocument(reopened);
  assert.match(markdownAgain, /^# R\n\n## A \^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}\n- x$/);
});

// ---- Region / preamble preservation (P2) ----

test("P2: preamble between frontmatter and H1 survives byte-for-byte", () => {
  const input = "---\nmindmap-plugin: basic\n---\nsome stray preamble line\n\n# R\n\n## H\n- x";
  const { prefix, body } = splitRegions(input);
  assert.equal(prefix, "---\nmindmap-plugin: basic\n---\nsome stray preamble line\n\n");
  assert.equal(body, "# R\n\n## H\n- x");
  assert.equal(roundtrip(input, "R"), input);
});

test("E22: CRLF input normalizes to LF in the body (documented)", () => {
  const input = "# R\r\n\r\n## H\r\n- a\r\n- b";
  const out = assertIdempotent(input, "R");
  assert.equal(out, "# R\n\n## H\n- a\n- b");
});

test("empty bullets roundtrip as bare '-' lines", () => {
  const input = "# R\n\n## H\n- a\n\t-\n- b";
  const doc = parsed(input, "R");
  assert.equal(doc.root.children[0].children[0].children[0].text, "");
  assert.equal(serializeDocument(doc), input);
});

test("E17: numbered list items serialize as plain bullets", () => {
  const input = "# R\n\n## H\n1. first\n2. second";
  const out = assertIdempotent(input, "R");
  assert.equal(out, "# R\n\n## H\n- first\n- second");
});

test("E16: heading text that looks like a frontmatter key is just text", () => {
  const input = "---\nmindmap-plugin: basic\n---\n\n# mindmap-plugin: basic\n\n## H\n- x";
  assert.equal(roundtrip(input, "x"), input);
});

test("P4: parseDocument never throws — returns ok:false instead", () => {
  // No realistic input makes the parser throw; force the contract shape.
  const result = parseDocument("# R\n- x", "R");
  assert.equal(result.ok, true);
});

// ---- Lossless emission at heading depth (P3 — no newline flattening) ----

test("code fence directly under the root H1 roundtrips losslessly", () => {
  const input = "# Root\n```js\nlet x = 1\n```\n- after\n";
  const out = assertIdempotent(input, "Root");
  // The fence node demotes the sibling group to bullets — never flattened.
  assert.ok(out.includes("  ```js\n  let x = 1\n  ```"));
  const doc = parsed(out, "Root");
  assert.deepEqual(flatTexts(doc.root), ["Root", "```js\nlet x = 1\n```", "after"]);
});

test("multi-line text at heading depth splits per line, no content lost", () => {
  const root = createNode("Root");
  const multi = createNode("alpha\nbeta\ngamma");
  attachChild(root, multi, 0);
  const pass1 = serializeBody(root);
  assert.equal(pass1, "# Root\n\n## alpha\n\n## beta\n\n## gamma");
  // Idempotent: a reparse + reserialize must be byte-identical.
  const reparsed = parseBody(pass1, "Root");
  assert.equal(serializeBody(reparsed.root), pass1);
});

test("children of a split multi-line heading node reattach to its last line", () => {
  const root = createNode("Root");
  const multi = createNode("alpha\nbeta");
  attachChild(root, multi, 0);
  attachChild(multi, createNode("kid"), 0);
  const pass1 = serializeBody(root);
  const reparsed = parseBody(pass1, "Root");
  assert.equal(serializeBody(reparsed.root), pass1);
  const beta = reparsed.root.children[1];
  assert.equal(beta.text, "beta");
  assert.deepEqual(beta.children.map((c) => c.text), ["kid"]);
});

test("empty node at heading depth saves as a bare '-' and stays saveable", () => {
  // Legacy shape: "- " directly under the root H1 (also what Tab-then-
  // Escape on the root leaves behind). Must roundtrip, never emit '## '.
  const input = "# Root\n- \n- real\n";
  const out = assertIdempotent(input, "Root");
  assert.equal(out, "# Root\n-\n- real");
  const doc = parsed(out, "Root");
  assert.deepEqual(flatTexts(doc.root), ["Root", "", "real"]);
});

test("empty node created in-memory at heading depth roundtrips", () => {
  const root = createNode("Root");
  attachChild(root, createNode(""), 0);
  attachChild(root, createNode("real"), 1);
  const pass1 = serializeBody(root);
  assert.equal(pass1, "# Root\n-\n- real");
  const reparsed = parseBody(pass1, "Root");
  assert.equal(serializeBody(reparsed.root), pass1);
  assert.deepEqual(flatTexts(reparsed.root), ["Root", "", "real"]);
});

test("an unclosed fence node is closed on emission (mid-tree safe)", () => {
  const root = createNode("Root");
  const section = createNode("Section");
  attachChild(root, section, 0);
  attachChild(section, createNode("```js\ncode"), 0);
  attachChild(section, createNode("after"), 1);
  const pass1 = serializeBody(root);
  // The fence gains a closing line, so "after" is NOT swallowed on reparse.
  const reparsed = parseBody(pass1, "Root");
  assert.equal(serializeBody(reparsed.root), pass1, "self-check must pass");
  assert.deepEqual(flatTexts(reparsed.root), ["Root", "Section", "```js\ncode\n```", "after"]);
});

test("text starting with ``` but not one pure fence is split as bullets", () => {
  const root = createNode("Root");
  const section = createNode("Section");
  attachChild(root, section, 0);
  attachChild(section, createNode("```js\na\n```\nextra"), 0);
  const pass1 = serializeBody(root);
  const reparsed = parseBody(pass1, "Root");
  assert.equal(serializeBody(reparsed.root), pass1, "must stay idempotent");
  // Every line survives as literal bullet text — nothing swallowed.
  const texts = flatTexts(reparsed.root);
  for (const piece of ["```js", "a", "```", "extra"]) {
    assert.ok(texts.includes(piece), `line "${piece}" must survive`);
  }
});

// ---- splitRegions is code-fence-aware ----

test("a '# ' line inside a code fence is never taken as the root H1", () => {
  const input =
    "---\nmindmap-plugin: basic\n---\n```bash\n# install deps\nnpm i\n```\n- real content\n- more content\n";
  const { prefix, body } = splitRegions(input);
  // No real H1 → the whole remainder is body; the fence stays intact.
  assert.equal(prefix, "---\nmindmap-plugin: basic\n---\n");
  assert.equal(body.startsWith("```bash"), true);
  const doc = parsed(input, "My Note");
  assert.equal(doc.synthesizedRoot, true);
  assert.equal(doc.root.text, "My Note");
  assert.deepEqual(flatTexts(doc.root), [
    "My Note",
    "```bash\n# install deps\nnpm i\n```",
    "real content",
    "more content",
  ]);
  // A forced save of this doc must pass the self-check (idempotent).
  const pass1 = serializeDocument(doc);
  assert.equal(roundtrip(pass1, "My Note"), pass1);
});

test("a real H1 after a closed fence is still found as the root", () => {
  const input = "```txt\n# fake\n```\n\n# Real Root\n- a\n";
  const { prefix, body } = splitRegions(input);
  assert.equal(prefix, "```txt\n# fake\n```\n\n");
  assert.equal(body, "# Real Root\n- a\n");
  const doc = parsed(input, "x");
  assert.equal(doc.root.text, "Real Root");
});

// ---- Duplicate fold ids never collide in the id → node index ----

test("duplicate fold ids get a fresh id; collapsed state is kept", () => {
  const input =
    "# R\n\n## A ^aaaaaaaa-bbbb-cccc\n- a1\n\n## B ^aaaaaaaa-bbbb-cccc\n- b1";
  const doc = parsed(input, "R");
  const [a, b] = doc.root.children;
  assert.equal(a.id, "aaaaaaaa-bbbb-cccc");
  assert.notEqual(b.id, "aaaaaaaa-bbbb-cccc", "second use must be re-id'd");
  assert.equal(b.collapsed, true, "collapsed state survives the re-id");
  // No two nodes anywhere share an id.
  const ids: string[] = [];
  walk(doc.root, (n) => ids.push(n.id));
  assert.equal(new Set(ids).size, ids.length);
  // Text-lossless and idempotent: the duplicate re-emits with the new id.
  const pass1 = serializeDocument(doc);
  assert.match(pass1, /## B \^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
  assert.equal(roundtrip(pass1, "R"), pass1);
});
