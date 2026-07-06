// Shared tracker for where the USABLE screen ends vertically — i.e. the
// on-screen keyboard's top edge, in layout coordinates. Extracted from the
// mobile bar so the map controller can use the same truth (revealNode must
// not park a node "visibly" under the keyboard — landscape jump bug
// 2026-07-06). Three independent signals, most conservative wins:
//   1. visualViewport bottom — honest in portrait; in landscape iOS
//      reports FULL height with the keyboard up (on-device diagnosis),
//   2. window height minus the native keyboard height from Capacitor's
//      keyboardWillShow/Hide window events (Obsidian's mobile shell),
//   3. the top of Obsidian's own .mobile-toolbar, which the app parks
//      directly above the keyboard when it is visible.

export class KeyboardInsets {
  private doc: Document;
  private listeners: Array<() => void> = [];
  /** Native keyboard height (px) from Capacitor; 0 = none/unknown. */
  nativeKbHeight = 0;

  private kbShow = (e: Event): void => {
    const h = (e as { keyboardHeight?: unknown }).keyboardHeight;
    this.nativeKbHeight = typeof h === "number" && h > 0 ? h : 0;
    this.emit();
  };
  private kbHide = (): void => {
    this.nativeKbHeight = 0;
    this.emit();
  };

  constructor(doc: Document) {
    this.doc = doc;
  }

  attach(): void {
    const win = this.doc.defaultView;
    win?.addEventListener("keyboardWillShow", this.kbShow);
    win?.addEventListener("keyboardDidShow", this.kbShow);
    win?.addEventListener("keyboardWillHide", this.kbHide);
    win?.addEventListener("keyboardDidHide", this.kbHide);
  }

  destroy(): void {
    const win = this.doc.defaultView;
    win?.removeEventListener("keyboardWillShow", this.kbShow);
    win?.removeEventListener("keyboardDidShow", this.kbShow);
    win?.removeEventListener("keyboardWillHide", this.kbHide);
    win?.removeEventListener("keyboardDidHide", this.kbHide);
    this.listeners = [];
  }

  /** Notify when the native keyboard height changes (bar repositions). */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** The TRUE bottom of the usable area, layout coordinates. */
  visibleBottom(): number {
    const win = this.doc.defaultView;
    const vv = win?.visualViewport;
    if (!win || !vv) return Number.POSITIVE_INFINITY;
    let bottom = vv.offsetTop + vv.height;
    if (this.nativeKbHeight > 0) {
      bottom = Math.min(bottom, win.innerHeight - this.nativeKbHeight);
    }
    const toolbar = this.doc.querySelector(".mobile-toolbar");
    if (toolbar instanceof HTMLElement && toolbar.offsetParent !== null) {
      const top = toolbar.getBoundingClientRect().top;
      if (top > 0) bottom = Math.min(bottom, top);
    }
    return bottom;
  }
}
