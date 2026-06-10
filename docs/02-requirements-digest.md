# Mindsidian v2 — Requirements Digest

Distilled 2026-06-10 from: the Technical Documentation (v0.5.47 state), the 2026-05-12 Improvement Ideas + Creative Crossings research sweep (8 + 4 sub-agent reports), and the external ChatGPT code review (`REVIEW_FINDINGS.md`, 2026-04-28, against a v0.5.1 snapshot).

**Prime directive (owner's own words and the project's hard rule): data safety — no markdown corruption or data loss — outranks every feature.**

---

## 1. KNOWN BUGS

### 1.1 Open as of v0.5.47 — design-level (v2 must solve these architecturally)

| # | Bug / risk | Symptom | Suspected / confirmed cause | Status |
|---|-----------|---------|------------------------------|--------|
| B1 | **Whole-document rewrite on save** | Any mindmap edit regenerates the entire file from the internal tree. Bare text becomes bullets, space indent becomes tabs, structure changes with settings, fold `^id`s can be appended. A small visual edit can rewrite non-mindmap markdown. | `getMarkdown()` serializes the whole tree; `normalizeBullets()` normalizes before parsing. The "assimilate everything, delete nothing" hardening (2026-04-04) prevents deletion but not rewriting. | **OPEN — the single biggest data-integrity risk.** External review rated it P1. v2's core architectural problem. |
| B2 | **Arrow-key navigation pans the viewport on every press** | Disorienting scroll even when target node is visible. Also a WCAG 2.1.1 keyboard-accessibility failure. | `INode.select()` → `containEl.focus()` triggers browser auto-scroll-into-view. `focus({preventScroll:true})` (v0.5.39) and scroll save/restore (v0.5.40) both failed; reverted v0.5.41. Scroll fires in a deferred callback outside synchronous reach. | **OPEN — accepted limitation** in v1 (Christian chose stability over risky fix). v2 should design selection so focus never auto-scrolls (e.g., focus a stable container, not the node). |
| B3 | **Large mindmaps slow to open; interaction lags** | Christian: "opening of a large mindmap is a bit slow." | Init render storm: one async `MarkdownRenderer` call per node fired in parallel, each forcing a layout flush (`refreshBox` reads offsetWidth) plus a 100ms timer per node; `getNodeById` is a full-tree DFS with no early return, called on **every mousemove**; every refresh rebuilds **all** SVG connectors from scratch. | **OPEN.** See §4 for the full performance inventory. |
| B4 | **Numbered-list roundtrip is lossy** | `1. item` → `- 1. item` on save. Real ordered lists become bullets. | Parser normalizes ordered items to bullets; serializer has no ordered branch. | **OPEN** (on the Pending list). Crossing #26 ("Numbered Checkboxes") proposes making one renderer parse `1. [ ] foo` and `- [x] bar` alike. |
| B5 | **Empty bullet → "Sub title" pollution** | A genuine empty bullet (`- ` alone, with an indented child below) gets the placeholder text "Sub title" written into the file. | `INode.parseText()` mutates empty node text to the placeholder. The chained-dash case (`- - X`) was fixed in v0.5.8; the genuine-empty-bullet case was explicitly left as a separate issue. | **OPEN.** |
| B6 | **~25ms lag adding sibling/child after committing an edit** | New-node creation feels a beat slower than it could. | A `setTimeout(0)` in `AddNode.execute` is load-bearing for ordering (placeholder auto-highlight). Removal attempts (v0.5.42/43) caused regressions; reverted v0.5.44. | **OPEN — accepted.** v2: design the add-node pipeline so select/edit ordering doesn't depend on timers. |

### 1.2 Open as of v0.5.47 — smaller / latent

