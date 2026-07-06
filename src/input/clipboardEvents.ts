// Native copy/cut/paste support: DOM ClipboardEvent listeners on the
// view's document (ownerDocument — popout-safe), mirroring keyboard.ts's
// ownership rules. Why this exists in ADDITION to the Mod+C/X/V keydown
// path in keyboard.ts: the app's Edit menu can consume the key equivalents
// before any keydown reaches us (classic macOS behavior — the reason v1
// needed its own Alt+Shift shortcuts). The menu's copy/cut/paste actions
// still dispatch these DOM events on the focused document, so this path
// catches menu clicks and menu-consumed hotkeys alike. The two routes are
// mutually exclusive per keystroke (a consumed accelerator never also
// delivers keydown), so nothing double-fires.
//
// While an inline edit is open the events are NOT claimed — text-level
// copy/paste inside the contenteditable stays fully native.

import type { MindmapController } from "../view/controller";

export class ClipboardEventController {
  private controller: MindmapController;
  private containerEl: HTMLElement;
  private isActive: () => boolean;
  private onCopy = (e: ClipboardEvent): void => this.handleCopy(e, false);
  private onCut = (e: ClipboardEvent): void => this.handleCopy(e, true);
  private onPaste = (e: ClipboardEvent): void => this.handlePaste(e);

  constructor(controller: MindmapController, isActive: () => boolean) {
    this.controller = controller;
    this.containerEl = controller.containerEl;
    this.isActive = isActive;
  }

  attach(): void {
    const doc = this.containerEl.ownerDocument;
    doc.addEventListener("copy", this.onCopy);
    doc.addEventListener("cut", this.onCut);
    doc.addEventListener("paste", this.onPaste);
  }

  destroy(): void {
    const doc = this.containerEl.ownerDocument;
    doc.removeEventListener("copy", this.onCopy);
    doc.removeEventListener("cut", this.onCut);
    doc.removeEventListener("paste", this.onPaste);
  }

  /** Same ownership test as keyboard.ts, plus: never claim during an
   *  inline edit — the contenteditable's native clipboard wins there. */
  private claims(e: ClipboardEvent): boolean {
    if (!this.isActive()) return false;
    if (this.controller.isEditing) return false;
    const t = e.target as HTMLElement | null;
    if (!t || t === this.containerEl.ownerDocument.body) return true;
    if (this.containerEl.contains(t)) return true;
    if (t.contains(this.containerEl)) return true; // workspace/leaf ancestors
    return false; // a modal input, another pane's editor, a rename field, …
  }

  private handleCopy(e: ClipboardEvent, isCut: boolean): void {
    if (!this.claims(e) || !e.clipboardData) return;
    const payload = this.controller.copyPayload();
    if (!payload) return; // nothing selected → leave the event alone
    e.preventDefault();
    e.clipboardData.setData("text/plain", payload);
    if (isCut) this.controller.deleteSelection();
  }

  private handlePaste(e: ClipboardEvent): void {
    if (!this.claims(e)) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    e.preventDefault();
    void this.controller.pasteIntoSelection(text);
  }
}
