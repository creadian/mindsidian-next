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
