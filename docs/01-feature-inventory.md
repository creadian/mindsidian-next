# Mindsidian v0.5.47 — Feature Inventory & Architecture Assessment

Source analyzed: `/Users/christiansextl/Obsidian/Claude_testing/.obsidian/plugins/mindsidian/src` (read-only reference).
Purpose: parity checklist + architecture lessons for the v2 rewrite. Anything missing here becomes a silently lost feature.

---

## 1. COMPLETE Feature Inventory (parity checklist)

### 1.1 Commands (command palette; ✋ = no default hotkey, bind manually)

| Command | Default hotkey(s) | Behavior notes |
|---|---|---|
| Create new mindmap | — | Creates `Untitled mindmap.md` with `mindmap-plugin: basic` frontmatter in the "new file" folder, opens as mindmap view (100ms delayed setViewState) |
| Toggle markdown/mindmap | — | Flips active leaf between MarkdownView and MindMapView; tracks per-leaf mode in `mindmapFileModes` |
| Set to mindmap mode | — | Markdown → mindmap for active leaf |
| Set to markdown mode | — | Mindmap → markdown for active leaf |
| Copy node(s) | Alt+Shift+C | Single: JSON `{type:'copyNode', text:[flat id/pid list]}` to clipboard. Multi-select: `{type:'copyNodes', subtrees:[…]}` pruned to top ancestors |
| Cut node(s) | Alt+Shift+X | Copy + delete (multi: prune-to-top-ancestors, root/editing nodes excluded) |
| Paste node(s) | Alt+Shift+V | Reads clipboard JSON; pastes subtree(s) as children of selected node; auto-expands folded target; re-writes clipboard so paste can repeat |
| Undo | Cmd/Ctrl+Z, Alt+Shift+Z | Command-pattern history, 50-step limit, per-mindmap instance |
| Redo | Cmd/Ctrl+Shift+Z, Cmd/Ctrl+Y, Alt+Shift+Y | |
| Replace by the previous text | — ✋ | Restores node's `oldText` |
| Edit node | Shift+F2 | Enter edit mode on selected node |
| Add sibling / End editing | Alt+Shift+Enter (fallback; plain **Enter** handled in internal keydown) | If editing: commit. Else: add sibling below current node (new node is moved below via `moveNode(…, 'down', false)` — not in history) |
| Insert child | Shift+Insert (fallback; plain **Tab** handled internally) | Auto-expands folded parent first |
| Delete node & child | Shift+Delete (fallback; plain **Delete/Backspace** handled internally) | Multi-delete supported (pruned to top ancestors) |
| Select the node's text | — ✋ | Enters edit + selects all text |
| Bold the node's text | Alt+Shift+B | Whole node or selected substring while editing; toggles `**`/`__` with prefix-stack awareness (bold-inside-italic etc.) |
| Italicize the node's text | Alt+Shift+I | Toggles `_…_` (deliberately `_` not `*` so bold+italic compose) |
| Highlight the node's text | Alt+Shift+H | Toggles `==…==` |
| Strike through the node's text | — ✋ | Toggles `~~…~~` |
| Add tabulation | Alt+Shift+T | Inserts 4 spaces (as nbsp) at cursor |
| Add line break (`<br>`) | Alt+Ctrl+Shift+L | Inserts `<br>` at cursor/selection |
| Remove line breaks (`<br>`) | Alt+Shift+L | Replaces first `<br>` in node text with space (via history command) |
| Cancel edit | — ✋ (Escape handled internally) | Exits edit, then `undo()` to revert the text change |
| Expand one level | Alt+Down | `setDisplayedLevel(selected.level+1)` |
| Expand one level from max displayed level | Alt+PageDown | Children-scoped expand |
| Collapse one level | Alt+Up | `setDisplayedLevel(selected.level-1)`, selects parent |
| Collapse one level from max displayed level | Alt+PageUp | Won't hide the currently selected node |
| Toggle expand/collapse node | Cmd/Ctrl+Shift+Space | Via history command (collapse/expand are undoable) |
| Toggle fold node | Cmd/Ctrl+. | Same toggle, non-root, not while editing |
| Fold all branches | Cmd/Ctrl+Shift+- | `setDisplayedLevel(1)` + Notice |
| Unfold all branches | Cmd/Ctrl+Shift+= | `setDisplayedLevel(99)` + Notice |
| Move the current node above | Alt+Shift+Up | Reorders among siblings (wraps around); optional re-center (`focusOnMove` setting) |
| Move the current node below | Alt+Shift+Down | Same, downward |
| Move the current node left | Alt+Shift+Left | Side-aware: promotes to parent level or demotes under previous sibling depending on which side of root the node sits |
| Move the current node right | Alt+Shift+Right | Mirror of above |
| Move next siblings as children | Alt+Shift+D | All following siblings become children of current node |
| Move all siblings as children | Alt+Ctrl+Shift+D | All siblings become children |
| Join with the node below | Alt+Shift+J | Merges next sibling's text into current (`<br>` separator); strips leading emoji, `[🔗](…pdf)` links, `(p. N)` page refs; joined node's children are copy-pasted under current; joined node deleted |
| Join as citation with the node below | Alt+Shift+Ctrl+J | Same but separator is ` (…)<br>` |
| Center mindmap view on the current node | Alt+E | Scrolls so selected node is centered |
| Center mindmap view | — ✋ (Alt+Shift+E intended) | Re-centers on root |
| Zoom in | Alt+= , Cmd/Ctrl+= | +10%, anchored at viewport center |
| Zoom out | Alt+- , Cmd/Ctrl+- | -10% |
| Reset zoom to 100% | Cmd/Ctrl+0 | Anchors at viewport center |
| Display the node's info in console | — ✋ | Debug: index, position, dimensions, canvas/scroll info |
| Export to html | — ✋ | dom-to-image PNG wrapped in `<img>` written next to file (`.html`) |
| Export to PNG / JPEG (LQ / default / HQ) | — ✋ ×6 | dom-to-image at scale 1/2/4; temporarily repositions root + resizes canvas to bounding box, writes binary `<file>.png/.jpeg` next to md, restores view |
| Open highlight palette | — ✋ | Floating swatch palette next to node; multi-select variant anchors at top-leftmost node, applies to all selected |
| Insert internal link | — ✋ | Fuzzy file picker (all vault md files, matches basename+path); inserts `[[basename]]` at cursor (preserves in-flight edit selection via saved Range) or appends in fresh edit mode |
| Toggle task state | — ✋ | Cycles none → todo → done → none. Bullet nodes only (level ≥ headLevel); headings get a Notice |

