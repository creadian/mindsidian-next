// The per-view state object (design §2): ONE place where selection, editing,
// history, the tree, the renderer and the viewport meet. Every user action —
// from pointer.ts, keyboard.ts, the mobile bar, the palette — goes through a
// controller method, which runs an undoable command, re-renders, and tells
// the owner (dev harness now, MindmapView in Stage D) that the tree changed.
// No module-level state: everything lives on this instance.

import type { MindDocument, MindNode, ModelSettings } from "../model/types";
import { createNode, depthOf, planGroupMove, walk } from "../model/tree";
import {
  AddNodeCommand,
  ChangeTextCommand,
  Command,
  CompositeCommand,
  History,
  MoveNodeCommand,
  RemoveNodeCommand,
  SetCollapsedCommand,
  SetTaskCommand,
  TreeContext,
} from "../model/commands";
import type { InlineMarker } from "../model/format";
import { applyHighlight, stripHighlight, toggleMarker } from "../model/format";
import { normalizeBulletText } from "../model/parse";
import { buildIndex } from "../model/tree";
import type { MindmapRenderer } from "./render";
import type { Viewport } from "./viewport";
import { NodeEditor } from "./edit";
import { Selection, pruneToTopAncestors } from "./selection";
import { encodeSubtrees, decodeClipboard } from "./clipboard";

export interface ControllerCallbacks {
  /** Fired after every committed tree mutation (Stage D: requestSave). */
  onTreeChanged(): void;
  /** Show a user-facing message (Stage D: Notice). */
  notify?(message: string): void;
  /** Open a wikilink (Stage D: workspace.openLinkText). */
  openLink?(linkText: string, newPane: boolean): void;
}

export class MindmapController {
  readonly doc: MindDocument;
  readonly ctx: TreeContext;
  readonly history: History;
  readonly selection = new Selection();
  readonly editor = new NodeEditor();
  readonly renderer: MindmapRenderer;
  readonly viewport: Viewport;
  modelSettings: ModelSettings;
  readonly containerEl: HTMLElement;
  private readonly callbacks: ControllerCallbacks;

  /** Hidden, stable focus target: keyboard focus lands here — never on a
   *  node div — so browser focus can never auto-scroll the map (B2 fix). */
  private focusAnchor: HTMLElement;
  /** Ids that currently carry selection CSS classes (for cheap clearing). */
  private styledIds = new Set<string>();
  /** Pointer.ts installs this so the Escape ladder can cancel a marquee. */
  cancelMarquee: (() => boolean) | null = null;
  /** UI listeners (mobile bar, palette) re-render on selection change. */
  private selectionListeners: Array<() => void> = [];
  /** True once the user has actually edited (gates synthesized-root saves). */
  hasEdits = false;
  /** Id of a node created by addChild/addSiblingBelow whose FIRST edit is
   *  still open. Only such a node may be auto-removed when the edit ends
   *  empty — a pre-existing empty node in the file is user data (EC:
   *  Escape on it used to DELETE it from the file). */
  private newlyAddedId: string | null = null;

  constructor(options: {
    doc: MindDocument;
    renderer: MindmapRenderer;
    viewport: Viewport;
    containerEl: HTMLElement;
    modelSettings: ModelSettings;
    callbacks: ControllerCallbacks;
  }) {
    this.doc = options.doc;
    this.ctx = { root: options.doc.root, index: buildIndex(options.doc.root) };
    this.history = new History(this.ctx);
    this.renderer = options.renderer;
    this.viewport = options.viewport;
    this.containerEl = options.containerEl;
    this.modelSettings = options.modelSettings;
    this.callbacks = options.callbacks;

    this.focusAnchor = options.containerEl.ownerDocument.createElement("div");
    this.focusAnchor.className = "mn-focus-anchor";
    this.focusAnchor.tabIndex = -1;
    options.containerEl.appendChild(this.focusAnchor);
  }

  destroy(): void {
    this.focusAnchor.remove();
    this.selectionListeners = [];
  }

  // ------------------------------------------------------------ rendering

  /** Re-render the tree and repaint selection classes. */
  async refresh(): Promise<void> {
    const renderPromise = this.renderer.render(this.ctx.root);
    this.applySelectionClasses(); // node DOM exists synchronously
    await renderPromise;
    this.applySelectionClasses(); // re-applied in case views were recreated
  }

