// Markdown body → MindNode tree, implementing the format contract exactly:
// every normalization from §1.8 (bare text → bullets, "#tag" is not a
// heading, indent clamping with auto-detected space width, "- -" collapse,
// horizontal rules become bullet text, fences captured byte-exact,
// blockquote lines become one node each), strict 8-4-4 fold-id extraction
// (user ^block-refs stay text — contract B1/B2), task prefixes, and
// multiple-H1 reattachment (E18). Returns ParseResult — never throws.

import type { MindDocument, MindNode, ParseResult, TaskState } from "./types";
import { createNode } from "./tree";
import { splitRegions } from "./region";

// A trailing fold marker: " ^xxxxxxxx-xxxx-xxxx", strict lowercase hex
// (contract B1). Looser ids like "^my-anchor" are real Obsidian block
// refs and must stay in the text (contract B2 / E8).
const TRAILING_FOLD_ID = / \^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4})$/;

// Leading task checkbox on a bullet: "[ ] " / "[x] " / "[X] ".
const TASK_PREFIX = /^\[([ xX])\]\s+/;

// ---- Line tokens produced by the normalizing lexer ----

interface HeadingToken {
  kind: "heading";
  hashLevel: number; // number of leading '#'
  text: string;
}
interface BulletToken {
  kind: "bullet";
  depth: number; // tab-equivalent depth after clamping
  text: string;
}
interface FenceToken {
  kind: "fence";
  depth: number;
  lines: string[]; // raw lines incl. opening/closing ``` — byte-exact
  ownIndent: string; // leading whitespace of the opening line
  /** True when the token right before was an empty bullet — the canonical
   *  serializer shape; the fence is that bullet's text (one node). */
  foldIntoPrev: boolean;
}
type Token = HeadingToken | BulletToken | FenceToken;

/**
 * Normalizing lexer: one pass over the body lines, applying every §1.8
 * normalization and emitting structural tokens. Mirrors v0.5.47's
 * normalizeBullets so existing files keep their exact shape.
 */
