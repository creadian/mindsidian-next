// Viewport (design §1 Stage B): the ONLY writer of the view transform.
// One {x, y, scale} state applied as a single CSS translate()+scale() on
// the world container (transform-origin 0 0, GPU-composited — no relayout
// during pan/zoom). Wheel zoom anchors at the cursor; pinch anchors at the
// focal point computed ONCE per gesture start (v1's hardest-won lesson:
// never re-read a moving cache mid-gesture). Zoom clamps to 20%–300%.

export interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 3.0;

/** Clamp a zoom factor into the allowed range. Exported for tests. */
export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export class Viewport {
  private container: HTMLElement;
  private world: HTMLElement;
  private t: ViewTransform = { x: 0, y: 0, scale: 1 };

  // Pinch gesture state (set once at gesture start, cleared at end).
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: {
    focalWorld: { x: number; y: number };
    startDist: number;
    startScale: number;
  } | null = null;

  // Animation state (recenter); cancelled by any new animation or gesture.
  private animationFrame = 0;

  /** Fired on DELIBERATE zoom gestures (wheel-zoom, pinch) — never on
   *  programmatic zoom/fit. The view uses it to gate the close-time
   *  mindmap-zoom frontmatter write (contract E12). */
  onUserZoom: (() => void) | null = null;

  // Bound handlers kept so destroy() can remove them.
  private onWheel = (e: WheelEvent): void => this.handleWheel(e);
  private onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e);
  private onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e);
  private onPointerEnd = (e: PointerEvent): void => this.handlePointerEnd(e);

  constructor(container: HTMLElement, world: HTMLElement) {
    this.container = container;
    this.world = world;
    world.style.transformOrigin = "0 0";
    world.style.willChange = "transform";
    this.apply();
  }

  /** Start listening for wheel + pinch on the container. */
  attach(): void {
    this.container.addEventListener("wheel", this.onWheel, { passive: false });
    this.container.addEventListener("pointerdown", this.onPointerDown);
    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerup", this.onPointerEnd);
    this.container.addEventListener("pointercancel", this.onPointerEnd);
  }

  destroy(): void {
    this.cancelAnimation();
    this.container.removeEventListener("wheel", this.onWheel);
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerup", this.onPointerEnd);
    this.container.removeEventListener("pointercancel", this.onPointerEnd);
  }

  get transform(): ViewTransform {
    return { ...this.t };
  }

  /** The single transform write — nothing else may touch world.style. */
  setTransform(x: number, y: number, scale: number): void {
    this.t = { x, y, scale: clampScale(scale) };
    this.apply();
  }

  panBy(dx: number, dy: number): void {
    this.setTransform(this.t.x + dx, this.t.y + dy, this.t.scale);
  }

  /** Convert a client (screen) point to world coordinates. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.t.x) / this.t.scale,
      y: (clientY - rect.top - this.t.y) / this.t.scale,
    };
  }

  /** Zoom by `factor`, keeping the given screen point fixed (cursor anchor). */
  zoomAtClientPoint(clientX: number, clientY: number, factor: number): void {
    const rect = this.container.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const newScale = clampScale(this.t.scale * factor);
    const ratio = newScale / this.t.scale;
    // Keep the world point under (sx, sy) exactly under (sx, sy) after.
    this.setTransform(
      sx - (sx - this.t.x) * ratio,
      sy - (sy - this.t.y) * ratio,
      newScale
    );
  }

  /** Zoom in/out around the container center (commands / buttons). */
  zoomAtCenter(factor: number): void {
    const rect = this.container.getBoundingClientRect();
    this.zoomAtClientPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      factor
    );
  }

  /** Put a world point at the container center (optionally animated). */
  centerOnWorldPoint(wx: number, wy: number, animate = false): void {
    const rect = this.container.getBoundingClientRect();
    const target = {
      x: rect.width / 2 - wx * this.t.scale,
      y: rect.height / 2 - wy * this.t.scale,
      scale: this.t.scale,
    };
    if (animate) this.animateTo(target);
    else this.setTransform(target.x, target.y, target.scale);
  }

  /** Recenter on the layout bounds, fitting if it overflows (animated). */
  recenter(bounds: WorldBounds, animate = true): void {
    const rect = this.container.getBoundingClientRect();
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    const pad = 40;
    let scale = this.t.scale;
    if (w > 0 && h > 0) {
      const fit = Math.min(
        (rect.width - pad * 2) / w,
        (rect.height - pad * 2) / h
      );
      scale = clampScale(Math.min(this.t.scale, fit, 1));
    }
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const target = {
      x: rect.width / 2 - cx * scale,
      y: rect.height / 2 - cy * scale,
      scale,
    };
    if (animate) this.animateTo(target);
    else this.setTransform(target.x, target.y, target.scale);
  }

  /** Smoothly animate to a target transform (~200ms ease-out). */
  animateTo(target: ViewTransform, durationMs = 200): void {
    this.cancelAnimation();
    const from = { ...this.t };
    const start = performance.now();
    const step = (now: number): void => {
      const raw = Math.min(1, (now - start) / durationMs);
      const k = 1 - Math.pow(1 - raw, 3); // ease-out cubic
      this.setTransform(
        from.x + (target.x - from.x) * k,
        from.y + (target.y - from.y) * k,
        from.scale + (target.scale - from.scale) * k
      );
      if (raw < 1) this.animationFrame = requestAnimationFrame(step);
      else this.animationFrame = 0;
    };
    this.animationFrame = requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- private

  private apply(): void {
    this.world.style.transform = `translate(${this.t.x}px, ${this.t.y}px) scale(${this.t.scale})`;
    // Expose the zoom to CSS so e.g. the fold-dot tap target can be
    // inverse-scaled (stays finger-sized at any zoom). Styling stays in CSS.
    this.world.style.setProperty("--mn-scale", String(this.t.scale));
  }

  private cancelAnimation(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    this.cancelAnimation();
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch / Ctrl+wheel → zoom anchored at the cursor.
      // Rate 0.004 ≈ v1's feel (~1.2x per normal pinch flick). The old
      // 0.01 zoomed ~2.5x faster; each anchored step flings the content
      // mass sideways so hard it reads as "the whole map shifts".
      const factor = Math.exp(-e.deltaY * 0.004);
      this.onUserZoom?.();
      this.zoomAtClientPoint(e.clientX, e.clientY, factor);
    } else {
      // Two-finger scroll / wheel → pan.
      this.panBy(-e.deltaX, -e.deltaY);
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.pointerType !== "touch") return; // mouse drag-pan is Stage C
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      this.cancelAnimation();
      const [a, b] = [...this.pointers.values()];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      // Focal point in WORLD coordinates, computed exactly once.
      this.pinch = {
        focalWorld: this.screenToWorld(midX, midY),
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startScale: this.t.scale,
      };
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this.pinch || this.pointers.size !== 2) return;
    e.preventDefault();
    const [a, b] = [...this.pointers.values()];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.pinch.startDist <= 0) return;
    const scale = clampScale(
      this.pinch.startScale * (dist / this.pinch.startDist)
    );
    this.onUserZoom?.();
    // Keep the fixed focal world point under the (moving) finger midpoint —
    // this gives focal-anchored zoom AND two-finger pan in one formula.
    const rect = this.container.getBoundingClientRect();
    this.setTransform(
      midX - rect.left - this.pinch.focalWorld.x * scale,
      midY - rect.top - this.pinch.focalWorld.y * scale,
      scale
    );
  }

  private handlePointerEnd(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
  }
}