- **Drag-tab-into-popout edge case:** listeners stay bound to the original window's document; fixed only by closing/reopening the file. (Known caveat since v0.5.5; a `layout-change` rebind was deferred.)
- **Task toggle pushes no undo step** (intentional v1 limit); promoting a task node to heading keeps the checkbox visually until reopen (cosmetic; disk is correct).
- **`tempDispLevel` module-level mutable global** — race waiting to happen with two mindmaps open (popouts are supported).
- **Mobile 250ms poller never sleeps** — battery cost, competes with main thread during pinch/scroll.
- **Mobile keyboard-bar magic constants (270 fallback, 413 shift, 2× multiplier)** are empirical, iPhone-portrait-specific, and duplicated in two places that must stay in sync. Fragile by admission.
- From the external review (against v0.5.1; re-verify which still apply, but all are plausible in current code):
  - P1: `_loaded` never set to `true` → the frontmatter auto-open monkey-patch may be effectively disabled.
  - P1: markdown→mindmap toggle calls `setMarkdownView()` where `setMindMapView()` is meant (works only indirectly via the monkey-patch).
  - P2: metadata-cache event handler reads files from disk before checking they match the view; `dblclick` listener removed as `dblClick` (cleanup never matches); dropping an external `.xmind` onto a node can crash (`_dragNode` undefined); `getFileCache()` null-deref during view init; embed-link HTML interpolates unescaped `src` into `innerHTML` (injection risk); settings handlers assume `v.mindmap.root` exists; `package.json` still says "obsidian-sample-plugin"; `main.js` gitignored but tracked; README stale.

### 1.3 Fixed in v1 — but only because of hard-won workarounds (v2 must not regress these)

