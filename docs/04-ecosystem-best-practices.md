# Ecosystem Best Practices for the Mindsidian Rewrite (researched 2026-06)

Purpose: current (2025–2026) best practices for building a high-quality Obsidian plugin,
researched from docs.obsidian.md, obsidianmd/obsidian-sample-plugin, obsidian-api, and
comparable node-graph plugins. Informs the from-scratch rewrite of the mind-map plugin.

Confidence notes: everything under sections 1–3 and 5 is sourced from official docs /
the official sample plugin. Section 4 mixes documented facts with well-established
community knowledge about how comparable plugins render (marked where applicable).

---

## 1. Toolchain (official baseline, 2026)

The official template is **obsidianmd/obsidian-sample-plugin**. It is the reviewed,
maintained baseline — start from it rather than inventing a build setup.

### Build tool: esbuild (not rollup)

- The sample plugin ships an `esbuild.config.mjs`. esbuild is the de-facto standard;
  rollup appears only in very old tutorials. esbuild builds in milliseconds, which is
  what makes the watch/hot-reload loop pleasant.
- Standard config (from the sample plugin):
  - `format: "cjs"`, `target: "es2018"`, `bundle: true`, `treeShaking: true`
  - `external`: `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, node builtins —
    these are provided by Obsidian at runtime and must never be bundled
  - dev mode: `sourcemap: "inline"` + watch; prod: no sourcemap, minify optional
- Entry `src/main.ts` → single output `main.js` next to `manifest.json` and `styles.css`.

### TypeScript config

- `strict: true` is the expectation today (the sample's tsconfig enables strict
  null checks etc.). Types come from the `obsidian` npm package (`obsidian.d.ts`
  in obsidianmd/obsidian-api, with TSDoc on every API).
- Node 18+ for the build environment.
- Lint: the official **`eslint-plugin` from obsidianmd** encodes the review-bot rules
  (sentence case, innerHTML, etc.). Run `npm run lint` before any release.

### Dev workflow / hot reload

1. Develop against a **throwaway test vault** (for us: `Claude_testing`), never the
   real vault. Plugin lives at `<vault>/.obsidian/plugins/mindsidian-next/`.
2. `npm run dev` = esbuild watch, rebuilds `main.js` on save. Either set esbuild's
   outfile to the plugin folder directly, or add a tiny copy step.
3. Install pjeby's **Hot-Reload plugin** in the test vault: it watches `main.js` /
   `styles.css` and reloads the plugin automatically when they change (a `.hotreload`
   marker file in the plugin folder enables it). This removes the manual
   "reload Obsidian" step entirely.
4. Debugging: Ctrl/Cmd-Shift-I devtools; mobile emulation via
   `this.app.emulateMobile(true)` in the console (see §3).

### Folder layout (sample-plugin convention, plus review guideline "organize multi-file plugins into folders")

```
Mindsidian-v2/
├── manifest.json          # id, version, minAppVersion, isDesktopOnly
├── versions.json          # plugin version → min Obsidian version map
├── esbuild.config.mjs
├── tsconfig.json
├── styles.css             # ALL styling lives here, not in JS
└── src/
    ├── main.ts            # Plugin class only: registration + lifecycle
    ├── view/              # the TextFileView subclass + UI
    ├── model/             # markdown ↔ tree parsing/serializing (pure, testable)
    └── settings/          # settings tab + defaults
