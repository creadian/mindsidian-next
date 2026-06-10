// Shared data types for the Mindsidian v2 core model.
// Pure TypeScript — no obsidian imports, no DOM. Everything the parser,
// serializer, tree operations and commands agree on lives here.

/** Task checkbox state of a node ("[ ] " / "[x] " prefix on bullets). */
export type TaskState = "none" | "todo" | "done";

/** How fold (collapse) state is persisted. */
export type FoldPersistence = "markdown" | "plugin-data" | "none";

/** One node of the mind map tree. */
export interface MindNode {
  /** 8-4-4 lowercase hex id; adopted from a fold ^id, else random per session. */
  id: string;
  /**
   * Node text: a single line of Obsidian markdown, verbatim — including
   * <mark> wraps, [[wikilinks]], `code`, user ^block-refs. The task prefix
   * and the fold ^id marker are stripped out into their own fields.
   * (Code-fence nodes are the one multi-line exception.)
   */
  text: string;
  /** Checkbox state (bullets only — headings never carry one). */
  task: TaskState;
  /** Collapsed (folded) — persisted as a trailing " ^id" in markdown mode. */
  collapsed: boolean;
  /** Children in document order. */
  children: MindNode[];
  /** Parent node; null only for the root. */
  parent: MindNode | null;
}

/** A parsed mindmap file: opaque outer bytes + the editable tree. */
export interface MindDocument {
  /**
   * Opaque verbatim bytes before the mindmap body: frontmatter and any
   * preamble before the first H1. NEVER regenerated — written back as-is.
   */
  prefix: string;
  /** Opaque verbatim bytes after the mindmap region. "" for whole-file maps. */
  suffix: string;
  /** The root node (first H1, or synthesized from the file basename). */
  root: MindNode;
  /** Exact text last received from disk — the refuse-to-corrupt fallback. */
  originalText: string;
  /**
   * True when the root was synthesized (empty file / no H1). The view must
   * not write to disk until the user actually edits (contract E12 / T7).
   */
  synthesizedRoot: boolean;
}

/** Result of a parse — never throws into callers (contract P4). */
export type ParseResult =
  | { ok: true; doc: MindDocument }
  | { ok: false; error: string; originalText: string };

/** The slice of plugin settings the model layer needs. */
export interface ModelSettings {
  /** Nodes at depth < headLevel become ATX headings; deeper ones bullets. */
  headLevel: number;
  /** Fold-state persistence mode (markers emitted only in "markdown"). */
  foldStatePersistence: FoldPersistence;
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  headLevel: 2,
  foldStatePersistence: "markdown",
};
