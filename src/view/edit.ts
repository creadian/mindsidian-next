// Inline node editing (design §1 Stage C): turns a node's content element
// into a contenteditable="plaintext-only" editor showing the RAW markdown
// text, commits/cancels synchronously (fast-keystroke flow), guards IME
// composition, and applies format toggles to the selected substring.
// The editor never touches the model — commit() RETURNS the new text and
// the controller decides whether to run a ChangeTextCommand. The empty-node
// placeholder is pure CSS (:empty::before) and is never written anywhere.

import type { MindNode } from "../model/types";
import type { InlineMarker } from "../model/format";
import { toggleMarker, toggleMarkerRange } from "../model/format";

interface ActiveEdit {
  node: MindNode;
  nodeEl: HTMLElement;
  contentEl: HTMLElement;
  originalText: string;
  composing: boolean;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onBlur: (e: FocusEvent) => void;
}

export interface CommitResult {
  nodeId: string;
  /** The committed text (already normalized), or null when unchanged. */
  newText: string | null;
}

export class NodeEditor {
  private active: ActiveEdit | null = null;

  get isEditing(): boolean {
    return this.active !== null;
  }

  get editingId(): string | null {
    return this.active?.node.id ?? null;
  }

  /** True while an IME composition is in flight (Enter must not commit). */
  get composing(): boolean {
    return this.active?.composing ?? false;
  }

  /**
   * Start editing a node in place. Synchronous — the caret is focused inside
   * the same user gesture (required for the iOS keyboard to appear).
   */
  begin(
    node: MindNode,
    nodeEl: HTMLElement,
    contentEl: HTMLElement,
    options?: { selectAll?: boolean }
  ): void {
    if (this.active) return; // commit/cancel first — controller's job
    nodeEl.classList.add("is-editing");
    // Show the raw markdown, not the rendered HTML. In a handoff the
    // element is already prepared AND focused — rewriting it here would
    // restart the iOS input session (keyboard blink), so skip.
    const prepared = this.handoffEl === contentEl;
    this.handoffEl = null;
    if (!prepared) {
      contentEl.textContent = node.text;
      contentEl.setAttribute(
        "contenteditable",
        supportsPlainTextOnly() ? "plaintext-only" : "true"
      );
    }

    const edit: ActiveEdit = {
      node,
      nodeEl,
      contentEl,
      originalText: node.text,
      composing: false,
      onCompositionStart: () => (edit.composing = true),
      onCompositionEnd: () => (edit.composing = false),
      onBlur: (e: FocusEvent) => {
        // Obsidian's keymap-scope manager blurs elements it doesn't own
        // (observed: programmatic blur with relatedTarget null right after
        // begin()). While the edit is active, take focus back — but only
        // for ownerless blurs; a non-null relatedTarget means the user
        // deliberately focused something else (palette, another pane).
        if (this.active !== edit || e.relatedTarget !== null) return;
        // Synchronously first: a frame with nothing focused makes iOS
        // dismiss and re-summon the keyboard (visible blink when adding
        // a sibling/child from the mobile bar). The rAF pass stays as a
        // fallback for anything that re-blurs within this tick.
        if (edit.contentEl.isConnected) {
          edit.contentEl.focus({ preventScroll: true });
        }
        requestAnimationFrame(() => {
          if (this.active === edit && edit.contentEl.isConnected) {
            edit.contentEl.focus({ preventScroll: true });
          }
        });
      },
    };
    contentEl.addEventListener("compositionstart", edit.onCompositionStart);
    contentEl.addEventListener("compositionend", edit.onCompositionEnd);
    contentEl.addEventListener("blur", edit.onBlur);
    this.active = edit;

    contentEl.focus({ preventScroll: true });
    placeCaret(contentEl, options?.selectAll === true);
  }

  /** Element fully prepared by prepareHandoff — begin() must not touch
   *  its DOM again (post-focus mutations restart the iOS input session). */
  private handoffEl: HTMLElement | null = null;

