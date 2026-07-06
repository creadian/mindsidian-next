// Inline "[[" autocomplete (Stage D): typing "[[" inside a node edit
// auto-pairs to "[[]]" and opens Obsidian's native suggestion popover
// (AbstractInputSuggest — works on a contenteditable div, desktop + mobile).
// Picking a file replaces the in-progress "[[query" with the completed link.
//
// Key handling needs NO coordination with input/keyboard.ts in the normal
// case: while the popover is open, Obsidian's keymap consumes Enter / Escape
// / arrows on window in the CAPTURE phase (preventDefault + stopPropagation),
// so the view's document-level keydown listener never sees them. A
// defaultPrevented guard in keyboard.ts covers any platform where only
// preventDefault happens.
//
// The pure text half (findLinkContext / autoPairBrackets / completeLink /
// deleteBracketPair) lives in ui/wikilink.ts and is unit-tested; this module
// only wires DOM events and the vault file list.
//
// Lifecycle: ONE instance per node content element, created lazily on first
// edit and reused (render.ts caches content elements per node, so per-edit
// instances would stack listeners). All handlers are inert while the element
// is not contenteditable, so a parked instance costs nothing.

import { AbstractInputSuggest, App, TFile, prepareFuzzySearch } from "obsidian";
import {
  autoPairBrackets,
  completeLink,
  deleteBracketPair,
  findLinkContext,
} from "../ui/wikilink";
import { selectionOffsets, setCaretOffset } from "./edit";

const MAX_SUGGESTIONS = 30;
/** Keys that move the caret without firing an input event — the popover must
 *  re-check its context after them or it shows stale suggestions. */
const CARET_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

export class NodeLinkSuggest extends AbstractInputSuggest<TFile> {
  private readonly el: HTMLDivElement;
  private readonly sourcePath: () => string;
  private readonly composing: () => boolean;
  /** The query the current suggestion list was computed for. */
  private lastQuery = "";

  constructor(
    app: App,
    el: HTMLDivElement,
    sourcePath: () => string,
    composing: () => boolean
  ) {
    super(app, el);
    this.el = el;
    this.sourcePath = sourcePath;
    this.composing = composing;
    // beforeinput runs before the base class reacts; input runs after its
    // listener (registered in super()), so the popover computes its query
    // first and the auto-pair appends "]]" without re-triggering it.
    el.addEventListener("beforeinput", this.onBeforeInput);
    el.addEventListener("input", this.onInput);
    el.addEventListener("keyup", this.onKeyUp);
    // IME: the last real input event of a composition still reports
    // composing, so the popover never sees the committed text. Refresh one
    // tick after compositionend — deferred because the editor's own
    // compositionend handler (which clears the flag) may run after ours.
    el.addEventListener("compositionend", () => {
      window.setTimeout(() => this.refresh(), 0);
    });
    // A mouse/touch click moves the caret without any input event — the
    // popover would keep suggestions for the old caret position.
    el.addEventListener("pointerup", () => {
      if (this.popoverOpen) this.refresh();
    });
  }

  /** Make the base class recompute suggestions (it closes on an empty
   *  result). Synthetic events carry no inputType, so onInput/onBeforeInput
   *  ignore them — only the base class's input listener reacts. */
  private refresh(): void {
    this.el.dispatchEvent(new Event("input"));
  }

  /** The base class tracks `isOpen` at runtime; it's not in the public
   *  typings, and declaring our own collides with its assignment. */
  private get popoverOpen(): boolean {
    return (this as unknown as { isOpen?: boolean }).isOpen === true;
  }

  /** Active only during an inline edit; parked instances stay silent. */
  private editing(): boolean {
    return this.el.isContentEditable && !this.composing();
  }

  private caret(): number | null {
    const sel = selectionOffsets(this.el);
    return sel && sel.start === sel.end ? sel.start : null;
  }

  /** Backspace between an auto-paired `[|]` removes both brackets. */
  private onBeforeInput = (e: Event): void => {
    const ev = e as InputEvent;
    if (!this.editing() || ev.inputType !== "deleteContentBackward") return;
    const caret = this.caret();
    if (caret === null) return;
    const result = deleteBracketPair(this.el.textContent ?? "", caret);
    if (!result) return;
    ev.preventDefault();
    this.el.textContent = result.text;
    setCaretOffset(this.el, result.caret);
    // The base class only recomputes on real input events — refresh it so
    // the popover closes/updates after the programmatic edit.
    this.el.dispatchEvent(new Event("input"));
  };

  /** Typing the second `[` auto-pairs to `[[]]`, caret in the middle. */
  private onInput = (e: Event): void => {
    const ev = e as InputEvent;
    if (!this.editing() || ev.inputType !== "insertText" || ev.data !== "[") return;
    const caret = this.caret();
    if (caret === null) return;
    const result = autoPairBrackets(this.el.textContent ?? "", caret);
    if (!result) return;
    this.el.textContent = result.text;
    setCaretOffset(this.el, result.caret);
  };

  /** Caret-move keys don't fire input events — re-check the context. */
  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.popoverOpen || !this.editing() || !CARET_KEYS.has(e.key)) return;
    this.refresh();
  };

  /** Query = whatever follows the unclosed "[[" at the caret. The base class
   *  passes the whole element text — ignore it and read the caret context. */
  getSuggestions(_value: string): TFile[] {
    if (!this.editing()) return [];
    const caret = this.caret();
    if (caret === null) return [];
    const ctx = findLinkContext(this.el.textContent ?? "", caret);
    if (!ctx) return [];
    // Heading/alias syntax ("[[Note#…", "[[Note|…") is manual territory —
    // completing would overwrite what was typed after the marker.
    if (ctx.query.includes("#") || ctx.query.includes("|")) return [];
    this.lastQuery = ctx.query;
    const files = this.app.vault.getMarkdownFiles();
    if (ctx.query === "") {
      // No query yet: most recently edited notes are the likeliest targets.
      return files
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, MAX_SUGGESTIONS);
    }
    const fuzzy = prepareFuzzySearch(ctx.query);
    const scored: Array<{ score: number; file: TFile }> = [];
    for (const file of files) {
      const match = fuzzy(file.basename) ?? fuzzy(file.path);
      if (match) scored.push({ score: match.score, file });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_SUGGESTIONS).map((s) => s.file);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.addClass("mod-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title", text: file.basename });
    const parent = file.parent?.path;
    if (parent && parent !== "/") {
      content.createDiv({ cls: "suggestion-note", text: parent });
    }
  }

  selectSuggestion(file: TFile): void {
    this.close();
    if (!this.editing() && !this.el.isContentEditable) return;
    const caret = this.caret();
    if (caret === null) return;
    // The caret may have moved since the list was computed (e.g. a click
    // into another "[[" context) — never complete against a different
    // query than the one the user picked from.
    const ctx = findLinkContext(this.el.textContent ?? "", caret);
    if (!ctx || ctx.query !== this.lastQuery) return;
    // Respects the vault's "shortest path when possible" link setting.
    const linktext = this.app.metadataCache.fileToLinktext(file, this.sourcePath());
    const result = completeLink(this.el.textContent ?? "", caret, linktext);
    if (!result) return;
    this.el.textContent = result.text;
    this.el.focus({ preventScroll: true });
    setCaretOffset(this.el, result.caret);
  }
}
