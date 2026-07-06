// MindNode tree → markdown body, exactly the canonical emitter of the
// format contract §5: ATX headings below `headLevel`, tab-indented "- "
// bullets at and beyond it, task prefixes, fold ^id markers only on
// collapsed nodes in "markdown" persistence mode, and fence lines emitted
// byte-exact (E10 fix — no trim inside fences). Pure and synchronous.
//
// Lossless-at-heading-depth rules (P3 — newlines are never flattened):
// - A multi-line node at heading depth is split into one heading PER LINE
//   (the heading-level analogue of the documented E9 bullet split).
// - A node that has no heading form at all — empty text, or a whole code
//   fence — demotes its ENTIRE sibling group to bullet form, because a
//   lone bullet between heading siblings would re-attach to the wrong
//   parent on reparse (bullets always attach to the nearest heading above).
// - An unclosed code fence is closed on emission, so a fence node moved
//   mid-document can never swallow the lines after it on reparse.

import type { MindDocument, MindNode, ModelSettings } from "./types";
import { DEFAULT_MODEL_SETTINGS } from "./types";
import { fenceOpen, fenceCloses, isPureFence } from "./fence";

/** A node with no possible heading line: empty text, a whole code fence,
 *  or a task checkbox (headings cannot carry [ ]/[x] — emitting one as a
 *  heading silently destroys the task state, contract §1.5 / EC12). All
 *  three shapes survive a reparse unchanged, so using them as the
 *  demotion trigger keeps serialization idempotent (the save self-check
 *  in the view depends on that). */
function needsBulletForm(node: MindNode): boolean {
  const text = node.text;
  return (
    node.task !== "none" ||
    text.trim() === "" ||
    (text.includes("\n") && isPureFence(text))
  );
}

/** One node in bullet form (indent, "- ", task prefix, fence/multi-line
 *  rules), as the emitted lines. Shared by the body serializer and the
 *  clipboard encoder so both emit the exact same shape. */