  /** Run a command as one undoable step, then re-render + notify.
   *  `countsAsEdit: false` (fold toggles outside markdown persistence)
   *  keeps hasEdits untouched so a forced save cannot normalize a file
   *  the user never edited (contract §1.5: a fold toggle in non-markdown
   *  mode must not touch the file). */
  execute(command: Command, opts?: { countsAsEdit?: boolean }): void {
    this.history.execute(command);
    if (opts?.countsAsEdit !== false) this.hasEdits = true;
    void this.refresh();
    this.callbacks.onTreeChanged();
  }

  notify(message: string): void {
    this.callbacks.notify?.(message);
  }

  /** Settings changed mid-session: refresh the frozen snapshot so guards
   *  (e.g. cycleTask's heading check) judge against the CURRENT headLevel,
   *  not the one from view construction. */
  updateModelSettings(settings: ModelSettings): void {
    this.modelSettings = settings;
  }

  openLink(linkText: string, newPane: boolean): void {
    this.callbacks.openLink?.(linkText, newPane);
  }

  // ------------------------------------------------------------ selection

  node(id: string): MindNode | undefined {
    return this.ctx.index.get(id);
  }

  get primaryNode(): MindNode | null {
    const id = this.selection.primary;
    return id ? this.ctx.index.get(id) ?? null : null;
  }

  select(id: string): void {
    this.selection.select(id);
    this.applySelectionClasses();
    this.focusKeyboard();
  }

  toggleMultiSelect(id: string): void {
    const node = this.ctx.index.get(id);
    if (!node) return;
    this.selection.toggleMulti(id, node.parent === null);
    this.applySelectionClasses();
    this.focusKeyboard();
  }

  /** Marquee live update — root is filtered out here. */
  setMultiSelection(ids: string[]): void {
    const valid = ids.filter((id) => this.ctx.index.get(id)?.parent != null);
    this.selection.setMulti(valid);
    this.applySelectionClasses();
  }

  clearSelection(): void {
    this.selection.clear();
    this.applySelectionClasses();
  }

  /** Move keyboard focus to the hidden anchor (never a node div). */
  focusKeyboard(): void {
    this.focusAnchor.focus({ preventScroll: true });
  }

  onSelectionChanged(listener: () => void): void {
    this.selectionListeners.push(listener);
  }

  /** Paint is-selected / is-multi-selected classes from selection state. */
  applySelectionClasses(): void {
    for (const id of this.styledIds) {
      const el = this.renderer.getElement(id);
      el?.classList.remove("is-selected", "is-multi-selected");
    }
    this.styledIds.clear();
    const multi = this.selection.isMulti;
    for (const id of this.selection.ids) {
      const el = this.renderer.getElement(id);
      if (!el) continue;
      el.classList.add(multi ? "is-multi-selected" : "is-selected");
      this.styledIds.add(id);
    }
    for (const listener of this.selectionListeners) listener();
  }

  /** Selected nodes pruned to top ancestors, root excluded (group ops). */
  selectedTopNodes(): MindNode[] {
    const nodes = this.selection.ids
      .map((id) => this.ctx.index.get(id))
      .filter((n): n is MindNode => n !== undefined && n.parent !== null);
    return pruneToTopAncestors(nodes);
  }

  // ------------------------------------------------------------ editing

  get isEditing(): boolean {
    return this.editor.isEditing;
  }

  /** Start inline editing. Synchronous so the iOS keyboard opens in-gesture. */
  beginEdit(id: string, options?: { selectAll?: boolean }): void {
    if (this.editor.editingId === id) return;
    const node = this.ctx.index.get(id);
    const nodeEl = this.renderer.getElement(id);
    const contentEl = this.renderer.getContentElement(id);
    if (!node || !nodeEl || !contentEl) {
      if (this.editor.isEditing) this.commitEdit();
      return;
    }
    if (this.editor.isEditing) {
      // Edit-to-edit switch: hand the keyboard over BEFORE the commit
      // tears the old editor down (see Editor.prepareHandoff), and skip
      // the anchor refocus — the target already owns the focus.
      this.editor.prepareHandoff(node, contentEl);
      this.commitEdit({ keepDomFocus: true });
    }
    this.selection.select(id);
    this.applySelectionClasses();
    this.editor.begin(node, nodeEl, contentEl, options);
    // A child/sibling born beyond the window edge appeared clipped AT the
    // edge (nothing panned — focus uses preventScroll). Reveal it with a
    // margin once this frame's layout has settled.
    requestAnimationFrame(() => {
      if (this.editor.editingId === id) this.revealNode(id);
    });
  }

