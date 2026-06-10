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
