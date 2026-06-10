// Splits a raw file into [prefix][body][suffix] by byte offsets.
// Prefix = YAML frontmatter (recognized ONLY at the top of the file —
// contract F1, the fix for the v1 mid-file "---" deletion bug) plus any
// preamble before the first H1, kept as opaque verbatim bytes (contract P2).
// Suffix is "" for whole-file maps (the only mode the prototype ships).

export interface RegionSplit {
  prefix: string;
  body: string;
  suffix: string;
}

/** Default frontmatter written when a brand-new mindmap file is created. */
export const DEFAULT_FRONTMATTER = "---\nmindmap-plugin: basic\n---\n\n";

/**
 * Find the byte offset just past the YAML frontmatter block, or 0 if the
 * file has none. Frontmatter is recognized only when the first non-blank
 * line of the file is exactly "---" (contract F1); blank lines inside the
 * block are allowed (contract F3).
 */
function frontmatterEnd(text: string): number {
  const lines = text.split("\n");
  let offset = 0;
  let i = 0;
  // Skip leading blank lines — "first non-empty content" per the contract.
  while (i < lines.length && lines[i].trim() === "") {
    offset += lines[i].length + 1;
    i++;
  }
  if (i >= lines.length || lines[i].replace(/\r$/, "").trim() !== "---") {
    return 0; // no opening fence at the top → no frontmatter
  }
  offset += lines[i].length + 1;
  i++;
  // Find the closing "---" line.
  for (; i < lines.length; i++) {
    const isLast = i === lines.length - 1;
    offset += lines[i].length + (isLast ? 0 : 1);
    if (lines[i].replace(/\r$/, "").trim() === "---") {
      return Math.min(offset, text.length);
    }
  }
  return 0; // unclosed fence → treat as content, not frontmatter
}

/** Split raw file text into opaque prefix, parseable body, opaque suffix. */
export function splitRegions(text: string): RegionSplit {
  const fmEnd = frontmatterEnd(text);
  // Preamble: everything between the frontmatter and the first H1 line
  // stays in the prefix, byte-verbatim. If there is no H1, the whole
  // remainder is body (the parser will synthesize a root).
  const lines = text.slice(fmEnd).split("\n");
  let offset = fmEnd;
  let h1Start = -1;
  // Track code-fence state exactly like the body lexer does: a line whose
  // trimmed text starts with ``` opens a fence, the next such line closes
  // it. A "# " line INSIDE a fence is code, never the root heading —
  // without this, opening a regular note as a mindmap could tear a fence
  // apart and rewrite the file around a bogus root.
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/\r$/, "").trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
    } else if (!inFence && /^#[ \t]/.test(trimmed)) {
      h1Start = offset;
      break;
    }
    offset += lines[i].length + 1;
  }
  const splitAt = h1Start >= 0 ? h1Start : fmEnd;
  return { prefix: text.slice(0, splitAt), body: text.slice(splitAt), suffix: "" };
}

/** Read the `mindmap-zoom` frontmatter value from a prefix, or null if the
 *  prefix has no frontmatter / no such key. Clamped to the 20–300 range. */
export function readZoomFromPrefix(prefix: string): number | null {
  const fmEnd = frontmatterEnd(prefix);
  if (fmEnd === 0) return null;
  const match = /^mindmap-zoom:[ \t]*([0-9]+)/m.exec(prefix.slice(0, fmEnd));
  if (!match) return null;
  return Math.min(300, Math.max(20, parseInt(match[1], 10)));
}

/**
 * Pure helper for the per-file zoom value (frontmatter key `mindmap-zoom`).
 * Updates only that one key inside the prefix, leaving every other byte
 * untouched (contract F2 / T22). Stage D may route this through Obsidian's
 * processFrontMatter instead; the byte-level behavior must match this.
 */
export function updateZoomInPrefix(prefix: string, zoom: number): string {
  const clamped = Math.round(Math.min(300, Math.max(20, zoom)));
  const fmEnd = frontmatterEnd(prefix);
  if (fmEnd === 0) return prefix; // no frontmatter → nothing to update here
  const fm = prefix.slice(0, fmEnd);
  const rest = prefix.slice(fmEnd);
  const keyRe = /^(mindmap-zoom:[ \t]*)\S.*$/m;
  if (keyRe.test(fm)) {
    return fm.replace(keyRe, `$1${clamped}`) + rest;
  }
  // Key missing: insert it just before the closing fence.
  const closing = fm.lastIndexOf("---");
  return fm.slice(0, closing) + `mindmap-zoom: ${clamped}\n` + fm.slice(closing) + rest;
}