- **Bare text lines silently deleted on save** (fixed 2026-04-04 — markmap-lib's `cleanNode()` dropped paragraphs; three-layer fix).
- **Content loss from `#tags`-at-line-start, space indentation, tab-indented orphans, horizontal rules** (fixed 2026-04-04, "assimilate everything, delete nothing").
- **`- - X` → "Sub title" file corruption** (v0.5.8 strip).
- **Rapid Enter/Tab dropped the second press** (v0.5.45 — `appFocusIn`'s 100ms setTimeout left a cached `isFocused` stale; fixed with a live `document.activeElement` fallback).
- **Cmd+W → 300% zoom state leak** (v0.5.0); **`^id` fold-marker pollution** (v0.5.0, now a 3-mode setting); **dual-mindmap zoom leak** (v0.5.4, per-view `wheel` listener); **popout windows: bare keys / selection API / double-click** (v0.5.5/6/46 — always resolve `document`/`window` via `ownerDocument`); **desktop zoom start-jump** (v0.5.10 — read CSS transform-origin, not the JS cache); **add-child-to-folded-branch lands at (0,0)** (v0.5.11/12 — auto-expand first); **the entire iOS pinch-zoom saga** (v0.3.0→v0.5.1: native scroll for pan; transform-origin anchored at the focal point, set once per gesture); **macOS scroll-momentum fight** (preventDefault + manual scrollBy); **mobile keyboard-bar tracking** (v0.5.12→v0.5.20, eight iterations).

---

## 2. OWNER WISHLIST (Christian's own asks, verbatim-faithful, prioritized)

### Tier 1 — strongest / most distinctive asks

1. **Partial mindmap region in a long note** (his most architecturally significant idea, conditioned entirely on safety):
   > "Is it possible to do it in a way so that only the text within a certain part of the note will be rendered as a mindmap, and the rest of the note will be untouched? I would like to be able to have a very long note with a lot of information and only the top part of it is in the format that will be rendered as a mind map. There would be a clear distinction, like a separating line or a separating header or whatever, to separate the mind map part from the general notes part. **I would only want to do this if there is no risk of data loss or corruption or anything like that.**"

   The prior research converged on two safe designs: a fenced ` ```mindmap ` block (which also enables `registerMarkdownCodeBlockProcessor` embedding) or a sentinel comment (`<!-- mindsidian-end -->`), with byte-exact suffix preservation, a diff-on-save corruption guard that refuses to write, and opt-in default-off. For v2 this should be a first-class design constraint, not a retrofit: **the plugin should only ever own/rewrite a delimited region.**

2. **Data-loss anxiety as a standing requirement.** Beyond the quote above, his recorded operating principle: he explicitly chose *"stability I can trust"* over fixes that "might cause downstream weirdness I can't debug myself" (Lesson #44; memory `feedback_prefer_workaround_over_risky_fix`). He is a non-coder; a regression two months later costs more than the original annoyance. v2 implication: round-trip golden tests, refuse-to-write guards, and minimal-diff saves are features *he asked for*, in effect.

3. **"opening of a large mindmap is a bit slow."** (Performance — see §4.)

### Tier 2 — explicit open asks

4. "changes for mindmap plugin: a bit more spacing between children of neighbor branches. maybe customizable?" (Layout constants are hardcoded: levelDis 40 / nodeDis 8 / firstLevelDis 80 / firstNodeDis 20. Wants extra gap at subtree boundaries, exposed as settings.)
5. "Improvement: the more indented the nodes, the smaller the font."
6. "I would like to change the 'Max level of node to create a heading' to 3. What will happen when I open an older note — will it automatically be updated to the setting 3?" (Answer documented: the setting only affects serialization on the next save; files rewrite silently on first edit. v2 should make this behavior explicit in the UI and/or offer a migration command.)
7. "mobile: when I select multiple nodes, the trash icon should remain there"
8. "mobile: should there be more icons: copy, paste, etc?"
9. Arrow keys shouldn't move the mindmap every time (from his Prios list; currently an accepted limitation — he still wants it).
10. Pending list: **triple-space → new child, triple-enter → new sibling** (also in his saved memory `project_mindsidian_next`; blocked in v1 because Enter means "end edit"); **numbered-list roundtrip fix**; **color scheme customization**.
11. From memory `project_mindsidian_next`: **mobile long-press drag-to-reparent** refinements.

### Tier 3 — already shipped in v1, so they are baseline expectations for v2

Wiki links (insert via fuzzy picker, v0.5.37 — inline `[[` autocomplete still missing), colored highlights (6-swatch palette, v0.5.38), task checkboxes (v0.5.36), fast rapid Enter/Tab (v0.5.45), per-file zoom persistence + default zoom (v0.5.7), fold-state persistence modes (v0.5.0), configurable node max width (v0.5.22), mobile bottom action bar with keyboard tracking (v0.5.12–21), shift-click multi-select + multi-ops (v0.5.47), checkCallback-scoped hotkeys, popout-window support, the iOS gesture suite.

---

## 3. COMPETITOR FEATURES WORTH STEALING (from the 14-tool survey)

Ranked by leverage for Christian; sizes/risks per the original report.

1. **Focus Mode** — dim everything outside the selected subtree (MindNode). Pure CSS overlay, zero data risk. The research's #1 fix for "finding stuff in big maps."
2. **Side-panel outline view**, scroll-synced with the map (MindNode/Mubu). Read-only first; textual index + Ctrl-F searchability.
3. **Slash command menu** in the node editor (Workflowy/Notion) — one mobile-friendly surface for `/link`, `/tag`, `/check`, `/color`, `/date`; unifies several wishlist items without bar bloat.
4. **Tag filter / dim-by-tag** (Workflowy, MindNode Tag Highlight) — `#tags` already round-trip; surface them as navigation. Render tags as colored chips (MindNode "visual tags").
5. **Zoom-into-subtree / Workflowy "zoom in"** — treat a node as temporary root with breadcrumb back; the core mobile navigation pattern for big trees.
6. **Boundaries & Summaries** (XMind, obsidian-markmind) — visual grouping + "these N siblings → one outcome" bracket. Biggest expressive gap; store in frontmatter, render-only.
7. **Mindmap fenced block inside a regular note** (markmap convention) — same feature as wishlist #1; competitors validate the ` ```mindmap ` encoding.
8. **Outline-mode toggle on the same content** (Mubu) — flip map ↔ indented list; outline mode is dramatically better on iPhone with keyboard up.
9. **Quick-add buttons next to the selected node** (Whimsical) — visible `+child` / `+sibling` affordances sidestep keystroke-timing races.
10. **Bring-your-own-key AI** ("expand node", "summarize branch") — Christian already pays for Anthropic; competitors lock this behind subscriptions.

**Deliberately rejected** (keep rejecting in v2): real-time collaboration, mirror nodes, loop branches, multiple roots, orbital layout, PDF annotation, sticker libraries, presentation mode, cloud AI without BYO key. Most break the tree-to-markdown round-trip invariant — the plugin's foundation.

---

## 4. PERFORMANCE + MOBILE-UX FINDINGS (condensed)

### Performance (v1 bottlenecks → v2 design rules)

Ranked findings from the profiling-oriented report:

1. **`getNodeById` = full-tree DFS on every mousemove**, no early return. ~30k node visits/sec at 500 nodes. → v2: maintain a `Map<id, node>` index from day one.
2. **Every refresh rebuilds all SVG connectors** (`svgDom.clear()` + re-create per edge) and re-runs `setDirect` (resets every node's `class` attribute even when unchanged). → v2: keyed/reused edge objects; only update what changed.
3. **Init render storm:** N parallel `MarkdownRenderer` calls, each followed by a forced reflow, plus N 100ms timers. → v2: plain-text fast path (skip the markdown pipeline for nodes without markdown syntax — likely the majority), batch all measurement reads into one pass, one completion promise instead of an event counter.
4. **Read/write interleaving in layout** forces a reflow per node. → v2: strict two-pass layout (read all, then write all).
5. **Arrow-key navigation does a full-tree DFS per keystroke** → use parent/children arrays, O(siblings).
6. **Full re-layout per drag pixel** → suppress refresh during drag, one refresh on drop.
7. Cheap wins: `content-visibility: auto` on nodes; pause the mobile poller when the view is hidden.
8. **Virtualization verdict:** hard (tree layout needs all node sizes; SVG edges are global). Not needed below ~1000 nodes if 1–4 are done. The recommended scaling path is **incremental/cached layout** (re-layout only the smallest dirty subtree); canvas-rendering or a layout library (react-flow/elkjs) only if 2000+ node maps become routine.

### Mobile UX (gaps vs. MindNode/Workflowy/Bear/Drafts)

Top three by leverage: **(1) chained capture** — Return commits + creates next sibling with keyboard staying up; Tab demotes (drops a 10-node capture from ~30 taps to ~10 keystrokes; needs `contenteditable="plaintext-only"` + intercepting Enter/Tab on the editable); **(2) swipe actions on nodes** (left = delete, right = indent/fold); **(3) focus mode / zoom-to-subtree**. Then: keyboard accessory bar above the iOS keyboard (home for Tab/Shift-Tab/wikilink/mic); **rich haptics policy** (try `Capacitor.Plugins.Haptics` — `navigator.vibrate` is ignored by iOS Safari); **voice dump via iOS system dictation** (not Web Speech API — unreliable on iOS); quick-capture "brainstorm mode" shell; bottom-sheet node detail panel; ≤200ms feedback animations; 18px SF Pro mobile typography; animated (not teleporting) recenter.

### Hard-won iOS/Electron knowledge v2 must carry forward (from the "iOS Touch Saga" + Lessons 1–47)

- Panning must be **native iOS scrolling** (`touch-action: pan-x pan-y`); custom JS panning can never compete (compositor vs. main thread).
- Pinch zoom: **anchor `transform-origin` at the focal point once per gesture**, adjust scroll once, then only change scale. Origin 0,0 + scroll compensation hits layout-bounded scroll limits at high zoom (CSS transforms don't change `scrollWidth`).
- iOS suppresses synthesized `dblclick` when non-passive touch listeners exist; Obsidian popouts also break native `dblclick` → **manual double-tap/double-click detectors are the default pattern** for any synthesized event.
- Popouts: always resolve `document`/`window` via `element.ownerDocument` — never globals.
- `touchstart.preventDefault()` kills the whole iOS click chain; preventDefault on `mousedown` instead.
- `visualViewport` resize events miss subsequent keyboard appearances → event listeners + polling safety net; iOS clips `position:fixed` below the visualViewport bottom; keyboard "chrome" eats ~3cm above the visible keys.
- Prefer `document.activeElement` (live DOM truth) over cached JS flags like `isFocused`/`editNode` — stale caches caused at least two shipped bugs.
- Hide the dragged node before `elementFromPoint` hit-testing; show the user what they're dragging.
- Cmd+R doesn't reload plugin code — full Obsidian restart to test.
- Debugging mobile: screen recording → Gemini description, or structured questions ("stuttery / delayed / snapping / artifacts?").

---

## 5. PRIOR ARCHITECTURE CRITIQUE (what v2's structure must avoid)

From the dedicated architecture review of v1 (~v0.5.24 source):

1. **`mindmap.ts` is a 2,955-line god class** mixing keyboard, mouse, touch, drag math, zoom math, layout glue, history glue, markdown serialization, clipboard, and xmind import. Every v0.5.x fix touched this one file. Proposed (and validated) decomposition: slim orchestrator + `KeyboardController`, `PointerController`, `DragController`, `ZoomController`, `ViewportController`, `MarkdownExporter`, `NodeFormatter`, `DisplayLevel`. **v2 should be born in this shape.**
2. **~800 lines of commented-out dead code** (654 in mindmap.ts, 128 in main.ts) — the single biggest "is this alive?" reading cost. v2 rule: delete, never comment out.
3. **`main.ts` = 1,567 lines, 50 near-identical `checkCallback` blocks.** One `mindmapCommand()` helper makes every command a one-liner.
4. **Type safety abandoned at the core:** `INode.data: any` (the central data structure is untyped), `: any` across Cmds/Execute/Layout; 252 `var` declarations with hoisting collisions; TS 4.2; no `strict`/`strictNullChecks`; `sourcemap: false` (debugging the bundle is blind). v2: strict TypeScript, typed `INodeData`, sourcemaps on.
5. **Circular imports** (`uuid` lives in `MindMapView.ts` and is imported by three mindmap/ files); 25 `bind(this)` constructor lines (use arrow-field handlers); module-global `tempDispLevel`.
6. **Drag logic duplicated** across mouse handlers and touch handlers — every drag bug must be fixed twice.
7. **Three independent implementations of formatting-marker toggling** (`**`/`==`/`~~` substring math) — classic "ate my character" factory. One tested `toggleMarker()` module.
8. **`setTimeout` sprinkled everywhere** (0/100/200ms), several load-bearing for ordering (the AddNode select/edit defer; the init wait). v2: explicit promises/rAF, no timing-based correctness.
9. **No tests.** Highest-ROI starter suite: **markdown round-trip golden tests** (parse → serialize → byte-compare), then `getMarkdown` snapshots, formatter toggles, undo/redo stack invariants, arrow-navigation tree math. Vitest with a stubbed `obsidian` module. Given §1 B1, round-trip tests are the #1 safety net for v2.
10. **Settings:** flat 15+ field bag, no grouping, no `schemaVersion`/migration hook. v2: grouped settings + schema version from day one.
11. **Save path:** uses whole-file regeneration (see B1); the modern API is `vault.process()` (atomic), with the documented gotcha that it no-ops while a `requestSave` debounce is pending on the same file — a suspected contributor to historical edit races. v2: one save funnel, atomic, region-scoped.
12. Strategic Obsidian-API gaps to claim in v2: hover-preview (`registerHoverLinkSource` — scaffolding existed but commented out), `AbstractInputSuggest` for inline `[[` autocomplete, resolved/unresolved link styling via `metadataCache`, `registerMarkdownCodeBlockProcessor` (the partial-mindmap path), view-header actions, vault `rename`/`delete` events, and (strategic, later) a Bases custom view ("visual Bases" — no plugin ships this). Upstream fork source (MarkMindCkm) is dormant — no need to track it.

---

## Cross-cutting synthesis for v2 (from the research's own conclusions)

- **"Find stuff in big maps" is the biggest UX gap** (focus mode + outline panel + tag dim + non-panning arrow nav + content-visibility).
- **Node text should be first-class links, not strings** — wikilink render/click/hover/autocomplete is the move that makes Mindsidian graph-native rather than "an outliner with colors."
- **Feature collapse beats feature addition** (Creative Crossings meta-pattern): density dial (one slider for spacing/font-depth/chips/visibility), slash menu as the single power-feature surface, mindmap-as-projection (the fenced-region model) rather than mindmap-as-file.
- **AI layers on, never invades:** read-only critique panel first (zero write-back risk), then voice-to-tree capture (add-only, preview-before-insert), then vault-aware link suggestions (local embeddings, ~zero cost). Explicit don't-build list: AI chat sidebar, AI auto-layout, AI tags everywhere.
- **Perceived latency is one budget** ("the 16ms mindmap"), not a checklist.