### 1.2 Internal keyboard handling (document-level keydown/keyup per mindmap)

- **Enter** — add sibling (or commit edit). **Tab** — add child (or commit edit). Handled in mindmap's own keydown to avoid stealing keys in markdown mode.
- **Delete / Backspace** — delete node+children (single or multi-selection); pass-through while editing.
- **Escape** — cancel marquee mode → clear multi-select → cancel edit (+undo of the text change).
- **Arrow keys** (keyup) — spatial navigation: nearest node by distance, same level, same side of root; up/down climb to parent when at first/last sibling (with max-distance guard); left/right walk toward/away from root and auto-expand.
- **Home** — select root + center. **Ctrl+Home** — same.
- Focus guard: `isFocused` flag from focusin/focusout with 100ms grace, plus a live `document.activeElement` fallback (fixes dropped rapid second Enter/Tab) and a `<body>`+multi-selection fallback (Delete after marquee).
- IME composition tracked via compositionstart/end (`isComposing`).

### 1.3 Mouse interactions (desktop)

- **Click node** — select (focus containEl, set draggable). Plain click with multi-selection active collapses to single select (Canvas convention).
- **Shift+click node** — toggle in multi-selection; seeds from current single-select (A selected, shift-click B ⇒ {A,B}).
- **Manual double-click detector** (500ms, same node) — enter edit. Kept alongside native dblclick because native is unreliable in popout windows.
- **Click fold dot (`.mm-node-bar`)** — toggle collapse/expand (undoable).
- **Click internal-link `<a>`** — opens note via `workspace.openLinkText` (Ctrl/Cmd = new pane). **Hover internal link** — triggers Obsidian `hover-link` page preview.
- **Click empty space** — end edit + clear selection.
- **Drag empty space** — pan (manual scrollLeft/Top).
- **Hold still 1s on empty space** (timer says 2s in comments, code is 1000ms) — **marquee multi-select mode**: crosshair cursor, rectangle drawn in canvas coords (inverse-transform via getComputedStyle transform-origin — NOT the cached scalePointer), live add/remove of intersected nodes, suppresses the trailing click that would wipe the selection.
- **HTML5 drag & drop node** — drop-target highlight (nearest candidate within 24px, cycle-safe), arrow indicator showing drop type (top/down/left/right/child-*) computed from quadrant + node's layout direction; Ctrl+drop = copy instead of move; dragging a multi-selected node = **group drag** (single history step, order-preserving).
- **Drop `.xmind` file from Finder** — XMind Zen import (jszip → content.json → tree), replaces current map content.
- **Wheel** — manual scroll takeover (kills macOS inertia direction-lag). **Ctrl/Cmd+wheel** — zoom with accumulator/threshold smoothing, direction-change reset, anchored at cursor (`_anchorScaleAt`).