```

### Versioning / releases

- Bump `manifest.json` + `versions.json` together; `npm version patch|minor|major`
  automates both via the sample's `version-bump.mjs`.
- Releases are **GitHub releases with `main.js`, `manifest.json`, `styles.css` as
  individual binary assets** (not zipped, not just branch commits). BRAT and the
  community catalog both read releases — pushing to the branch alone ships nothing.
  (This matches the existing Mindsidian lesson: "push" must include the release.)

---

## 2. Custom file view that edits markdown: `TextFileView`

### Why TextFileView (not raw ItemView)

`TextFileView` (extends `EditableFileView` → `FileView` → `ItemView`) is the official
class for "display and edit text-based file formats". Obsidian handles reading the
file, watching for external changes, and writing to disk; the view only converts
between the file's text and its own UI. This is the single most important
data-safety lever: **never read/write the file yourself with `vault.modify()` from
inside the view — implement the three hooks and let Obsidian own disk I/O.**

### The save lifecycle (the contract)

| Hook | Direction | Notes |
|---|---|---|
| `setViewData(data, clear)` | disk → view | Called on file load AND when the file changes externally (sync, another device, editing the md in another pane). `clear === true` means "a different file is now in this leaf — reset everything". Must be idempotent and fast. |
| `getViewData(): string` | view → disk | Return the full markdown serialization of current state. Obsidian calls it whenever it decides to save. Must be pure/synchronous — no side effects. |
| `clear()` | — | Wipe view state; called before loading a new file into the same view instance. |
| `this.requestSave()` | trigger | Call after **every** user mutation. It is a pre-debounced (~2 s) save scheduler. Without it, TextFileView only saves when the view closes — which loses data on crash. |
| `onLoadFile(file)` / `onUnloadFile(file)` | lifecycle | `onUnloadFile` runs before the file is detached; Obsidian performs a final save around it. Use it to flush pending edits and tear down per-file resources. |

Data-safety corollaries:
- Keep the markdown text as the **source of truth**; the in-memory tree is derived.
  If parsing fails, preserve the original text verbatim (round-trip guarantee) rather
  than serializing a partial tree — this is how corruption bugs happen.
- `getViewData()` must always be able to produce valid output, even mid-edit.
- For programmatic edits to *other* files use `Vault.process()` (atomic) — never
  `Vault.modify()` — and `FileManager.processFrontMatter()` for frontmatter.

### Coexisting with the core markdown editor

Two patterns exist for "my view edits .md files":

1. **`registerExtensions(["md"], VIEW_TYPE)`** — claims the extension globally.
   Don't: it fights the core markdown view for every .md file and breaks other plugins.
2. **The Kanban-plugin pattern (recommended, proven at scale):** keep the core
   markdown view as default; detect "this file is a mind map" via a frontmatter key
   (e.g. `mindsidian: true`). On `active-leaf-change` / file-open, if the file matches
   and the leaf holds a markdown view, swap it with
   `leaf.setViewState({ type: MINDMAP_VIEW_TYPE, state: { file: path } })`.
   Provide explicit commands + a pane-menu item: "Open as mind map" / "Open as
   markdown", which set the opposite view state on the same leaf. Remember a
   per-file override (e.g. in a Map keyed by path) so "open as markdown" sticks for
   that file until toggled back.

This gives users a guaranteed escape hatch to the raw markdown — important for trust
and for recovering from any view bug.

### Per-leaf state (fixing "two open views share state")

- The factory passed to `registerView(TYPE, (leaf) => new MindmapView(leaf))` may be
  called **many times** — once per leaf, plus re-creations. Official docs:
  *"Never manage references to views in your plugin."* No `this.view = ...` singleton,
  no module-level mutable state (current selection, undo stack, pan/zoom, parsed
  tree). **All of it lives as instance fields on the view.** This is the root cause
  of every "two open copies of the map mirror each other / overwrite each other" bug.
- To reach views from elsewhere: `app.workspace.getLeavesOfType(TYPE)` each time, or
  `getActiveViewOfType(MindmapView)` — never `workspace.activeLeaf` directly.
- Persistent per-leaf state (which file, fold state, zoom): implement
  `getState()` / `setState()` so Obsidian's workspace layout save/restore works.
  Note the documented quirk: `setState` is called *after* `onOpen` returns, and the
  call order differs between workspace restore vs. manual `setViewState` — write
  `setState` defensively (it may arrive before or after file load).
- Transient state (scroll/zoom that shouldn't persist): `getEphemeralState()` /
  `setEphemeralState()`.

### Workspace events to handle (always via `this.registerEvent(...)`)

- `vault.on("rename")` / `("delete")` for the open file (FileView handles some of
  this, but update internal path references and the per-file "open as markdown" map).
- `workspace.on("active-leaf-change")` for the view-swap pattern above.
- External modification arrives through `setViewData` — don't also subscribe to
  `vault.on("modify")` for your own open file or you'll double-handle.
- `registerEvent` / `registerDomEvent` / `addCommand` auto-clean on unload — use them
  for everything; never raw `addEventListener` without registration.

---

## 3. Mobile support (`isDesktopOnly: false`)

- Obsidian mobile runs in a **Capacitor** WebView (WKWebView on iOS, Chrome WebView
  on Android). Consequences, per official docs:
  - **No Node.js, no Electron APIs** — any reference crashes the plugin on mobile.
    Also applies transitively to npm dependencies. Audit deps for `fs`, `path`, etc.
  - **Regex lookbehind** only works on iOS ≥ 16.4 — avoid it or feature-detect via
    the `Platform` API.
  - `Platform.isIosApp` / `Platform.isAndroidApp` / `Platform.isMobile` for
    conditional behavior.
- Testing without a device: `this.app.emulateMobile(true)` in the desktop devtools
  console (toggle with `this.app.emulateMobile(!this.app.isMobile)`). Real-device
  debugging: `chrome://inspect` (Android), Safari Web Inspector (iOS 16.4+).
