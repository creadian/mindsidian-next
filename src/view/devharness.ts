// Stage B/C dev harness — DELETED in Stage D, replaced by MindmapView.
// A minimal READ-ONLY view shell: it parses a markdown file and renders the
// mind map (layout + nodes + edges + pan/zoom) so rendering can be eyeballed
// in the test vault before the real TextFileView exists.
// Hard-coded to never write: it only ever calls vault.cachedRead.

import { ItemView, MarkdownRenderer, TFile, WorkspaceLeaf } from "obsidian";
import { parseDocument } from "../model/parse";
import { MindmapRenderer, DEFAULT_RENDER_SETTINGS } from "./render";
import { Viewport } from "./viewport";

export const DEVHARNESS_VIEW_TYPE = "mindsidian-next-devharness";

export class DevHarnessView extends ItemView {
  private filePath = "";
  private renderer: MindmapRenderer | null = null;
  private viewport: Viewport | null = null;

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

    // Build the container/world pair the renderer + viewport expect.
    this.contentEl.empty();
    this.contentEl.addClass("mm-container");
    const world = this.contentEl.createDiv();

    this.renderer?.destroy();
    this.viewport?.destroy();
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
    await this.renderer.render(result.doc.root);
    const layout = this.renderer.getLayout();
    if (layout) this.viewport.recenter(layout.bounds, false);
  }

  async onClose(): Promise<void> {
    this.renderer?.destroy();
    this.viewport?.destroy();
    this.renderer = null;
    this.viewport = null;
  }
}
