// Pure text half of the inline "[[" autocomplete (src/ui/wikilink.ts):
// context detection, bracket auto-pairing, link completion, pair deletion.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoPairBrackets,
  completeLink,
  deleteBracketPair,
  findLinkContext,
} from "../src/ui/wikilink";

// ---------------------------------------------------------- findLinkContext

test("findLinkContext: fresh [[ at end", () => {
  assert.deepEqual(findLinkContext("hello [[", 8), { start: 6, query: "" });
});

test("findLinkContext: query typed after [[", () => {
  assert.deepEqual(findLinkContext("see [[Praxis", 12), { start: 4, query: "Praxis" });
});

test("findLinkContext: caret inside auto-paired [[]]", () => {
  assert.deepEqual(findLinkContext("a [[]] b", 4), { start: 2, query: "" });
});

test("findLinkContext: no [[ anywhere", () => {
  assert.equal(findLinkContext("plain text", 5), null);
});

test("findLinkContext: closed link before caret is not a context", () => {
  assert.equal(findLinkContext("[[Done]] and", 12), null);
});

test("findLinkContext: caret after ]] of the auto-pair is outside", () => {
  assert.equal(findLinkContext("a [[]] b", 6), null);
});

test("findLinkContext: second [[ after a closed link", () => {
  assert.deepEqual(findLinkContext("[[Done]] [[Ne", 13), { start: 9, query: "Ne" });
});

test("findLinkContext: after [[[ the LAST two brackets are the context", () => {
  assert.deepEqual(findLinkContext("a [[[", 5), { start: 3, query: "" });
});

test("findLinkContext: stray [ inside the query breaks the context", () => {
  assert.equal(findLinkContext("[[a[b", 5), null);
});

test("findLinkContext: caret mid-text only sees what precedes it", () => {
  assert.deepEqual(findLinkContext("[[Pra]] tail", 5), { start: 0, query: "Pra" });
});

// --------------------------------------------------------- autoPairBrackets

test("autoPairBrackets: [[ at end pairs to [[]]", () => {
  assert.deepEqual(autoPairBrackets("note [[", 7), { text: "note [[]]", caret: 7 });
});

test("autoPairBrackets: [[ mid-text pairs in place", () => {
  assert.deepEqual(autoPairBrackets("a [[ b", 4), { text: "a [[]] b", caret: 4 });
});

test("autoPairBrackets: skips when ] already follows", () => {
  assert.equal(autoPairBrackets("a [[]]", 4), null);
});

test("autoPairBrackets: skips on third [ in a row", () => {
  assert.equal(autoPairBrackets("a [[[", 5), null);
});

test("autoPairBrackets: skips when caret not after [[", () => {
  assert.equal(autoPairBrackets("a [x", 4), null);
});

// ------------------------------------------------------------- completeLink

test("completeLink: replaces query and consumes the auto-paired ]]", () => {
  assert.deepEqual(completeLink("see [[Pra]] end", 9, "Praxis HOME"), {
    text: "see [[Praxis HOME]] end",
    caret: 19,
  });
});

test("completeLink: works without a closing ]] (manual [[)", () => {
  assert.deepEqual(completeLink("see [[Pra", 9, "Praxis"), {
    text: "see [[Praxis]]",
    caret: 14,
  });
});

test("completeLink: empty query", () => {
  assert.deepEqual(completeLink("[[]]", 2, "Note"), { text: "[[Note]]", caret: 8 });
});

test("completeLink: null when caret is outside any [[ context", () => {
  assert.equal(completeLink("plain", 3, "Note"), null);
});

test("completeLink: consumes a lone ] left by forward-delete", () => {
  // "[[Pra]]" -> forward-delete one "]" -> "[[Pra]" with caret at 5
  assert.deepEqual(completeLink("[[Pra]", 5, "Praxis"), {
    text: "[[Praxis]]",
    caret: 10,
  });
});

test("completeLink: consumes at most two closing brackets", () => {
  assert.deepEqual(completeLink("[[q]]] x", 3, "Note"), {
    text: "[[Note]]] x",
    caret: 8,
  });
});

test("completeLink: keeps text after the pair intact", () => {
  assert.deepEqual(completeLink("a [[q]] tail", 5, "Q Note"), {
    text: "a [[Q Note]] tail",
    caret: 12,
  });
});

// -------------------------------------------------------- deleteBracketPair

test("deleteBracketPair: removes [|]", () => {
  assert.deepEqual(deleteBracketPair("a [[]] b", 4), { text: "a [] b", caret: 3 });
});

test("deleteBracketPair: second backspace clears the outer pair too", () => {
  assert.deepEqual(deleteBracketPair("a [] b", 3), { text: "a  b", caret: 2 });
});

test("deleteBracketPair: null when caret not between [ and ]", () => {
  assert.equal(deleteBracketPair("a [x] b", 4), null);
  assert.equal(deleteBracketPair("ab", 1), null);
});