  /** Pan (animated) the minimal amount that puts the node fully inside
   *  the view with a comfortable margin. No-op when already inside. */
  revealNode(id: string, margin = 64): void {
    const pos = this.renderer.getLayout()?.positions.get(id);
    if (!pos) return;
    const size = this.renderer.getSize(id);
    const { x: tx, y: ty, scale } = this.viewport.transform;
    const rect = this.containerEl.getBoundingClientRect();
    const w = (size?.w ?? 0) * scale;
    const h = (size?.h ?? 0) * scale;
    const left = tx + pos.x * scale; // container-relative screen coords
    const top = ty + pos.y * scale;
    // Shrink the margin for nodes too big to fit with it (never overshoot).
    const mx = Math.min(margin, Math.max(0, (rect.width - w) / 2));
    const my = Math.min(margin, Math.max(0, (rect.height - h) / 2));
    let dx = 0;
    let dy = 0;
    if (left < mx) dx = mx - left;
    else if (left + w > rect.width - mx) dx = rect.width - mx - (left + w);
    if (top < my) dy = my - top;
    else if (top + h > rect.height - my) dy = rect.height - my - (top + h);
    if (dx === 0 && dy === 0) return;
    this.viewport.animateTo({ x: tx + dx, y: ty + dy, scale }, 160);
  }

  /** Commit the in-flight edit (if any) as one history step.
   *  `keepDomFocus` (edit handoff): do not refocus the keyboard anchor —
   *  the next edit target already holds the focus. */
  commitEdit(opts?: { keepDomFocus?: boolean }): void {
    const result = this.editor.commit();
    if (!result) return;
    this.renderer.invalidateNode(result.nodeId);
    let newText = result.newText;
    // The root must stay one non-empty H1 line — an empty or multi-line
    // root has no lossless markdown form (it would trip the save
    // self-check and silently block every save). Sanitize at commit time
    // so what the user sees is exactly what gets saved.
    if (newText !== null && result.nodeId === this.ctx.root.id) {
      const flat = newText.replace(/\s*\n+\s*/g, " ").trim();
      if (flat === "") {
        this.notify("The root node cannot be empty — previous text kept.");
        newText = null;
      } else if (flat !== newText) {
        this.notify("Root text must be a single line — line breaks removed.");
        newText = flat;
      }
    }
    // Normalize non-root text to its parse-stable form (EC10a): text
    // beginning with a list marker would serialize to a line the parser
    // rewrites, making the save self-check fail on EVERY save — the whole
    // session's edits would silently never reach disk.
    if (newText !== null && result.nodeId !== this.ctx.root.id) {
      const norm = normalizeBulletText(newText);
      if (norm !== newText) {
        this.notify(
          "Text adjusted — a leading list marker or trailing fold-id suffix cannot be stored as node text."
        );
        newText = norm;
      }
    }
    // An empty childless node whose FIRST edit ended empty is an abandoned
    // add — remove it (outliner convention). Pre-existing empty nodes are
    // file content and stay (their heading-depth form is handled by the
    // serializer's sibling-group demotion).
    const edited = this.ctx.index.get(result.nodeId);
    const wasJustAdded = this.newlyAddedId === result.nodeId;
    this.newlyAddedId = null;
    const finalText = newText !== null ? newText : (edited?.text ?? "");
    if (
      wasJustAdded &&
      edited && edited.parent && finalText === "" && edited.children.length === 0
    ) {
      const parentId = edited.parent.id;
      this.execute(new RemoveNodeCommand(edited.id));
      if (opts?.keepDomFocus) {
        // Handoff in flight — selecting via select() would refocus the
        // keyboard anchor and blink the iOS keyboard away again.
        this.selection.select(parentId);
        this.applySelectionClasses();
      } else {
        this.select(parentId);
      }
      return;
    }
    if (newText !== null) {
      this.execute(new ChangeTextCommand(result.nodeId, newText));
    } else {
      void this.refresh();
    }
    if (!opts?.keepDomFocus) this.focusKeyboard();
  }

  /** Cancel the in-flight edit — original text stays, nothing in history. */
  cancelEdit(): void {
    const id = this.editor.cancel();
    if (!id) return;
    this.renderer.invalidateNode(id);
    // Escape on a JUST-ADDED empty child abandons it — same removal rule
    // as commitEdit. A pre-existing empty node stays: it is file content.
    const node = this.ctx.index.get(id);
    const wasJustAdded = this.newlyAddedId === id;
    this.newlyAddedId = null;
    if (wasJustAdded && node && node.parent && node.text === "" && node.children.length === 0) {
      const parentId = node.parent.id;
      this.execute(new RemoveNodeCommand(id));
      this.select(parentId);
      return;
    }
    void this.refresh();
    this.focusKeyboard();
  }

