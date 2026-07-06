// Wikilink insertion (design §1 Stage C): the picker INTERFACE plus the
// pure text helper. The real fuzzy vault-file picker (obsidian
// FuzzySuggestModal) is wired in Stage D — this module stays obsidian-free
// so Stage C compiles and tests without the app.

import type { MindmapController } from "../view/controller";

/** Implemented in Stage D with FuzzySuggestModal over the vault's md files. */
export interface WikilinkPicker {
  /** Open the picker; calls back with the chosen file's resolved linktext
   *  (fileToLinktext — unambiguous for duplicate basenames). */
  open(onPick: (linktext: string) => void): void;
}

/** Pure: build the `[[linktext]]` snippet for insertion. */
export function wikilinkSnippet(linktext: string): string {
  return `[[${linktext}]]`;
}

// ---- Inline "[[" autocomplete (pure text half; DOM/obsidian wiring lives
// ---- in view/linksuggest.ts). All functions take (text, caret) and never
// ---- touch the DOM, so they unit-test in plain node.

/** An unclosed `[[` the caret currently sits inside. */
export interface LinkContext {
  /** Index of the opening `[[`. */
  start: number;
  /** What was typed after `[[` up to the caret. */
  query: string;
}

/** Pure: the `[[` context around the caret, or null when the caret is not
 *  inside an in-progress wikilink (closed with `]]`, or a stray `[`). */
export function findLinkContext(text: string, caret: number): LinkContext | null {
  const upto = text.slice(0, caret);
  const start = upto.lastIndexOf("[[");
  if (start === -1) return null;
  const query = upto.slice(start + 2);
  if (query.includes("]") || query.includes("[")) return null;
  return { start, query };
}

/** Pure: after typing the second `[`, close the pair — `[[` → `[[]]` with the
 *  caret staying between. Null when pairing is wrong here (already paired,
 *  or a third `[` in a row means the user is doing something else). */
export function autoPairBrackets(
  text: string,
  caret: number
): { text: string; caret: number } | null {
  if (text.slice(caret - 2, caret) !== "[[") return null;
  if (text.slice(caret, caret + 1) === "]") return null;
  if (caret >= 3 && text.slice(caret - 3, caret - 2) === "[") return null;
  return { text: text.slice(0, caret) + "]]" + text.slice(caret), caret };
}

/** Pure: replace the in-progress `[[query` (and the auto-paired `]]` right
 *  after the caret, when present) with a completed `[[linktext]]`. The
 *  returned caret sits just after the closing brackets. */
export function completeLink(
  text: string,
  caret: number,
  linktext: string
): { text: string; caret: number } | null {
  const ctx = findLinkContext(text, caret);
  if (!ctx) return null;
  // Consume up to TWO closing brackets after the caret: inside a valid
  // context they can only be (remnants of) the auto-paired closer — a lone
  // "]" left by a forward-delete would otherwise survive as "[[Note]]]".
  const rest = text.slice(caret).replace(/^\]{1,2}/, "");
  const link = `[[${linktext}]]`;
  return {
    text: text.slice(0, ctx.start) + link + rest,
    caret: ctx.start + link.length,
  };
}

/** Pure: Backspace between an empty bracket pair (`[|]`) deletes both, so
 *  backing out of an auto-paired `[[]]` doesn't strand `]]`. Null when the
 *  caret is not between `[` and `]`. */
export function deleteBracketPair(
  text: string,
  caret: number
): { text: string; caret: number } | null {
  if (text.slice(caret - 1, caret) !== "[") return null;
  if (text.slice(caret, caret + 1) !== "]") return null;
  return {
    text: text.slice(0, caret - 1) + text.slice(caret + 1),
    caret: caret - 1,
  };
}

/**
 * Insert a wikilink for the controller's current context: into the caret /
 * selection of an in-flight edit, else appended to the selected node's text
 * via a fresh edit session (preserves the v1 behavior).
 */
export function insertWikilink(
  controller: MindmapController,
  picker: WikilinkPicker
): void {
  picker.open((linktext) => {
    const snippet = wikilinkSnippet(linktext);
    if (controller.editor.insertText(snippet)) return; // in-flight edit
    const id = controller.selection.primary;
    if (!id) return;
    controller.beginEdit(id); // caret lands at the end of the text
    controller.editor.insertText(snippet);
  });
}
