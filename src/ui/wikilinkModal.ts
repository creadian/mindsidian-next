// Stage D wiring of the WikilinkPicker interface (src/ui/wikilink.ts):
// a FuzzySuggestModal over every markdown file in the vault. Picking a
// file hands its basename back to the pure insertion helper.

import { App, FuzzySuggestModal, TFile } from "obsidian";
import type { WikilinkPicker } from "./wikilink";

export class WikilinkModal extends FuzzySuggestModal<TFile> implements WikilinkPicker {
  private onPick: ((basename: string) => void) | null = null;

  constructor(app: App) {
    super(app);
    this.setPlaceholder("Link to a note…");
  }

  open(onPick?: (basename: string) => void): void {
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
    this.onPick?.(item.basename);
  }
}