  /** Escape ladder: marquee → multi-select → cancel edit → clear selection. */
  escape(): void {
    if (this.cancelMarquee?.()) return;
    if (this.selection.isMulti) {
      this.selection.collapseToPrimary();
      this.applySelectionClasses();
      return;
    }
    if (this.editor.isEditing) {
      this.cancelEdit();
      return;
    }
    this.clearSelection();
  }

  // ------------------------------------------------------------ node CRUD

  /** Enter: new empty sibling below the current node (root gets a child). */
  addSiblingBelow(): void {
    const ref = this.primaryNode ?? this.ctx.root;
    if (!ref.parent) {
      this.addChild();
      return;
    }
    const node = createNode("");
    const index = ref.parent.children.indexOf(ref) + 1;
    this.execute(new AddNodeCommand(ref.parent.id, index, node));
    this.selection.select(node.id);
    this.beginEdit(node.id);
    this.newlyAddedId = node.id;
  }

  /** Tab: new empty child of the current node (auto-expands a folded one). */
  addChild(): void {
    const parent = this.primaryNode ?? this.ctx.root;
    const node = createNode("");
    const commands: Command[] = [];
    if (parent.collapsed) commands.push(new SetCollapsedCommand(parent.id, false));
    commands.push(new AddNodeCommand(parent.id, parent.children.length, node));
    this.execute(new CompositeCommand(commands));
    this.selection.select(node.id);
    this.beginEdit(node.id);
    this.newlyAddedId = node.id;
  }

  /** Delete the selection (pruned to top ancestors) as one history step. */
  deleteSelection(): void {
    const targets = this.selectedTopNodes();
    if (targets.length === 0) return;
    const nextId = targets[0].parent?.id ?? this.ctx.root.id;
    this.execute(
      new CompositeCommand(targets.map((n) => new RemoveNodeCommand(n.id)))
    );
    this.select(nextId);
  }

  // ------------------------------------------------------------ moving

  /** Alt+Shift+Up/Down: reorder among siblings, wrapping around. */
  moveAmongSiblings(direction: "up" | "down"): void {
    const node = this.primaryNode;
    const parent = node?.parent;
    if (!node || !parent) return;
    const siblings = parent.children;
    if (siblings.length < 2) return;
    const from = siblings.indexOf(node);
    const to = (from + (direction === "up" ? -1 : 1) + siblings.length) % siblings.length;
    // moveNode counts the slot before removal: moving forward needs +1.
    this.execute(new MoveNodeCommand(node.id, parent.id, to > from ? to + 1 : to));
    this.select(node.id);
  }

  /** Promote: become the parent's next sibling (Shift+Tab / move toward root). */
  promote(): void {
    const node = this.primaryNode;
    const parent = node?.parent;
    const grandparent = parent?.parent;
    if (!node || !parent || !grandparent) return;
    const index = grandparent.children.indexOf(parent) + 1;
    this.execute(new MoveNodeCommand(node.id, grandparent.id, index));
    this.select(node.id);
  }

  /** Demote: become the last child of the previous sibling. */
  demote(): void {
    const node = this.primaryNode;
    const parent = node?.parent;
    if (!node || !parent) return;
    const at = parent.children.indexOf(node);
    const prev = parent.children[at - 1];
    if (!prev) return;
    const commands: Command[] = [];
    if (prev.collapsed) commands.push(new SetCollapsedCommand(prev.id, false));
    commands.push(new MoveNodeCommand(node.id, prev.id, prev.children.length));
    this.execute(new CompositeCommand(commands));
    this.select(node.id);
  }

  /** Alt+Shift+Left/Right: side-aware promote/demote (mirrored flanks). */
  moveHorizontal(direction: "left" | "right"): void {
    const node = this.primaryNode;
    if (!node || !node.parent) return;
    const side = this.renderer.getLayout()?.positions.get(node.id)?.side ?? "right";
    const towardRoot = side === "right" ? "left" : "right";
    if (direction === towardRoot) this.promote();
    else this.demote();
  }

