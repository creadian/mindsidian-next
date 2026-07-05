// Clipboard codec (design §1 Stage C): copy/cut/paste subtrees as JSON in
// v1's clipboard format, kept for cross-compatibility with v0.5.47:
//   single  {type:'copyNode',  text:[{id,text,pid,isExpand,note}, …]}
//   multi   {type:'copyNodes', subtrees:[<copyNode payloads>, …]}
// Pure encode/decode only — the controller talks to navigator.clipboard.
// v2 additionally writes/reads a `taskState` field per entry (v1 ignores it;
// v1 payloads simply paste without task state, exactly like v1 itself).

import type { MindNode, TaskState } from "../model/types";
import { createNode, newId } from "../model/tree";
import { normalizeBulletText } from "../model/parse";

interface ClipboardEntry {
  id: string;
  text: string;
  pid: string | null;
  isExpand: boolean;
  note?: unknown;
  taskState?: "todo" | "done";
}

interface CopyNodePayload {
  type: "copyNode";
  text: ClipboardEntry[];
}

interface CopyNodesPayload {
  type: "copyNodes";
  subtrees: CopyNodePayload[];
}

/** Flatten one subtree into v1's id/pid entry list (fresh ids, like v1). */
function flatten(node: MindNode): ClipboardEntry[] {
  const entries: ClipboardEntry[] = [];
  const visit = (n: MindNode, pid: string | null): void => {
    const id = newId();
    entries.push({
      id,
      text: n.text,
      pid,
      isExpand: !n.collapsed,
      taskState: n.task === "none" ? undefined : n.task,
    });
    for (const child of n.children) visit(child, id);
  };
  visit(node, null);
  return entries;
}

/** Encode subtrees for the clipboard. One node → copyNode, several →
 *  copyNodes (callers prune to top ancestors first). "" when empty. */
export function encodeSubtrees(nodes: MindNode[]): string {
  if (nodes.length === 0) return "";
  if (nodes.length === 1) {
    const payload: CopyNodePayload = { type: "copyNode", text: flatten(nodes[0]) };
    return JSON.stringify(payload);
  }
  const payload: CopyNodesPayload = {
    type: "copyNodes",
    subtrees: nodes.map((n) => ({ type: "copyNode" as const, text: flatten(n) })),
  };
  return JSON.stringify(payload);
}

/** Rebuild one entry list into a detached subtree (fresh session ids). */
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

/** Decode a clipboard string into detached subtrees, or null when the text
 *  is not a Mindsidian payload (never throws — bad JSON is just "not ours"). */
export function decodeClipboard(text: string): MindNode[] | null {
  if (!text) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
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
    return subtrees.length > 0 ? subtrees : null;
  }
  if (payload?.type === "copyNode" && Array.isArray(payload.text)) {
    const tree = rebuild(payload.text as ClipboardEntry[]);
    return tree ? [tree] : null;
  }
  return null;
}