function emitBulletLines(node: MindNode, depth: number, ending: string): string {
  const indent = "\t".repeat(Math.max(0, depth));
  const taskPrefix =
    node.task === "todo" ? "[ ] " : node.task === "done" ? "[x] " : "";
  const text = node.text.trim();
  let md = "";

  if (text === "") {
    // Empty node → bare "-" (contract §5). A fold marker cannot ride
    // on an empty bullet without becoming text, so it is not emitted.
    md += `${indent}-\n`;
  } else if (!text.includes("\n")) {
    md += `${indent}- ${taskPrefix}${text}${ending}\n`;
  } else if (isPureFence(node.text)) {
    // Code fence: empty bullet, then the fence lines two spaces
    // deeper, byte-exact, wrapped in blank lines (contract §5 / E10).
    const lines = node.text.split("\n");
    // An unclosed fence is closed here — otherwise it would swallow
    // every following line on reparse and block all saves. The closer
    // mirrors the opener (character AND length: ~~~ or ````).
    const open = fenceOpen(lines[0]) as NonNullable<ReturnType<typeof fenceOpen>>;
    const closed = lines.length > 1 && fenceCloses(lines[lines.length - 1], open);
    if (!closed) lines.push(open.char.repeat(open.len));
    md += `\n${indent}-\n`;
    lines.forEach((line, i) => {
      md += `${indent}  ${line}${i === lines.length - 1 ? ending : ""}\n`;
    });
    md += "\n";
  } else {
    // Multi-line text: one sibling bullet per line — the documented
    // E9 normalization. No line is ever dropped: blank lines become
    // bare "-" empty bullets. Task prefix rides on the first content
    // line, the fold marker on the last content line. (Text that
    // merely starts with ``` but is not one pure fence also lands
    // here — each line becomes literal bullet text, never a fence.)
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
  return md;
}

/** Subtrees → tab-indented markdown bullet lines: the clipboard format.
 *  Fold markers are never emitted (fold state is not clipboard-worthy);
 *  heading-depth nodes come out as bullets too — heading-ness is
 *  positional and restored by where the paste lands. */
export function serializeSubtreesAsBullets(nodes: MindNode[]): string {
  let md = "";
  const visit = (n: MindNode, depth: number): void => {
    md += emitBulletLines(n, depth, "");
    for (const c of n.children) visit(c, depth + 1);
  };
  for (const n of nodes) visit(n, 0);
  return md.trim();
}

/** Serialize a tree to a markdown body (no frontmatter, no prefix).
 *  `lineMap` (optional, does NOT alter the emission): filled with each
 *  node id → 0-based line index of the node's first content line in the
 *  returned body — used to jump to a node in the markdown editor. */
export function serializeBody(
  root: MindNode,
  settings: ModelSettings = DEFAULT_MODEL_SETTINGS,
  lineMap?: Map<string, number>
): string {
  const headLevel = Math.min(6, Math.max(1, settings.headLevel));
  const emitFoldIds = settings.foldStatePersistence === "markdown";
  let md = "";
  let lineNo = 0; // newlines emitted so far (tracked only for lineMap)

  const emitHeading = (node: MindNode, level: number, ending: string): void => {
    const hashes = "#".repeat(level + 1);
    // One blank line before every heading except the root H1.
    const blank = level > 0 ? "\n" : "";
    if (!node.text.includes("\n")) {
      md += `${blank}${hashes} ${node.text.trim()}${ending}\n`;
      return;
    }
    if (level === 0) {
      // The root must stay ONE H1 line; the edit layer enforces a
      // single-line, non-empty root, so this is unreachable in normal
      // use. Emitting the raw text here makes any breach fail the save
      // self-check (save refused) instead of silently losing newlines.
      md += `${hashes} ${node.text.trim()}${ending}\n`;
      return;
    }
    // Multi-line text at heading depth: one heading per line, so no line
    // is ever flattened away. Blank lines vanish (they carry no content
    // and a heading line cannot be empty). The fold marker rides the last
    // line — children re-attach there on reparse.
    const lines = node.text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    lines.forEach((line, i) => {
      md += `${blank}${hashes} ${line}${i === lines.length - 1 ? ending : ""}\n`;
    });
  };

  const emitBullet = (node: MindNode, depth: number, ending: string): void => {
    md += emitBulletLines(node, depth, ending);
  };

  // bulletDepth === null → the node may still be a heading (level
  // permitting); a number → this node and its whole subtree are bullets
  // at that depth (set when a heading-depth sibling group was demoted).
  const visit = (node: MindNode, level: number, bulletDepth: number | null): void => {
    const ending = node.collapsed && emitFoldIds ? ` ^${node.id}` : "";
    let childBulletDepth: number | null;
    const before = md.length;

    if (bulletDepth === null && level < headLevel) {
      emitHeading(node, level, ending);
      // If ANY child has no heading form, ALL children demote to bullets
      // (see file header). Only relevant while children would still be
      // headings; at bullet depth the natural rule applies.
      const demote = level + 1 < headLevel && node.children.some(needsBulletForm);
      childBulletDepth = demote ? 0 : null;
    } else {
      const depth = bulletDepth ?? level - headLevel;
      emitBullet(node, depth, ending);
      childBulletDepth = depth + 1;
    }

    if (lineMap) {
      // First CONTENT line of this node's chunk: skip the blank line(s)
      // some emissions prepend (headings, fences).
      const chunk = md.slice(before);
      let lead = 0;
      while (chunk[lead] === "\n") lead++;
      lineMap.set(node.id, lineNo + lead);
      for (let i = 0; i < chunk.length; i++) if (chunk[i] === "\n") lineNo++;
    }

    for (const child of node.children) visit(child, level + 1, childBulletDepth);
  };

  visit(root, 0, null);
  return md.trim();
}

/** Serialize a whole document: opaque prefix + body + opaque suffix. */
export function serializeDocument(
  doc: MindDocument,
  settings: ModelSettings = DEFAULT_MODEL_SETTINGS
): string {
  return doc.prefix + serializeBody(doc.root, settings) + doc.suffix;
}

/** 0-based line index of a node's first content line in the FULL document
 *  text (prefix included), or null for an unknown id. Read-only: uses the
 *  same emission as serializeDocument without touching the file. */
export function nodeLineInDocument(
  doc: MindDocument,
  nodeId: string,
  settings: ModelSettings = DEFAULT_MODEL_SETTINGS
): number | null {
  const lineMap = new Map<string, number>();
  serializeBody(doc.root, settings, lineMap);
  const bodyLine = lineMap.get(nodeId);
  if (bodyLine === undefined) return null;
  let prefixLines = 0;
  for (let i = 0; i < doc.prefix.length; i++) {
    if (doc.prefix[i] === "\n") prefixLines++;
  }
  return prefixLines + bodyLine;
}

/**
 * True when every non-blank line of `ours` (with multiplicity, ignoring
 * trailing whitespace) also appears somewhere in `incoming`. The view uses
 * this on an external reload to decide whether pending edits were actually
 * discarded: Obsidian often auto-merges an external change, and the merged
 * text still contains every line we held — warning about data loss then
 * would be a false alarm.
 */
export function allLinesContained(ours: string, incoming: string): boolean {
  const counts = new Map<string, number>();
  for (const line of incoming.split("\n")) {
    const key = line.replace(/\s+$/, "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const line of ours.split("\n")) {
    const key = line.replace(/\s+$/, "");
    if (key === "") continue;
    const left = counts.get(key) ?? 0;
    if (left === 0) return false;
    counts.set(key, left - 1);
  }
  return true;
}