  /** All following siblings become children of the current node. */
  moveNextSiblingsAsChildren(allSiblings = false): void {
    const node = this.primaryNode;
    const parent = node?.parent;
    if (!node || !parent) return;
    const at = parent.children.indexOf(node);
    const movers = parent.children.filter(
      (sibling, i) => sibling !== node && (allSiblings || i > at)
    );
    if (movers.length === 0) return;
    const commands: Command[] = [];
    if (node.collapsed) commands.push(new SetCollapsedCommand(node.id, false));
    movers.forEach((sibling, i) =>
      commands.push(new MoveNodeCommand(sibling.id, node.id, node.children.length + i))
    );
    this.execute(new CompositeCommand(commands));
    this.select(node.id);
  }

  /** Drop commit from drag-to-reparent: move a group as ONE history step.
   *  Indices are computed by SIMULATING each move on a copy of the sibling
   *  list — the naive "base + i" scheme reads positions from the pre-move
   *  array while the commands mutate the real one sequentially, which
   *  scrambled multi-select reorders (A B C D E, move [B,C] after D used
   *  to yield A D B E C). The simulation mirrors moveNode()'s semantics:
   *  index counts the slot BEFORE removal, same-parent forward moves -1. */
  moveNodes(
    nodes: MindNode[],
    target: MindNode,
    kind: "child" | "before" | "after"
  ): void {
    const commands: Command[] = [];
    const parent = kind === "child" ? target : target.parent;
    if (!parent) return; // no siblings beside the root
    if (kind === "child" && target.collapsed) {
      commands.push(new SetCollapsedCommand(target.id, false));
    }
    // First node lands after `anchor` (null = at the very start / before
    // target); each moved node then becomes the anchor for the next.
    const siblings = parent.children;
    const anchor: MindNode | null =
      kind === "child"
        ? siblings[siblings.length - 1] ?? null
        : kind === "after"
          ? target
          : siblings[siblings.indexOf(target) - 1] ?? null;
    for (const step of planGroupMove(parent, nodes, anchor)) {
      commands.push(new MoveNodeCommand(step.node.id, parent.id, step.index));
    }
    if (commands.length === 0) return;
    this.execute(new CompositeCommand(commands));
    this.select(nodes[0].id);
  }

  // ------------------------------------------------------------ fold / level

  toggleFold(id: string): void {
    const node = this.ctx.index.get(id);
    if (!node || !node.parent || node.children.length === 0) return;
    this.execute(new SetCollapsedCommand(id, !node.collapsed), {
      countsAsEdit: this.foldTouchesMarkdown(),
    });
  }

  /** Fold state only lives in the file in "markdown" persistence mode. */
  private foldTouchesMarkdown(): boolean {
    return this.modelSettings.foldStatePersistence === "markdown";
  }

  /** Deepest depth currently visible (not hidden under a collapsed node). */
  private displayedDepth(): number {
    let max = 0;
    const visit = (n: MindNode, depth: number): void => {
      if (depth > max) max = depth;
      if (!n.collapsed) for (const c of n.children) visit(c, depth + 1);
    };
    visit(this.ctx.root, 0);
    return max;
  }

  /** Collapse/expand the whole map to show exactly `level` depths. */
  setDisplayedLevel(level: number): void {
    const target = Math.max(1, level);
    const commands: Command[] = [];
    walk(this.ctx.root, (n, depth) => {
      if (n.children.length === 0) return;
      const shouldCollapse = depth >= target;
      if (n.collapsed !== shouldCollapse) {
        commands.push(new SetCollapsedCommand(n.id, shouldCollapse));
      }
    });
    if (commands.length === 0) return;
    this.execute(new CompositeCommand(commands), {
      countsAsEdit: this.foldTouchesMarkdown(),
    });
    // Keep the selection visible: climb to the deepest still-visible ancestor.
    const primary = this.primaryNode;
    if (primary && depthOf(primary) > target) {
      let node = primary;
      while (node.parent && depthOf(node) > target) node = node.parent;
      this.select(node.id);
    }
  }

  expandOneLevel(): void {
    this.setDisplayedLevel(this.displayedDepth() + 1);
  }

  collapseOneLevel(): void {
    this.setDisplayedLevel(this.displayedDepth() - 1);
  }

  foldAll(): void {
    this.setDisplayedLevel(1);
  }

  unfoldAll(): void {
    this.setDisplayedLevel(99);
  }

  // ------------------------------------------------------------ tasks

  /** Checkbox tap: binary todo ↔ done (never removes the task). */
  toggleTaskBinary(id: string): void {
    const node = this.ctx.index.get(id);
    if (!node || node.task === "none") return;
    this.execute(new SetTaskCommand(id, node.task === "done" ? "todo" : "done"));
  }

