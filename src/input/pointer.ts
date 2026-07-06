// Pointer input (design §1 Stage C): Pointer Events only — ONE code path
// for mouse, touch and pen (no duplicated drag logic). Scoped to the view's
// container and its ownerDocument (popout-safe). Owns: tap/click select,
// manual double-click/double-tap detection, long-press drag-to-reparent with
// ghost + drop highlight + arrow + edge auto-pan (commit to the LAST SHOWN
// target), drag-empty-space panning, hold-still marquee multi-select, fold
// dot + task checkbox taps, and wikilink clicks. Two-finger pinch zoom stays
// in viewport.ts — this module backs off whenever a second touch lands.

import type { MindNode } from "../model/types";
import { walk } from "../model/tree";
import type { MindmapController } from "../view/controller";
import { findDropTarget, type CandidateRect, type DropKind } from "./dropTarget";

const LONG_PRESS_MS = 500;
const MARQUEE_HOLD_MS = 1000;
const DOUBLE_MOUSE_MS = 500;
const DOUBLE_TOUCH_MS = 350;
const DRAG_SLOP_MOUSE = 4;
const DRAG_SLOP_TOUCH = 8;
const EDGE_PAN_MARGIN = 48;
const EDGE_PAN_SPEED = 12; // px per frame at the very edge
// Drop-target search tolerance in SCREEN px (converted to world at use).
// v1's values: fingers need a far bigger reach than a mouse cursor.
const DROP_TOLERANCE_TOUCH = 60;
const DROP_TOLERANCE_MOUSE = 24;
// Ghost visual offset so the finger doesn't cover what it drags (v1 values).
const TOUCH_GHOST_DX = -55;
const TOUCH_GHOST_DY = -15;

interface Press {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  nodeId: string | null;
  anchorHref: string | null; // wikilink under the pointer at press time
  moved: boolean;
  longPressTimer: number;
  marqueeTimer: number;
  panning: boolean;
  /** Recent move positions (~last 120ms) for release-velocity (glide). */
  samples: Array<{ x: number; y: number; t: number }>;
}

interface DragState {
  nodes: MindNode[]; // pruned top ancestors being moved
  excluded: Set<string>; // dragged ids + all descendants (cycle guard)
  ghostEl: HTMLElement;
  arrowEl: HTMLElement;
  hitDx: number;
  hitDy: number;
  lastShown: { targetId: string; kind: DropKind } | null;
  lastTargetEl: HTMLElement | null;
  rafId: number;
}

interface MarqueeState {
  rectEl: HTMLElement;
  startWorldX: number;
  startWorldY: number;
}

export class PointerController {
  private c: MindmapController;
  private containerEl: HTMLElement;
  private worldEl: HTMLElement;
  private press: Press | null = null;
  private drag: DragState | null = null;
  private marquee: MarqueeState | null = null;
  private touchCount = 0;
  private lastTap: { id: string; time: number } | null = null;
  /** Node context menu callback (set by the view). Desktop: right-click.
   *  Touch: long-press released IN PLACE (a long-press that MOVES is the
   *  existing drag-to-reparent — the two gestures share the hold). */
  onNodeMenu: ((nodeId: string, x: number, y: number) => void) | null = null;

  private onPointerDown = (e: PointerEvent): void => this.handleDown(e);
  private onPointerMove = (e: PointerEvent): void => this.handleMove(e);
  private onPointerUp = (e: PointerEvent): void => this.handleUp(e);
  private onPointerCancel = (): void => this.cancelAll();
  // Touch shield (F1): the raw-touch stream runs in PARALLEL to pointer
  // events, and Obsidian's own gesture recognizers (sidebar swipe,
  // pull-down menu) listen to it — `touch-action: none` cannot reach
  // them. Claim the stream: stopPropagation always; preventDefault only
  // once a v2 gesture owns the touch (past slop / drag / marquee /
  // pinch), so taps stay native and iOS click synthesis survives.
  private onTouchStart = (e: TouchEvent): void => {
    e.stopPropagation(); // claim; NEVER preventDefault here (kills iOS taps)
  };
  private onTouchMove = (e: TouchEvent): void => {
    e.stopPropagation();
    const gestureActive =
      this.drag !== null ||
      this.marquee !== null ||
      (this.press?.moved ?? false) || // 1-finger pan past slop
      e.touches.length > 1; // pinch (viewport's)
    if (gestureActive) e.preventDefault();
  };
  /** Right-click on a node → context menu (desktop; also mouse on iPad). */
  private onContextMenu = (e: MouseEvent): void => {
    if (!this.onNodeMenu || this.c.isEditing) return; // native menu in edits
    const target = e.target as HTMLElement | null;
    const nodeEl = target?.closest?.(".mn-node") as HTMLElement | null;
    const nodeId = nodeEl?.dataset.mnId;
    if (!nodeId) return; // empty canvas: leave the default menu alone
    e.preventDefault();
    e.stopPropagation();
    if (!this.c.selection.isSelected(nodeId)) this.c.select(nodeId);
    this.onNodeMenu(nodeId, e.clientX, e.clientY);
  };


