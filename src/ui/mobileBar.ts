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
      { icon: "🗑", label: "Delete", hideOnRoot: true, action: () => this.deleteWithConfirm() },
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

  /** Armed state of the delete button (tap-again-to-confirm, branches). */
  private deleteArmedUntil = 0;

  /** Deleting a BRANCH (anything with children) needs a second tap within
   *  2.5s — one fat-finger on the bar used to wipe a whole subtree.
   *  Leaves still delete immediately (undo covers those). */
  private deleteWithConfirm(): void {
    const targets = this.c.selectedTopNodes();
    if (targets.length === 0) return;
    const hasBranch = targets.some((n) => n.children.length > 0);
    const btn = this.buttons.find((b) => b.spec.label === "Delete")?.el;
    const disarm = (): void => {
      this.deleteArmedUntil = 0;
      btn?.classList.remove("mn-confirm");
      if (btn) btn.textContent = "🗑";
    };
    if (!hasBranch || Date.now() < this.deleteArmedUntil) {
      disarm();
      this.c.deleteSelection();
      return;
    }
    this.deleteArmedUntil = Date.now() + 2500;
    if (btn) {
      btn.classList.add("mn-confirm");
      btn.textContent = "❗";
      this.el.ownerDocument.defaultView?.setTimeout(() => {
        if (Date.now() >= this.deleteArmedUntil) disarm();
      }, 2600);
    }
    this.c.notify("Deleting a whole branch — tap again to confirm.");
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
    // Keyboard up: sit DIRECTLY above it (small gap). The configured
    // bottom offset exists to clear Obsidian's navbar — which iOS hides
    // while typing, so stacking offset + keyboard height put the bar
    // absurdly high. Keyboard down: the CSS bottom rule alone positions.
    const KEYBOARD_GAP = 8;
    let lift = 0;
    if (covered > 0) {
      const baseBottom = parseFloat(win.getComputedStyle(this.el).bottom) || 0;
      lift = Math.max(0, covered + KEYBOARD_GAP - baseBottom);
    }
    // Compose via CSS var — writing style.transform here clobbered the
    // scale(var(--mn-bar-scale)) rule, so the size setting never worked.
    this.el.style.setProperty("--mn-bar-lift", `${-lift}px`);
  }
}