  /** Command: cycle none → todo → done → none. Bullet nodes only. */
  cycleTask(): void {
    const node = this.primaryNode;
    if (!node) return;
    if (depthOf(node) < this.modelSettings.headLevel) {
      this.notify("Headings cannot be tasks — only bullet nodes.");
      return;
    }
    const next = node.task === "none" ? "todo" : node.task === "todo" ? "done" : "none";
    this.execute(new SetTaskCommand(node.id, next));
  }

  // ------------------------------------------------------------ formatting

  /** Bold/italic/highlight/strike on the node (or edit-selection substring). */
  toggleFormat(marker: InlineMarker): void {
    if (this.editor.toggleMarkerInEdit(marker)) return;
    const node = this.primaryNode;
    if (!node) return;
    this.execute(new ChangeTextCommand(node.id, toggleMarker(node.text, marker)));
  }

  /** Palette pick: color = recolor/wrap, null = strip. Multi-select aware. */
  applyHighlightColor(color: string | null): void {
    const targets = this.selection.isMulti
      ? this.selection.ids.map((id) => this.ctx.index.get(id)).filter((n): n is MindNode => !!n)
      : this.primaryNode
        ? [this.primaryNode]
        : [];
    if (targets.length === 0) return;
    if (this.editor.isEditing) this.commitEdit();
    const commands = targets.map(
      (n) =>
        new ChangeTextCommand(
          n.id,
          color === null ? stripHighlight(n.text) : applyHighlight(n.text, color)
        )
    );
    this.execute(new CompositeCommand(commands));
  }

  // ------------------------------------------------------------ clipboard

  /** Returns true when the payload actually reached the system clipboard. */
  async copySelection(): Promise<boolean> {
    const nodes = this.selectedTopNodes();
    if (nodes.length === 0) return false;
    const payload = encodeSubtrees(nodes);
    if (!payload) return false;
    return writeClipboard(payload);
  }

  /** Cut = copy + delete, but ONLY when the copy verifiably succeeded —
   *  otherwise the nodes would be destroyed with nothing to paste back. */
  async cutSelection(): Promise<void> {
    const copied = await this.copySelection();
    if (!copied) {
      if (this.selectedTopNodes().length > 0) {
        this.notify("Cut cancelled — could not write to the clipboard.");
      }
      return;
    }
    this.deleteSelection();
  }

  /** Paste subtrees as children of the selection; re-writes the clipboard
   *  (fresh ids) so paste can repeat. */
  async pasteIntoSelection(): Promise<void> {
    const target = this.primaryNode ?? this.ctx.root;
    const text = await readClipboard();
    const subtrees = decodeClipboard(text);
    if (!subtrees) return;
    const commands: Command[] = [];
    if (target.collapsed) commands.push(new SetCollapsedCommand(target.id, false));
    subtrees.forEach((tree, i) =>
      commands.push(new AddNodeCommand(target.id, target.children.length + i, tree))
    );
    this.execute(new CompositeCommand(commands));
    await writeClipboard(encodeSubtrees(subtrees)); // fresh ids for next paste
  }

  // ------------------------------------------------------------ history

  undo(): void {
    if (this.editor.isEditing) this.cancelEdit();
    if (!this.history.undo()) return;
    this.selection.pruneTo(this.ctx.index);
    void this.refresh();
    this.callbacks.onTreeChanged();
  }

  redo(): void {
    if (this.editor.isEditing) this.commitEdit();
    if (!this.history.redo()) return;
    this.selection.pruneTo(this.ctx.index);
    void this.refresh();
    this.callbacks.onTreeChanged();
  }

  // ------------------------------------------------------------ viewport

  /** Center the view on a node (explicit command — never automatic). */
  centerOnNode(id: string, animate = true): void {
    const pos = this.renderer.getLayout()?.positions.get(id);
    const size = this.renderer.getSize(id);
    if (!pos) return;
    const w = size?.w ?? 0;
    const h = size?.h ?? 0;
    this.viewport.centerOnWorldPoint(pos.x + w / 2, pos.y + h / 2, animate);
  }

  recenter(animate = true): void {
    const layout = this.renderer.getLayout();
    if (layout) this.viewport.recenter(layout.bounds, animate);
  }

  /** Home: select the root and center on it. */
  goHome(): void {
    this.select(this.ctx.root.id);
    this.centerOnNode(this.ctx.root.id);
  }
}

// Clipboard IO kept tiny and failure-tolerant (clipboard.ts stays pure).
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // clipboard permission denied — caller decides
  }
}

async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}
