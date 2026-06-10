// Mobile bottom action bar (design §1 Stage C): +sibling, +child, undo,
// redo, delete (stays visible with multi-select — owner wishlist #7),
// highlight palette, recenter. Keyboard-aware positioning comes ONLY from
// visualViewport + safe-area CSS (no 270/413/×2 magic constants, no poller —
// visualViewport resize/scroll events do the work and naturally go quiet
// while the view is hidden). Add-node actions run synchronously inside the
// pointerdown gesture so the iOS keyboard opens/stays up.

import type { MindmapController } from "../view/controller";
import type { HighlightPalette } from "./palette";

interface BarButton {
  icon: string;
  label: string;
  hideOnRoot?: boolean;
  action: () => void;
}

export class MobileActionBar {
  private c: MindmapController;
  private el: HTMLElement;
  private buttons: Array<{ el: HTMLElement; spec: BarButton }> = [];
  private viewportHandler = (): void => this.updatePosition();

  constructor(controller: MindmapController, palette: HighlightPalette) {
    this.c = controller;
    const doc = controller.containerEl.ownerDocument;
    this.el = doc.createElement("div");
    this.el.className = "mn-mobile-bar";

    const specs: BarButton[] = [
      { icon: "↩", label: "Add sibling", hideOnRoot: true, action: () => this.c.addSiblingBelow() },
      { icon: "→", label: "Add child", action: () => this.c.addChild() },
      { icon: "↶", label: "Undo", action: () => this.c.undo() },
      { icon: "↷", label: "Redo", action: () => this.c.redo() },
      // Delete stays visible during multi-select (owner wishlist #7).
      { icon: "🗑", label: "Delete", hideOnRoot: true, action: () => this.c.deleteSelection() },
      { icon: "🖍", label: "Highlight", action: () => palette.toggle() },
      { icon: "⌖", label: "Recenter", action: () => this.c.recenter() },
    ];
    for (const spec of specs) {
      const btn = doc.createElement("button");
      btn.className = "mn-mobile-btn";
      btn.textContent = spec.icon;
      btn.setAttribute("aria-label", spec.label);
      // pointerdown + preventDefault: act inside the gesture without
      // stealing focus from an in-flight edit (keeps the iOS keyboard up).
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        spec.action();
      });
      this.buttons.push({ el: btn, spec });
      this.el.appendChild(btn);
    }

    controller.containerEl.appendChild(this.el);
    controller.onSelectionChanged(() => this.updateButtons());
    this.updateButtons();

    const vv = doc.defaultView?.visualViewport;
    vv?.addEventListener("resize", this.viewportHandler);
    vv?.addEventListener("scroll", this.viewportHandler);
    this.updatePosition();
  }

  destroy(): void {
    const vv = this.el.ownerDocument.defaultView?.visualViewport;
    vv?.removeEventListener("resize", this.viewportHandler);
    vv?.removeEventListener("scroll", this.viewportHandler);
    this.el.remove();
  }

  /** Hide root-only-unsafe buttons when the root is the selection. */
  private updateButtons(): void {
    const primary = this.c.primaryNode;
    const isRoot = primary !== null && primary.parent === null;
    for (const { el, spec } of this.buttons) {
      el.classList.toggle("mn-hidden", spec.hideOnRoot === true && isRoot);
    }
  }

  /** Keep the bar above the on-screen keyboard, from visualViewport only. */
  private updatePosition(): void {
    const win = this.el.ownerDocument.defaultView;
    const vv = win?.visualViewport;
    if (!win || !vv) return;
    // How much of the layout viewport the keyboard (or browser chrome)
    // covers at the bottom right now.
    const covered = win.innerHeight - vv.height - vv.offsetTop;
    this.el.style.transform = `translateY(${-Math.max(0, covered)}px)`;
  }
}
