// The real Obsidian view (design §4): a TextFileView subclass — the ONLY
// owner of disk I/O. Obsidian pushes file text in via setViewData and pulls
// it back out via getViewData; we never call vault.modify on our own file.
// Every save passes the refuse-to-corrupt guard: serialize → reparse →
// re-serialize must be byte-identical, otherwise the last-known-good text
// is written instead and the user is told nothing changed on disk.

import {
  MarkdownRenderer,
  Menu,
  Notice,
  Platform,
  TextFileView,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import type MindsidianNextPlugin from "../main";
import type { MindDocument, ModelSettings } from "../model/types";
import { parseDocument } from "../model/parse";
import {
  allLinesContained,
  nodeIdAtLine,
  nodeLineInDocument,
  serializeDocument,
} from "../model/serialize";
import { DEFAULT_FRONTMATTER, readZoomFromPrefix } from "../model/region";
import { applyCollapsedPaths, collectCollapsedPaths } from "../model/tree";
import { toModelSettings, toRenderSettings } from "../settings";
import { MindmapRenderer } from "./render";
import { Viewport, clampScale } from "./viewport";
import { MindmapController } from "./controller";
import { PointerController } from "../input/pointer";
import { KeyboardController } from "../input/keyboard";
import { ClipboardEventController } from "../input/clipboardEvents";
import { KeyboardInsets } from "../input/keyboardInsets";
import { HighlightPalette } from "../ui/palette";
import { MobileActionBar } from "../ui/mobileBar";
import { insertWikilink } from "../ui/wikilink";
import { NodeLinkSuggest } from "./linksuggest";
import { WikilinkModal } from "../ui/wikilinkModal";
import { showNodeMenu } from "../ui/nodeMenu";

export const MINDMAP_VIEW_TYPE = "mindsidian-next";

/** First line where two serializations differ — shown in the self-check
 *  Notice so a refused save names the offending node instead of failing
 *  anonymously (a non-technical user cannot debug a bare refusal). */
function firstDiffLine(a: string, b: string | null): string {
  if (b === null) return "(file did not reparse)";
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) return (al[i] ?? bl[i] ?? "").slice(0, 60);
  }
  return "";
}

export class MindmapView extends TextFileView {
  private plugin: MindsidianNextPlugin;
  private modelSettings: ModelSettings;

  // The Stage B/C stack — rebuilt per file load, torn down in clear().
  controller: MindmapController | null = null;
  private renderer: MindmapRenderer | null = null;
  private viewport: Viewport | null = null;
  private pointer: PointerController | null = null;
  private keyboard: KeyboardController | null = null;
  private clipboardEvents: ClipboardEventController | null = null;
  private keyboardInsets: KeyboardInsets | null = null;
  private palette: HighlightPalette | null = null;
  /** Inline "[[" autocomplete, one per (cached) node content element. */
  private linkSuggests = new WeakMap<HTMLElement, NodeLinkSuggest>();
  private activeLinkSuggest: NodeLinkSuggest | null = null;
  private mobileBar: MobileActionBar | null = null;

  /** True after a failed parse: getViewData must echo the original bytes. */
  private saveBlocked = false;
  /** Text of our own last save — lets the reconcile path ignore echoes. */
  private lastEmittedText: string | null = null;
  /** Zoom % in effect right after load; the close-time write compares to it. */
  private initialZoomPct = 100;
  /** True while committed edits are waiting on the debounced save. */
  private savePending = false;
  /** Zoom captured by teardown() for onUnloadFile's frontmatter write. */
  private parkedZoom: number | null = null;
  /** True only after a DELIBERATE zoom (wheel/pinch/command). The plugin's
   *  own fit/recenter also changes the scale — without this gate, a plain
   *  open-then-close rewrote mindmap-zoom on large maps (contract E12). */
  private userZoomed = false;
  /** Timestamp of our last successful save — a reload arriving within a
   *  short window of it is likely another pane reacting to that save. */
  private lastSaveAt = 0;

  constructor(leaf: WorkspaceLeaf, plugin: MindsidianNextPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.modelSettings = toModelSettings(plugin.settings);
    this.navigation = true;
  }

