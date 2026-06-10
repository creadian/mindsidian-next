// Stage B/C dev harness — DELETED in Stage D, replaced by MindmapView.
// A READ-ONLY view shell: parses a markdown file, renders the mind map and
// wires the FULL Stage C interaction stack (select, edit, drag, fold, undo,
// clipboard, palette, mobile bar) so everything can be exercised in the test
// vault. Edits live in memory only — the harness NEVER writes to disk. Every
// mutation is spot-checked: serialize → reparse → serialize must be a fixed
// point (the Stage D refuse-to-corrupt guard, here just logged).

import { ItemView, MarkdownRenderer, Notice, Platform, TFile, WorkspaceLeaf } from "obsidian";
import { parseDocument } from "../model/parse";
import { serializeDocument } from "../model/serialize";
import { DEFAULT_MODEL_SETTINGS } from "../model/types";
import { MindmapRenderer, DEFAULT_RENDER_SETTINGS } from "./render";
import { Viewport } from "./viewport";
import { MindmapController } from "./controller";
import { PointerController } from "../input/pointer";
import { KeyboardController } from "../input/keyboard";
import { HighlightPalette } from "../ui/palette";
import { MobileActionBar } from "../ui/mobileBar";

export const DEVHARNESS_VIEW_TYPE = "mindsidian-next-devharness";

export class DevHarnessView extends ItemView {
  private filePath = "";
  private renderer: MindmapRenderer | null = null;
  private viewport: Viewport | null = null;
  private controller: MindmapController | null = null;
  private pointer: PointerController | null = null;
  private keyboard: KeyboardController | null = null;
  private palette: HighlightPalette | null = null;
  private mobileBar: MobileActionBar | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return DEVHARNESS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return `Mindmap harness: ${this.filePath || "no file"} (read-only)`;
  }

  getIcon(): string {
    return "git-fork";
  }

  /** Point the harness at a file and render it. Read-only by construction. */
  async showFile(file: TFile): Promise<void> {
    this.filePath = file.path;
    const text = await this.app.vault.cachedRead(file);
    this.teardown();

    // Build the container/world pair the renderer + viewport expect.
    this.contentEl.empty();
    this.contentEl.addClass("mm-container");
    const world = this.contentEl.createDiv();

    this.renderer = new MindmapRenderer(world, {
      settings: DEFAULT_RENDER_SETTINGS,
      renderMarkdown: async (markdown, el) => {
        await MarkdownRenderer.render(this.app, markdown, el, file.path, this);
      },
    });
    this.viewport = new Viewport(this.contentEl, world);
    this.viewport.attach();

    const result = parseDocument(text, file.basename);
    if (!result.ok) {
      // The harness never writes, so an error is just a message.
      this.contentEl.empty();
      this.contentEl.createEl("p", {
        text: `Parse failed (file untouched): ${result.error}`,
      });
      return;
    }

    this.controller = new MindmapController({
      doc: result.doc,
      renderer: this.renderer,
      viewport: this.viewport,
      containerEl: this.contentEl,
      modelSettings: DEFAULT_MODEL_SETTINGS,
      callbacks: {
        // HARNESS: in-memory only. Spot-check that the edited tree still
        // serializes to a contract-conformant fixed point. Never writes.
        onTreeChanged: () => this.spotCheckSerialization(),
        notify: (message) => new Notice(message),
        openLink: (linkText, newPane) => {
          void this.app.workspace.openLinkText(linkText, file.path, newPane);
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

    await this.controller.refresh();
    const layout = this.renderer.getLayout();
    if (layout) this.viewport.recenter(layout.bounds, false);
    this.controller.focusKeyboard();
  }

  /** serialize → reparse → serialize must be byte-identical (P-rules). */
  private spotCheckSerialization(): void {
    const controller = this.controller;
    if (!controller) return;
    const once = serializeDocument(controller.doc, DEFAULT_MODEL_SETTINGS);
    const reparsed = parseDocument(once, "spot-check");
    const twice = reparsed.ok
      ? serializeDocument(reparsed.doc, DEFAULT_MODEL_SETTINGS)
      : null;
    if (!reparsed.ok || twice !== once) {
      console.error("Mindsidian-next harness: serialization NOT idempotent", {
        once,
        twice,
      });
      new Notice("Harness: serialization spot-check FAILED (see console).");
    }
  }

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
  }

  async onClose(): Promise<void> {
    this.teardown();
  }
}
