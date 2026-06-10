// ONE tested toggle for inline markdown markers — **bold**, _italic_,
// ==highlight==, ~~strike~~ — plus the <mark style> whole-node highlight
// wrap/unwrap/recolor (tolerant of attribute variations it didn't write,
// contract E14). Replaces v1's three divergent implementations.

export type InlineMarker = "**" | "_" | "==" | "~~";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Toggle a symmetric marker around a whole string. */
export function toggleMarker(text: string, marker: InlineMarker): string {
  const m = escapeRegex(marker);
  const wrapped = new RegExp(`^${m}([\\s\\S]+)${m}$`).exec(text);
  if (wrapped) return wrapped[1];
  if (text === "") return text; // nothing to wrap
  return `${marker}${text}${marker}`;
}

/**
 * Toggle a marker on a substring [start, end) of the text — used for
 * "format the selected part of a node". Returns the new full text.
 */
export function toggleMarkerRange(
  text: string,
  marker: InlineMarker,
  start: number,
  end: number
): string {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  if (safeStart === safeEnd) return text;
  const slice = text.slice(safeStart, safeEnd);
  return text.slice(0, safeStart) + toggleMarker(slice, marker) + text.slice(safeEnd);
}

// Whole-node <mark> highlight wrap. Tolerant: matches any style attribute
// content, not just the exact strings v2 writes (contract E14 / P3).
const MARK_WRAP_RE = /^<mark\s+style="[^"]*">([\s\S]*)<\/mark>$/;

/** The highlight color of a node's text, or null when not highlighted. */
export function getHighlightColor(text: string): string | null {
  const match = /^<mark\s+style="[^"]*background:\s*([^;"]+);?[^"]*">/.exec(text);
  return match ? match[1].trim() : null;
}

/** Wrap (or recolor) the whole node text in a <mark> highlight. */
export function applyHighlight(text: string, color: string): string {
  const inner = stripHighlight(text);
  return `<mark style="background:${color};">${inner}</mark>`;
}

/** Remove a whole-node <mark> wrap; returns the inner text unchanged. */
export function stripHighlight(text: string): string {
  const match = MARK_WRAP_RE.exec(text);
  return match ? match[1] : text;
}

/** True when the whole node text is wrapped in a <mark> highlight. */
export function hasHighlight(text: string): boolean {
  return MARK_WRAP_RE.test(text);
}
