// Node renderer (design §1 Stage B): owns the DOM lifecycle of node divs
// inside the world container — create/update/destroy keyed by node id.
// Plain-text fast path (textContent) for the majority of nodes; an injected
// async markdown renderer (Obsidian's MarkdownRenderer, wired by the view
// shell) only for text that actually contains markdown syntax. Strict
// two-pass discipline per render: write DOM → read ALL sizes → layout →
// write ALL positions. Full relayout every time (design priority rule 4).

import type { MindNode } from "../model/types";
import type { LayoutResult, LayoutSettings, Size } from "./layout";
import { layoutTree, DEFAULT_LAYOUT_SETTINGS } from "./layout";
import { EdgeLayer } from "./edges";

/** Async markdown→DOM renderer, injected so this module stays obsidian-free
 *  (the dev harness / Stage D view pass MarkdownRenderer.render). */
export type MarkdownRenderFn = (
  markdown: string,
  el: HTMLElement
) => Promise<void>;

/** The view-layer settings slice the renderer needs. */
export interface RenderSettings {
  layout: LayoutSettings;
  /** Branch color palette; first-level subtree i gets palette[i % length]. */
  branchColors: string[];
  /** Max node width in px (desktop/mobile resolved by the caller). */
  nodeMaxWidth: number;
  /** CSS-only depth-scaled font (owner wishlist #5), default off. */
  depthScaledFont: boolean;
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  layout: DEFAULT_LAYOUT_SETTINGS,
  branchColors: [
    "#fb464c", // red
    "#e9973f", // orange
    "#e0de71", // yellow
    "#44cf6e", // green
    "#53dfdd", // cyan
    "#027aff", // blue
    "#a882ff", // purple
    "#fa99cd", // pink
    "#25aa77", // teal
    "#8a6c54", // brown
  ],
  nodeMaxWidth: 800,
  depthScaledFont: false,
};

/** Markdown-syntax sniff for the fast path: if none of these characters
 *  appear, plain textContent is enough (no links/format/code/html/math). */
