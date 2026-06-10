// MindNode tree → markdown body, exactly the canonical emitter of the
// format contract §5: ATX headings below `headLevel`, tab-indented "- "
// bullets at and beyond it, task prefixes, fold ^id markers only on
// collapsed nodes in "markdown" persistence mode, and fence lines emitted
// byte-exact (E10 fix — no trim inside fences). Pure and synchronous.

import type { MindDocument, MindNode, ModelSettings } from "./types";
import { DEFAULT_MODEL_SETTINGS } from "./types";

/** Serialize a tree to a markdown body (no frontmatter, no prefix). */
export function serializeBody(
  root: MindNode,
  settings: ModelSettings = DEFAULT_MODEL_SETTINGS
): string {
  const headLevel = Math.min(6, Math.max(1, settings.headLevel));
  const emitFoldIds = settings.foldStatePersistence === "markdown";
  let md = "";

  const visit = (node: MindNode, level: number): void => {
    const ending = node.collapsed && emitFoldIds ? ` ^${node.id}` : "";

    if (level < headLevel) {
      // Heading: one blank line before every heading except the root H1.
      const blank = level > 0 ? "\n" : "";
      // Headings are single-line by definition; any stray newline in the
      // text would corrupt structure, so it is flattened to a space here
      // (the edit layer prevents this from arising in normal use).
      const text = node.text.trim().replace(/\n+/g, " ");
      md += `${blank}${"#".repeat(level + 1)} ${text}${ending}\n`;
    } else {
      const indent = "\t".repeat(level - headLevel);
      const taskPrefix =
        node.task === "todo" ? "[ ] " : node.task === "done" ? "[x] " : "";
      const text = node.text.trim();

      if (text === "") {
        // Empty node → bare "-" (contract §5). A fold marker cannot ride
        // on an empty bullet without becoming text, so it is not emitted.
        md += `${indent}-\n`;
      } else if (!text.includes("\n")) {
        md += `${indent}- ${taskPrefix}${text}${ending}\n`;
      } else if (text.startsWith("```")) {
        // Code fence: empty bullet, then the fence lines two spaces
        // deeper, byte-exact, wrapped in blank lines (contract §5 / E10).
        const lines = node.text.split("\n");
        md += `\n${indent}-\n`;
        lines.forEach((line, i) => {
          md += `${indent}  ${line}${i === lines.length - 1 ? ending : ""}\n`;
        });
        md += "\n";
      } else {
        // Multi-line text: one sibling bullet per line — the documented
        // E9 normalization. No line is ever dropped: blank lines become
        // bare "-" empty bullets. Task prefix rides on the first content
        // line, the fold marker on the last content line.
        const lines = text.split("\n").map((l) => l.trim());
        const lastContent = lines.reduce((acc, l, i) => (l !== "" ? i : acc), -1);
        let first = true;
        lines.forEach((line, i) => {
          if (line === "") {
            md += `${indent}-\n`;
          } else {
            const prefix = first ? taskPrefix : "";
            first = false;
            md += `${indent}- ${prefix}${line}${i === lastContent ? ending : ""}\n`;
          }
        });
      }
    }

    for (const child of node.children) visit(child, level + 1);
  };

  visit(root, 0);
  return md.trim();
}

/** Serialize a whole document: opaque prefix + body + opaque suffix. */
export function serializeDocument(
  doc: MindDocument,
  settings: ModelSettings = DEFAULT_MODEL_SETTINGS
): string {
  return doc.prefix + serializeBody(doc.root, settings) + doc.suffix;
}
