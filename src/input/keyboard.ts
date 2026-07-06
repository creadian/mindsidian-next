// Keyboard input (design §1 Stage C): ONE keydown listener per view on the
// view's document (ownerDocument — popout-safe). It CANNOT be on the
// container element: Obsidian's global focus management blurs arbitrary
// in-view elements (observed: app.js calls blur() on our focus anchor within
// ~50ms), after which a container-scoped listener never hears another key.
// v1 used a document listener for the same reason. Isolation between views
// comes from explicit guards instead of DOM focus:
//   1. only handle keys when THIS view is the active one (isActive callback),
//   2. only when the key targets our container, the body, or our inline
//      editor — never inputs/editors belonging to other panes or modals.
// Arrow keys use the pure spatial navigator and NEVER pan the viewport (B2).

import type { MindmapController } from "../view/controller";
import { navigate, ArrowDirection } from "./navigate";

const ARROWS: Record<string, ArrowDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export class KeyboardController {
  private controller: MindmapController;
  private containerEl: HTMLElement;
  private isActive: () => boolean;
  private onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);

  constructor(controller: MindmapController, isActive: () => boolean) {
    this.controller = controller;
    this.containerEl = controller.containerEl;
    this.isActive = isActive;
  }

  attach(): void {
    this.containerEl.ownerDocument.addEventListener("keydown", this.onKeyDown);
  }

  destroy(): void {
    this.containerEl.ownerDocument.removeEventListener("keydown", this.onKeyDown);
  }

  /** True when this keystroke belongs to this mindmap view (see header). */
  private claims(e: KeyboardEvent): boolean {
    if (!this.isActive()) return false;
    const t = e.target as HTMLElement | null;
    if (!t || t === this.containerEl.ownerDocument.body) return true;
    if (this.containerEl.contains(t)) return true;
    if (t.contains(this.containerEl)) return true; // workspace/leaf ancestors
    return false; // a modal input, another pane's editor, a rename field, …
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.claims(e)) return;
    const c = this.controller;
    const mod = e.metaKey || e.ctrlKey;

    // ---- While editing: only the keys that end/steer the edit ----
    if (c.isEditing) {
      if (e.isComposing || c.editor.composing) return; // IME guard
      // A key already consumed above us (the "[[" link-suggest popover takes
      // Enter/Escape via Obsidian's keymap scope) must not also end the edit.
      if (e.defaultPrevented) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        c.commitEdit();
      } else if (e.key === "Tab") {
        e.preventDefault();
        c.commitEdit(); // Tab commits (v1 behavior); next Tab adds the child
      } else if (e.key === "Escape") {
        e.preventDefault();
        c.cancelEdit();
      } else if (mod && !e.altKey && this.formatKey(e.key)) {
        e.preventDefault();
        c.toggleFormat(this.formatKey(e.key)!);
      }
      return; // everything else belongs to the contenteditable
    }

    // ---- Escape ladder ----
    if (e.key === "Escape") {
      e.preventDefault();
      c.escape();
      return;
    }

    // ---- Undo / redo ----
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) c.redo();
      else c.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      c.redo();
      return;
    }

    // ---- Zoom commands (this view only — the listener is container-scoped) ----
    if (mod && !e.shiftKey && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      c.viewport.onUserZoom?.(); // deliberate zoom — persists on close
      c.viewport.zoomAtCenter(1.1);
      return;
    }
    if (mod && !e.shiftKey && e.key === "-") {
      e.preventDefault();
      c.viewport.onUserZoom?.();
      c.viewport.zoomAtCenter(1 / 1.1);
      return;
    }
    if (mod && e.key === "0") {
      e.preventDefault();
      c.viewport.onUserZoom?.();
      c.viewport.zoomAtCenter(1 / c.viewport.transform.scale);
      return;
    }

    // ---- Fold / displayed level ----
    if (mod && e.key === ".") {
      e.preventDefault();
      const id = c.selection.primary;
      if (id) c.toggleFold(id);
      return;
    }
    if (mod && e.shiftKey && (e.key === "-" || e.key === "_")) {
      e.preventDefault();
      c.foldAll();
      return;
    }
    if (mod && e.shiftKey && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      c.unfoldAll();
      return;
    }
    if (e.altKey && !e.shiftKey && e.key === "ArrowDown") {
      e.preventDefault();
      c.expandOneLevel();
      return;
    }
    if (e.altKey && !e.shiftKey && e.key === "ArrowUp") {
      e.preventDefault();
      c.collapseOneLevel();
      return;
    }

    // ---- Move node among siblings / across levels (Alt+Shift+arrows) ----
    if (e.altKey && e.shiftKey && ARROWS[e.key]) {
      e.preventDefault();
      const dir = ARROWS[e.key];
      if (dir === "up" || dir === "down") c.moveAmongSiblings(dir);
      else c.moveHorizontal(dir);
      return;
    }

    // ---- Clipboard (v1 hotkeys + plain Mod when not editing) ----
    if ((mod || (e.altKey && e.shiftKey)) && this.clipboardKey(e)) return;

    // ---- Formatting on the whole node ----
    if (mod && !e.altKey && this.formatKey(e.key)) {
      e.preventDefault();
      c.toggleFormat(this.formatKey(e.key)!);
      return;
    }

    // ---- Structure: Enter / Tab / Shift+Tab / Delete ----
    if (e.key === "Enter" && !mod && !e.altKey) {
      e.preventDefault();
      c.addSiblingBelow();
      return;
    }
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      c.addChild();
      return;
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      c.promote(); // outdent: become the parent's next sibling
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      c.deleteSelection();
      return;
    }

    // ---- Spatial navigation (selection moves, the viewport does NOT) ----
    if (ARROWS[e.key] && !mod && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      const current = c.primaryNode ?? c.ctx.root;
      const layout = c.renderer.getLayout();
      if (!layout) return;
      const next = navigate(current, ARROWS[e.key], layout);
      if (next) {
        c.select(next.id);
        // Pan only when the selection would leave the view (the margin
        // pan is a no-op for on-screen nodes) — the highlight must never
        // walk off-screen, but on-screen navigation still never pans.
        c.revealNode(next.id);
      } else if (!c.selection.primary) c.select(current.id);
      return;
    }

    // ---- Home: root + center (an explicit jump, not auto-panning) ----
    if (e.key === "Home") {
      e.preventDefault();
      c.goHome();
      return;
    }

    // ---- F2 / Shift+F2: edit the selected node ----
    if (e.key === "F2") {
      e.preventDefault();
      const id = c.selection.primary;
      if (id) c.beginEdit(id, { selectAll: true });
    }
  }

  /** Mod+B / Mod+I / Mod+H / Mod+S(strike with shift) → inline markers. */
  private formatKey(key: string): "**" | "_" | "==" | "~~" | null {
    switch (key.toLowerCase()) {
      case "b":
        return "**";
      case "i":
        return "_";
      case "h":
        return "==";
      default:
        return null;
    }
  }

  /** Copy/cut/paste; returns true when handled. Uses e.code because on
   *  macOS Alt+Shift+C reports e.key as "Ç", not "c". */
  private clipboardKey(e: KeyboardEvent): boolean {
    const key =
      e.code === "KeyC" ? "c" : e.code === "KeyX" ? "x" : e.code === "KeyV" ? "v" : "";
    if (key === "c") {
      e.preventDefault();
      void this.controller.copySelection();
      return true;
    }
    if (key === "x") {
      e.preventDefault();
      void this.controller.cutSelection();
      return true;
    }
    if (key === "v") {
      e.preventDefault();
      void this.controller.pasteIntoSelection();
      return true;
    }
    return false;
  }
}
