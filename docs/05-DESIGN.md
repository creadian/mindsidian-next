# Mindsidian v2 — Final Build Spec (authoritative)

**Status: binding for all builders.** Where this document and a proposal disagree, this document wins.
Where this document and `03-format-contract.md` disagree on markdown behavior, the **format contract wins**.

**Priority order (owner's explicit rule): data safety > leanness > features.**
The owner is non-technical and cannot debug code himself. A known annoyance beats a risky fix.
Consequences baked into this design:

1. The parser/serializer is built and fully tested **before any UI exists** (Stage A gate).
2. Every save passes a **refuse-to-corrupt guard** (serialize → reparse → compare; on any doubt, write the last-known-good text instead).
3. The save path is **region-scoped by construction** (opaque prefix/suffix bytes) — the plugin can only ever rewrite the part of the file it owns.
4. The prototype ships with **full relayout** (simple, correct); incremental dirty-subtree layout is a later optimization behind a cross-checked debug flag. Two-pass batching + the plain-text render fast path already fix the v1 performance bugs at 1000 nodes.
5. Zero runtime dependencies. Only `obsidian` (provided at runtime) + esbuild/typescript/tsx at dev time.
6. v2 installs as a **separate plugin id (`mindsidian-next`)** so it runs side-by-side with the working v0.5.47 — the user's real maps are never the test bed.

Total source budget: ~4,600 lines src + ~350 css + ~800 tests. No `any`. No module-level mutable state (every piece of state lives on a view instance or is passed in). No `setTimeout` as a correctness mechanism. Delete, never comment out.

---

## 1. Modules and build order

All code under `/Users/christiansextl/Mindsidian-v2/src/`. Each file starts with a 2–4 line comment explaining its purpose in plain language.

### STAGE A — Core (pure TypeScript, **zero `obsidian` imports**, fully unit-tested)

Nothing in `src/model/` may import from `obsidian` or touch the DOM. This is enforced by a test (`tests/purity.test.ts` greps the model folder for `from "obsidian"` and `document.`/`window.`).

| File | ~Lines | Responsibility |
|---|---|---|
| `src/model/types.ts` | 80 | All shared interfaces (§2): `MindNode`, `MindDocument`, `ParseResult`, `Settings` shape used by the model. Strict types, no `any`. |
| `src/model/region.ts` | 100 | Splits raw file text into `[prefix][body][suffix]`. Prefix = frontmatter (recognized **only at byte 0**, blank lines inside allowed — contract F1/F3) + preamble before the first H1, held as **opaque verbatim bytes**. Suffix = `""` for whole-file maps (the only mode the prototype ships; the mechanism exists so the future "mindmap region in a long note" feature is architecture, not retrofit). |
| `src/model/parse.ts` | 350 | body → tree. Ports every normalization rule from contract §1.8 (bare text → bullets, `#tag` not a heading, indent clamping, space-width auto-detect, `- -` collapse, hr → bullet text, fences passed through byte-exact, blockquote → one node per quote line). Strict 8-4-4 fold-id extraction (B1/B2 — user block refs stay text). Task prefix extraction. Multiple H1s attach under the first (E18). Returns `ParseResult` — **never throws into callers**. |
| `src/model/serialize.ts` | 220 | tree → body, exactly the canonical emitter of contract §5. Headings below `headLevel`, tab-indented `- ` bullets at/after it, task prefixes, fold ids only on collapsed nodes in `markdown` persistence mode, fence lines byte-exact (E10 fix — no trim inside fences). Pure, synchronous, idempotent. |
| `src/model/tree.ts` | 220 | `MindNode` constructors, `Map<id,node>` index (maintained on every mutation — no DFS lookups ever, fixes B3), structural ops (insert/remove/move/reparent with cycle check), root invariants (no delete/sibling/drag of root), depth computation. |
| `src/model/commands.ts` | 280 | Undoable command objects: Add, Remove, ChangeText, Move, GroupMove, Reorder, Fold/Unfold, TaskToggle, Paste. Commands mutate **the tree only** — no selection, no editing, no DOM, no timers (kills v1's load-bearing `setTimeout(0)`, bug B6). The caller (Stage C) owns selection/edit orchestration. Includes History: undo/redo stacks, 50-step cap, per-view instance. |
| `src/model/format.ts` | 120 | **One** tested `toggleMarker()` for `**bold**`, `_italic_`, `==highlight==`, `~~strike~~`, plus the `<mark style>` highlight wrap/unwrap/recolor (tolerant regex per contract E14). Replaces v1's three divergent implementations. |
| `tests/` | ~800 | node:test suites: golden roundtrip **T1–T24 from the format contract** (fixtures = copies of the real files in `tests/fixtures/`, never the live vault), idempotence fuzz (500 random trees, pass 2 ≡ pass 1), command/undo invariants, toggleMarker cases, model purity check. |

**Stage A is the data-safety gate.** No Stage B code is written until T1 (the Praxis canary file) roundtrips byte-identical.

### STAGE B — Layout + renderer + styles

| File | ~Lines | Responsibility |
|---|---|---|
| `src/view/layout.ts` | 280 | Pure layout function `(tree, measuredSizes, settings) → positions` — unit-testable without DOM. Right / Left / Centered directions. Strict two-pass discipline at the call site: read **all** node boxes, then write **all** positions (fixes the v1 reflow-per-node thrash). **Full relayout every time** in the prototype (see priority rule 4). Spacing constants come from settings, including extra gap at subtree boundaries (owner wishlist #4). |
| `src/view/render.ts` | 320 | Node DOM lifecycle (create/update/destroy, keyed by node id). **Plain-text fast path**: `textContent` when node text has no markdown syntax (the majority); `MarkdownRenderer` only otherwise — wikilinks, embeds, code, math come free. Task checkbox injection, `<mark>` highlight render, depth + branch-color CSS variables per node. One `Promise.all` ready state (no counters, no 100ms timers); images/embeds re-measure via ResizeObserver. |
| `src/view/edges.ts` | 130 | One full-size SVG layer under the nodes. Keyed `<path>` per edge, updated in place with raw path strings (no svg.js). Branch-colored from the node's CSS variable. |
| `src/view/viewport.ts` | 240 | The **only writer** of the view transform: one `{x, y, scale}` → single CSS `translate() scale()` matrix on the inner "world" container, `transform-origin: 0 0`, `will-change: transform`. Wheel zoom anchored at cursor; pinch anchored at the focal point **computed once per gesture start** (v1's hardest-won lesson — never re-read a JS cache); zoom clamp 20–300; animated recenter. Escape hatch: a `nativeScrollPan` setting can swap the pan source to container scrolling behind the same API if transform-pan misbehaves on a real iPhone. |
| `styles.css` | ~350 | ALL styling (none in JS). Obsidian CSS variables for theme compliance. Node states (`select`, `multi-select`, `editing`, `drop-target`, `dragging`, `collapsed`), fold dot with inverse-scaled tap target, `content-visibility: auto` on nodes. |
| `src/view/devharness.ts` | 60 | Stage B/C only, deleted in Stage D: a minimal **read-only** view shell that loads a fixture file and renders it inside the test vault so layout/rendering can be eyeballed before the real TextFileView exists. Hard-coded to never write. |

### STAGE C — Interactions

| File | ~Lines | Responsibility |
|---|---|---|
| `src/input/pointer.ts` | 400 | **Pointer Events only** — one code path for mouse, touch, and pen (deletes v1's duplicated drag logic). Scoped to the view's container, `ownerDocument`-resolved (popouts). Tap-select; **manual** double-tap/double-click detector (native `dblclick` is unreliable in popouts and on iOS); long-press (500ms) → drag-to-reparent with ghost (leftward/up visual offset, hit-test at ghost position, hidden node during `elementFromPoint`), drop highlight + arrow indicator, edge auto-pan, **commit to the last *shown* drop target**; drag-empty-space → pan; hold-still 1s on empty space → marquee multi-select (rectangle in world coordinates from the viewport transform — the single source of truth); shift-click multi-select; group drag for multi-selected nodes (one history step). `preventDefault` on `mousedown`, never on touch-start equivalents (iOS click synthesis). |
| `src/input/keyboard.ts` | 280 | Keydown on the view's container — **never `document`**, no `isFocused` heuristics (kills the v1 focus-grace-timer bug family). Enter → sibling / commit, Tab → child (auto-expand folded parent), Delete/Backspace, Escape ladder (marquee → multi-select → cancel edit), arrows = spatial nav via parent/children arrays, O(siblings). Selection focuses a **stable hidden container, not the node div** — so focus never auto-scrolls the viewport (fixes B2 architecturally, WCAG keyboard nav). Home → root + center. Displayed-level keys (expand/collapse one level, fold/unfold all). |
| `src/view/selection.ts` | 140 | Single + multi selection state on the view instance; prune-to-top-ancestors helper for group ops; root never multi-selectable. |
| `src/view/edit.ts` | 260 | Node edit lifecycle: `contenteditable="plaintext-only"`, enter/commit/cancel, IME composition guard, focus-in-same-gesture for the iOS keyboard. Format toggle commands call `model/format.toggleMarker` on the node text or selected substring. Empty-node placeholder shown in the editor but **never written to disk as "Sub title"** (fixes B5 — an empty node serializes as bare `-` per contract). |
| `src/view/clipboard.ts` | 130 | Copy/cut/paste of subtrees as JSON (v1 clipboard format kept for cross-compatibility: `{type:'copyNode'|'copyNodes', …}`); paste as children of selection, auto-expand target, clipboard re-written so paste repeats. |
| `src/ui/palette.ts` | 100 | Floating 6-swatch highlight palette; single + multi-select targets; recolor replaces, × strips. |
| `src/ui/mobileBar.ts` | 220 | Bottom action bar (mobile only): +sibling, +child, undo, redo, delete (stays visible with multi-select — owner wishlist #7), palette, recenter. Positioning derived from `visualViewport` + measured safe-area only — **no 270/413/×2 magic constants**. Poller sleeps when the view is hidden. Add-node flow stays synchronous inside the user gesture (iOS keyboard). |
| `src/ui/wikilink.ts` | 80 | Fuzzy vault-file picker; inserts `[[basename]]` at the cursor, preserving an in-flight edit selection. *(Uses `obsidian` FuzzySuggestModal — wired fully in Stage D, stubbed interface here.)* |

### STAGE D — Obsidian integration

| File | ~Lines | Responsibility |
|---|---|---|
| `src/view/MindmapView.ts` | 400 | `TextFileView` subclass — the only owner of disk I/O (§4): `setViewData` / `getViewData` / `clear`, `requestSave` funnel, refuse-to-corrupt guard, parse-error read-only panel with "open as markdown", per-leaf state object, `getState`/`setState` (written defensively — call order varies), zoom persistence via `processFrontMatter` on close (only if changed), fold persistence modes, external-change reconcile with self-save echo token. Replaces the dev harness. |
| `src/main.ts` | 180 | Plugin entry: `registerView`, settings load, **Kanban-pattern view swap** on `active-leaf-change` (frontmatter `mindmap-plugin` detection; **no `setViewState` monkey-patching**), per-path mode `Map` so "open as markdown" sticks, `onLayoutReady` gating, `leaf.isDeferred` checks, file-menu + pane-menu items, folder "New mindmap" item. Never stores view references. |
| `src/commands.ts` | 220 | All command registrations as a **data table** → one `mindmapCommand()` helper (kills v1's 1,700-line main.ts). Sentence case, `checkCallback`-scoped, no default hotkeys beyond v1 parity bindings. |
| `src/settings.ts` + `src/settingsTab.ts` | 220 | Grouped settings + `schemaVersion` from day one. Each view receives a **frozen snapshot** + explicit `applySettings()` push (no shared-reference mutation). Settings: headLevel, layout direction, fold persistence mode, default zoom, node max width (desktop/mobile), spacing incl. subtree-boundary gap, branch color array, focus-on-move, mobile bar sizing, canvas background. Changing headLevel shows an explicit note that files re-serialize on next save (owner wishlist #6). |
| `src/validate.ts` | 120 | **Shadow-mode vault validation command**: runs v2's parse→serialize read-only across every `mindmap-plugin` file in the vault and reports diffs (a Notice + a report to the console / a modal). Run before the owner ever edits a real note with v2. Writes nothing. |

Install target (Stage D): `/Users/christiansextl/Obsidian/Claude_testing/.obsidian/plugins/mindsidian-next/` (the **only** path in the test vault we may write to), via an `npm run install:vault` copy script + pjeby Hot-Reload marker. The real vault and the v1 plugin folder are never touched.

---

## 2. Data model

```ts
// src/model/types.ts

export type TaskState = "none" | "todo" | "done";

export interface MindNode {
  id: string;                 // 8-4-4 lowercase hex; adopted from a fold ^id, else random per session
  text: string;               // single line of Obsidian markdown, verbatim — incl. <mark> wraps,
                              // [[wikilinks]], `code`, user ^block-refs. Task prefix + fold id stripped.
  task: TaskState;            // ↔ leading "[ ] " / "[x] " on bullets only (contract §1.5)
  collapsed: boolean;         // ↔ trailing " ^id" (markdown persistence mode, collapsed nodes only)
  children: MindNode[];       // sibling order = document order
  parent: MindNode | null;    // null only for root
}

export interface MindDocument {
  prefix: string;             // opaque verbatim bytes: frontmatter (+ preamble). NEVER regenerated.
  suffix: string;             // opaque verbatim bytes after the mindmap region. "" for whole-file maps.
  root: MindNode;
  originalText: string;       // exact text last received from disk — the refuse-to-corrupt fallback
}

export type ParseResult =
  | { ok: true; doc: MindDocument }
  | { ok: false; error: string; originalText: string };
```

Rules:
- **Highlight is not a field.** It lives inside `text` as the `<mark>` wrap — one less sync surface, matches the contract.
- **DOM/layout state never lives on model nodes.** The view keeps a parallel render map `id → { el, w, h, x, y }`; model and projection meet only through node ids.
- **Tree truth lives only in `MindNode`**; a `Map<id, MindNode>` index is maintained by `tree.ts` on every mutation.
- All view-only state (selection, edit node, viewport transform, displayed level, history) lives in one per-view state object — never module-level (the "two maps share zoom" bug class is impossible by construction).

---

## 3. Rendering decision

**Obsidian-Canvas hybrid: absolutely-positioned HTML divs for nodes inside one CSS-transformed pan/zoom world container, plus one full-size SVG layer underneath for bezier edges. Pointer Events for all input.**
All three proposals, the ecosystem research, and core Canvas itself converge on this: HTML nodes give native `MarkdownRenderer`, IME, contenteditable, and theme variables for free (text *is* the product), while a single GPU-composited transform deletes v1's two most bug-prone subsystems — the giant 8000–36000px scrolled canvas and the transform-origin/scroll-compensation zoom math.
Canvas/WebGL only pays off past ~5k nodes and maximizes custom (= data-risk) surface; SVG `foreignObject` text is flaky on iOS — both rejected.

---

## 4. Save lifecycle + state isolation

**Obsidian owns disk I/O via `TextFileView`. The view never calls `vault.modify` on its own file.**

Load: `setViewData(text, clear)` → `region.split(text)` → `parse(body)`.
- Parse OK → build tree, render.
- Parse failure → read-only error panel + "Open as markdown" button; original text kept verbatim; `saveBlocked = true`. **A partial tree is never serialized (contract P4).**

Save: every user mutation goes through exactly one funnel: command → history → tree-changed → `requestSave()`.
`getViewData()` is pure and synchronous: `prefix + serialize(root) + suffix`. Before returning, the **refuse-to-corrupt guard** runs:

1. If `saveBlocked`, or the tree is empty while the input wasn't → return `originalText` (last known good).
2. Self-check: `parse(serialize(root))` must deep-equal the tree. On mismatch → return `originalText` + `Notice` telling the user nothing was changed on disk.
3. Open-then-close-without-edit writes **nothing** (dirty flag; contract E12). Zoom is written via `processFrontMatter` on close **only if it actually changed**, and only that one key.

External changes arrive **only** through `setViewData` (no own `vault.on("modify")` subscription → no double-handling). Self-originated saves carry a version token so the reconcile path ignores echoes. With the same file open in two panes, only the focused/editing view triggers saves.

State isolation, guaranteed by construction:
- **Zero module-level mutable state** (enforced by a purity test + review rule: no top-level `let`).
- All state on the view instance; settings arrive as a frozen snapshot.
- Keyboard/pointer listeners registered on the view's `containerEl` via `registerDomEvent` (auto-cleaned, popout-safe through `ownerDocument`/`defaultView`).
- No stored view references anywhere; `getLeavesOfType` + `leaf.isDeferred` checks when iterating.
- Selection focuses a stable hidden container — browser focus can never auto-scroll the map.

---

## 5. Scope table

Anything not listed in the first two columns is **deferred** — there are no silent drops. The DEFERRED column explicitly names every v1 parity feature the prototype does not ship.

### MUST-HAVE (v1 parity core)

- Lossless roundtrip per the format contract incl. **all** documented compat fixes (E1 byte-0 frontmatter, E8 strict 8-4-4 fold ids, E10 fence bytes, E11 blockquote no-drop, E18 multi-H1 reattach); tests T1–T24 green; T1 canary byte-identical.
- Create new mindmap; toggle md/mindmap; set-to-mindmap / set-to-markdown; frontmatter-driven view swap (Kanban pattern); per-leaf mode memory; "Open as markdown" escape hatch everywhere incl. the parse-error panel.
- Node CRUD: Enter → sibling below current, Tab → child (auto-expand folded parent), Delete/Backspace (single + multi, pruned to top ancestors), edit (manual double-click/tap), Escape-cancel, root protections.
- Format toggles: bold / italic / highlight / strike (whole node + selected substring) via the single `toggleMarker`.
- Undo/redo (50 steps, per view); move node up/down/left/right among siblings; move-siblings-as-children commands.
- Fold: toggle, fold dot, expand/collapse one level, fold/unfold all, displayed-level logic; fold persistence modes `markdown` + `none`.
- Zoom/pan: wheel (Ctrl/Cmd+wheel zoom anchored at cursor), pinch (focal-anchored), zoom in/out/reset commands, per-file `mindmap-zoom` persistence + default-zoom setting, recenter (button + command + center-on-node).
- Selection: single, shift-click multi, marquee (hold-still on empty space), group drag/move/delete as one history step.
- Drag-reparent: desktop drag + **mobile long-press ghost drag** with drop highlight, arrow indicator, edge auto-pan, commit-to-last-shown target.
- Tasks: toggle command + checkbox tap (binary todo↔done), bullets only, headings get a Notice.
- Highlights: 6-swatch palette, single + multi-select.
- Wikilinks: rendered, clickable (`openLinkText`, Ctrl/Cmd = new pane), hover-preview, fuzzy insert picker. Embeds `![[…]]` rendered with re-measure.
- Copy/cut/paste subtrees (v1 clipboard JSON format).
- Mobile action bar (with delete staying visible during multi-select); keyboard-aware via visualViewport only.
- External-edit sync; popout-window support; spatial arrow navigation **without viewport panning** (B2 fix).
- Settings: headLevel, layout direction (centered/right/left), fold persistence, default zoom, node max width (desktop/mobile), branch colors, focus-on-move, mobile bar sizing, canvas background, spacing.
- New-file `mindmap-plugin: basic` frontmatter; empty-file root synthesis with no disk write until first edit.

### SHOULD-HAVE (new in v2; built only after parity in that stage works)

- Refuse-to-corrupt save guard + shadow-mode vault validation command (`src/validate.ts`) — *treated as must-build in practice; listed here only because v1 has no equivalent.*
- Plain-text render fast path; `Map` id index; keyed edges; `content-visibility: auto` (the B3 performance fixes — these are architecture, ship with Stage B).
- Empty-bullet fix: no more "Sub title" written to disk (B5).
- Subtree-boundary extra spacing as a setting (owner wishlist #4).
- Depth-scaled font setting, CSS-only (owner wishlist #5), default off.
- Focus mode: dim everything outside the selected subtree, pure CSS, default off.
- Fold persistence mode `plugin-data` (text-paths in plugin data; markdown stays clean).
- Join-with-below + join-as-citation commands (v1 parity, but low-risk text ops — land late in Stage C if time allows; otherwise they move to DEFERRED explicitly).

### DEFERRED (explicit — every v1 feature not shipping in the prototype is named here)

- PNG / JPEG / HTML export (drops dom-to-image vendor; v1 export also mutates the live canvas — unsafe pattern).
- XMind import (drops jszip) incl. Finder drop.
- Clockwise layout direction (centered/left/right ship).
- i18n locale system (English only; sentence-case strings in one place for later extraction).
- Numbered-list roundtrip *fix* (B4): v2 parses `1. item` and serializes as `- ` bullets exactly per contract E17 — the marker-preserving roundtrip is future work.
- Inline `[[` autocomplete (AbstractInputSuggest), slash menu, outline side panel, tag filter/chips, zoom-into-subtree, boundaries/summaries, quick-add buttons next to node.
- Triple-space → child / triple-enter → sibling capture shortcuts; swipe actions; keyboard accessory bar; voice capture; haptics beyond basic vibrate.
- Mindmap **region** UI (sentinel/fenced block in a long note): the prefix/suffix architecture ships, the user-facing feature does not.
- AI features of any kind.
- v1 commands intentionally dropped: "Replace by the previous text", "Display node info in console", "Export to html" vestige, `window.myNode` debug global, "Add tabulation" (nbsp insert), add/remove `<br>` line-break commands (multi-line nodes still parse/serialize safely per E9 — only the convenience commands are deferred).
- Incremental dirty-subtree layout (full relayout ships; incremental lands later behind a cross-checked debug flag).
- Per-node floating mobile menu (the action bar covers add/delete).

---

## 6. Toolchain

- **esbuild** (`esbuild.config.mjs`, sample-plugin pattern): entry `src/main.ts` → `main.js`; `format: cjs`, `target: es2018`, `bundle: true`; `external`: `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, node builtins. Dev: `sourcemap: inline` + watch. Prod: no sourcemap.
- **TypeScript strict** (`strict: true`, `noImplicitAny`, ES2018 lib + DOM).
- **Tests: `node:test` via `tsx`** — chosen over vitest as the leaner option (one dev dependency vs. a full framework; Node 18 on this machine cannot strip TS types natively). `npm test` = `tsx --test tests/*.test.ts`. Only Stage A's pure model is unit-tested; UI stages are verified by checklist in the test vault.
- Plain npm. **Runtime dependencies: none.** Dev dependencies: `obsidian`, `typescript`, `esbuild`, `tsx`, `@types/node`, `builtin-modules`.
- `manifest.json`: id `mindsidian-next`, name `Mindsidian Next (v2 prototype)`, version `2.0.0-alpha.1`, `minAppVersion: 1.7.2`, `isDesktopOnly: false`. `versions.json` maintained alongside.
- Scripts: `dev` (watch build), `build` (type-check + production build), `test`, `install:vault` (Stage D: copy `main.js`/`manifest.json`/`styles.css` to the `mindsidian-next` plugin folder in Claude_testing + `.hotreload` marker).
- Git: local repo in `/Users/christiansextl/Mindsidian-v2`; one logical change per commit (owner's revertibility rule).

---

## 7. Acceptance criteria per stage

**STAGE A — Core**
- `npm run build` and `npm test` both pass.
- T1–T6 golden fixtures roundtrip byte-identical (T6 per its documented exception); T7–T23 behave exactly as specified in the contract; T24 fuzz (500 trees) holds the idempotence fixed point.
- Purity test green: zero `obsidian`/DOM references in `src/model/`.
- Command/undo invariant tests green (undo restores deep-equal tree; history cap respected).
- **Gate: no Stage B work until T1 is byte-identical.**

**STAGE B — Layout + renderer**
- Compiles; layout unit tests (pure function, fake sizes) green.
- Dev harness in the test vault renders the Praxis-size fixture (~200 nodes, deep nesting) correctly: right/left/centered directions, branch colors, edges attached, tasks/highlights/wikilinks visible, collapsed nodes hidden.
- Pan/zoom buttery on desktop (single-matrix transform, no relayout during pan/zoom); wheel zoom stays anchored under the cursor.
- A 1000-node synthetic fixture opens in under ~1.5s (plain-text fast path + two-pass layout).
- **Demonstrably zero disk writes** (harness is read-only by construction).

**STAGE C — Interactions**
- Compiles; format-toggle and spatial-nav logic covered by unit tests where pure.
- In the test vault: full editing loop works — add/edit/delete/move/reparent/fold/undo/redo; every mutation produces a contract-conformant serialization (spot-check with the validate logic); arrow navigation never pans the viewport; Escape ladder correct.
- Multi-select (shift-click + marquee), group drag, copy/cut/paste round-trip through the clipboard format.
- `emulateMobile(true)`: tap select, double-tap edit, long-press drag-reparent with ghost + commit-to-last-shown, pinch zoom anchored at the fingers, action bar tracks the keyboard. Real-iPhone check is part of done for this stage.

**STAGE D — Obsidian integration**
- Compiles; `npm run install:vault` installs side-by-side with v0.5.47 (different plugin id) in Claude_testing; both plugins enabled simultaneously without interference.
- View swap works: opening a `mindmap-plugin` file lands in the v2 view (when v1 is disabled / on the toggle command); "Open as markdown" sticks per file; popout windows fully functional; two panes on one file stay consistent, only the focused one saves.
- Save guards verified by sabotage test: with a deliberately broken serializer build, edits produce a Notice and the file on disk stays byte-identical.
- Open-then-close-without-edit writes nothing (verified via file mtime); zoom write changes only the `mindmap-zoom` value.
- Shadow validation command runs across the test vault's fixture files and reports zero diffs on canonical files.
- Settings tab complete, grouped, with `schemaVersion`; all commands registered via the table; lint-clean against Obsidian review guidelines (no innerHTML with user strings, sentence case, no stored view refs, deferred-view checks).
