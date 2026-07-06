// Shared CommonMark-compatible code-fence detection — the ONE place that
// decides what opens and closes a fence. The lexer (parse.ts), the text
// normalizer (normalizeBulletText), the serializer (isPureFence + the
// unclosed-fence closer), and the H1 finder (region.ts) must all agree,
// or a fence torn open on one side of the roundtrip is swallowed on the
// other. Covers the CommonMark subset that matters here: ``` and ~~~
// openers of any length ≥3, closers of the same character at least as
// long carrying no info string, and backtick-info-string restrictions.

/** A trailing fold marker: " ^xxxxxxxx-xxxx-xxxx", strict lowercase hex
 *  (contract B1). Looser ids like "^my-anchor" are real Obsidian block
 *  refs and must stay in the text (contract B2 / E8). */
export const TRAILING_FOLD_ID = / \^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4})$/;

export interface FenceMarker {
  char: "`" | "~";
  len: number;
}

/** The fence a line OPENS, or null. A backtick fence's info string may not
 *  contain further backticks (CommonMark — "``` `x` ```" is a paragraph
 *  with inline code, not a fence; tilde info strings have no such rule). */
export function fenceOpen(line: string): FenceMarker | null {
  const t = line.trim();
  const m = t.match(/^(`{3,}|~{3,})/);
  if (!m) return null;
  const char = m[1][0] as "`" | "~";
  if (char === "`" && t.slice(m[1].length).includes("`")) return null;
  return { char, len: m[1].length };
}

/** True when a line CLOSES the given fence: the same character, at least
 *  as many, and nothing else (closers carry no info string). A fold
 *  marker on the closer line ("``` ^id" — appended by the serializer to a
 *  collapsed fence node's last line) is metadata, not part of the closer. */
export function fenceCloses(line: string, open: FenceMarker): boolean {
  // trimEnd BEFORE the fold-id strip: TRAILING_FOLD_ID anchors at the line
  // end, so trailing spaces after the marker would otherwise defeat it and
  // leave the fence open (Codex re-review 2026-07-06).
  const m = line
    .trimEnd()
    .replace(TRAILING_FOLD_ID, "")
    .trim()
    .match(/^(`{3,}|~{3,})$/);
  return m !== null && m[1][0] === open.char && m[1].length >= open.len;
}

/** True when `text` is one whole code fence: the first line opens one and
 *  no INTERIOR line closes it (only the final line may). Anything else is
 *  ordinary multi-line text. Shared by the serializer (byte-exact fence
 *  emission) and normalizeBulletText (fence bytes stay untouched) — the
 *  two MUST use the same predicate or the save self-check fails. */
export function isPureFence(text: string): boolean {
  const lines = text.split("\n");
  const open = fenceOpen(lines[0]);
  if (!open) return false;
  for (let i = 1; i < lines.length - 1; i++) {
    if (fenceCloses(lines[i], open)) return false;
  }
  return true;
}
