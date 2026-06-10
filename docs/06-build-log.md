# Mindsidian v2 — Build Log

Append-only record of build stages, deviations from the spec, and notes for later stages.

## Stage A-core — 2026-06-10

**Built:** `src/model/{types,region,parse,serialize,tree,commands,format}.ts` + test suites
`tests/{roundtrip,fuzz,commands,format,purity}.test.ts` and fixture copies in `tests/fixtures/`
(byte copies of the Praxis canary file and all test-vault root files — originals untouched).

**Acceptance:** `npm run build` clean, `npm test` 56/56 green. T1 (Praxis canary) byte-identical;
T2–T5 and `v0_5_8 strip test.md` byte-identical; T6 files byte-identical (frontmatter with blank
lines preserved verbatim); T24 fuzz holds the fixed point for 500 random trees (3 passes checked).

**Deviations / interpretations (all preservation-strengthening, none lossy):**

1. **F4 separator:** the prefix (frontmatter + preamble) is kept byte-verbatim including the
   original separator before the first H1, instead of forcing `frontmatter + "\n\n"`. Stronger
   than the contract's minimum; the `"\n\n"` layout applies only to newly created frontmatter
   (`DEFAULT_FRONTMATTER` in region.ts).
2. **Empty collapsed node:** a fold marker cannot ride on a bare `-` line without becoming text,
   so it is not emitted for empty-text nodes (contract §5 lists no marker there). Text-lossless;
   only the fold bit of an empty node is dropped.
3. **Heading text with embedded newlines** (only producible by future edit commands, never by
   parsing) is flattened to spaces at serialize time. Stage C's edit layer must prevent newlines
   in heading-depth nodes.
4. **Recommendation for the Stage D refuse-to-corrupt guard:** compare via serialize-idempotence
   (`serialize(parse(s)) === s`) rather than deep tree equality — robust against the documented
   one-way normalizations (2) and (3).
5. **T8/T11-style contract inputs** were written in canonical spacing (blank line before H2,
   bullets nested under an H2) since depth-1 nodes serialize as headings, which by contract §1.5
   never carry task prefixes.
6. **T22 (zoom)** is implemented as the pure helper `updateZoomInPrefix()` and tested at byte
   level. Stage D may route through Obsidian's `processFrontMatter`, but must match these bytes.
7. **T23 (plugin-data mode):** pure helpers `collectCollapsedPaths`/`applyCollapsedPaths` live in
   tree.ts. Switching plugin-data → markdown re-emits markers with fresh session ids (ids are not
   stable across modes; contract E19 allows this — text is lossless).
8. **Fence parsing:** a fence directly following an empty bullet folds into that bullet (the
   canonical emitter shape, so the roundtrip is one node); a raw fence elsewhere becomes its own
   node — never dropped. Fence bytes are never trimmed (E10 fix), dedent is exactly
   `indent + two spaces` and symmetric with the emitter.
9. **Known one-way inputs (same in v0.5.47, documented, idempotent after one pass):** node text
   beginning with `"- "` re-parses as a chained bullet; an empty root title serializes to `# `
   which does not re-parse as a heading. The fuzz pool excludes both; Stage C should prevent
   empty root titles.

**For the next stage (B):** import only from `src/model/`; the parse entry point is
`parseDocument(text, basename)` and the save path is `serializeDocument(doc, settings)`.
`MindDocument.synthesizedRoot === true` means "do not write to disk until the user edits" (T7/E12).

## Stage B-render — 2026-06-10

**Built:** `src/view/layout.ts` (pure layout: right/left/centered, fold-aware, branch indices,
bounds, `edgeAnchors` helper), `src/view/render.ts` (`MindmapRenderer`: keyed node DOM lifecycle,
plain-text fast path, injected async markdown renderer, two-pass measure→layout→position,
ResizeObserver re-measure, rAF-batched re-render), `src/view/edges.ts` (`EdgeLayer`: one SVG,
keyed paths, branch-colored beziers), `src/view/viewport.ts` (`Viewport`: sole transform writer,
wheel pan + Ctrl/Cmd-wheel cursor-anchored zoom, touch pinch with focal point computed once per
gesture, 20–300% clamp, animated recenter/fit), `src/view/devharness.ts` (read-only ItemView
shell — deleted in Stage D), full `styles.css` (theme variables only), `tests/layout.test.ts`
(15 tests incl. 1000-node perf budget + layout purity grep). `src/main.ts` now registers only
the dev-harness view + command (placeholder hello command removed).

