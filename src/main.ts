// Plugin entry point (design §1 Stage D): registers the mindmap view,
// settings, commands and menus, and performs the Kanban-pattern view swap —
// when a file with `mindmap-plugin` frontmatter becomes active in a plain
// markdown view, the leaf is switched to the mindmap view. No setViewState
// monkey-patching, no stored view references; per-path mode memory makes
// "Open as markdown" stick for a file until it is opened as mindmap again.

import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
  debounce,
  normalizePath,
} from "obsidian";
import { MindmapView, MINDMAP_VIEW_TYPE } from "./view/MindmapView";
import { MindsidianSettingTab } from "./settingsTab";
import { registerCommands } from "./commands";
import { DEFAULT_FRONTMATTER } from "./model/region";
import {
  DEFAULT_SETTINGS,
  MindsidianNextSettings,
  mergeSettings,
} from "./settings";

export default class MindsidianNextPlugin extends Plugin {
  settings: MindsidianNextSettings = { ...DEFAULT_SETTINGS };

  /** Per-path view-mode memory (session only): "markdown" suppresses the
   *  auto-swap for that file until it is explicitly opened as mindmap. */
  private fileModes = new Map<string, "markdown" | "mindmap">();

  /** Debounced persist for fold text-paths (plugin-data mode). */
  private saveFoldStates = debounce(
    () => void this.saveData(this.settings),
    1000,
    true
  );

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());

    this.registerView(MINDMAP_VIEW_TYPE, (leaf) => new MindmapView(leaf, this));
    this.addSettingTab(new MindsidianSettingTab(this.app, this));
    registerCommands(this);
    this.addRibbonIcon("git-fork", "Create new mindmap", () =>
      void this.createNewMindmap(null)
    );

    // View swap only once the workspace is fully restored — never during
    // startup layout deserialization (deferred views stay deferred).
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", (leaf) => {
          if (leaf) this.maybeSwapToMindmap(leaf);
        })
      );
      // Covers "open file into the already-active leaf" (no leaf change).
      this.registerEvent(
        this.app.workspace.on("file-open", () => {
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (view) this.maybeSwapToMindmap(view.leaf);
        })
      );
    });

    // Context menus: open an md file as mindmap / create a mindmap in a folder.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) =>
            item
              .setTitle("Open as mindmap")
              .setIcon("git-fork")
              .onClick(() => {
                const target = leaf ?? this.app.workspace.getLeaf("tab");
                void this.setMindmapView(target, file.path, true);
              })
          );
        }
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle("New mindmap")
              .setIcon("git-fork")
              .onClick(() => void this.createNewMindmap(file))
          );
        }
      })
    );
  }

  onunload(): void {
    // Registered views/events are detached by Obsidian automatically.
  }

  // ------------------------------------------------------------- view swap

  /** Kanban pattern: a markdown leaf showing a `mindmap-plugin` file is
   *  swapped to the mindmap view, unless the user chose markdown for it. */
  private maybeSwapToMindmap(leaf: WorkspaceLeaf): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const file = view.file;
    if (!file || this.fileModes.get(file.path) === "markdown") return;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter || frontmatter["mindmap-plugin"] == null) return;
    // Deferred + re-validated: this event can fire from inside Obsidian's
    // own async leaf handling (e.g. its deleted-file recovery restoring the
    // previous file). Swapping the view synchronously there mutates the
    // leaf mid-flight and crashes Obsidian's handler. One tick later, and
    // only if the leaf is still attached and still shows the same file.
    window.setTimeout(() => {
      const v = leaf.view;
      if (!leaf.parent || !(v instanceof MarkdownView)) return;
      if (v.file?.path !== file.path) return;
      if (this.fileModes.get(file.path) === "markdown") return;
      void this.setMindmapView(leaf, file.path, false);
    }, 0);
  }

  /** Switch a leaf to the mindmap view and remember the choice. */
  async setMindmapView(
    leaf: WorkspaceLeaf,
    path: string,
    active: boolean
  ): Promise<void> {
    this.fileModes.set(path, "mindmap");
    await leaf.setViewState({
      type: MINDMAP_VIEW_TYPE,
      state: { file: path },
      active,
    });
  }

  /** Switch a leaf back to markdown; the choice sticks for this file. */
  setMarkdownView(leaf: WorkspaceLeaf, path: string): void {
    this.fileModes.set(path, "markdown");
    void leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "source" },
      active: true,
    });
  }

  // ----------------------------------------------------------- new mindmap

  /** Create a fresh mindmap file (frontmatter + H1) and open it. */
  async createNewMindmap(folder: TFolder | null): Promise<void> {
    const parent =
      folder ??
      this.app.workspace.getActiveFile()?.parent ??
      this.app.vault.getRoot();
    const base = parent.path === "/" ? "" : `${parent.path}/`;
    let name = "Untitled mindmap";
    let path = normalizePath(`${base}${name}.md`);
    for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++) {
      name = `Untitled mindmap ${i}`;
      path = normalizePath(`${base}${name}.md`);
    }
    try {
      const file = await this.app.vault.create(
        path,
        `${DEFAULT_FRONTMATTER}# ${name}\n`
      );
      const leaf = this.app.workspace.getLeaf("tab");
      await this.setMindmapView(leaf, file.path, true);
    } catch (error) {
      console.error("Mindsidian Next: could not create mindmap", error);
      new Notice("Could not create the new mindmap file.");
    }
  }

  // -------------------------------------------------------------- settings

  /** Persist settings and push fresh snapshots into every open view. */
  async saveSettingsAndApply(): Promise<void> {
    await this.saveData(this.settings);
    for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
      if (leaf.isDeferred) continue;
      const view = leaf.view;
      if (view instanceof MindmapView) view.applySettings();
    }
  }

  /** plugin-data fold mode: store a file's collapsed text-paths (debounced). */
  setFoldPaths(path: string, paths: string[]): void {
    if (paths.length === 0) delete this.settings.foldStates[path];
    else this.settings.foldStates[path] = paths;
    this.saveFoldStates();
  }
}