const MD_SYNTAX_RE = /[*_~=`$<>[\]!#\\]/;

/** Per-node render bookkeeping (DOM + last-known content + measured box). */
interface NodeView {
  el: HTMLElement;
  contentEl: HTMLElement;
  taskEl: HTMLElement | null;
  foldEl: HTMLElement | null;
  renderedText: string | null;
  renderedTask: string;
  size: Size | undefined;
}

export class MindmapRenderer {
  private worldEl: HTMLElement;
  private renderMarkdown: MarkdownRenderFn | null;
  private settings: RenderSettings;
  private edges: EdgeLayer;
  private views = new Map<string, NodeView>();
  private lastLayout: LayoutResult | null = null;
  private lastRoot: MindNode | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderScheduled = false;
  private destroyed = false;

  constructor(
    worldEl: HTMLElement,
    options?: {
      renderMarkdown?: MarkdownRenderFn;
      settings?: RenderSettings;
    }
  ) {
    this.worldEl = worldEl;
    this.renderMarkdown = options?.renderMarkdown ?? null;
    this.settings = options?.settings ?? DEFAULT_RENDER_SETTINGS;
    this.worldEl.classList.add("mm-world");
    this.applySettingsToWorld();
    this.edges = new EdgeLayer(worldEl);
    // Late content (images/embeds) re-measures through one shared observer.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.mmId;
          const view = id ? this.views.get(id) : undefined;
          if (!view) continue;
          const w = view.el.offsetWidth;
          const h = view.el.offsetHeight;
          if (!view.size || view.size.w !== w || view.size.h !== h) {
            this.scheduleRender();
            return;
          }
        }
      });
    }
  }

  /** Push a new (frozen) settings snapshot and re-render. */
  applySettings(settings: RenderSettings): void {
    this.settings = settings;
    this.applySettingsToWorld();
    this.scheduleRender();
  }

  private applySettingsToWorld(): void {
    this.worldEl.style.setProperty(
      "--mm-node-max-width",
      `${this.settings.nodeMaxWidth}px`
    );
    this.worldEl.classList.toggle(
      "mm-depth-font",
      this.settings.depthScaledFont
    );
  }

  /** Latest layout (for recenter / fit / hit-testing by later stages). */
  getLayout(): LayoutResult | null {
    return this.lastLayout;
  }

  /** Measured size of a node, if it has been rendered. */
  getSize(id: string): Size | undefined {
    return this.views.get(id)?.size;
  }

  /** The DOM element of a node, if rendered (Stage C hit-testing). */
  getElement(id: string): HTMLElement | undefined {
    return this.views.get(id)?.el;
  }

  /**
   * Full render pass: sync node DOM to the tree, wait for any markdown
   * renders, then measure → layout → position → edges. Resolves when the
   * frame is complete.
   */
  async render(root: MindNode): Promise<void> {
    if (this.destroyed) return;
    this.lastRoot = root;

    // ---- write pass 1: sync DOM (create/update/remove), no reads ----
    const visible: MindNode[] = [];
    const depths = new Map<string, number>();
    const collectVisible = (n: MindNode, depth: number): void => {
      visible.push(n);
      depths.set(n.id, depth);
      if (!n.collapsed) for (const c of n.children) collectVisible(c, depth + 1);
    };
    collectVisible(root, 0);

    const pending: Promise<void>[] = [];
    const visibleIds = new Set<string>();
    for (const node of visible) {
      visibleIds.add(node.id);
      pending.push(...this.syncNode(node, depths.get(node.id) ?? 0));
    }
    for (const [id, view] of this.views) {
      if (!visibleIds.has(id)) {
        this.resizeObserver?.unobserve(view.el);
        view.el.remove();
        this.views.delete(id);
      }
    }

    // One ready state: a single Promise.all, no counters, no timers.
    if (pending.length > 0) await Promise.all(pending);
    if (this.destroyed || this.lastRoot !== root) return; // superseded

    // ---- read pass: measure ALL boxes before any position write ----
    for (const node of visible) {
      const view = this.views.get(node.id);
      if (!view) continue;
      const w = view.el.offsetWidth;
      const h = view.el.offsetHeight;
      // Detached / display:none containers measure 0 — keep undefined so
      // layout uses its fallback box instead of stacking everything at 0.
      view.size = w > 0 && h > 0 ? { w, h } : undefined;
    }

    // ---- pure layout ----
    const sizeOf = (id: string): Size | undefined => this.views.get(id)?.size;
    const layout = layoutTree(root, sizeOf, this.settings.layout);
    this.lastLayout = layout;

    // ---- write pass 2: positions + branch colors + edges ----
    for (const node of visible) {
      const view = this.views.get(node.id);
      const pos = layout.positions.get(node.id);
      if (!view || !pos) continue;
      view.el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      view.el.dataset.branch = String(pos.branchIndex);
      view.el.dataset.side = pos.side; // CSS places the fold dot per side
      view.el.style.setProperty(
        "--mm-branch-color",
        this.branchColor(pos.branchIndex)
      );
    }
    this.edges.update(root, layout, sizeOf, (i) => this.branchColor(i));
  }

  /** Re-render with the last tree on the next animation frame (rAF-batched). */
  scheduleRender(): void {
    if (this.renderScheduled || this.destroyed || !this.lastRoot) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      if (this.lastRoot) void this.render(this.lastRoot);
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const view of this.views.values()) view.el.remove();
    this.views.clear();
    this.edges.destroy();
  }

  // ---------------------------------------------------------------- private

  private branchColor(branchIndex: number): string {
    if (branchIndex < 0 || this.settings.branchColors.length === 0) {
      return "var(--interactive-accent)";
    }
    return this.settings.branchColors[
      branchIndex % this.settings.branchColors.length
    ];
  }

  /** Create or update one node's DOM. Returns pending markdown renders. */
  private syncNode(node: MindNode, depth: number): Promise<void>[] {
    const pending: Promise<void>[] = [];
    let view = this.views.get(node.id);
    if (!view) {
      const el = document.createElement("div");
      el.classList.add("mm-node");
      el.dataset.mmId = node.id;
      const contentEl = document.createElement("div");
      contentEl.classList.add("mm-node-content");
      el.appendChild(contentEl);
      this.worldEl.appendChild(el);
      view = {
        el,
        contentEl,
        taskEl: null,
        foldEl: null,
        renderedText: null, // null = never rendered yet
        renderedTask: "",
        size: undefined,
      };
      this.views.set(node.id, view);
      this.resizeObserver?.observe(el);
    }

    view.el.dataset.depth = String(Math.min(depth, 6));
    view.el.classList.toggle("is-collapsed", node.collapsed);

    // Task checkbox (render-only in Stage B; Stage C wires the tap).
    if (node.task !== "none") {
      if (!view.taskEl) {
        view.taskEl = document.createElement("span");
        view.taskEl.classList.add("mm-task");
        view.el.insertBefore(view.taskEl, view.contentEl);
      }
      if (view.renderedTask !== node.task) {
        view.taskEl.dataset.state = node.task;
        view.taskEl.textContent = node.task === "done" ? "✓" : "";
        view.renderedTask = node.task;
      }
    } else if (view.taskEl) {
      view.taskEl.remove();
      view.taskEl = null;
      view.renderedTask = "";
    }

    // Fold dot for nodes with children; shows hidden count when collapsed.
    if (node.children.length > 0) {
      if (!view.foldEl) {
        view.foldEl = document.createElement("div");
        view.foldEl.classList.add("mm-fold-dot");
        view.el.appendChild(view.foldEl);
      }
      view.foldEl.textContent = node.collapsed
        ? String(countDescendants(node))
        : "";
    } else if (view.foldEl) {
      view.foldEl.remove();
      view.foldEl = null;
    }

    // Node text — only re-render when it actually changed.
    if (view.renderedText !== node.text) {
      view.renderedText = node.text;
      // Empty nodes get a non-breaking space so the box stays measurable.
      // This is display-only — it is NEVER written into the model/file (B5).
      const display = node.text === "" ? " " : node.text;
      if (this.renderMarkdown && MD_SYNTAX_RE.test(display)) {
        view.contentEl.textContent = ""; // clear before async fill
        pending.push(
          this.renderMarkdown(display, view.contentEl).catch(() => {
            // Markdown renderer failure must never break the map: fall
            // back to plain text (the model text is untouched either way).
            view!.contentEl.textContent = display;
          })
        );
      } else {
        view.contentEl.textContent = display;
      }
    }
    return pending;
  }
}

/** Number of nodes hidden below a collapsed node. */
function countDescendants(node: MindNode): number {
  let count = 0;
  for (const child of node.children) count += 1 + countDescendants(child);
  return count;
}
