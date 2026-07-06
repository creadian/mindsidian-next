// Mobile bottom action bar (design §1 Stage C): +sibling, +child, undo,
// redo, delete (stays visible with multi-select — owner wishlist #7),
// highlight palette, recenter. Keyboard-aware positioning comes ONLY from
// visualViewport + safe-area CSS (no 270/413/×2 magic constants, no poller —
// visualViewport resize/scroll events do the work and naturally go quiet
// while the view is hidden). Add-node actions run synchronously inside the
// pointerdown gesture so the iOS keyboard opens/stays up.

import type { MindmapController } from "../view/controller";
import type { HighlightPalette } from "./palette";

/** Gap between the keyboard top and the bar (px). */
const KEYBOARD_GAP = 8;

interface BarButton {
  icon: string;
  label: string;
  hideOnRoot?: boolean;
  /** Survives compact mode (landscape + keyboard: only the add buttons
   *  stay — owner request 2026-07-06, screen estate is scarce there). */
  compact?: boolean;
  action: () => void;
}

export class MobileActionBar {
  private c: MindmapController;
  private el: HTMLElement;
  private buttons: Array<{ el: HTMLElement; spec: BarButton }> = [];
  private viewportHandler = (): void => this.scheduleSettle();
  private settleTimers: number[] = [];
  /** Current keyboard lift in px (kept as state so the post-layout
   *  verification can adjust it against the bar's MEASURED position). */
  private lift = 0;
  /** Native keyboard height from Capacitor window events (Obsidian's
   *  mobile shell). THE decisive signal in landscape, where iOS neither
   *  resizes the window nor shrinks the visualViewport for the keyboard
   *  (diagnosed on-device 2026-07-06: vv claimed full height while the
   *  keyboard covered the bar). 0 = no keyboard / no such events. */
  private nativeKbHeight = 0;
  private kbShowHandler = (e: Event): void => {
    const h = (e as { keyboardHeight?: unknown }).keyboardHeight;
    this.nativeKbHeight = typeof h === "number" && h > 0 ? h : 0;
    this.scheduleSettle();
  };
  private kbHideHandler = (): void => {
    this.nativeKbHeight = 0;
    this.scheduleSettle();
  };
  private diagnostics: () => boolean;
  private diagEl: HTMLElement | null = null;