**Acceptance:** `npm run build` clean; `npm test` 71/71 green (Stage A's 56 + 15 layout tests).
Renderer/viewport/edges verified by typecheck + build per design §6 ("only Stage A's pure model
is unit-tested; UI stages are verified by checklist in the test vault").

**Deviations / interpretations:**

1. **render.ts stays obsidian-free:** the markdown renderer is injected
   (`MarkdownRenderFn`) instead of importing `MarkdownRenderer` directly; the dev harness /
   Stage D view pass `MarkdownRenderer.render`. Strengthens testability, changes no behavior.
2. **Ready state:** `MindmapRenderer.render()` awaits its own `Promise.all` of pending markdown
   renders and resolves when positions are written — no separate `whenReady` surface needed.
3. **Viewport listeners** use plain `addEventListener` with a `destroy()`; Stage D must route
   registration through `registerDomEvent` (and `ownerDocument` for popouts) when the real
   view owns the lifecycle. Mouse drag-pan is deliberately absent (Stage C pointer.ts).
4. **Inverse-scaled fold tap target** is CSS `calc(-12px / var(--mm-scale))`; viewport.ts writes
   `--mm-scale` on the world element alongside the transform (single writer preserved).
5. **Default branch palette** is a 10-color list in render.ts, not v1's 20-color curated array;
   the Stage D settings (strokeArray) override it per user.
6. **`data-depth` is capped at 6** for CSS purposes; layout depth itself is unlimited.
7. **Detached/zero-size measurements** (`offsetWidth === 0`) are treated as "unknown" and fall
   back to a default box in layout, so a hidden container never collapses the map to (0,0).

**For the next stage (C):** `MindmapRenderer.getElement(id)/getSize(id)/getLayout()` exist for
hit-testing and centering; `Viewport.screenToWorld()` is the marquee/world-coordinate source of
truth; node state classes already styled: `is-selected`, `is-multi-selected`, `is-editing`,
`is-drop-target`, `is-dragging`, plus `.mm-marquee` and the focus-mode/dim hooks. The fold dot
(`.mm-fold-dot`) and task box (`.mm-task`) render but have no handlers yet. Re-render after any
tree mutation = `await renderer.render(root)` (full relayout by design).

## Stage C-interact — 2026-06-10

**Built:** `src/view/controller.ts` (the per-view state object from design §2: tree ctx + history +
selection + editor + renderer + viewport meet here; every user action is one controller method →
one undoable command → re-render → onTreeChanged), `src/view/selection.ts` (single/multi state +
prune-to-top-ancestors, root never multi-selectable), `src/view/edit.ts` (contenteditable
plaintext-only inline editor, synchronous begin/commit, IME composition guard, range-aware format
toggles, CSS-only empty placeholder — never saved, B5), `src/view/clipboard.ts` (pure v1-format
codec: copyNode/copyNodes), `src/input/pointer.ts` (Pointer Events only — one path for mouse/touch/
pen: tap/shift-click select, manual double-click/double-tap detectors, mouse-drag + long-press
ghost drag-to-reparent with drop highlight/arrow/edge auto-pan and commit-to-LAST-SHOWN target,
empty-space pan, hold-still-1s marquee in world coords, fold-dot + task taps, wikilink clicks,
backs off when a second touch lands so viewport.ts pinches), `src/input/keyboard.ts` (one keydown
listener on the container; Enter/Tab/Shift-Tab, delete, Escape ladder, undo/redo, zoom, fold +
displayed-level keys, Alt+Shift move keys, clipboard, format), `src/input/navigate.ts` (pure
spatial arrow navigation — never pans the viewport, B2), `src/ui/palette.ts` (v1's 6 swatches + ×),
`src/ui/mobileBar.ts`, `src/ui/wikilink.ts` (picker interface stub for Stage D + pure helpers).
Renderer gained `getContentElement()` + `invalidateNode()` (editor clobbers node DOM in place).
Dev harness now hosts the full interaction stack — still read-only: every mutation runs an
in-memory serialize→reparse→serialize fixed-point spot-check and only logs.
Tests: `tests/{navigate,clipboard,selection}.test.ts` (19 new; 90 total).

**Acceptance:** `npm run build` clean; `npm test` → tests 90 / pass 90 / fail 0.

**Deviations / interpretations:**

1. **`src/view/controller.ts` added** (not in the §1 file table): design §2 mandates "one per-view
   state object" — this is it. pointer/keyboard/ui modules stay thin and DOM-only.
2. **Spatial nav extracted to `src/input/navigate.ts`** so it is pure and unit-testable
   (acceptance: "spatial-nav logic covered by unit tests where pure").
3. **Edit commit flattens newlines to spaces** in every node. Covers Stage A's rule (no newlines
   in heading nodes) with one safe policy; multi-line node *creation* via the editor is out, the
   add/remove `<br>` commands were already DEFERRED. Multi-line nodes from disk still roundtrip.
4. **Empty root title prevented at commit** (Stage A known one-way input): an emptied root keeps
   its previous title.
5. **Tab while editing commits only** (v1 parity); **Shift+Tab = promote/outdent** (new, no v1
   equivalent). In-view hotkeys are plain Mod+B/I/H, Mod+Z/Y, Mod+C/X/V etc.; the Alt+Shift v1
   bindings arrive with the Stage D command table (clipboard already answers both).
6. **Clipboard:** v2 writes an extra optional `taskState` per entry (v1 ignores it; v1 payloads
   decode fine without it — task state is lost there exactly as in v1). After paste the clipboard
   is re-written with a fresh-id payload so paste repeats (v1 cleared it to "").
7. **Drop kinds simplified to before/after/child** via vertical thirds of the target box (v1 had
   quadrant + direction variants). The shown target is sticky over empty space so the commit
   always matches the last indicator the user saw.
8. **Mobile bar keyboard tracking** uses visualViewport resize/scroll events (no 250 ms poller,
   no 270/413/×2 constants); events are naturally silent while the view is hidden.
9. **Join-with-below / join-as-citation moved to DEFERRED** (spec §5 allowed this explicitly).
10. **Listeners** are plain addEventListener with `destroy()` (same as Stage B); Stage D must
    route them through `registerDomEvent` and re-resolve `ownerDocument` for popouts.

**For the next stage (D):** construct per file-open: `MindmapRenderer` + `Viewport` +
`MindmapController` (callbacks: onTreeChanged→requestSave, notify→Notice, openLink→openLinkText) +
`PointerController` + `KeyboardController` + `HighlightPalette` (+ `MobileActionBar` when
Platform.isMobile) — copy the wiring in devharness.ts before deleting it. `getViewData()` =
`prefix + serializeBody(root) + suffix` with the refuse-to-corrupt guard (use serialize-idempotence
per Stage A note; the harness's spotCheckSerialization shows the exact check).
`controller.hasEdits` gates synthesized-root first writes (T7/E12). Wire `src/ui/wikilink.ts`'s
`WikilinkPicker` with a FuzzySuggestModal. Mod-key zoom/fold hotkeys may collide with Obsidian
defaults — resolve in the Stage D command table review.

## Stage D — Obsidian integration

Built: `src/view/MindmapView.ts` (TextFileView, save lifecycle + refuse-to-corrupt guard),
`src/main.ts` (rewritten: view registration, Kanban-pattern swap via active-leaf-change +
file-open, per-path mode memory, file/folder menus, ribbon, fold-path store),
`src/commands.ts` (data-table command registration), `src/settings.ts` + `src/settingsTab.ts`
(schemaVersion 1, frozen per-view snapshots), `src/validate.ts` (read-only shadow validation),
`src/ui/wikilinkModal.ts` (FuzzySuggestModal picker), `scripts/install-vault.mjs`
(`npm run install:vault`), Stage D styles appended. `src/view/devharness.ts` deleted.
`src/model/region.ts` gained the pure `readZoomFromPrefix()` helper.

Deviations from the design spec (all recorded, none weaken data safety):

- **Refuse-to-corrupt guard uses serialize-idempotence** (`serialize(parse(s)) === s`),
  not deep tree equality — per the Stage A handoff (expanded nodes get fresh random ids,
  so deep equality would false-alarm). On failure: Notice + last-known-good bytes returned.
- **Listeners keep the Stage C `attach()`/`destroy()` pattern** instead of a full
  `registerDomEvent` refactor; teardown is guaranteed via `clear()`/`onClose()`. All
  listeners sit on elements inside the view's own container (popout-safe via
  `ownerDocument` where created). Only the new Stage D hover-preview listener uses
  `registerDomEvent`. Full migration deferred as a refactor-only task.
- **`getState`/`setState` not overridden** — the base FileView state (file path) is all
  that must persist; everything else is intentionally ephemeral per-view state.
- **No default hotkeys registered** — in-view editing keys live in `src/input/keyboard.ts`;
  command-palette commands ship unbound so nothing collides with Obsidian defaults
  (review of Mod-key zoom/fold bindings was the Stage C handoff concern; resolution: unbound).
- **Zoom write goes through `processFrontMatter`** on `onUnloadFile`, after the base
  class flushes any pending save; written only when the rounded % differs from the
  value at load, and never for an untouched synthesized-root file (E12/T7).
- **Save scheduling is diff-gated**: `onTreeChanged` serializes and calls `requestSave()`
  only when the bytes differ from the last on-disk text — fold toggles in
  `plugin-data`/`none` mode never touch the file; undoing back to the original is a no-op.
- **Synthesized-root first save**: `getViewData` upgrades `doc.prefix` from `""` to the
  default frontmatter exactly once, when the first real edit is saved (T7; Stage A emits
  body only).
- **`focusOnMove` wiring**: centers on the primary selection after *any* committed
  mutation (not only move commands) — simplest faithful reading; default off.
- **`.hotreload` marker NOT created** in the test vault — the orchestrator instruction
  ("copy ONLY manifest.json, main.js, styles.css") overrides the design's hot-reload note.
- **Mobile bar sizing** implemented as a CSS scale factor (`--mm-bar-scale`), set per
  view from settings.

Install: `manifest.json`, `main.js`, `styles.css` copied to
`Claude_testing/.obsidian/plugins/mindsidian-next/`; plugin NOT enabled in
`community-plugins.json` (owner enables manually, side-by-side with v0.5.47).

Acceptance: `npm run build` clean; `npm test` → 90/90 pass; three files present in the
test vault plugin folder.