  /**
   * Keyboard handoff (iOS): before committing the CURRENT edit to switch
   * to another node, fully prepare the target (raw text, editable) and
   * focus it FIRST, so focus travels editable→editable with no stop on
   * body or the focus anchor — any non-editable stop makes iOS dismiss
   * and re-summon the keyboard (visible blink when adding a
   * sibling/child from the mobile bar).
   */
  prepareHandoff(node: MindNode, contentEl: HTMLElement): void {
    contentEl.textContent = node.text;
    contentEl.setAttribute(
      "contenteditable",
      supportsPlainTextOnly() ? "plaintext-only" : "true"
    );
    contentEl.focus({ preventScroll: true });
    this.handoffEl = contentEl;
  }

  /**
   * End editing and report the result. Newlines are flattened to spaces —
   * heading nodes must never contain them (Stage A rule) and multi-line
   * bullet creation is deferred, so one policy covers every node safely.
   * An emptied ROOT keeps its old title (an empty root title can't roundtrip).
   */
  commit(): CommitResult | null {
    const edit = this.active;
    if (!edit) return null;
    let text = (edit.contentEl.textContent ?? "").replace(/\s*\n\s*/g, " ").trim();
    if (!edit.node.parent && text === "") text = edit.originalText;
    this.teardown(edit);
    return {
      nodeId: edit.node.id,
      newText: text === edit.originalText ? null : text,
    };
  }

  /** Abandon the edit; the node keeps its original text (no history entry). */
  cancel(): string | null {
    const edit = this.active;
    if (!edit) return null;
    this.teardown(edit);
    return edit.node.id;
  }

  /**
   * Toggle an inline marker while editing: on the selected substring when
   * a selection exists inside the editor, else on the whole text. Updates
   * the editor DOM and keeps the caret usable. Returns false when idle.
   */
  toggleMarkerInEdit(marker: InlineMarker): boolean {
    const edit = this.active;
    if (!edit) return false;
    const text = edit.contentEl.textContent ?? "";
    const range = selectionOffsets(edit.contentEl);
    const next =
      range && range.start !== range.end
        ? toggleMarkerRange(text, marker, range.start, range.end)
        : toggleMarker(text, marker);
    edit.contentEl.textContent = next;
    placeCaret(edit.contentEl, false);
    return true;
  }

  /** Insert text at the caret (wikilink picker); appends when caret unknown. */
  insertText(snippet: string): boolean {
    const edit = this.active;
    if (!edit) return false;
    const text = edit.contentEl.textContent ?? "";
    const range = selectionOffsets(edit.contentEl);
    const at = range ? range.start : text.length;
    const end = range ? range.end : text.length;
    edit.contentEl.textContent = text.slice(0, at) + snippet + text.slice(end);
    placeCaret(edit.contentEl, false);
    return true;
  }

  private teardown(edit: ActiveEdit): void {
    edit.contentEl.removeEventListener("compositionstart", edit.onCompositionStart);
    edit.contentEl.removeEventListener("compositionend", edit.onCompositionEnd);
    edit.contentEl.removeEventListener("blur", edit.onBlur);
    edit.contentEl.removeAttribute("contenteditable");
    edit.nodeEl.classList.remove("is-editing");
    edit.contentEl.blur();
    this.active = null;
  }
}

/** plaintext-only is supported on Chromium (Obsidian) and iOS WebKit. */
function supportsPlainTextOnly(): boolean {
  const probe = document.createElement("div");
  try {
    probe.contentEditable = "plaintext-only";
    return probe.contentEditable === "plaintext-only";
  } catch {
    return false;
  }
}

/** Put the caret at the end of the editor (or select everything). */
function placeCaret(contentEl: HTMLElement, selectAll: boolean): void {
  const doc = contentEl.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return;
  const range = doc.createRange();
  range.selectNodeContents(contentEl);
  if (!selectAll) range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Character offsets of the current selection inside the editor, if any. */
function selectionOffsets(
  contentEl: HTMLElement
): { start: number; end: number } | null {
  const selection = contentEl.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!contentEl.contains(range.startContainer) || !contentEl.contains(range.endContainer)) {
    return null;
  }
  const measure = (container: Node, offset: number): number => {
    const probe = contentEl.ownerDocument.createRange();
    probe.selectNodeContents(contentEl);
    probe.setEnd(container, offset);
    return probe.toString().length;
  };
  const start = measure(range.startContainer, range.startOffset);
  const end = measure(range.endContainer, range.endOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}