### 1.4 Touch interactions (mobile)

- **Native 1-finger pan** (touch-action: pan-x pan-y; appEl overflow visible on mobile to avoid rubber-band).
- **Tap node** — select + show floating add/delete menu (`_menuDom`, positioned right of node, inverse-scaled to stay constant size).
- **Manual double-tap detector** (350ms, same node) — edit.
- **Long-press 500ms on node** — **drag-to-reparent**: haptic vibrate, ghost follows finger with leftward(55px)/up(15px) visual offset (hit-test at ghost position, not finger), drop highlight + arrow indicator, edge auto-pan (48px edges, 110px bottom for action bar), scroll-compensated ghost translate, commit on touchend to the *last shown* target (`_currentDropNode`), group drag if node is in multi-selection, full state cleanup on touchcancel.
- **Hold still 1s on empty space** — marquee multi-select (takes over from native pan; vibrate 15ms).
- **2-finger pinch** — zoom 20–300%; transform-origin anchored to finger midpoint at gesture start (focal point stays under fingers without scroll math); commit via `scale()` on touchend.
- **Mobile bottom action bar** (Platform.isMobile, per view): +sibling (↩, hidden on root), +child (→), undo, redo, trash (hidden on root), highlight palette, recenter (⌖). Keyboard-aware positioning via visualViewport + measured safe-area-inset + empirical iOS offsets (270px keyboard fallback, ×2 multiplier, 413px shift); 250ms poller re-applies position & visibility; mousedown preventDefault (NOT touchstart — iOS click synthesis); add-node flow: commit edit → expand folded parent → execute → select → scroll-into-safe-zone → edit synchronously in same gesture → re-scroll at 350ms.
- **Tap task checkbox** — binary todo↔done toggle (never removes task; propagation stopped).

### 1.5 Context menus & view chrome

- **Folder context menu**: "New mindmap board".
- **File menu (markdown mode, file has `mindmap-plugin` frontmatter)**: "Open as mindmap board".
- **Mindmap pane menu (⋮)**: "Open as markdown".
- **Desktop floating recenter button** (`.mm-recenter-btn`) in view corner.
- **Per-node floating menu** (mobile): add-child icon, delete icon.

### 1.6 View switching / persistence / multi-pane

- **Frontmatter-driven auto-conversion**: monkey-patch on `WorkspaceLeaf.setViewState` — any markdown view opening a file with `mindmap-plugin` frontmatter is forced to mindmap view, unless the per-leaf mode map says markdown. `leaf.detach` patch cleans the mode map. Gated by `_loaded` flag.
- **`mindmapFileModes`** keyed by leaf-id-or-path: remembers per-leaf md/mindmap choice while file is open.
- **Zoom persistence per file**: `mindmap-zoom` frontmatter key, written on view close/unload via `processFrontMatter` (clamped 20–300, rounded); read at open; `defaultZoom` setting as fallback.
- **Fold persistence, 3 modes** (`foldStatePersistence` setting):
  - `markdown` (default): collapsed nodes get ` ^<id>` block-ref markers appended in the saved markdown; nodes parsed with an `^id` start collapsed.
  - `plugin-data`: collapsed-node **text-paths** ("Root > A > B") saved per file path in plugin data; applied to parsed tree before init; markdown stays clean.
  - `none`: no persistence.