- Input handling: use **Pointer Events** (`pointerdown/move/up` +
  `setPointerCapture`) as the single code path for mouse, touch, and pen — not
  parallel mouse/touch listeners. Add `touch-action: none` (CSS) on the pan/zoom
  surface so the WebView doesn't hijack gestures for scrolling; implement pinch-zoom
  from two active pointers. Keep tap targets ≥ ~40 px; long-press needs its own
  timer logic (and must not fight text selection — suppress via
  `-webkit-user-select` during drags).
- iOS quirks worth designing around: `100vh` is unreliable inside the app (size to
  the view's container, never the viewport); on-screen keyboard resizes the WebView
  (re-measure on `resize`); SVG `foreignObject` text rendering is historically flaky
  in WKWebView (a reason to prefer HTML nodes — see §4).
- The current plugin already proved mobile demand (long-press drag-to-reparent is a
  planned feature) — keep `isDesktopOnly: false` and test in emulateMobile from week 1.

---

## 4. Rendering approach for the node-graph UI

### What comparable tools use

| Tool | Nodes | Edges | Notes |
|---|---|---|---|
| **Obsidian Canvas (core)** | DOM `div`s, positioned with CSS `transform: translate()` inside one zoom/pan-transformed container | single SVG layer | Community-established reading of the core plugin; nodes are real DOM so markdown embeds/editors render natively; offscreen content is culled/simplified at low zoom. |
| **Excalidraw (library + plugin)** | HTML5 `<canvas>` (rough.js) | canvas | Immediate-mode; great for freeform sketching at huge element counts, but text editing is a separate overlay hack, and theming/accessibility don't come free. |
| **Markmap (obsidian-mind-map)** | SVG (d3) | SVG paths | Read-only rendering of markdown → mind map; fine because it never edits text in place. |
| **SimpleMindMap (wanglin2, newest mind-map plugin, accepted 2025)** | SVG | SVG | Full editor in SVG; works, but text editing uses overlay inputs and its rendering stack is a large bundled library. |
| **Enhancing Mindmap / markmind family** | DOM nodes | SVG edge layer | Same hybrid as Canvas. (Community knowledge; repos are stale/abandoned — one reason for this rewrite.) |
| **Obsidian graph view (core)** | WebGL/canvas (pixi-style) | canvas | Built for 10k+ nodes, zero text editing — wrong trade-off for a mind map. |

### Trade-off summary for ~1000 nodes with pan/zoom

- **DOM + CSS transforms (hybrid: HTML nodes + one SVG layer for edges)** — best fit.
  - Text is the product in a mind map: HTML nodes give native contenteditable /
    embedded-editor editing, IME, copy/paste, RTL, ellipsis/wrapping for free.
  - Theme integration for free via Obsidian CSS variables (a review guideline anyway).
  - Pan/zoom = one `transform: translate(...) scale(...)` on the container with
    `transform-origin: 0 0` and `will-change: transform` — GPU-composited, no relayout.
  - 1000 nodes ≈ a few thousand DOM elements: comfortably fine, same order as
    Obsidian Canvas usage. Add simple viewport culling (`display:none` outside the
    visible rect, swap text for blocks below ~25 % zoom) and it stays smooth on mobile.
  - Hit-testing, hover, focus, ARIA all come from the platform instead of hand-rolled.
- **SVG everywhere** — fine for edges (use it for that), weak for node *content*:
  text layout in SVG means `foreignObject` (flaky on iOS WKWebView) or manual
  line-breaking; editing needs overlay inputs. Per-element cost similar to DOM, so
  no perf win at this scale.
- **Canvas/WebGL** — only pays off at ~5–10k+ visible elements. Costs: rebuild text
  layout, editing overlays, hit-testing, theming, accessibility by hand; biggest
  data-safety surface because everything is custom. Not justified for ≤ 1000 nodes.

**Recommendation: the Obsidian-Canvas hybrid — absolutely-positioned HTML divs for
nodes inside a single CSS-transformed pan/zoom container, plus one full-size SVG
layer underneath for edge paths. Pointer Events for all input.** It is the leanest
to build, the most native-feeling, the most theme/mobile-friendly, and matches what
the most successful comparable plugin (core Canvas) does.

---

## 5. Plugin review guidelines — pitfalls checklist

From the official "Plugin guidelines" (enforced by the review bot + human review):

**Security / DOM**
- No `innerHTML` / `outerHTML` / `insertAdjacentHTML` with user-derived strings.
  Use `createEl()` / `createDiv()` / `createSpan()`, and `el.empty()` to clear.
- Never fetch and execute remote code.

**Views / workspace**
- Don't store view references (factory may run multiple times) — `getLeavesOfType()`.
- **Don't detach your leaves in `onunload()`** (1.7+ rule: leave them; Obsidian
  preserves the user's layout and re-binds on re-enable).
- Use `getActiveViewOfType()` instead of `workspace.activeLeaf`.
- **Deferred views (Obsidian ≥ 1.7.2):** all tabs load as `DeferredView` until
  visible. `leaf.view instanceof MyView` is false for deferred leaves — check
  `leaf.isDeferred`; `await leaf.loadIfDeferred()` *sparingly*, or
  `await workspace.revealLeaf(leaf)` before talking to the view. Never blind-cast
  `leaf.view as MyView`.
- Heavy startup work and any iteration over leaves: inside
  `this.app.workspace.onLayoutReady(() => ...)`, never directly in `onload()`.
  One-time setup after install: `Plugin.onUserEnable()`.

**Vault**
- `Vault.process()` over `Vault.modify()`; Editor API for the active file;
  `FileManager.processFrontMatter()` for frontmatter; `normalizePath()` on any
  user-supplied path; `getFileByPath()` instead of scanning `getFiles()`.

**Resources**
- Everything through `registerEvent` / `registerDomEvent` / `registerInterval` /
  `addCommand` so unload is automatic and leak-free.

**UI conventions**
- Sentence case everywhere ("Create new node", not "Create New Node").
- No default hotkeys on commands. Use `checkCallback` where conditional.
- Settings: `setHeading()` not `<h2>`; no "Settings" in headings; headings only
  when there are multiple sections.
- No hardcoded styles in JS — `styles.css` + Obsidian CSS variables only.

**Code quality flags reviewers check**
- No global `app` (use `this.app`); no `var`; prefer `async/await`; minimal console
  logging (errors only); rename all `MyPlugin`/`Sample*` placeholders; multi-file
  code organized in folders; `manifest.json` id/name without "Obsidian"/"Plugin"
  redundancy; license file present.

**Manifest / release**
- `minAppVersion` honest (≥ 1.7.2 given deferred-view handling), `versions.json`
  maintained, release assets = `main.js` + `manifest.json` + `styles.css`.

---

## Sources

- https://github.com/obsidianmd/obsidian-sample-plugin (toolchain baseline, esbuild config, versioning)
- https://docs.obsidian.md/Plugins/User+interface/Views (custom views, no view references)
- https://docs.obsidian.md/Reference/TypeScript+API/TextFileView (+ setViewData/getViewData pages)
- https://docs.obsidian.md/plugins/guides/defer-views (deferred views, 1.7.2)
- https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines (review guidelines)
- https://docs.obsidian.md/Plugins/Getting+started/Mobile+development (mobile, emulateMobile, lookbehind)
- https://github.com/obsidianmd/obsidian-api (obsidian.d.ts)
- https://github.com/korbinzhao/obsidian-textfileview-plugin-sample (TextFileView auto-save sample)
- https://forum.obsidian.md/t/confused-about-the-setviewstate-and-state-management-of-the-itemview-class/66798 and /t/api-the-calls-to-views-setstate-are-inconsistent-or-poorly-documented/67097 (setState ordering quirks)
- https://github.com/wanglin2/obsidian-simplemindmap and https://github.com/lynchjames/obsidian-mind-map (comparable plugins)
- https://github.com/pjeby/hot-reload (dev hot-reload workflow)
- Community-established knowledge marked inline (core Canvas/Excalidraw rendering internals, Kanban view-swap pattern).
