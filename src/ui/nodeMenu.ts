// Node context menu (owner request 2026-07-07): right-click on desktop,
// long-press-and-release on touch. Built on Obsidian's Menu so it renders
// natively on both platforms (popup on desktop, bottom sheet on mobile).
// Items per Christian's spec: Cut / Copy / Paste, "Highlight" opening a
// SECOND menu with the color swatches (this API version has no submenus),
// task-checkbox toggle, and "Show in Markdown view" (jump to the node's
// line in the markdown editor).

import { Menu } from "obsidian";
import type { MindmapController } from "../view/controller";
import { HIGHLIGHT_COLORS } from "./palette";

/** A menu title with a colored dot in front (color picker rows). */
function coloredTitle(doc: Document, hex: string, name: string): DocumentFragment {
  const frag = doc.createDocumentFragment();
  const dot = doc.createElement("span");
  dot.className = "mn-menu-swatch";
  dot.style.backgroundColor = hex;
  frag.appendChild(dot);
  frag.appendChild(doc.createTextNode(name));
  return frag;
}

export function showNodeMenu(options: {
  controller: MindmapController;
  x: number;
  y: number;
  revealInMarkdown: (nodeId: string) => void;
  nodeId: string;
}): void {
  const { controller: c, x, y, revealInMarkdown, nodeId } = options;
  const doc = c.containerEl.ownerDocument;
  const menu = new Menu();

  menu.addItem((item) =>
    item
      .setTitle("Copy")
      .setIcon("copy")
      .onClick(() => void c.copySelection())
  );
  menu.addItem((item) =>
    item
      .setTitle("Cut")
      .setIcon("scissors")
      .onClick(() => void c.cutSelection())
  );
  menu.addItem((item) =>
    item
      .setTitle("Paste")
      .setIcon("clipboard-paste")
      .onClick(() => void c.pasteIntoSelection())
  );

  menu.addSeparator();

  menu.addItem((item) =>
    item
      .setTitle("Highlight")
      .setIcon("highlighter")
      .onClick(() => {
        // Second menu at the same spot: the color picker.
        const colors = new Menu();
        for (const color of HIGHLIGHT_COLORS) {
          colors.addItem((ci) =>
            ci
              .setTitle(coloredTitle(doc, color.hex, color.name))
              .onClick(() => c.applyHighlightColor(color.hex))
          );
        }
        colors.addSeparator();
        colors.addItem((ci) =>
          ci
            .setTitle("Remove highlight")
            .setIcon("eraser")
            .onClick(() => c.applyHighlightColor(null))
        );
        colors.showAtPosition({ x, y }, doc);
      })
  );
  menu.addItem((item) =>
    item
      .setTitle("Toggle checkbox")
      .setIcon("check-square")
      .onClick(() => c.cycleTask())
  );

  menu.addSeparator();

  menu.addItem((item) =>
    item
      .setTitle("Show in Markdown view")
      .setIcon("file-text")
      .onClick(() => revealInMarkdown(nodeId))
  );

  menu.showAtPosition({ x, y }, doc);
}