- **External edit sync**: `metadataCache.on('changed')` → each mindmap view re-reads file from disk and rebuilds if content differs (`onQuickPreview` path). Multi-pane note: ALL mindmap leaves are notified; each view filters to its own file.
- **Save path**: any model change → `mindMapChange` event → `view.getMarkdown()` regenerated → `this.data = yamlString + md` → `requestSave()` (Obsidian-debounced). Frontmatter preserved byte-for-byte from cached offsets.
- **Popout-window support**: all selection/focus/event code resolves `ownerDocument`/`defaultView` instead of globals.

### 1.7 Markdown round-trip (data safety core)

- **Parse (md → tree)**: strip frontmatter (regex) → `normalizeBullets()` → markmap Transformer → tree.
  `normalizeBullets` guarantees **no content is silently dropped**: bare text/#tags/HRs become bullets; orphaned over-indentation clamped to maxIndent+1; spaces-as-indent auto-detected (smallest space run); tabs normalized; chained `- - x` collapsed; code fences and blockquotes passed through; heading detection requires `# `+space (so `#tag` isn't a heading).
- **Blockquote nodes**: transform unwraps `blockquote` and prefixes text with `> `.
- **`^id` suffix** parsed off node text → node id + collapsed.
- **Task syntax**: leading `[ ] `/`[x] ` on bullets → `taskState` flag, stripped from display text; re-emitted on save (first line only for multi-line nodes); typing `[ ] foo` in edit mode promotes to task.
- **Serialize (tree → md)**: levels < headLevel become `#`-headings (level+1 hashes); deeper levels become tab-indented `- ` bullets; multi-line node text → one bullet per line (or fenced code block emitted with 2-space continuation); empty node → bare `-`; fold ids appended per persistence mode; root not double-emitted; output trimmed; frontmatter re-prepended by the view.
- **Empty node text** → placeholder "Sub title".

### 1.8 Node rendering features

- Markdown rendered per node via `MarkdownRenderer.renderMarkdown` (full Obsidian md: links, tags, code, MathJax).
- **Internal embeds `![[note]]`** rendered as real embeds (with subpath/heading/block resolution + open-link icon); **image embeds** `![[img.png]]` resolved via `vault.getResourcePath`; image onload/onerror triggers re-measure + relayout; code/MathJax get a delayed re-measure (100ms).
- **Highlight wrap**: `<mark style="background:#hex;">…</mark>` whole-node wrap; tolerant regex; re-color replaces, × strips. 6-color palette (HighlightPalette.ts).
- **Task checkbox** injected inside first rendered block element.
- Node max-width via CSS var `--mm-node-max-width` (desktop/mobile settings).
- Branch colors: optional user `strokeArray` then 20-color curated palette repeated ×3 (60 branches); root cubic-bezier edges thicker; child edges = bezier + underline segment; fold dot colored to branch.
- Selected (`mm-node-select`), editing (`mm-edit-node`), multi-selected (`mm-node-multi-select`), drop-target (`mm-node-drop-target`), dragging (`mm-node-dragging`), collapsed (`mm-node-collapse`), leaf/second-level/direction classes.
- Fold-dot tap target inverse-scaled with zoom (CSS vars `--dot-tap-size/offset`).

### 1.9 Settings (settingTab.ts; most apply live to all open mindmap leaves)

1. Canvas size (4000–36000; live: re-center root + refresh)
2. Canvas background (color string)
3. Max heading level (`headLevel` 0–6 — node level at which headings become bullets)
4. Font size (live re-measure + relayout)
5. Layout direction: Centered ('mind map') / Right / Left / Clockwise
6. Stroke array (comma-separated branch colors)
7. Focus on move (re-center on node after move commands)
8. Default zoom on open (%) — with per-file frontmatter override behavior
9. Mobile action bar: button size (24–100px), idle opacity (10–100%), offset no-keyboard (0–200px), offset with-keyboard (0–200px)
10. Node max width: desktop (80–2000, default 800), mobile (default 300)
11. Fold state persistence: markdown / plugin-data / none

### 1.10 Misc behaviors easily lost

