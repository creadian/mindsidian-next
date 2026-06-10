// Plugin entry point. STAGE D will replace this with the real view
// registration, Kanban-pattern view swap, settings, and the command table.
// For Stage B/C it registers only the READ-ONLY dev harness so layout and
// rendering can be eyeballed in the test vault. Nothing here writes files.
import { Notice, Plugin, TFile } from "obsidian";
import { DevHarnessView, DEVHARNESS_VIEW_TYPE } from "./view/devharness";

export default class MindsidianNextPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(
      DEVHARNESS_VIEW_TYPE,
      (leaf) => new DevHarnessView(leaf)
    );

    this.addCommand({
      id: "open-dev-harness",
      name: "Open current file in the dev harness (read-only)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || file.extension !== "md") return false;
        if (checking) return true;
        void this.openHarness(file);
        return true;
      },
    });
  }

  private async openHarness(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: DEVHARNESS_VIEW_TYPE, active: true });
    const view = leaf.view;
    if (view instanceof DevHarnessView) {
      await view.showFile(file);
    } else {
      new Notice("Could not open the dev harness view.");
    }
  }

  onunload(): void {
    // Obsidian detaches registered views automatically.
  }
}
