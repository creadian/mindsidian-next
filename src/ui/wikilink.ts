// Wikilink insertion (design §1 Stage C): the picker INTERFACE plus the
// pure text helper. The real fuzzy vault-file picker (obsidian
// FuzzySuggestModal) is wired in Stage D — this module stays obsidian-free
// so Stage C compiles and tests without the app.

import type { MindmapController } from "../view/controller";

/** Implemented in Stage D with FuzzySuggestModal over the vault's md files. */
export interface WikilinkPicker {
  /** Open the picker; calls back with the chosen file's basename. */
  open(onPick: (basename: string) => void): void;
}

/** Pure: build the `[[basename]]` snippet for insertion. */
export function wikilinkSnippet(basename: string): string {
  return `[[${basename}]]`;
}

/**
 * Insert a wikilink for the controller's current context: into the caret /
 * selection of an in-flight edit, else appended to the selected node's text
 * via a fresh edit session (preserves the v1 behavior).
 */
export function insertWikilink(
  controller: MindmapController,
  picker: WikilinkPicker
): void {
  picker.open((basename) => {
    const snippet = wikilinkSnippet(basename);
    if (controller.editor.insertText(snippet)) return; // in-flight edit
    const id = controller.selection.primary;
    if (!id) return;
    controller.beginEdit(id); // caret lands at the end of the text
    controller.editor.insertText(snippet);
  });
}