- New-mindmap files created with `basicFrontmatter` (`mindmap-plugin: basic`).
- Root cannot be deleted, dragged, multi-selected, or have siblings.
- Adding a child to a collapsed parent auto-expands first (every entry path: Tab, menu, mobile button).
- New node auto-enters edit with "Sub title" placeholder pre-selected (the `setTimeout(0)` in AddNode.execute is load-bearing — see Cmds.ts comment).
- Enter-on-node inserts sibling **directly below** the current node (moveNode 'down', excluded from history so undo removes the node, not the reposition).
- On open: root selected + view centered on root (first Layout construction).
- `window.myNode` debug handle set on every select (legacy; drop in v2).
- Localization scaffold: 20+ locale files keyed by English strings (`t()`); en is the only fully maintained one.
- Export temporarily mutates the live canvas (root reposition + content resize) and restores after — a crash mid-export leaves the view broken.
- xmind import: only first sheet (`mindData[0]`), content.json only.

---

## 2. Module Map

| File | Lines | Responsibility |
|---|---|---|
| `mindmap/mindmap.ts` | 3,678 | God object: canvas DOM, all desktop+touch input, marquee, drag/drop, pinch/wheel zoom & anchor math, selection (single+multi), spatial keyboard nav, displayed-level logic, md serialization (`getMarkdown`), copy/paste, xmind import hook, palette opening, center/scale. ~800 lines are commented-out dead keyboard handlers |
| `main.ts` | 1,718 | Plugin entry: ~50 command registrations (heavily repetitive boilerplate), settings load/save, fold-path plugin-data API, view registration, file-menu events, monkey-around patches for view switching |
| `MindMapView.ts` | 1,252 | TextFileView: data⇄tree conversion (`mdToData`, `normalizeBullets`), frontmatter handling, zoom persistence, fold-path apply/collect, PNG/JPEG/HTML export, mobile action bar (build/position/poll/teardown), color palette setup, external-change sync |
| `mindmap/INode.ts` | 1,030 | Node: DOM (containEl/contentEl/barDom), markdown render + embeds/images/tasks, edit lifecycle (edit/cancelEdit/selectText), inline-format text surgery (setSelectedText etc.), highlight wrap, wikilink insert, tree accessors (level/index/siblings), expand/collapse show/hide, box measurement/cache |
| `mindmap/Layout.ts` | 596 | Tree layout: left/right/centered/clockwise partitioning, recursive top-down positioning, bounding-box sibling push-apart (`_dolayout`/`_adjustNode`), SVG edge drawing (svg.js bezier + underline), branch color assignment |
| `mindmap/Cmds.ts` | 405 | Command pattern: AddNode, RemoveNode, ChangeNodeText, MoveNode, GroupMoveNode, MovePos, Collapse/ExpandNode, PasteNode — each with execute/undo |
| `settingTab.ts` | 353 | Settings UI; pushes live updates into every open mindmap leaf |
| `mindmap/import/xmindZen.ts` | 273 | XMind Zen content.json → INodeData tree |
| `mindmap/HighlightPalette.ts` | 152 | Floating color swatch palette (single + multi target) |
| `mindmap/Execute.ts` | 110 | String-dispatched command factory + History facade |
| `mindmap/History.ts` | 73 | Undo/redo stacks, 50 limit |
| `lang/helpers.ts` + locales | ~330 | i18n lookup keyed by English strings |
| `settings.ts` | 45 | Settings data class + defaults |
| `MindLinkSuggestModal.ts` | 28 | Fuzzy vault-file picker for wikilink insertion |
| `constants.ts` | 18 | Frontmatter key/template, regex |
| `mindmap/parseMd.ts` | 2 | Dead file |
| `markmapLib/**` | ~200 | Vendored markmap-lib type stubs; only the Transformer (md→tree) is used at runtime |
| (not in src) `dom-to-image-more.js` | — | Vendored export rasterizer |

---

## 3. Architecture Assessment