  onload(): void {
    super.onload();
    // The debounced save leaves a ~2s window in which edits exist only in
    // memory. Flush it whenever this window loses focus or is hidden, so
    // sync / another app sees the freshest bytes and the window in which
    // an external writer can race us stays as small as possible.
    const flush = () => {
      if (this.savePending && !this.saveBlocked) void this.save();
    };
    this.registerDomEvent(window, "blur", flush);
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden) flush();
    });
  }

  getViewType(): string {
    return MINDMAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Mindmap";
  }

  getIcon(): string {
    return "git-fork";
  }

  // Must be false: Obsidian's WorkspaceLeaf.openFile keeps the CURRENT view
  // type whenever the current view canAcceptExtension — accepting "md" made
  // every wikilink clicked inside a mindmap load the target note INTO this
  // view (which then wrote mindmap-zoom frontmatter into a plain note on
  // unload). With false, openFile falls back to the markdown view; real
  // mindmap files are swapped back by maybeSwapToMindmap via the file-open /
  // active-leaf-change events in main.ts.
  canAcceptExtension(): boolean {
    return false;
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setTitle("Open as markdown")
        .setIcon("file-text")
        .setSection("pane")
        .onClick(() => this.openAsMarkdown())
    );
  }

  /** Switch this leaf back to the plain markdown editor (sticks per file). */
  openAsMarkdown(): void {
    const path = this.file?.path;
    if (path) void this.plugin.setMarkdownView(this.leaf, path);
  }

  /** Context-menu "Show in Markdown view": switch to the markdown editor
   *  and land on this node's line. Read-only — the line is computed from
   *  the same emission a save would write, nothing touches the file. */
  async revealNodeInMarkdown(nodeId: string): Promise<void> {
    const controller = this.controller;
    const path = this.file?.path;
    if (!controller || !path) return;
    // Commit an in-flight edit so the editor shows what the map shows.
    if (controller.editor.isEditing) controller.commitEdit();
    const line = nodeLineInDocument(controller.doc, nodeId, this.modelSettings);
    const leaf = this.leaf;
    await this.plugin.setMarkdownView(leaf, path);
    if (line === null) return;
    // eState {line} scrolls to and flash-highlights the line (the same
    // mechanism search results use). Applied twice: the editor may still
    // be laying out right after the view swap.
    leaf.setEphemeralState({ line });
    window.setTimeout(() => leaf.setEphemeralState({ line }), 150);
  }

  // ------------------------------------------------------- load (disk → view)

  /**
   * Obsidian pushes file text here on load and on external changes.
   * Self-save echoes (text identical to what we just emitted) keep the
   * live tree — selection, history and viewport survive.
   */
  setViewData(data: string, clear: boolean): void {
    this.data = data;
    if (!clear && this.controller && data === this.lastEmittedText) return;
    // External change (sync, another app, a second view on this file):
    // the disk is the source of truth, so we rebuild from it — but if
    // edits were still waiting on the debounced save (or an inline edit
    // was open), they MAY be lost in the reload. Obsidian usually
    // auto-merges external changes, preserving our edits — so verify
    // against the incoming text and warn only about genuine loss.
    if (
      !clear &&
      this.controller &&
      (this.savePending ||
        this.controller.editor.isEditing ||
        Date.now() - this.lastSaveAt < 3000)
    ) {
      if (this.pendingEditsSurvivedIn(data)) {
        console.info(
          "Mindsidian Next: external reload — all pending edits are present " +
            "in the incoming text; no data was lost."
        );
      } else {
        new Notice(
          "Mindsidian Next: this file was changed outside this view — " +
            "reloaded from disk; some of your last edits are NOT in the " +
            "new version and were discarded."
        );
      }
    }
    this.savePending = false;
    // Real external content replaced our last emission — a LATER write of
    // those old bytes must rebuild, not be mistaken for our own echo.
    if (data !== this.lastEmittedText) this.lastEmittedText = null;
    this.rebuild(data);
  }

  /**
   * Did the state this view holds (including a still-open inline edit)
   * fully make it into the incoming external text? Folds an open edit
   * into the model first (safe: the model is discarded by the rebuild
   * right after), serializes, and checks line containment. Any doubt —
   * commit or serialize failing — counts as NOT survived, so the
   * data-loss warning errs toward showing.
   */
  private pendingEditsSurvivedIn(incoming: string): boolean {
    const controller = this.controller;
    if (!controller) return false;
    if (controller.editor.isEditing) {
      try {
        controller.commitEdit();
      } catch (error) {
        console.error("Mindsidian Next: commit-for-reload-check failed", error);
        return false;
      }
    }
    try {
      const ours = serializeDocument(controller.doc, this.modelSettings);
      return ours === incoming || allLinesContained(ours, incoming);
    } catch (error) {
      console.error("Mindsidian Next: reload-check serialize failed", error);
      return false;
    }
  }

  /**
   * Disk write path. Pure + synchronous (design §4) with the
   * refuse-to-corrupt guard. On ANY doubt it returns the last-known-good
   * text, so the file on disk is never replaced by a broken serialization.
   */
  getViewData(): string {
    if (this.saveBlocked || !this.controller) return this.data;
    const doc = this.controller.doc;

    // Open-then-close without an edit writes nothing new (contract E12/T7)
    // — for EVERY file, not just synthesized roots. Obsidian can force a
    // save outside requestSave (Ctrl+S, save-on-close); without this
    // guard, that would normalize a legacy file the user never touched.
    if (!this.controller.hasEdits) return this.data;

    // First real save of a synthesized root: add the default frontmatter
    // exactly once (contract T7 — frontmatter is the view's job).
    if (doc.synthesizedRoot && this.controller.hasEdits && doc.prefix === "") {
      doc.prefix = DEFAULT_FRONTMATTER;
    }

    const text = serializeDocument(doc, this.modelSettings);
    const reparsed = parseDocument(text, this.file?.basename ?? "");
    const second = reparsed.ok
      ? serializeDocument(reparsed.doc, this.modelSettings)
      : null;
    if (second !== text) {
      console.error("Mindsidian Next: save self-check failed", { text, second });
      new Notice(
        "Mindsidian Next: save self-check failed — nothing was changed on disk. " +
          `Problem near: "${firstDiffLine(text, second)}"`
      );
      return this.data; // last-known-good bytes
    }
    this.lastEmittedText = text;
    this.lastSaveAt = Date.now();
    this.data = text;
    doc.originalText = text;
    this.savePending = false; // in-memory state is on disk again
    return text;
  }

  /** Reset all per-file state (called when another file loads into us). */
  clear(): void {
    this.teardown();
    this.saveBlocked = false;
    this.lastEmittedText = null;
    this.savePending = false;
    this.userZoomed = false;
    this.data = "";
  }

  /** Capture zoom BEFORE the stack is torn down, write it after the save
   *  flush — and only when it actually changed (contract T22 / E12). */
  async onUnloadFile(file: TFile): Promise<void> {
    // An inline edit still open when the file is switched away must reach
    // the model BEFORE the unload flush below reads it — otherwise the
    // typed text is silently discarded with the editor DOM.
    if (this.controller?.editor.isEditing) {
      try {
        this.controller.commitEdit();
      } catch (error) {
        console.error("Mindsidian Next: commit-on-unload failed", error);
      }
    }
    // teardown() may already have run (Obsidian's ordering varies) — in
    // that case pendingZoomWrite() sees no viewport and the parked value
    // from teardown carries the zoom across.
    const zoom = this.pendingZoomWrite() ?? this.parkedZoom;
    this.parkedZoom = null;
    await super.onUnloadFile(file); // flushes any pending debounced save
    // Safety net: never write zoom into a file that isn't a mindmap — a plain
    // note that somehow entered this view must not get properties added.
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const isMindmap = fm != null && fm["mindmap-plugin"] != null;
    if (zoom !== null && isMindmap) {
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          fm["mindmap-zoom"] = zoom;
        });
      } catch (error) {
        console.error("Mindsidian Next: zoom write failed", error);
      }
    }
  }

  async onClose(): Promise<void> {
    this.teardown();
    await super.onClose();
  }

  // ---------------------------------------------------------------- rebuild

  /** Parse `data` and stand up the full render + interaction stack. */
  private rebuild(data: string): void {
    this.teardown(false); // external text wins over an in-flight edit
    const file = this.file;
    const basename = file?.basename ?? "Untitled";

    const result = parseDocument(data, basename);
    if (!result.ok) {
      // Parse failure: read-only panel, saves blocked, original bytes kept.
      this.saveBlocked = true;
      this.showErrorPanel(result.error);
      return;
    }
    this.saveBlocked = false;
    const doc = result.doc;

    // plugin-data fold mode: collapsed state lives in plugin data, keyed by
    // text paths, so the markdown stays clean (contract §1.5 / T23).
    if (
      this.modelSettings.foldStatePersistence === "plugin-data" &&
      file
    ) {
      const paths = this.plugin.settings.foldStates[file.path];
      if (paths) applyCollapsedPaths(doc.root, paths);
    }

    // DOM scaffold: container (events, focus) + world (transformed content).
    this.contentEl.empty();
    this.contentEl.addClass("mn-container");
    this.applyContainerStyle();
    const world = this.contentEl.createDiv();

    this.renderer = new MindmapRenderer(world, {
      settings: toRenderSettings(this.plugin.settings, Platform.isMobile),
      renderMarkdown: async (markdown, el) => {
        await MarkdownRenderer.render(this.app, markdown, el, file?.path ?? "", this);
      },
    });
    this.viewport = new Viewport(this.contentEl, world);
    this.viewport.onUserZoom = () => {
      this.userZoomed = true;
    };
    this.viewport.attach();

    // Keyboard-top tracker: shared truth for the controller's revealNode
    // and the mobile bar (iOS landscape hides the keyboard from the web
    // layer — see KeyboardInsets).
    this.keyboardInsets = new KeyboardInsets(this.contentEl.ownerDocument);
    this.keyboardInsets.attach();
    const insets = this.keyboardInsets;

    this.controller = new MindmapController({
      doc,
      renderer: this.renderer,
      viewport: this.viewport,
      containerEl: this.contentEl,
      modelSettings: this.modelSettings,
      visibleBottom: () => insets.visibleBottom(),
      callbacks: {
        onTreeChanged: () => this.onTreeChanged(),
        notify: (message) => new Notice(message),
        openLink: (linkText, newPane) => {
          void this.app.workspace.openLinkText(linkText, file?.path ?? "", newPane);
        },
      },
    });
    // Inline "[[" autocomplete: one suggest per content element (elements are
    // cached per node in render.ts — reuse instead of stacking listeners).
    this.controller.editor.onEditStart = (contentEl) => {
      let suggest = this.linkSuggests.get(contentEl);
      if (!suggest) {
        suggest = new NodeLinkSuggest(
          this.app,
          contentEl as HTMLDivElement,
          () => this.file?.path ?? "",
          () => this.controller?.editor.composing ?? false
        );
        this.linkSuggests.set(contentEl, suggest);
      }
      this.activeLinkSuggest = suggest;
    };
    this.controller.editor.onEditEnd = () => {
      // Blur already closes the popover; belt-and-braces for edge orderings.
      this.activeLinkSuggest?.close();
      this.activeLinkSuggest = null;
    };

    this.pointer = new PointerController(this.controller, world);
    this.pointer.onNodeMenu = (nodeId, x, y) => {
      const controller = this.controller;
      if (!controller) return;
      showNodeMenu({
        controller,
        nodeId,
        x,
        y,
        revealInMarkdown: (id) => void this.revealNodeInMarkdown(id),
      });
    };
    this.pointer.attach();
    this.keyboard = new KeyboardController(
      this.controller,
      () => this.app.workspace.getActiveViewOfType(MindmapView) === this
    );
    this.keyboard.attach();
    this.clipboardEvents = new ClipboardEventController(
      this.controller,
      () => this.app.workspace.getActiveViewOfType(MindmapView) === this
    );
    this.clipboardEvents.attach();
    this.palette = new HighlightPalette(this.controller);
    if (Platform.isMobile) {
      this.mobileBar = new MobileActionBar(
        this.controller,
        this.palette,
        insets,
        () => this.plugin.settings.mobileBarDiagnostics
      );
    }
    this.registerHoverPreview();

    // First paint: render, center, then apply the persisted/default zoom.
    this.initialZoomPct = readZoomFromPrefix(doc.prefix) ?? this.plugin.settings.defaultZoom;
    void this.firstPaint(this.initialZoomPct);
  }

  private async firstPaint(zoomPct: number): Promise<void> {
    const controller = this.controller;
    const renderer = this.renderer;
    const viewport = this.viewport;
    if (!controller || !renderer || !viewport) return;
    await controller.refresh();
    const layout = renderer.getLayout();
    if (layout) viewport.recenter(layout.bounds, false);
    const target = clampScale(zoomPct / 100);
    const current = viewport.transform.scale;
    if (current > 0 && target !== current) viewport.zoomAtCenter(target / current);
    controller.focusKeyboard();

    // Markdown → mindmap jump: consume a cursor-line reveal parked by the
    // "Show current line in mindmap" command before the view swap.
    const pendingLine = this.plugin.takePendingReveal(this.file?.path ?? null);
    if (pendingLine !== null) {
      controller.revealById(nodeIdAtLine(controller.doc, pendingLine, this.modelSettings));
    }

    // Plugin reload (e.g. a BRAT update) re-creates the view while node
    // measurements are still settling, so the recenter above can aim at
    // bogus bounds and leave the whole map off-screen. One delayed check:
    // if NOTHING is visible, recenter again — a deliberate user pan always
    // leaves part of the map visible, so this can never fight the user.
    window.setTimeout(() => {
      const lay = renderer.getLayout();
      const container = controller.containerEl;
      if (!lay || !container.isConnected) return;
      const t = viewport.transform;
      const x1 = t.x + lay.bounds.minX * t.scale;
      const x2 = t.x + lay.bounds.maxX * t.scale;
      const y1 = t.y + lay.bounds.minY * t.scale;
      const y2 = t.y + lay.bounds.maxY * t.scale;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (x2 < 0 || x1 > w || y2 < 0 || y1 > h) {
        viewport.recenter(lay.bounds, false);
      }
    }, 300);
  }

  /** The single save funnel: every committed mutation lands here. */
  private onTreeChanged(): void {
    const controller = this.controller;
    const file = this.file;
    if (!controller) return;
    // plugin-data fold mode: persist collapsed text-paths off-markdown.
    if (this.modelSettings.foldStatePersistence === "plugin-data" && file) {
      this.plugin.setFoldPaths(file.path, collectCollapsedPaths(controller.doc.root));
    }
    // Optional: keep the selected node centered after mutations.
    if (this.plugin.settings.focusOnMove) {
      const id = controller.selection.primary;
      if (id) controller.centerOnNode(id);
    }
    // Only schedule a disk write when the serialization actually differs
    // (a fold toggle in non-markdown mode must not touch the file).
    if (this.saveBlocked) return;
    // Without a committed edit, nothing may reach the disk (contract E12,
    // same gate as getViewData). A fold toggle in plugin-data/none mode
    // lands here with hasEdits false — serializing anyway would adopt and
    // save a normalized text whenever the disk bytes contain anything the
    // serializer re-emits differently (e.g. legacy fold markers), silently
    // rewriting a file the user never edited.
    if (!controller.hasEdits) return;
    const text = serializeDocument(controller.doc, this.modelSettings);
    if (text !== this.data) {
      // Adopt the new text into this.data NOW (after the same self-check
      // getViewData uses) — not only at save time. Obsidian tears the
      // controller down before the unload flush on a view toggle, and
      // getViewData's controller-gone fallback returns this.data; if that
      // were still the pre-edit text, an "edit then toggle immediately"
      // would silently lose the edit (observed live, 2026-06-11).
      const reparsed = parseDocument(text, this.file?.basename ?? "");
      const second = reparsed.ok
        ? serializeDocument(reparsed.doc, this.modelSettings)
        : null;
      if (second !== text) {
        console.error("Mindsidian Next: self-check failed on tree change", { text, second });
        new Notice(
          "Mindsidian Next: this change does not serialize cleanly — it stays on screen but will NOT be saved. " +
            `Problem near: "${firstDiffLine(text, second)}"`
        );
        return;
      }
      this.data = text;
      this.savePending = true;
      this.requestSave();
    }
  }

  // ------------------------------------------------------------ error panel

  private showErrorPanel(error: string): void {
    this.contentEl.empty();
    this.contentEl.removeClass("mn-container");
    const panel = this.contentEl.createDiv({ cls: "mn-error-panel" });
    panel.createEl("h3", { text: "This mindmap could not be parsed" });
    panel.createEl("p", {
      text: "To protect your data, the file is read-only in this view and nothing will be written to disk.",
    });
    panel.createEl("p", { text: `Details: ${error}` });
    const button = panel.createEl("button", { text: "Open as markdown" });
    button.addEventListener("click", () => this.openAsMarkdown());
  }

  // ------------------------------------------------------- settings + zoom

  /** Push a fresh frozen settings snapshot into the live stack. */
  applySettings(): void {
    this.modelSettings = toModelSettings(this.plugin.settings);
    this.controller?.updateModelSettings(this.modelSettings);
    this.applyContainerStyle();
    if (this.renderer) {
      this.renderer.applySettings(
        toRenderSettings(this.plugin.settings, Platform.isMobile)
      );
    }
  }

  private applyContainerStyle(): void {
    const bg = this.plugin.settings.canvasBackground.trim();
    if (bg) this.contentEl.style.setProperty("--mn-canvas-background", bg);
    else this.contentEl.style.removeProperty("--mn-canvas-background");
    this.contentEl.style.setProperty(
      "--mn-bar-scale",
      String(this.plugin.settings.mobileBarScale)
    );
    this.contentEl.style.setProperty(
      "--mn-bar-bottom",
      `${this.plugin.settings.mobileBarBottomOffset}px`
    );
    this.contentEl.classList.toggle(
      "mn-style-boxed",
      this.plugin.settings.nodeStyle === "boxed"
    );
  }

  /** Zoom commands (anchored at the view center). */
  zoomBy(factor: number): void {
    this.userZoomed = true;
    this.viewport?.zoomAtCenter(factor);
  }

  zoomReset(): void {
    const viewport = this.viewport;
    if (!viewport) return;
    this.userZoomed = true;
    const current = viewport.transform.scale;
    const target = clampScale(this.plugin.settings.defaultZoom / 100);
    if (current > 0) viewport.zoomAtCenter(target / current);
  }

  /** Wikilink insertion via the vault-wide fuzzy picker. */
  insertWikilink(): void {
    if (!this.controller) return;
    insertWikilink(
      this.controller,
      new WikilinkModal(this.app, () => this.file?.path ?? "")
    );
  }

  /** Zoom % to write on close, or null when nothing changed / not allowed. */
  private pendingZoomWrite(): number | null {
    const controller = this.controller;
    const viewport = this.viewport;
    if (!controller || !viewport || this.saveBlocked) return null;
    // Only a DELIBERATE zoom is persisted. The plugin's own fit/recenter
    // (large map, off-screen refit) also moves the scale — writing that
    // dirtied every big file on a plain open-then-close (contract E12).
    if (!this.userZoomed) return null;
    // A never-edited synthesized file must stay untouched (contract E12/T7).
    if (controller.doc.synthesizedRoot && !controller.hasEdits) return null;
    const current = Math.round(viewport.transform.scale * 100);
    return current !== Math.round(this.initialZoomPct) ? current : null;
  }

  // ----------------------------------------------------------- hover links

  /** Wikilink hover → Obsidian page preview (Ctrl/Cmd per user setting). */
  private registerHoverPreview(): void {
    this.registerDomEvent(this.contentEl, "mouseover", (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a.internal-link");
      if (!(anchor instanceof HTMLElement)) return;
      const linktext = anchor.getAttribute("data-href") ?? anchor.getAttribute("href");
      if (!linktext) return;
      this.app.workspace.trigger("hover-link", {
        event: e,
        source: MINDMAP_VIEW_TYPE,
        hoverParent: this,
        targetEl: anchor,
        linktext,
        sourcePath: this.file?.path ?? "",
      });
    });
  }

  // -------------------------------------------------------------- teardown

  /**
   * Obsidian can run onClose/clear() BEFORE the unload save-flush calls
   * getViewData (observed live: controller already null inside
   * onUnloadFile). Anything living only in the interaction stack must be
   * captured here, not at flush time: an in-flight inline edit is
   * committed (which refreshes this.data via onTreeChanged), and the
   * current zoom is parked for onUnloadFile's frontmatter write.
   * `commitInFlight` is false on the rebuild path — an external file
   * change wins over an open edit (disk is the source of truth) and the
   * user gets the existing Notice instead of a silent overwrite.
   */
  private teardown(commitInFlight = true): void {
    // Close the "[[" popover FIRST, unconditionally: on the no-commit rebuild
    // path (external file change wins over an open edit) the editor teardown
    // never runs, contentEl.empty() removes the focused element WITHOUT a
    // blur event, and an orphaned popover would keep consuming Enter/Escape/
    // arrows app-wide through its keymap scope.
    this.activeLinkSuggest?.close();
    this.activeLinkSuggest = null;
    if (commitInFlight && this.controller?.editor.isEditing) {
      try {
        this.controller.commitEdit();
      } catch (error) {
        console.error("Mindsidian Next: commit-on-teardown failed", error);
      }
    }
    const zoom = this.pendingZoomWrite();
    if (zoom !== null) this.parkedZoom = zoom;
    this.mobileBar?.destroy();
    this.palette?.destroy();
    this.keyboardInsets?.destroy();
    this.clipboardEvents?.destroy();
    this.keyboard?.destroy();
    this.pointer?.destroy();
    this.controller?.destroy();
    this.renderer?.destroy();
    this.viewport?.destroy();
    this.mobileBar = null;
    this.palette = null;
    this.keyboardInsets = null;
    this.clipboardEvents = null;
    this.keyboard = null;
    this.pointer = null;
    this.controller = null;
    this.renderer = null;
    this.viewport = null;
    this.contentEl.empty();
    this.contentEl.removeClass("mn-container");
  }
}
