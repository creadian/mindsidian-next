// Floating highlight palette (design §1 Stage C): six color swatches plus a
// "×" strip button, anchored next to the selected node. A pick re-colors or
// wraps the node text in a <mark style> highlight via the controller; "×"
// strips it. Works for single and multi selection (applies to all selected).

import type { MindmapController } from "../view/controller";

/** v1's default palette — kept so existing maps look identical. */
export const HIGHLIGHT_COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Yellow", hex: "#FFD580" },
  { name: "Green", hex: "#A7E8A4" },
  { name: "Pink", hex: "#FFB3D1" },
  { name: "Blue", hex: "#A4C9F7" },
  { name: "Orange", hex: "#FFB088" },
  { name: "Purple", hex: "#CDA8E6" },
];

export class HighlightPalette {
  private c: MindmapController;
  private el: HTMLElement | null = null;

  constructor(controller: MindmapController) {
    this.c = controller;
    // Hide automatically when the selection changes underneath us.
    controller.onSelectionChanged(() => this.hide());
  }

  get isOpen(): boolean {
    return this.el !== null;
  }

  toggle(): void {
    if (this.el) this.hide();
    else this.show();
  }

  /** Open the palette anchored above the primary selected node. */
  show(): void {
    const primaryId = this.c.selection.primary;
    if (!primaryId) return;
    this.hide();

    const doc = this.c.containerEl.ownerDocument;
    const el = doc.createElement("div");
    el.className = "mm-palette";
    for (const color of HIGHLIGHT_COLORS) {
      el.appendChild(this.swatch(doc, color.hex, color.name));
    }
    el.appendChild(this.swatch(doc, null, "Remove highlight"));
    this.c.containerEl.appendChild(el);
    this.el = el;

    // Anchor above the node (container coordinates; clamped inside).
    const nodeEl = this.c.renderer.getElement(primaryId);
    const cRect = this.c.containerEl.getBoundingClientRect();
    if (nodeEl) {
      const r = nodeEl.getBoundingClientRect();
      const x = Math.max(4, r.left - cRect.left);
      const y = Math.max(4, r.top - cRect.top - el.offsetHeight - 8);
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
  }

  destroy(): void {
    this.hide();
  }

  private swatch(doc: Document, hex: string | null, label: string): HTMLElement {
    const btn = doc.createElement("button");
    btn.className = hex ? "mm-palette-swatch" : "mm-palette-clear";
    btn.setAttribute("aria-label", label);
    if (hex) btn.style.setProperty("--mm-swatch-color", hex);
    else btn.textContent = "×";
    // pointerdown (not click) so an in-flight edit keeps its focus/keyboard.
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.c.applyHighlightColor(hex);
      this.hide();
    });
    return btn;
  }
}