  constructor(
    controller: MindmapController,
    palette: HighlightPalette,
    diagnostics: () => boolean = () => false
  ) {
    this.diagnostics = diagnostics;
    this.c = controller;
    const doc = controller.containerEl.ownerDocument;
    this.el = doc.createElement("div");
    this.el.className = "mn-mobile-bar";

    const specs: BarButton[] = [
      { icon: "↩", label: "Add sibling", hideOnRoot: true, compact: true, action: () => this.c.addSiblingBelow() },
      { icon: "→", label: "Add child", compact: true, action: () => this.c.addChild() },
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
      if (spec.compact) btn.classList.add("mn-compact-keep");
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
    // Native keyboard height (Capacitor dispatches these on window).
    doc.defaultView?.addEventListener("keyboardWillShow", this.kbShowHandler);
    doc.defaultView?.addEventListener("keyboardDidShow", this.kbShowHandler);
    doc.defaultView?.addEventListener("keyboardWillHide", this.kbHideHandler);
    doc.defaultView?.addEventListener("keyboardDidHide", this.kbHideHandler);
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
    win?.removeEventListener("keyboardWillShow", this.kbShowHandler);
    win?.removeEventListener("keyboardDidShow", this.kbShowHandler);
    win?.removeEventListener("keyboardWillHide", this.kbHideHandler);
    win?.removeEventListener("keyboardDidHide", this.kbHideHandler);
    for (const id of this.settleTimers) win?.clearTimeout(id);
    this.settleTimers = [];
    this.c.containerEl.removeEventListener("focusin", this.focusHandler);
    this.c.containerEl.removeEventListener("focusout", this.focusHandler);
    this.diagEl?.remove();
    this.diagEl = null;
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
    const covered = containerBottom - this.visibleBottom();
    // Keyboard up: sit DIRECTLY above it (small gap). The configured
    // bottom offset exists to clear Obsidian's navbar — which iOS hides
    // while typing, so stacking offset + keyboard height put the bar
    // absurdly high. Keyboard down: the CSS bottom rule alone positions.
    let lift = 0;
    if (covered > 0) {
      const baseBottom = parseFloat(win.getComputedStyle(this.el).bottom) || 0;
      lift = Math.max(0, covered + KEYBOARD_GAP - baseBottom);
    }
    this.applyLift(lift);

    // Landscape + keyboard: barely any screen left above the keyboard —
    // shrink to the two add buttons (mn-compact-keep) so the bar doesn't
    // sit on top of the node being edited. Evaluated here (not only in
    // the focus handler) because a rotation can happen mid-edit.
    const kbUp = this.el.classList.contains("mn-kb-up");
    const landscape = vv.width > vv.height;
    this.el.classList.toggle("mn-compact", kbUp && landscape);

    // Closed loop: after this position lands, verify the bar is REALLY
    // inside the visible area and correct against its measured rect —
    // whichever iOS metric was stale or lying (landscape bug 2026-07-06,
    // second report: bar invisible despite the computed position).
    win.requestAnimationFrame(() => this.verifyVisible());
  }

  /** Compose the lift via CSS var — writing style.transform here
   *  clobbered the scale(var(--mn-bar-scale)) rule (size setting). */
  private applyLift(lift: number): void {
    this.lift = lift;
    this.el.style.setProperty("--mn-bar-lift", `${-lift}px`);
  }

  /** The TRUE bottom of the usable screen area, in layout coordinates:
   *  the most conservative of three independent keyboard signals. On
   *  iOS landscape the visualViewport alone is dishonest (claims full
   *  height with the keyboard up — on-device diagnosis 2026-07-06), so:
   *  1. visualViewport bottom (honest in portrait),
   *  2. window height minus the NATIVE keyboard height (Capacitor
   *     keyboardWillShow events — honest everywhere, when present),
   *  3. the top of Obsidian's own mobile toolbar, which the app parks
   *     directly above the keyboard (when visible). */
  private visibleBottom(): number {
    const win = this.el.ownerDocument.defaultView;
    const vv = win?.visualViewport;
    if (!win || !vv) return Number.POSITIVE_INFINITY;
    let bottom = vv.offsetTop + vv.height;
    if (this.nativeKbHeight > 0) {
      bottom = Math.min(bottom, win.innerHeight - this.nativeKbHeight);
    }
    const toolbar = this.el.ownerDocument.querySelector(".mobile-toolbar");
    if (toolbar instanceof HTMLElement && toolbar.offsetParent !== null) {
      const top = toolbar.getBoundingClientRect().top;
      if (top > 0) bottom = Math.min(bottom, top);
    }
    return bottom;
  }

  /** Measure where the bar ACTUALLY ended up; if it pokes below the
   *  visual viewport (under the keyboard) or above the container, adjust
   *  the lift by the measured error. Runs once per position update; the
   *  settle burst provides the retries. */
  private verifyVisible(): void {
    const win = this.el.ownerDocument.defaultView;
    const vv = win?.visualViewport;
    if (!win || !vv || !this.el.isConnected) return;
    if (!this.el.classList.contains("mn-kb-up")) return; // only while typing
    const rect = this.el.getBoundingClientRect();
    if (rect.height === 0) return; // display:none / detached — nothing to fix
    const visBottom = this.visibleBottom();
    const containerTop = this.c.containerEl.getBoundingClientRect().top;
    let corrected = this.lift;
    // Poking below the keyboard line → push up by the measured overshoot.
    const overshoot = rect.bottom + KEYBOARD_GAP - visBottom;
    if (overshoot > 1) corrected += overshoot;
    // Pushed above the visible/container top → bring it back down, but
    // never below the keyboard line again (keyboard wins when both bind).
    const maxTop = Math.max(vv.offsetTop, containerTop) + 4;
    if (rect.top - (corrected - this.lift) < maxTop) {
      corrected = Math.min(corrected, this.lift + rect.top - maxTop);
    }
    if (Math.abs(corrected - this.lift) > 1) this.applyLift(Math.max(0, corrected));
    this.updateDiagnostics(rect, visBottom);
  }

  /** Optional on-device overlay with the live numbers (settings toggle).
   *  Exists so positioning bugs can be diagnosed from a screenshot
   *  instead of blind iteration. */
  private updateDiagnostics(barRect: DOMRect, vvBottom: number): void {
    const win = this.el.ownerDocument.defaultView;
    const vv = win?.visualViewport;
    if (!win || !vv) return;
    if (!this.diagnostics()) {
      this.diagEl?.remove();
      this.diagEl = null;
      return;
    }
    if (!this.diagEl) {
      this.diagEl = this.el.ownerDocument.createElement("div");
      this.diagEl.className = "mn-bar-diag";
      this.c.containerEl.appendChild(this.diagEl);
    }
    const cr = this.c.containerEl.getBoundingClientRect();
    const toolbar = this.el.ownerDocument.querySelector(".mobile-toolbar");
    const mtbTop =
      toolbar instanceof HTMLElement && toolbar.offsetParent !== null
        ? Math.round(toolbar.getBoundingClientRect().top)
        : "none";
    this.diagEl.textContent =
      `win ${win.innerWidth}x${win.innerHeight} | ` +
      `vv ${Math.round(vv.width)}x${Math.round(vv.height)} top${Math.round(vv.offsetTop)} | ` +
      `useBot${Math.round(vvBottom)} natKB${Math.round(this.nativeKbHeight)} mtb${mtbTop} | ` +
      `cont ${Math.round(cr.top)}..${Math.round(cr.bottom)} | ` +
      `bar ${Math.round(barRect.top)}..${Math.round(barRect.bottom)} lift${Math.round(this.lift)} | ` +
      `${this.el.classList.contains("mn-kb-up") ? "KB" : "–"} ` +
      `${this.el.classList.contains("mn-compact") ? "CMP" : ""}`;
  }
}
