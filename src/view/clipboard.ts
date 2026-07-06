// Clipboard codec: subtrees are COPIED as tab-indented markdown bullet
// lines — readable when pasted into any note, email, or chat, and parsed
// back into a full subtree (structure + task checkboxes) when pasted into
// a mindmap. PASTE additionally understands:
//   - v1's JSON payloads ({type:'copyNode'/'copyNodes'}) for backward
//     compatibility with old copies and the retired v1 plugin (decode
//     only — never written anymore),
//   - any outline-ish plain text (bullets with tab/space indents, plain
//     lines, headings), via the same parser that reads mindmap files.
// Pure encode/decode only — the controller talks to the clipboard APIs.

import type { MindNode, TaskState } from "../model/types";
import { createNode } from "../model/tree";
import { normalizeBulletText, parseBody } from "../model/parse";
import { serializeSubtreesAsBullets } from "../model/serialize";

interface ClipboardEntry {
  id: string;
  text: string;
  pid: string | null;
  isExpand: boolean;
  note?: unknown;
  taskState?: "todo" | "done";
}

/** Encode subtrees for the clipboard as markdown bullet lines. "" when
 *  empty (callers prune to top ancestors first). */
export function encodeSubtrees(nodes: MindNode[]): string {
  return serializeSubtreesAsBullets(nodes);
}

/** Rebuild one v1 entry list into a detached subtree (fresh session ids). */
function rebuild(entries: ClipboardEntry[]): MindNode | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const byOld = new Map<string, MindNode>();
  let root: MindNode | null = null;
  for (const entry of entries) {
    if (typeof entry?.text !== "string" || typeof entry?.id !== "string") continue;
    const task: TaskState =
      entry.taskState === "todo" || entry.taskState === "done"
        ? entry.taskState
        : "none";
    // Normalize pasted text like committed text (EC10a): a leading list
    // marker would make every save fail its self-check after the paste.
    const node = createNode(normalizeBulletText(entry.text), {
      task,
      collapsed: entry.isExpand === false,
    });
    byOld.set(entry.id, node);
    const parent = entry.pid != null ? byOld.get(entry.pid) : undefined;
    if (parent) {
      node.parent = parent;
      parent.children.push(node);
    } else if (!root) {
      root = node; // first parentless entry = the subtree root (v1 order)
    }
  }
  return root;
}

/** Decode plain text into detached subtrees via the file parser: bullet
 *  lists (tab or space indents), headings, bare lines — everything the
 *  parser accepts in a body. Null when there is no content. */
function decodeMarkdown(text: string): MindNode[] | null {
  if (!text.trim()) return null;
  const { root, synthesizedRoot } = parseBody(text, "");
  if (!synthesizedRoot) {
    // The text carried its own H1 → the whole parse IS one subtree.
    root.parent = null;
    return [root];
  }
  if (root.children.length === 0) return null;
  for (const child of root.children) child.parent = null;
  return root.children;
}

/** Decode a clipboard string into detached subtrees: v1 JSON payloads
 *  first, then markdown/plain text. Null only for empty/blank clipboards
 *  (never throws — non-payload JSON falls through as plain text). */
export function decodeClipboard(text: string): MindNode[] | null {
  if (!text) return null;
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON → plain text / markdown
  }
  const payload = json as {
    type?: unknown;
    text?: unknown;
    subtrees?: Array<{ text?: unknown }>;
  } | null;
  if (payload?.type === "copyNodes" && Array.isArray(payload.subtrees)) {
    const subtrees = payload.subtrees
      .map((sub) =>
        Array.isArray(sub?.text) ? rebuild(sub.text as ClipboardEntry[]) : null
      )
      .filter((n): n is MindNode => n !== null);
    if (subtrees.length > 0) return subtrees;
  }
  if (payload?.type === "copyNode" && Array.isArray(payload.text)) {
    const tree = rebuild(payload.text as ClipboardEntry[]);
    if (tree) return [tree];
  }
  return decodeMarkdown(text);
}
