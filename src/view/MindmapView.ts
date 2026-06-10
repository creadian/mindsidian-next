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
import { serializeDocument } from "../model/serialize";
import { DEFAULT_FRONTMATTER, readZoomFromPrefix } from "../model/region";
import { applyCollapsedPaths, collectCollapsedPaths } from "../model/tree";
import { toModelSettings, toRenderSettings } from "../settings";
import { MindmapRenderer } from "./render";
import { Viewport, clampScale } from "./viewport";
import { MindmapController } from "./controller";
import { PointerController } from "../input/pointer";
import { KeyboardController } from "../input/keyboard";
import { HighlightPalette } from "../ui/palette";
import { MobileActionBar } from "../ui/mobileBar";
import { insertWikilink } from "../ui/wikilink";
import { WikilinkModal } from "../ui/wikilinkModal";

export const MINDMAP_VIEW_TYPE = "mindsidian-next";

export class MindmapView extends TextFileView {
  private plugin: MindsidianNextPlugin;
  private modelSettings: ModelSettings;

  // The Stage B/C stack — rebuilt per file load, torn down in clear().
  controller: MindmapController | null = null;
  private renderer: MindmapRenderer | null = null;
  private viewport: Viewport | null = null;
  private pointer: PointerController | null = null;
  private keyboard: KeyboardController | null = null;
  private palette: HighlightPalette | null = null;
  private mobileBar: MobileActionBar | null = null;

  /** True after a failed parse: getViewData must echo the original bytes. */
  private saveBlocked = false;
  /** Text of our own last save — lets the reconcile path ignore echoes. */
  private lastEmittedText: string | null = null;
  /** Zoom % in effect right after load; the close-time write compares to it. */
  private initialZoomPct = 100;
  /** True while committed edits are waiting on the debounced save. */
  private savePending = false;

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

  canAcceptExtension(extension: string): boolean {
    return extension === "md";
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
    if (path) this.plugin.setMarkdownView(this.leaf, path);
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
    // was open), they are lost in the reload. Never silently: say so.
    if (
      !clear &&
      this.controller &&
      (this.savePending || this.controller.editor.isEditing)
    ) {
      new Notice(
        "Mindsidian Next: this file was changed outside this view — " +
          "reloaded from disk; your last few seconds of edits were discarded."
      );
    }
    this.savePending = false;
    this.rebuild(data);
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
        "Mindsidian Next: save self-check failed — nothing was changed on disk."
      );
      return this.data; // last-known-good bytes
    }
    this.lastEmittedText = text;
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
    this.data = "";
  }

  /** Capture zoom BEFORE the stack is torn down, write it after the save
   *  flush — and only when it actually changed (contract T22 / E12). */
  async onUnloadFile(file: TFile): Promise<void> {
    const zoom = this.pendingZoomWrite();
    await super.onUnloadFile(file); // flushes any pending debounced save
    if (zoom !== null) {
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
    this.teardown();
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
    this.contentEl.addClass("mm-container");
    this.applyContainerStyle();
    const world = this.contentEl.createDiv();

    this.renderer = new MindmapRenderer(world, {
      settings: toRenderSettings(this.plugin.settings, Platform.isMobile),
      renderMarkdown: async (markdown, el) => {
        await MarkdownRenderer.render(this.app, markdown, el, file?.path ?? "", this);
      },
    });
    this.viewport = new Viewport(this.contentEl, world);
    this.viewport.attach();

    this.controller = new MindmapController({
      doc,
      renderer: this.renderer,
      viewport: this.viewport,
      containerEl: this.contentEl,
      modelSettings: this.modelSettings,
      callbacks: {
        onTreeChanged: () => this.onTreeChanged(),
        notify: (message) => new Notice(message),
        openLink: (linkText, newPane) => {
          void this.app.workspace.openLinkText(linkText, file?.path ?? "", newPane);
        },
      },
    });
    this.pointer = new PointerController(this.controller, world);
    this.pointer.attach();
    this.keyboard = new KeyboardController(this.controller);
    this.keyboard.attach();
    this.palette = new HighlightPalette(this.controller);
    if (Platform.isMobile) {
      this.mobileBar = new MobileActionBar(this.controller, this.palette);
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
    const text = serializeDocument(controller.doc, this.modelSettings);
    if (text !== this.data) {
      this.savePending = true;
      this.requestSave();
    }
  }

  // ------------------------------------------------------------ error panel

  private showErrorPanel(error: string): void {
    this.contentEl.empty();
    this.contentEl.removeClass("mm-container");
    const panel = this.contentEl.createDiv({ cls: "mm-error-panel" });
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
    this.applyContainerStyle();
    if (this.renderer) {
      this.renderer.applySettings(
        toRenderSettings(this.plugin.settings, Platform.isMobile)
      );
    }
  }

  private applyContainerStyle(): void {
    const bg = this.plugin.settings.canvasBackground.trim();
    if (bg) this.contentEl.style.setProperty("--mm-canvas-background", bg);
    else this.contentEl.style.removeProperty("--mm-canvas-background");
    this.contentEl.style.setProperty(
      "--mm-bar-scale",
      String(this.plugin.settings.mobileBarScale)
    );
  }

  /** Zoom commands (anchored at the view center). */
  zoomBy(factor: number): void {
    this.viewport?.zoomAtCenter(factor);
  }

  zoomReset(): void {
    const viewport = this.viewport;
    if (!viewport) return;
    const current = viewport.transform.scale;
    const target = clampScale(this.plugin.settings.defaultZoom / 100);
    if (current > 0) viewport.zoomAtCenter(target / current);
  }

  /** Wikilink insertion via the vault-wide fuzzy picker. */
  insertWikilink(): void {
    if (!this.controller) return;
    insertWikilink(this.controller, new WikilinkModal(this.app));
  }

  /** Zoom % to write on close, or null when nothing changed / not allowed. */
  private pendingZoomWrite(): number | null {
    const controller = this.controller;
    const viewport = this.viewport;
    if (!controller || !viewport || this.saveBlocked) return null;
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

  private teardown(): void {
    this.mobileBar?.destroy();
    this.palette?.destroy();
    this.keyboard?.destroy();
    this.pointer?.destroy();
    this.controller?.destroy();
    this.renderer?.destroy();
    this.viewport?.destroy();
    this.mobileBar = null;
    this.palette = null;
    this.keyboard = null;
    this.pointer = null;
    this.controller = null;
    this.renderer = null;
    this.viewport = null;
    this.contentEl.empty();
    this.contentEl.removeClass("mm-container");
  }
}