function lex(body: string): Token[] {
  const lines = body.split("\n").map((l) => l.replace(/\r$/, "")); // E22: CRLF → LF

  // Auto-detect the space indent width: smallest leading-space bullet run.
  let spaceIndent = 2;
  for (const line of lines) {
    const m = line.match(/^( +)[-*+]\s/);
    if (m && m[1].length > 0) {
      spaceIndent = m[1].length;
      break;
    }
  }

  const indentOf = (line: string): number => {
    const raw = (line.match(/^(\s*)/) as RegExpMatchArray)[1];
    let indent = 0;
    for (let c = 0; c < raw.length; c++) {
      if (raw[c] === "\t") {
        indent++;
      } else {
        let run = 0;
        while (c < raw.length && raw[c] === " ") {
          run++;
          c++;
        }
        c--;
        indent += Math.floor(run / spaceIndent);
      }
    }
    return indent;
  };

  const tokens: Token[] = [];
  // Current valid depth; -1 = right after a heading (no bullets yet).
  let maxIndent = -1;

  // Clamp a raw indent to a valid depth (contract E6/E15: first bullet
  // after a heading is forced to depth 0; orphans clamp to parent+1).
  const clamp = (indent: number): number => {
    let depth: number;
    if (maxIndent === -1) depth = 0;
    else if (indent > maxIndent + 1) depth = maxIndent + 1;
    else depth = indent;
    maxIndent = depth;
    return depth;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code fences: capture the whole block byte-exact (E10 — no trims).
    if (trimmed.startsWith("```")) {
      const fenceLines: string[] = [line];
      let j = i + 1;
      for (; j < lines.length; j++) {
        fenceLines.push(lines[j]);
        if (lines[j].trim().startsWith("```")) break; // closing fence
      }
      const ownIndent = (line.match(/^(\s*)/) as RegExpMatchArray)[1];
      // Canonical emitter shape: an empty bullet directly before the fence
      // means the fence IS that bullet's text — reuse its depth so the
      // roundtrip collapses back to a single node.
      const prevTok = tokens[tokens.length - 1];
      const foldIntoPrev =
        prevTok !== undefined && prevTok.kind === "bullet" && prevTok.text === "";
      const depth = foldIntoPrev ? (prevTok as BulletToken).depth : clamp(indentOf(line));
      tokens.push({ kind: "fence", depth, lines: fenceLines, ownIndent, foldIntoPrev });
      i = j; // skip past the block (or to EOF when unclosed)
      continue;
    }

    if (trimmed === "") continue; // blank lines carry no structure

    // Real headings need "# " (hash + space): "#tag" stays text (E4).
    if (/^#{1,6}\s/.test(trimmed)) {
      const hashLevel = (trimmed.match(/^(#{1,6})\s/) as RegExpMatchArray)[1].length;
      tokens.push({ kind: "heading", hashLevel, text: trimmed.slice(hashLevel).trim() });
      maxIndent = -1;
      continue;
    }

    const indent = indentOf(line);

    // Bullet detection: -, *, + or "1." markers; a bare "-" is an empty
    // node (the canonical empty-bullet emission). Horizontal rules are
    // NOT bullets — they become literal "- ---" text (E1 fix / T17).
    let text = trimmed;
    const isHr = /^[-*_]{3,}\s*$/.test(trimmed) && trimmed !== "-";
    let isBullet = !isHr && (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed) || trimmed === "-");

    if (isBullet) {
      // Chained "- - X" collapses to "- X" (E7 — no empty middle nodes).
      while (/^- - /.test(text)) text = text.replace(/^- /, "");
      // Strip the one list marker; "1." ordering is implied by sibling
      // order and not preserved as a marker (E17).
      text = text === "-" ? "" : text.replace(/^(?:[-*+]|\d+\.)\s+/, "");
    }
    // Everything else (bare text, #tags, hr lines, "> quote" lines) is
    // assimilated as a bullet with the line as verbatim text (P1, E5,
    // §1.7 — each blockquote line becomes its own "> …" node).

    tokens.push({ kind: "bullet", depth: clamp(indent), text });
  }

  return tokens;
}

/** Extract fold marker + task prefix from a bullet's text. */
function extractBulletFields(raw: string): {
  text: string;
  task: TaskState;
  foldId: string | null;
} {
  let text = raw;
  let foldId: string | null = null;
  const fold = text.match(TRAILING_FOLD_ID);
  if (fold) {
    foldId = fold[1];
    text = text.slice(0, -fold[0].length).trimEnd();
  }
  let task: TaskState = "none";
  const taskMatch = text.match(TASK_PREFIX);
  if (taskMatch) {
    task = taskMatch[1] === " " ? "todo" : "done";
    text = text.slice(taskMatch[0].length);
  }
  return { text, task, foldId };
}

/** Extract only the fold marker (headings never carry a task checkbox). */
function extractHeadingFields(raw: string): { text: string; foldId: string | null } {
  let text = raw;
  let foldId: string | null = null;
  const fold = text.match(TRAILING_FOLD_ID);
  if (fold) {
    foldId = fold[1];
    text = text.slice(0, -fold[0].length).trimEnd();
  }
  return { text, foldId };
}

/** Strip the canonical fence emission indent from a captured fence line. */
function dedentFenceLine(line: string, bulletIndent: string): string {
  const full = bulletIndent + "  "; // serializer emits indent + two spaces
  if (line.startsWith(full)) return line.slice(full.length);
  if (line.startsWith(bulletIndent) && bulletIndent.length > 0) {
    return line.slice(bulletIndent.length);
  }
  return line; // unknown shape: keep bytes, idempotent after one roundtrip
}

/**
 * Parse a markdown body into a tree. `fallbackRootText` (usually the file
 * basename) names the synthesized root when the body has no H1.
 */
export function parseBody(
  body: string,
  fallbackRootText: string
): { root: MindNode; synthesizedRoot: boolean } {
  const tokens = lex(body);

  let root: MindNode | null = null;
  let synthesizedRoot = false;
  // Heading stack: [node, effective hash level]; the root counts as level 1.
  let headingStack: Array<{ node: MindNode; hashLevel: number }> = [];
  // bulletStack[d] = most recent bullet node at clamped depth d.
  let bulletStack: MindNode[] = [];

  const ensureRoot = (): MindNode => {
    if (!root) {
      root = createNode(fallbackRootText);
      synthesizedRoot = true;
      headingStack = [{ node: root, hashLevel: 1 }];
    }
    return root;
  };

  const attach = (parent: MindNode, child: MindNode) => {
    child.parent = parent;
    parent.children.push(child);
  };

  const bulletParent = (depth: number): MindNode => {
    if (depth > 0 && bulletStack[depth - 1]) return bulletStack[depth - 1];
    return headingStack[headingStack.length - 1].node;
  };

  for (const token of tokens) {
    if (token.kind === "heading") {
      const { text, foldId } = extractHeadingFields(token.text);
      const node = createNode(text, {
        id: foldId ?? undefined,
        collapsed: foldId !== null,
      });
      if (!root && token.hashLevel === 1) {
        root = node;
        headingStack = [{ node, hashLevel: 1 }];
      } else {
        ensureRoot();
        // Later H1s attach as children of the root (contract E18/T20).
        const effLevel = token.hashLevel === 1 ? 2 : token.hashLevel;
        while (
          headingStack.length > 1 &&
          headingStack[headingStack.length - 1].hashLevel >= effLevel
        ) {
          headingStack.pop();
        }
        attach(headingStack[headingStack.length - 1].node, node);
        headingStack.push({ node, hashLevel: effLevel });
      }
      bulletStack = [];
      continue;
    }

    if (token.kind === "bullet") {
      ensureRoot();
      const { text, task, foldId } = extractBulletFields(token.text);
      const node = createNode(text, {
        id: foldId ?? undefined,
        task,
        collapsed: foldId !== null,
      });
      attach(bulletParent(token.depth), node);
      bulletStack[token.depth] = node;
      bulletStack.length = token.depth + 1;
      continue;
    }

    // Fence block. Canonical emission is an empty bullet followed by the
    // fence lines two spaces deeper — fold that back into ONE node so the
    // roundtrip is identity. A raw fence with no empty bullet before it
    // becomes its own node (never dropped — contract P1).
    ensureRoot();
    const prev = bulletStack[token.depth];
    const prevIsEmptyBullet =
      token.foldIntoPrev &&
      prev !== undefined &&
      prev.text === "" &&
      prev.children.length === 0;
    // Last line may carry a fold marker appended by the serializer.
    const lines = token.lines.slice();
    let foldId: string | null = null;
    const last = lines[lines.length - 1];
    const foldMatch = last.match(TRAILING_FOLD_ID);
    if (foldMatch) {
      foldId = foldMatch[1];
      lines[lines.length - 1] = last.slice(0, -foldMatch[0].length);
    }
    if (prevIsEmptyBullet) {
      const indent = "\t".repeat(token.depth);
      prev.text = lines.map((l) => dedentFenceLine(l, indent)).join("\n");
      if (foldId) {
        prev.id = foldId;
        prev.collapsed = true;
      }
    } else {
      const text = lines
        .map((l) => (token.ownIndent && l.startsWith(token.ownIndent) ? l.slice(token.ownIndent.length) : l))
        .join("\n");
      const node = createNode(text, { id: foldId ?? undefined, collapsed: foldId !== null });
      attach(bulletParent(token.depth), node);
      bulletStack[token.depth] = node;
      bulletStack.length = token.depth + 1;
    }
  }

  if (!root) {
    root = createNode(fallbackRootText);
    synthesizedRoot = true;
  }
  return { root, synthesizedRoot };
}

/**
 * Parse a whole file: split regions, parse the body, never throw.
 * This is the only parse entry point the view layer should use.
 */
export function parseDocument(text: string, fallbackRootText: string): ParseResult {
  try {
    const { prefix, body, suffix } = splitRegions(text);
    const { root, synthesizedRoot } = parseBody(body, fallbackRootText);
    const doc: MindDocument = { prefix, suffix, root, originalText: text, synthesizedRoot };
    return { ok: true, doc };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, originalText: text };
  }
}
