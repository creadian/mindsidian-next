// All command registrations as ONE data table → one helper (design §1
// Stage D — kills v1's 1,700-line main.ts). View-scoped commands use a
// checkCallback that only lights up when a mindmap view is active; the
// handful of global commands (toggle, new mindmap, validate) sit below.
// Sentence case everywhere. No default hotkeys — in-view editing keys are
// handled by src/input/keyboard.ts, so nothing here fights Obsidian's own.

import { MarkdownView, Notice, TFile } from "obsidian";
import type MindsidianNextPlugin from "./main";
import { MindmapView, MINDMAP_VIEW_TYPE } from "./view/MindmapView";
import { toModelSettings } from "./settings";
import { validateVault } from "./validate";

/** One row of the command table: name + what it does to the active view. */
interface ViewCommand {
  id: string;
  name: string;
  run(view: MindmapView): void;
}

const VIEW_COMMANDS: ViewCommand[] = [
  // --- structure ---
  { id: "add-sibling", name: "Add sibling node", run: (v) => v.controller?.addSiblingBelow() },
  { id: "add-child", name: "Add child node", run: (v) => v.controller?.addChild() },
  { id: "delete-node", name: "Delete selected node(s)", run: (v) => v.controller?.deleteSelection() },
  { id: "move-node-up", name: "Move node up", run: (v) => v.controller?.moveAmongSiblings("up") },
  { id: "move-node-down", name: "Move node down", run: (v) => v.controller?.moveAmongSiblings("down") },
  { id: "move-node-left", name: "Move node left", run: (v) => v.controller?.moveHorizontal("left") },
  { id: "move-node-right", name: "Move node right", run: (v) => v.controller?.moveHorizontal("right") },
  { id: "siblings-as-children", name: "Move following siblings as children", run: (v) => v.controller?.moveNextSiblingsAsChildren(false) },
  { id: "all-siblings-as-children", name: "Move all siblings as children", run: (v) => v.controller?.moveNextSiblingsAsChildren(true) },
  // --- history ---
  { id: "undo", name: "Undo", run: (v) => v.controller?.undo() },
  { id: "redo", name: "Redo", run: (v) => v.controller?.redo() },
  // --- fold ---
  { id: "toggle-fold", name: "Fold or unfold selected node", run: (v) => { const id = v.controller?.selection.primary; if (id) v.controller?.toggleFold(id); } },
  { id: "expand-one-level", name: "Expand one level", run: (v) => v.controller?.expandOneLevel() },
  { id: "collapse-one-level", name: "Collapse one level", run: (v) => v.controller?.collapseOneLevel() },
  { id: "unfold-all", name: "Unfold all nodes", run: (v) => v.controller?.unfoldAll() },
  { id: "fold-all", name: "Fold all nodes", run: (v) => v.controller?.foldAll() },
  // --- formatting / tasks ---
  { id: "toggle-bold", name: "Toggle bold", run: (v) => v.controller?.toggleFormat("**") },
  { id: "toggle-italic", name: "Toggle italic", run: (v) => v.controller?.toggleFormat("_") },
  { id: "toggle-highlight", name: "Toggle highlight", run: (v) => v.controller?.toggleFormat("==") },
  { id: "toggle-strikethrough", name: "Toggle strikethrough", run: (v) => v.controller?.toggleFormat("~~") },
  { id: "cycle-task", name: "Toggle task checkbox", run: (v) => v.controller?.cycleTask() },
  // --- clipboard ---
  { id: "copy-subtree", name: "Copy selected subtree(s)", run: (v) => void v.controller?.copySelection() },
  { id: "cut-subtree", name: "Cut selected subtree(s)", run: (v) => void v.controller?.cutSelection() },
  { id: "paste-subtree", name: "Paste subtree(s) as children", run: (v) => void v.controller?.pasteIntoSelection() },
  // --- links ---
  { id: "insert-wikilink", name: "Insert wikilink", run: (v) => v.insertWikilink() },
  // --- viewport ---
  { id: "zoom-in", name: "Zoom in", run: (v) => v.zoomBy(1.2) },
  { id: "zoom-out", name: "Zoom out", run: (v) => v.zoomBy(1 / 1.2) },
  { id: "zoom-reset", name: "Reset zoom", run: (v) => v.zoomReset() },
  { id: "recenter", name: "Recenter the map", run: (v) => v.controller?.recenter() },
  { id: "go-home", name: "Select root and center", run: (v) => v.controller?.goHome() },
  // --- view mode ---
  { id: "open-as-markdown", name: "Open as markdown", run: (v) => v.openAsMarkdown() },
];

export function registerCommands(plugin: MindsidianNextPlugin): void {
  // One helper, many rows: a command is available iff a mindmap view with a
  // live controller is active (checkCallback-scoped per the review rules).
  for (const command of VIEW_COMMANDS) {
    plugin.addCommand({
      id: command.id,
      name: command.name,
      checkCallback: (checking) => {
        const view = plugin.app.workspace.getActiveViewOfType(MindmapView);
        if (!view) return false;
        if (!checking) command.run(view);
        return true;
      },
    });
  }

  // --- global commands (not tied to an open mindmap view) ---

  plugin.addCommand({
    id: "toggle-view",
    name: "Toggle markdown/mindmap view",
    checkCallback: (checking) => {
      const mindmap = plugin.app.workspace.getActiveViewOfType(MindmapView);
      if (mindmap) {
        if (!checking) mindmap.openAsMarkdown();
        return true;
      }
      const markdown = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const file = markdown?.file;
      if (!markdown || !(file instanceof TFile) || file.extension !== "md") return false;
      if (!checking) void plugin.setMindmapView(markdown.leaf, file.path, true);
      return true;
    },
  });

  plugin.addCommand({
    id: "new-mindmap",
    name: "Create new mindmap",
    callback: () => void plugin.createNewMindmap(null),
  });

  plugin.addCommand({
    id: "validate-vault",
    name: "Validate all vault mindmaps (read-only)",
    callback: () => {
      new Notice("Validating vault mindmaps (read-only)…");
      void validateVault(plugin.app, toModelSettings(plugin.settings));
    },
  });
}
