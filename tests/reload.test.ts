// External-reload data-loss detection (2026-07-06): the view used to warn
// "your last few seconds of edits were discarded" on ANY external reload
// that arrived while a save was pending — even when Obsidian's auto-merge
// preserved every pending edit. allLinesContained is the pure check behind
// the fixed warning: warn only when lines we held are missing from the
// incoming text.

import { test } from "node:test";
import assert from "node:assert/strict";

import { allLinesContained } from "../src/model/serialize";

const OURS = [
  "---",
  "mindmap-plugin: basic",
  "---",
  "",
  "# Root",
  "",
  "- alpha",
  "\t- beta",
  "- gamma",
].join("\n");

test("identical text: everything contained", () => {
  assert.equal(allLinesContained(OURS, OURS), true);
});

test("auto-merge superset (external lines added) still contains ours", () => {
  const merged = OURS + "\n- delta (external)";
  assert.equal(allLinesContained(OURS, merged), true);
});

test("a pending edit missing from the incoming text is detected", () => {
  const incoming = OURS.replace("- gamma", "- gamma CLOBBERED");
  assert.equal(allLinesContained(OURS, incoming), false);
});

test("indentation is structure: a depth change does not count as contained", () => {
  const incoming = OURS.replace("\t- beta", "- beta");
  assert.equal(allLinesContained(OURS, incoming), false);
});

test("duplicate lines need matching multiplicity", () => {
  const ours = "- same\n- same";
  assert.equal(allLinesContained(ours, "- same\n- other"), false);
  assert.equal(allLinesContained(ours, "- same\n- same"), true);
});

test("blank lines and trailing whitespace are ignored", () => {
  assert.equal(allLinesContained("- a\n\n\n- b", "- b   \n- a"), true);
});

test("reordered lines still count as contained (no content lost)", () => {
  assert.equal(allLinesContained("- a\n- b", "- b\n- a"), true);
});
