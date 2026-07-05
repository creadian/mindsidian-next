// Plugin settings (design §1 Stage D): the single persisted settings shape
// with schemaVersion from day one, plus pure helpers that derive the FROZEN
// per-view snapshots (model slice + render slice). Views never share a live
// settings reference — changes are pushed explicitly via applySettings().

import type { FoldPersistence, ModelSettings } from "./model/types";
import type { LayoutDirection } from "./view/layout";
import type { RenderSettings } from "./view/render";
import { DEFAULT_LAYOUT_SETTINGS, type LayoutSettings } from "./view/layout";
import { DEFAULT_RENDER_SETTINGS } from "./view/render";

export interface MindsidianNextSettings {
  /** Bumped on any breaking settings-shape change; migrations key off it. */
  schemaVersion: number;
  /** Nodes at depth < headLevel serialize as ATX headings (contract §1.3). */
  headLevel: number;
  foldStatePersistence: FoldPersistence;
  layoutDirection: LayoutDirection;
  /** Zoom % applied when a file has no `mindmap-zoom` frontmatter (20–300). */
  defaultZoom: number;
  nodeMaxWidthDesktop: number;
  nodeMaxWidthMobile: number;
  /** Horizontal gap parent → children (px). */
  levelGap: number;
  /** Vertical gap between sibling nodes (px). */
  siblingGap: number;
  /** EXTRA vertical gap at subtree boundaries (owner wishlist #4). */
  subtreeGap: number;
  /** First-level branch color rotation. */
  branchColors: string[];
  /** CSS-only depth-scaled font (owner wishlist #5). */
  depthScaledFont: boolean;
  /** Deep-node look: branch-colored underline (classic) or a light box. */
  nodeStyle: "underline" | "boxed";
  /** After move commands, keep the moved node centered. */
  focusOnMove: boolean;
  /** Mobile action bar scale factor (1 = default size). */
  mobileBarScale: number;
  /** Action bar distance from the bottom edge (px), on top of the device
   *  safe area. Default clears Obsidian's own mobile navbar. */
  mobileBarBottomOffset: number;
  /** Canvas background CSS color; "" = follow the Obsidian theme. */
  canvasBackground: string;
  /** plugin-data fold persistence: file path → collapsed node text-paths. */
  foldStates: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: MindsidianNextSettings = {
  schemaVersion: 1,
  headLevel: 2,
  foldStatePersistence: "markdown",
  layoutDirection: "right",
  defaultZoom: 100,
  nodeMaxWidthDesktop: 800,
  nodeMaxWidthMobile: 400,
  levelGap: DEFAULT_LAYOUT_SETTINGS.levelGap,
  siblingGap: DEFAULT_LAYOUT_SETTINGS.siblingGap,
  subtreeGap: DEFAULT_LAYOUT_SETTINGS.subtreeGap,
  branchColors: [...DEFAULT_RENDER_SETTINGS.branchColors],
  depthScaledFont: false,
  nodeStyle: "underline",
  focusOnMove: false,
  mobileBarScale: 1,
  mobileBarBottomOffset: 24,
  canvasBackground: "",
  foldStates: {},
};

/** Merge loaded data over the defaults (unknown keys dropped, gaps filled). */
export function mergeSettings(loaded: unknown): MindsidianNextSettings {
  const raw = (loaded ?? {}) as Partial<MindsidianNextSettings>;
  const merged: MindsidianNextSettings = { ...DEFAULT_SETTINGS, ...raw };
  merged.schemaVersion = DEFAULT_SETTINGS.schemaVersion;
  merged.headLevel = clampInt(merged.headLevel, 1, 6);
  merged.defaultZoom = clampInt(merged.defaultZoom, 20, 300);
  // Every remaining numeric flows into layout/CSS — a hand-edited or
  // corrupted data.json (0, negative, NaN) must not collapse the map.
  merged.nodeMaxWidthDesktop = clampNum(
    merged.nodeMaxWidthDesktop, 100, 4000, DEFAULT_SETTINGS.nodeMaxWidthDesktop
  );
  merged.nodeMaxWidthMobile = clampNum(
    merged.nodeMaxWidthMobile, 100, 4000, DEFAULT_SETTINGS.nodeMaxWidthMobile
  );
  merged.levelGap = clampNum(merged.levelGap, 4, 400, DEFAULT_SETTINGS.levelGap);
  merged.siblingGap = clampNum(merged.siblingGap, 0, 200, DEFAULT_SETTINGS.siblingGap);
  merged.subtreeGap = clampNum(merged.subtreeGap, 0, 200, DEFAULT_SETTINGS.subtreeGap);
  merged.mobileBarScale = clampNum(
    merged.mobileBarScale, 0.5, 3, DEFAULT_SETTINGS.mobileBarScale
  );
  merged.mobileBarBottomOffset = clampNum(
    merged.mobileBarBottomOffset, 0, 120, DEFAULT_SETTINGS.mobileBarBottomOffset
  );
  if (!Array.isArray(merged.branchColors) || merged.branchColors.length === 0) {
    merged.branchColors = [...DEFAULT_SETTINGS.branchColors];
  }
  if (merged.nodeStyle !== "boxed") merged.nodeStyle = "underline";
  if (typeof merged.foldStates !== "object" || merged.foldStates === null) {
    merged.foldStates = {};
  }
  return merged;
}

/** Clamp a possibly-invalid numeric setting; non-finite → the default. */
function clampNum(value: number, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Frozen model-layer snapshot (what parse/serialize need). */
export function toModelSettings(s: MindsidianNextSettings): ModelSettings {
  return Object.freeze({
    headLevel: clampInt(s.headLevel, 1, 6),
    foldStatePersistence: s.foldStatePersistence,
  });
}

/** Frozen render-layer snapshot (layout + colors + widths). */
export function toRenderSettings(
  s: MindsidianNextSettings,
  isMobile: boolean
): RenderSettings {
  const layout: LayoutSettings = Object.freeze({
    direction: s.layoutDirection,
    levelGap: s.levelGap,
    rootLevelGap: DEFAULT_LAYOUT_SETTINGS.rootLevelGap,
    siblingGap: s.siblingGap,
    rootSiblingGap: DEFAULT_LAYOUT_SETTINGS.rootSiblingGap,
    subtreeGap: s.subtreeGap,
  });
  return Object.freeze({
    layout,
    branchColors: Object.freeze([...s.branchColors]) as string[],
    nodeMaxWidth: isMobile ? s.nodeMaxWidthMobile : s.nodeMaxWidthDesktop,
    depthScaledFont: s.depthScaledFont,
  });
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(Number.isFinite(value) ? value : min);
  return Math.min(max, Math.max(min, n));
}