### Worth keeping conceptually
- **Markdown is the single source of truth; the mindmap is a projection.** Tree → `getMarkdown()` → `requestSave()` on every change; reparse on external change. This is the right model — keep it.
- **`normalizeBullets()` no-data-loss philosophy** — assimilate every line into the structure rather than dropping it. Battle-tested against real messy vault notes; port the rules (and write golden-file round-trip tests for them).
- **Command pattern with undoable commands** (Cmds.ts/History.ts) — clean, small, correct. GroupMoveNode shows it composes. Keep the pattern; fix the embedded select/edit side effects (the `setTimeout(0)` in AddNode is documented as load-bearing — v2 must move select+edit responsibility to the caller, per the "Snappy-Add Rework" note in Cmds.ts).
- **Obsidian-native rendering** (`MarkdownRenderer` per node) — free wikilinks, embeds, math, hover-preview, theme compliance.
- **Battle-earned interaction details** (the real value of this fork, encoded in comments): pinch anchored at gesture-start focal point; `_anchorScaleAt` reading CSS transform-origin via getComputedStyle (never the JS cache); ghost-position hit-testing with visual offset; commit-to-last-shown drop target; manual double-click/tap detectors (native dblclick unreliable in popouts/iOS); iOS focus-in-same-gesture for keyboard; touchstart preventDefault kills iOS click synthesis; ownerDocument/defaultView everywhere for popouts. These are *requirements*, not implementation accidents.
- **Three-mode fold persistence** and per-file zoom in frontmatter — good user-facing design.

### Legacy cruft (do not port)
- `markmapLib` vendored stubs — replace with a small purpose-built md⇄tree parser (the normalizeBullets pre-pass already does half the work; the Transformer is used only for list/heading nesting).
- ~800 lines of commented-out keyboard/feature code inside mindmap.ts; dead `parseMd.ts`; `window.myNode` debug global; `Display node info in console` debug command; unused `randomColor` import paths; `exportToSvg` ("Export to html") writing an `<img>` into an .html file is vestigial.
- Locale system keyed by English strings, 20 nearly-empty locale files — v2 can ship English-only or a tiny dictionary.
- String-dispatched `execute('addChildNode', …)` switch — replace with typed command constructors.
- Empirical magic numbers in mobile bar math (×2 multiplier, 413px shift, 270px keyboard guess) — works but is device-fragile; v2 should derive from visualViewport alone where possible.
- The 8000–36000px fixed-size canvas + scroll approach itself (see §4).