  constructor(controller: MindmapController, worldEl: HTMLElement) {
    this.c = controller;
    this.containerEl = controller.containerEl;
    this.worldEl = worldEl;
    // Let the Escape ladder cancel an in-progress marquee.
    controller.cancelMarquee = () => this.cancelMarqueeMode();
  }

  attach(): void {
    this.containerEl.addEventListener("pointerdown", this.onPointerDown);
    this.containerEl.addEventListener("pointermove", this.onPointerMove);
    this.containerEl.addEventListener("pointerup", this.onPointerUp);
    this.containerEl.addEventListener("pointercancel", this.onPointerCancel);
    this.containerEl.addEventListener("touchstart", this.onTouchStart, { passive: true });
    this.containerEl.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.containerEl.addEventListener("contextmenu", this.onContextMenu);
  }

  destroy(): void {
    this.cancelAll();
    this.containerEl.removeEventListener("pointerdown", this.onPointerDown);
    this.containerEl.removeEventListener("pointermove", this.onPointerMove);
    this.containerEl.removeEventListener("pointerup", this.onPointerUp);
    this.containerEl.removeEventListener("pointercancel", this.onPointerCancel);
    this.containerEl.removeEventListener("touchstart", this.onTouchStart);
    this.containerEl.removeEventListener("touchmove", this.onTouchMove);
    this.containerEl.removeEventListener("contextmenu", this.onContextMenu);
    this.c.cancelMarquee = null;
  }

  // ------------------------------------------------------------ down

  private handleDown(e: PointerEvent): void {
    // Any new press stops a momentum glide (finger catches the map).
    this.c.viewport.stopGlide();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "touch") {
      this.touchCount++;
      if (this.touchCount > 1) {
        // Second finger → pinch (viewport's job). Back off completely.
        this.cancelPress();
        this.cancelDrag();
        return;
      }
    }
    if (this.press || this.drag) return; // one gesture at a time

    const target = e.target as HTMLElement;

    // Clicks inside the node being edited belong to the contenteditable.
    if (this.c.isEditing) {
      const editingEl = this.c.editor.editingId
        ? this.c.renderer.getElement(this.c.editor.editingId)
        : null;
      if (editingEl && editingEl.contains(target)) return;
      this.c.commitEdit();
    }

    // Fold dot / task checkbox: act immediately (snappy, undoable).
    const foldEl = target.closest(".mn-fold-dot");
    if (foldEl) {
      if (e.pointerType === "mouse") e.preventDefault();
      const id = (foldEl.closest(".mn-node") as HTMLElement | null)?.dataset.mnId;
      if (id) this.c.toggleFold(id);
      return;
    }
    const taskEl = target.closest(".mn-task");
    if (taskEl) {
      if (e.pointerType === "mouse") e.preventDefault();
      const id = (taskEl.closest(".mn-node") as HTMLElement | null)?.dataset.mnId;
      if (id) this.c.toggleTaskBinary(id);
      return;
    }

    const anchor = target.closest("a") as HTMLAnchorElement | null;
    const nodeEl = target.closest(".mn-node") as HTMLElement | null;
    const nodeId = nodeEl?.dataset.mnId ?? null;

    // preventDefault on MOUSE only — never on touch (iOS click synthesis).
    if (e.pointerType === "mouse" && !anchor) e.preventDefault();
    try {
      this.containerEl.setPointerCapture(e.pointerId);
    } catch {
      // The pointer can already be gone (fast tap, synthetic event) — the
      // press still works, only move-tracking outside the pane is lost.
    }

