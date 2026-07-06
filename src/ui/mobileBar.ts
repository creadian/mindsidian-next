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
  private viewportHandler = (): void => this.scheduleSettle();
  private settleTimers: number[] = [];

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
      // The tap's TRAILING native events (touchend → synthesized click)
      // still land on this button AFTER the action moved focus into a
      // contenteditable — iOS answers a trailing tap on a non-editable
      // control by dismissing/re-summoning the keyboard (the residual
      // fast blink). Swallow them; the action has already run. (v1 has
      // no blink because its buttons act on the native click itself.)
      btn.addEventListener("touchend", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      this.buttons.push({ el: btn, spec });
      this.el.appendChild(btn);
    }

    controller.containerEl.appendChild(this.el);
    controller.onSelectionChanged(() => {
      this.disarmDelete();
      this.updateButtons();
    });
    this.updateButtons();

    const vv = doc.defaultView?.visualViewport;
    vv?.addEventListener("resize", this.viewportHandler);
    vv?.addEventListener("scroll", this.viewportHandler);
    // Rotation: visualViewport alone is not enough — iOS updates window
    // and visualViewport metrics at DIFFERENT times during an orientation
    // change, and the last visualViewport event can fire while the numbers
    // are still mismatched (observed on-device: bar stuck far above the
    // keyboard after landscape→portrait). The window listeners re-trigger,
    // and scheduleSettle() re-measures until iOS has settled.
    doc.defaultView?.addEventListener("resize", this.viewportHandler);
    doc.defaultView?.addEventListener("orientationchange", this.viewportHandler);
    // Keyboard tracking: iOS RESIZES the whole webview when the keyboard
    // opens, so the visualViewport "covered" math reads 0 there — the
    // container's bottom already IS the keyboard's top. Track typing
    // directly instead: while a contenteditable has focus, the bar drops
    // to a slim 8px gap (the configured offset exists only to clear
    // Obsidian's navbar, which iOS hides while typing).
    controller.containerEl.addEventListener("focusin", this.focusHandler);
    controller.containerEl.addEventListener("focusout", this.focusHandler);
    this.updatePosition();
  }

  private focusHandler = (): void => {
    const win = this.el.ownerDocument.defaultView;
    // Defer: on focusout the next activeElement lands a tick later (the
    // editor also re-grabs focus asynchronously against Obsidian's blur).
    win?.setTimeout(() => {
      const active = this.el.ownerDocument.activeElement as HTMLElement | null;
      this.el.classList.toggle("mn-kb-up", active?.isContentEditable === true);
      // Settle burst, not a single read: the iOS keyboard is still
      // animating in/out at this point and one early measurement would
      // freeze the bar at a mid-animation position.
      this.scheduleSettle();
    }, 120);
  };

  destroy(): void {
    const win = this.el.ownerDocument.defaultView;
    const vv = win?.visualViewport;
    vv?.removeEventListener("resize", this.viewportHandler);
    vv?.removeEventListener("scroll", this.viewportHandler);
    win?.removeEventListener("resize", this.viewportHandler);
    win?.removeEventListener("orientationchange", this.viewportHandler);
    for (const id of this.settleTimers) win?.clearTimeout(id);
    this.settleTimers = [];
    this.c.containerEl.removeEventListener("focusin", this.focusHandler);
    this.c.containerEl.removeEventListener("focusout", this.focusHandler);
    this.el.remove();
  }

  /** Armed state of the delete button (tap-again-to-confirm). */
  private deleteArmedUntil = 0;

  private disarmDelete(): void {
    this.deleteArmedUntil = 0;
    const btn = this.buttons.find((b) => b.spec.label === "Delete")?.el;
    btn?.classList.remove("mn-confirm");
    if (btn) btn.textContent = "🗑";
  }

  /** Every delete needs a second tap within 2.5s — one fat-finger on the
   *  bar used to wipe content (owner request: leaves included). */
  private deleteWithConfirm(): void {
    const targets = this.c.selectedTopNodes();
    if (targets.length === 0) return;
    if (Date.now() < this.deleteArmedUntil) {
      this.disarmDelete();
      this.c.deleteSelection();
      return;
    }
    this.deleteArmedUntil = Date.now() + 2500;
    const btn = this.buttons.find((b) => b.spec.label === "Delete")?.el;
    if (btn) {
      btn.classList.add("mn-confirm");
      btn.textContent = "❗";
      this.el.ownerDocument.defaultView?.setTimeout(() => {
        if (Date.now() >= this.deleteArmedUntil) this.disarmDelete();
      }, 2600);
    }
    this.c.notify("Tap 🗑 again to delete.");
  }

  /** Hide root-only-unsafe buttons when the root is the selection. */
  private updateButtons(): void {
    const primary = this.c.primaryNode;
    const isRoot = primary !== null && primary.parent === null;
    for (const { el, spec } of this.buttons) {
      el.classList.toggle("mn-hidden", spec.hideOnRoot === true && isRoot);
    }
  }

  /** Recompute now AND over the next second: iOS settles window /
   *  visualViewport metrics asynchronously after rotations and keyboard
   *  transitions, and the last event can fire before the final numbers
   *  are in. A bounded burst (not a poller) rides out the settling. */
  private scheduleSettle(): void {
    const win = this.el.ownerDocument.defaultView;
    if (!win) return;
    for (const id of this.settleTimers) win.clearTimeout(id);
    this.updatePosition();
    this.settleTimers = [150, 400, 900].map((ms) =>
      win.setTimeout(() => this.updatePosition(), ms)
    );
  }

  /** Keep the bar above the on-screen keyboard, from visualViewport only. */
  private updatePosition(): void {
    const win = this.el.ownerDocument.defaultView;
    const vv = win?.visualViewport;
    if (!win || !vv) return;
    // How much of the CONTAINER the keyboard covers right now. Measured
    // against the container's own rect — NOT window.innerHeight, whose
    // update timing differs from visualViewport's during rotation, which
    // left the bar stranded on a stale mismatch (landscape bug 2026-07-06).
    // getBoundingClientRect and the vv metrics are both read at call time.
    const containerBottom = this.c.containerEl.getBoundingClientRect().bottom;
    const covered = containerBottom - (vv.offsetTop + vv.height);
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
