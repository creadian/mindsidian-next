// toggleMarker + highlight wrap tests — the single formatting implementation
// (contract E14: the <mark> regex must tolerate attributes it didn't write).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyHighlight,
  getHighlightColor,
  hasHighlight,
  stripHighlight,
  toggleMarker,
  toggleMarkerRange,
} from "../src/model/format";

test("toggleMarker wraps and unwraps every marker", () => {
  for (const marker of ["**", "_", "==", "~~"] as const) {
    assert.equal(toggleMarker("hello", marker), `${marker}hello${marker}`);
    assert.equal(toggleMarker(`${marker}hello${marker}`, marker), "hello");
  }
});

test("toggleMarker leaves empty text alone", () => {
  assert.equal(toggleMarker("", "**"), "");
});

test("toggleMarker is its own inverse on mixed content", () => {
  const text = "see [[Note|alias]] and `code` 🌳";
  assert.equal(toggleMarker(toggleMarker(text, "=="), "=="), text);
});

test("toggleMarkerRange formats only the selected substring", () => {
  assert.equal(toggleMarkerRange("make this bold now", "**", 5, 9), "make **this** bold now");
  assert.equal(toggleMarkerRange("make **this** bold now", "**", 5, 13), "make this bold now");
});

test("toggleMarkerRange ignores empty or out-of-range selections", () => {
  assert.equal(toggleMarkerRange("abc", "**", 2, 2), "abc");
  assert.equal(toggleMarkerRange("abc", "**", -5, 0), "abc");
});

test("applyHighlight wraps, recolors, and strips", () => {
  const wrapped = applyHighlight("hello", "#A7E8A4");
  assert.equal(wrapped, '<mark style="background:#A7E8A4;">hello</mark>');
  assert.equal(hasHighlight(wrapped), true);
  assert.equal(getHighlightColor(wrapped), "#A7E8A4");

  const recolored = applyHighlight(wrapped, "#FFD580");
  assert.equal(recolored, '<mark style="background:#FFD580;">hello</mark>');

  assert.equal(stripHighlight(recolored), "hello");
  assert.equal(hasHighlight("plain"), false);
  assert.equal(getHighlightColor("plain"), null);
});

test("E14: tolerant of mark attributes v2 did not write", () => {
  const foreign = '<mark style="color:red; background: #A4C9F7 ;">text</mark>';
  assert.equal(hasHighlight(foreign), true);
  assert.equal(getHighlightColor(foreign), "#A4C9F7");
  assert.equal(stripHighlight(foreign), "text");
});

test("partial mark wraps are not treated as whole-node highlights", () => {
  const partial = 'before <mark style="background:#A7E8A4;">mid</mark> after';
  assert.equal(hasHighlight(partial), false);
  assert.equal(stripHighlight(partial), partial);
});