    const press: Press = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      nodeId,
      anchorHref: anchor?.dataset.href ?? anchor?.getAttribute("href") ?? null,
      moved: false,
      longPressTimer: 0,
      marqueeTimer: 0,
      panning: false,
      samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
    };
    this.press = press;

    if (nodeId) {
      const node = this.c.node(nodeId);
      if (!node) return;
      if (e.pointerType === "mouse") {
        if (e.shiftKey) {
          this.c.toggleMultiSelect(nodeId);
          this.press = null;
          return;
        }
        // Manual double-click detector (native dblclick fails in popouts).
        if (this.isDoubleTap(nodeId, DOUBLE_MOUSE_MS)) {
          this.press = null;
          this.c.beginEdit(nodeId);
          return;
        }
        // Keep an existing multi-selection intact so a group drag can start;
        // a plain click (no drag) collapses it at pointerup.
        if (!this.c.selection.isSelected(nodeId)) this.c.select(nodeId);
      } else {
        // Touch: select on tap (at pointerup); long-press starts the drag.
        press.longPressTimer = window.setTimeout(() => {
          if (this.press === press && !press.moved) {
            navigator.vibrate?.(10);
            this.startDrag(press);
          }
        }, LONG_PRESS_MS);
      }
    } else {
      // Empty space: hold still → marquee; move → pan; release → deselect.
      press.marqueeTimer = window.setTimeout(() => {
        if (this.press === press && !press.moved) {
          navigator.vibrate?.(15);
          this.startMarquee(press);
        }
      }, MARQUEE_HOLD_MS);
    }
  }

  // ------------------------------------------------------------ move

  private handleMove(e: PointerEvent): void {
    if (this.drag) {
      this.drag && this.updateDrag(e);
      return;
    }
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;

    const dx = e.clientX - press.lastX;
    const dy = e.clientY - press.lastY;
    press.lastX = e.clientX;
    press.lastY = e.clientY;

    const slop = press.pointerType === "mouse" ? DRAG_SLOP_MOUSE : DRAG_SLOP_TOUCH;
    if (!press.moved) {
      const total = Math.hypot(e.clientX - press.startX, e.clientY - press.startY);
      if (total < slop) return;
      press.moved = true;
      window.clearTimeout(press.longPressTimer);
      window.clearTimeout(press.marqueeTimer);
      if (press.nodeId && press.pointerType === "mouse") {
        // Mouse: dragging a node past the slop starts the reparent drag.
        this.startDrag(press);
        if (this.drag) return;
        // Not draggable (the root) → fall through to panning instead.
      }
      press.panning = true; // touch-on-node drag and any empty-space drag pan
    }

    if (this.marquee) {
      this.updateMarquee(e);
      return;
    }
    if (press.panning) {
      this.c.viewport.panBy(dx, dy);
      const now = performance.now();
      press.samples.push({ x: e.clientX, y: e.clientY, t: now });
      while (press.samples.length > 1 && now - press.samples[0].t > 120) {
        press.samples.shift();
      }
    }
  }

  // ------------------------------------------------------------ up

  private handleUp(e: PointerEvent): void {
    if (e.pointerType === "touch") this.touchCount = Math.max(0, this.touchCount - 1);

    if (this.drag) {
      // Touch long-press released IN PLACE: never a drag — it's the
      // context-menu gesture (hold on a node, let go without moving).
      const held = this.press;
      if (
        held &&
        !held.moved &&
        held.pointerType !== "mouse" &&
        held.nodeId &&
        this.onNodeMenu
      ) {
        this.cancelDrag();
        this.press = null;
        if (!this.c.selection.isSelected(held.nodeId)) this.c.select(held.nodeId);
        this.onNodeMenu(held.nodeId, held.startX, held.startY);
        return;
      }
      this.commitDrag();
      this.press = null;
      return;
    }
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    this.press = null;
    window.clearTimeout(press.longPressTimer);
    window.clearTimeout(press.marqueeTimer);

    if (this.marquee) {
      this.endMarquee();
      return;
    }
    if (press.moved) {
      this.maybeStartGlide(press); // touch pan release → momentum glide
      return; // not a tap
    }

    // ---- It was a tap / click ----
    if (press.anchorHref) {
      this.c.openLink(press.anchorHref, e.metaKey || e.ctrlKey);
      return;
    }
    if (!press.nodeId) {
      this.c.clearSelection();
      return;
    }
    if (press.pointerType === "mouse") {
      // Plain click with a multi-selection collapses it (Canvas convention).
      if (this.c.selection.isMulti) this.c.select(press.nodeId);
      return;
    }
    // Touch tap: manual double-tap detector → edit; single tap → select.
    if (this.isDoubleTap(press.nodeId, DOUBLE_TOUCH_MS)) {
      this.c.beginEdit(press.nodeId);
      return;
    }
    this.c.select(press.nodeId);
  }

  /** Start a momentum glide from the release velocity of a touch pan.
   *  Velocity comes from the last ~120ms of movement; a finger that
   *  stopped before lifting produces no fresh samples → no glide. */
  private maybeStartGlide(press: Press): void {
    if (!press.panning || press.pointerType !== "touch") return;
    const now = performance.now();
    const recent = press.samples.filter((s) => now - s.t <= 120);
    if (recent.length < 2) return;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = last.t - first.t;
    if (dt < 10) return;
    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed < 0.15) return; // slow release — stop dead, no glide
    const MAX_SPEED = 5; // px per ms — tame extreme flicks
    if (speed > MAX_SPEED) {
      vx *= MAX_SPEED / speed;
      vy *= MAX_SPEED / speed;
    }
    this.c.viewport.startInertia(vx, vy);
  }

  // ------------------------------------------------------------ tap memory

  /** True when this tap is the second on the same node within `windowMs`.
   *  Consumes the memory either way (a triple tap is not two doubles). */
  private isDoubleTap(nodeId: string, windowMs: number): boolean {
    const now = Date.now();
    const isDouble =
      this.lastTap !== null &&
      this.lastTap.id === nodeId &&
      now - this.lastTap.time < windowMs;
    this.lastTap = isDouble ? null : { id: nodeId, time: now };
    return isDouble;
  }

  // ------------------------------------------------------------ drag-to-reparent

  private startDrag(press: Press): void {
    const node = press.nodeId ? this.c.node(press.nodeId) : undefined;
    if (!node || !node.parent) return; // root is never draggable
    this.press = press; // stays referenced for pointer id matching

    // Group drag when the pressed node is part of the multi-selection.
    const group =
      this.c.selection.isMulti && this.c.selection.isSelected(node.id)
        ? this.c.selectedTopNodes()
        : [node];
    if (group.length === 0) return;

    const excluded = new Set<string>();
    for (const n of group) walk(n, (d) => excluded.add(d.id));

    const doc = this.containerEl.ownerDocument;
    const ghostEl = doc.createElement("div");
    ghostEl.className = "mn-ghost";
    const sourceEl = this.c.renderer.getElement(node.id);
    ghostEl.textContent = node.text || " ";
    if (group.length > 1) ghostEl.dataset.count = String(group.length);
    this.containerEl.appendChild(ghostEl);
    const arrowEl = doc.createElement("div");
    arrowEl.className = "mn-drop-arrow";
    this.containerEl.appendChild(arrowEl);

    for (const n of group) this.c.renderer.getElement(n.id)?.classList.add("is-dragging");
    sourceEl?.classList.add("is-dragging");
    this.containerEl.classList.add("mn-is-dragging");

    const isTouch = press.pointerType !== "mouse";
    this.drag = {
      nodes: group,
      excluded,
      ghostEl,
      arrowEl,
      // Touch: hit-test at the (offset) ghost so the finger never hides it.
      hitDx: isTouch ? TOUCH_GHOST_DX : 0,
      hitDy: isTouch ? TOUCH_GHOST_DY : 0,
      lastShown: null,
      lastTargetEl: null,
      rafId: 0,
    };
    this.positionGhost(press.lastX, press.lastY);
    this.hitTest(press.lastX, press.lastY);
    this.startEdgePanLoop();
  }

  private updateDrag(e: PointerEvent): void {
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    press.lastX = e.clientX;
    press.lastY = e.clientY;
    this.positionGhost(e.clientX, e.clientY);
    this.hitTest(e.clientX, e.clientY);
  }

  private positionGhost(clientX: number, clientY: number): void {
    const drag = this.drag;
    if (!drag) return;
    const rect = this.containerEl.getBoundingClientRect();
    const x = clientX - rect.left + drag.hitDx;
    const y = clientY - rect.top + drag.hitDy;
    drag.ghostEl.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Find the drop candidate near the (offset) pointer and show it.
   *  Layout-based nearest-rect search (F2) — no elementFromPoint, so no
   *  pixel-exact hits needed and the indicator tracks continuously.
   *  The shown target is sticky: leaving it for empty space keeps it, so
   *  the commit always matches what the user last saw (v1's contract). */
  private hitTest(clientX: number, clientY: number): void {
    const drag = this.drag;
    if (!drag) return;
    const world = this.c.viewport.screenToWorld(
      clientX + drag.hitDx,
      clientY + drag.hitDy
    );
    const tolerancePx =
      this.press?.pointerType === "mouse" ? DROP_TOLERANCE_MOUSE : DROP_TOLERANCE_TOUCH;
    const scale = this.c.viewport.transform.scale;
    const hit = findDropTarget(
      world.x,
      world.y,
      this.dropCandidates(drag.excluded),
      tolerancePx / (scale > 0 ? scale : 1)
    );
    if (!hit) return; // nothing near — previous target stays sticky
    if (drag.lastShown?.targetId === hit.id && drag.lastShown.kind === hit.kind) {
      return; // unchanged
    }
    const nodeEl = this.c.renderer.getElement(hit.id);
    if (!nodeEl) return;
    drag.lastTargetEl?.classList.remove("is-drop-target");
    nodeEl.classList.add("is-drop-target");
    drag.lastTargetEl = nodeEl;
    drag.lastShown = { targetId: hit.id, kind: hit.kind };
    this.positionArrow(nodeEl, hit.kind);
  }

  /** Visible node rects (world coords) minus the dragged subtree. */
  private dropCandidates(excluded: Set<string>): CandidateRect[] {
    const layout = this.c.renderer.getLayout();
    if (!layout) return [];
    const out: CandidateRect[] = [];
    for (const [id, pos] of layout.positions) {
      if (excluded.has(id)) continue;
      const node = this.c.node(id);
      if (!node) continue;
      const size = this.c.renderer.getSize(id);
      out.push({
        id,
        x: pos.x,
        y: pos.y,
        w: size?.w ?? 0,
        h: size?.h ?? 0,
        side: pos.side,
        isRoot: !node.parent,
      });
    }
    return out;
  }

  /** Place the drop-kind arrow indicator next to the shown target. */
  private positionArrow(nodeEl: HTMLElement, kind: DropKind): void {
    const drag = this.drag;
    if (!drag) return;
    const cRect = this.containerEl.getBoundingClientRect();
    const rect = nodeEl.getBoundingClientRect();
    drag.arrowEl.dataset.kind = kind;
    let x = rect.left - cRect.left + rect.width / 2;
    let y: number;
    if (kind === "before") y = rect.top - cRect.top - 10;
    else if (kind === "after") y = rect.bottom - cRect.top + 10;
    else {
      // Child: point at the side the target's children grow toward.
      const side = nodeEl.dataset.side === "left" ? -1 : 1;
      x = (side === 1 ? rect.right : rect.left) - cRect.left + side * 14;
      y = rect.top - cRect.top + rect.height / 2;
    }
    drag.arrowEl.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Auto-pan while the pointer hovers near a container edge (rAF loop). */
  private startEdgePanLoop(): void {
    const step = (): void => {
      const drag = this.drag;
      const press = this.press;
      if (!drag || !press) return;
      const rect = this.containerEl.getBoundingClientRect();
      const speed = (distInto: number): number =>
        Math.min(1, distInto / EDGE_PAN_MARGIN) * EDGE_PAN_SPEED;
      let dx = 0;
      let dy = 0;
      if (press.lastX < rect.left + EDGE_PAN_MARGIN) dx = speed(rect.left + EDGE_PAN_MARGIN - press.lastX);
      if (press.lastX > rect.right - EDGE_PAN_MARGIN) dx = -speed(press.lastX - (rect.right - EDGE_PAN_MARGIN));
      if (press.lastY < rect.top + EDGE_PAN_MARGIN) dy = speed(rect.top + EDGE_PAN_MARGIN - press.lastY);
      if (press.lastY > rect.bottom - EDGE_PAN_MARGIN) dy = -speed(press.lastY - (rect.bottom - EDGE_PAN_MARGIN));
      if (dx !== 0 || dy !== 0) {
        this.c.viewport.panBy(dx, dy);
        this.hitTest(press.lastX, press.lastY); // world moved under pointer
      }
      drag.rafId = requestAnimationFrame(step);
    };
    if (this.drag) this.drag.rafId = requestAnimationFrame(step);
  }

  /** Commit the drop to the LAST SHOWN target (never a fresh hit-test). */
  private commitDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    const shown = drag.lastShown;
    this.cancelDrag(); // cleanup first — controller render replaces classes
    if (!shown) return;
    const target = this.c.node(shown.targetId);
    if (!target || drag.excluded.has(target.id)) return;
    const nodes = drag.nodes.filter((n) => this.c.node(n.id) === n);
    if (nodes.length === 0) return;
    this.c.moveNodes(nodes, target, shown.kind);
  }

  private cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    cancelAnimationFrame(drag.rafId);
    drag.ghostEl.remove();
    drag.arrowEl.remove();
    drag.lastTargetEl?.classList.remove("is-drop-target");
    for (const n of drag.nodes) {
      this.c.renderer.getElement(n.id)?.classList.remove("is-dragging");
    }
    this.containerEl.classList.remove("mn-is-dragging");
    this.drag = null;
  }

  // ------------------------------------------------------------ marquee

  private startMarquee(press: Press): void {
    const doc = this.containerEl.ownerDocument;
    const rectEl = doc.createElement("div");
    rectEl.className = "mn-marquee";
    this.worldEl.appendChild(rectEl); // world coords: zooms with the map
    const start = this.c.viewport.screenToWorld(press.startX, press.startY);
    this.marquee = { rectEl, startWorldX: start.x, startWorldY: start.y };
    this.containerEl.classList.add("mn-marquee-mode");
    press.moved = true; // from now on, moves draw the rectangle
  }

  private updateMarquee(e: PointerEvent): void {
    const m = this.marquee;
    if (!m) return;
    const cur = this.c.viewport.screenToWorld(e.clientX, e.clientY);
    const x0 = Math.min(m.startWorldX, cur.x);
    const y0 = Math.min(m.startWorldY, cur.y);
    const x1 = Math.max(m.startWorldX, cur.x);
    const y1 = Math.max(m.startWorldY, cur.y);
    m.rectEl.style.transform = `translate(${x0}px, ${y0}px)`;
    m.rectEl.style.width = `${x1 - x0}px`;
    m.rectEl.style.height = `${y1 - y0}px`;

    // Live selection: every laid-out node whose box intersects the rect.
    const layout = this.c.renderer.getLayout();
    if (!layout) return;
    const hits: string[] = [];
    for (const [id, pos] of layout.positions) {
      const size = this.c.renderer.getSize(id) ?? { w: 120, h: 32 };
      if (pos.x < x1 && pos.x + size.w > x0 && pos.y < y1 && pos.y + size.h > y0) {
        hits.push(id);
      }
    }
    this.c.setMultiSelection(hits);
  }

  private endMarquee(): void {
    const m = this.marquee;
    if (!m) return;
    m.rectEl.remove();
    this.containerEl.classList.remove("mn-marquee-mode");
    this.marquee = null;
    // The selection made by the marquee stays.
  }

  /** Escape during a marquee: abandon it and its in-progress selection. */
  private cancelMarqueeMode(): boolean {
    if (!this.marquee) return false;
    this.endMarquee();
    this.c.clearSelection();
    this.press = null;
    return true;
  }

  // ------------------------------------------------------------ cleanup

  private cancelPress(): void {
    if (!this.press) return;
    window.clearTimeout(this.press.longPressTimer);
    window.clearTimeout(this.press.marqueeTimer);
    this.press = null;
  }

  private cancelAll(): void {
    this.cancelDrag();
    if (this.marquee) this.endMarquee();
    this.cancelPress();
    this.touchCount = 0;
  }
}
