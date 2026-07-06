// Stage D wiring of the WikilinkPicker interface (src/ui/wikilink.ts):
// a FuzzySuggestModal over every markdown file in the vault. Picking a
// file hands its resolved linktext back to the pure insertion helper —
// fileToLinktext, not the bare basename, so duplicate basenames in
// different folders always link the picked file (and the vault's
// "shortest path when possible" setting is respected).

import { App, FuzzySuggestModal, TFile } from "obsidian";
import type { WikilinkPicker } from "./wikilink";

export class WikilinkModal extends FuzzySuggestModal<TFile> implements WikilinkPicker {
  private onPick: ((linktext: string) => void) | null = null;

  constructor(app: App, private readonly sourcePath: () => string) {
    super(app);
    this.setPlaceholder("Link to a note…");
  }

  open(onPick?: (linktext: string) => void): void {
    if (onPick) this.onPick = onPick;
    super.open();
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.onPick?.(this.app.metadataCache.fileToLinktext(item, this.sourcePath()));
  }
}