### Where state lives and how it tangles
- **Per-MindMap instance state is mostly fine** (selectNode, selectNodes, editNode, mindScale, scalePointer, ~25 `_gesture` flags) — but it's all flat mutable fields on one god object with no ownership boundaries; gesture handlers reach into everything.
- **The "two open mindmaps share zoom" bug class** came from: (a) module-level mutable `tempDispLevel` in mindmap.ts (shared across ALL instances — still there for displayed-level computation); (b) `MindMapView.setViewData` reusing/resetting mindmap state across file loads, with defensive triple-resets (`mindScale=100; scalePointer=[]; _isTouchZooming=false`) duplicated in constructor, onClose, onunload, setViewData — the resets are symptoms of unclear instance lifecycle; (c) document-level keydown/keyup listeners per mindmap with a fuzzy `isFocused` heuristic (100ms grace timer + activeElement fallback + body fallback) deciding which map a keystroke belongs to — three stacked patches over an ambient-state design. v2: scope key handling to the view's container, one explicit state object per view, zero module-level mutables.
- **Dual rendering state**: tree truth lives in `node.data` (INodeData) but layout/selection truth lives on Node instances + DOM classes + cached `box`/`boundingRect`; cache invalidation (`clearCacheData` walking ancestors, `boundingRect=null` sprinkled in 20 places) is manual and a recurring bug source.
- `view.data` vs `mindmap.data` vs the file on disk form a 3-way sync with `yamlString` glued on — `getViewData/setViewData/requestSave` interplay is fragile (fileCache fallback object in the constructor papers over cold-start).
- Settings object is **shared by reference** between plugin and each MindMap (`new MindMap(data, el, this.plugin.settings)` then `Object.assign` copies — actually copied into a new object, but settingTab then mutates each leaf's `mindmap.setting` manually field-by-field; forgetting one field = stale-setting bug).

## 4. Rendering approach & performance

- **Pure DOM + one SVG overlay.** Each node = absolutely-positioned `<div class="mm-node">` inside a fixed-size square canvas div (`canvasSize`, default 8000–36000px). Edges drawn with svg.js paths into one `<svg>` (100%×100%) behind the nodes. Pan = native/manual scrolling of the giant div inside the container; zoom = CSS `scale()` transform on the whole canvas with carefully managed `transform-origin` + compensating scroll.
- **Layout** is computed in TS (Layout.ts): measure each node's DOM box (`offsetWidth/Height` — forces layout), recursively stack children vertically with fixed gaps, then a second pass (`_dolayout`) pushes sibling subtrees apart using cached subtree bounding rects, then re-balance left/right around root, then redraw **all** SVG edges from scratch.
- **Performance characteristics on large maps:**
  - Every `refresh()` relayouts the entire tree and clears+redraws every edge — O(n) DOM writes + O(n) `getBox` reads with interleaved read/write = layout thrashing. Fine to ~hundreds of nodes; janky in the thousands.
  - `getNodeById` and `_findNearestDropCandidate`/`_nodesInRect` are full-tree traversals run per click / per dragover / per touchmove tick (drop-candidate search does `getBoundingClientRect` on every node per move event).
  - Per-node `MarkdownRenderer.renderMarkdown` is async at init → N renders racing, completion tracked by a `_tempNum == _nodeNum` counter; images/code/MathJax trigger extra full relayouts as they load.
  - The giant fixed canvas wastes memory and makes "center" math depend on canvasSize; content can outgrow it (user-visible setting up to 36000 exists *because* of this).
  - Zoom via CSS transform keeps text crisp and is GPU-composited (`translate3d` hack) — that part performs well, but the transform-origin/scroll-compensation duo is the single most bug-prone subsystem in the codebase (multiple "Lessons Learned" comments).
- v2 guidance: keep DOM nodes + SVG edges (Obsidian markdown rendering requires DOM), but use a translated inner container instead of a giant scrolled canvas (pan/zoom = one matrix), an id→node Map, incremental/dirty-subtree layout, batched measure-then-write phases, and edge redraw scoped to changed subtrees.

## 5. Top 10 risks a rewrite must not reintroduce

1. **Markdown corruption / silent data loss on round-trip.** Parse→serialize must be lossless for headings, nested bullets, multi-line nodes, code fences, blockquotes, tasks, `^id` markers, bare text, weird indentation. Build a golden-file round-trip test suite *before* features.
2. **Frontmatter destruction.** Current code slices frontmatter by cached metadata offsets and re-prepends it; any drift (cold cache, no frontmatter, CRLF) risks eating YAML. v2: treat frontmatter as opaque, never regenerate it, and never write the file when the parsed tree is empty/failed.
3. **Cross-instance state leakage** (the shared-zoom bug class): module-level mutables (`tempDispLevel`), document-level key handlers with heuristic focus routing, settings mutated by reference across leaves. One instance = one state object; keyboard scoped to the view container.
4. **Stale-cache layout corruption**: manual `boundingRect`/box invalidation missed in one code path ⇒ overlapping subtrees. v2 needs a single invalidation choke point (or recompute-always with memoization keyed on content+children).
5. **Zoom anchor desync**: JS-cached scale origin vs CSS transform-origin drifting apart (jump-on-zoom, marquee offset bugs). Single source of truth for the view transform; never cache what CSS already knows.
6. **Undo/redo breaking edit state**: commands that internally select/edit nodes created ordering bugs (the load-bearing `setTimeout(0)`); Escape-cancel relies on `undo()` popping the right command. v2: commands mutate the tree only; selection/edit is the caller's concern; text-edit commits are atomic.
7. **iOS gesture regressions**: preventDefault-on-touchstart killing synthesized clicks (v0.5.12 bug); keyboard focus only working synchronously inside the user gesture; native pan vs custom gesture arbitration (touch-action switching); double-tap unreliability. Port the documented solutions, don't rediscover them.
8. **Popout-window breakage**: any use of global `document`/`window` for selection, focus, getComputedStyle, or listeners breaks popouts. Always `ownerDocument`/`defaultView`.
9. **Race conditions around async node rendering**: N async MarkdownRenderer calls + image/math late-loading vs layout/zoom application (`firstInit` 100ms setTimeout, scale applied "after init" with a visible flash). v2: explicit ready-state (await all renders or observe sizes) instead of counters and timeouts.
10. **External-change feedback loops & multi-view writes**: file watcher re-parsing while a local edit is in flight, or two panes on the same file both calling requestSave, can ping-pong or drop keystrokes. v2: version/dirty tokens — ignore self-originated change events, and only the active editing view writes.

Bonus (11): **drop-commit mismatch** — committing a drag to a fresh hit-test instead of the last *shown* target makes mobile reparenting feel random; keep the `_currentDropNode` contract.
