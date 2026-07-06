// The settings tab (design §1 Stage D): grouped controls over the single
// persisted settings object. Every change saves immediately and pushes a
// fresh frozen snapshot into all open mindmap views via the plugin.

import { App, PluginSettingTab, Setting } from "obsidian";
import type MindsidianNextPlugin from "./main";
import type { FoldPersistence } from "./model/types";
import type { LayoutDirection } from "./view/layout";
import { DEFAULT_SETTINGS } from "./settings";

export class MindsidianSettingTab extends PluginSettingTab {
  private plugin: MindsidianNextPlugin;

  constructor(app: App, plugin: MindsidianNextPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    // ------------------------------------------------------------ structure
    new Setting(containerEl).setName("Structure").setHeading();

    new Setting(containerEl)
      .setName("Max heading level")
      .setDesc(
        "Nodes above this depth are written as headings, deeper ones as bullets. " +
          "Note: changing this re-serializes each mindmap file the next time it is saved. " +
          "Branches containing task checkboxes always stay in bullet form."
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, 6, 1)
          .setValue(s.headLevel)
          .setDynamicTooltip()
          .onChange(async (value) => {
            s.headLevel = value;
            await this.plugin.saveSettingsAndApply();
          })
      );

    new Setting(containerEl)
      .setName("Fold state persistence")
      .setDesc(
        "Markdown: collapsed nodes carry a trailing ^id marker in the file. " +
          "Plugin data: markdown stays clean, fold state is stored by the plugin. " +
          "None: fold state is forgotten on close."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            markdown: "Markdown (^id markers)",
            "plugin-data": "Plugin data",
            none: "Not persisted",
          })
          .setValue(s.foldStatePersistence)
          .onChange(async (value) => {
            s.foldStatePersistence = value as FoldPersistence;
            await this.plugin.saveSettingsAndApply();
          })
      );

    // -------------------------------------------------------------- layout
    new Setting(containerEl).setName("Layout").setHeading();

    new Setting(containerEl)
      .setName("Direction")
      .setDesc("Which side(s) of the root the branches grow toward.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ right: "Right", left: "Left", centered: "Centered" })
          .setValue(s.layoutDirection)
          .onChange(async (value) => {
            s.layoutDirection = value as LayoutDirection;
            await this.plugin.saveSettingsAndApply();
          })
      );

    this.numberSetting(containerEl, "Level gap", "Horizontal space between a parent and its children (px).", s.levelGap, 4, async (v) => { s.levelGap = v; });
    this.numberSetting(containerEl, "Sibling gap", "Vertical space between neighboring nodes (px).", s.siblingGap, 0, async (v) => { s.siblingGap = v; });
    this.numberSetting(containerEl, "Subtree gap", "Extra vertical space between separate branches (px).", s.subtreeGap, 0, async (v) => { s.subtreeGap = v; });
    this.numberSetting(containerEl, "Node max width (desktop)", "Widest a node may grow before wrapping (px).", s.nodeMaxWidthDesktop, 100, async (v) => { s.nodeMaxWidthDesktop = v; });
    this.numberSetting(containerEl, "Node max width (mobile)", "Widest a node may grow before wrapping on phones (px).", s.nodeMaxWidthMobile, 100, async (v) => { s.nodeMaxWidthMobile = v; });

    // ------------------------------------------------------------- behavior
    new Setting(containerEl).setName("Behavior").setHeading();

    new Setting(containerEl)
      .setName("Default zoom")
      .setDesc("Zoom percentage for files without a saved mindmap-zoom value (20–300).")
      .addSlider((slider) =>
        slider
          .setLimits(20, 300, 5)
          .setValue(s.defaultZoom)
          .setDynamicTooltip()
          .onChange(async (value) => {
            s.defaultZoom = value;
            await this.plugin.saveSettingsAndApply();
          })
      );

    new Setting(containerEl)
      .setName("Focus on move")
      .setDesc("Keep the selected node centered after move commands.")
      .addToggle((toggle) =>
        toggle.setValue(s.focusOnMove).onChange(async (value) => {
          s.focusOnMove = value;
          await this.plugin.saveSettingsAndApply();
        })
      );

    // ----------------------------------------------------------- appearance
    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Branch colors")
      .setDesc("Comma-separated CSS colors for the first-level branches, used in order.")
      .addTextArea((text) =>
        text
          .setValue(s.branchColors.join(", "))
          .onChange(async (value) => {
            const colors = value
              .split(",")
              .map((c) => c.trim())
              .filter((c) => c.length > 0);
            s.branchColors = colors.length > 0 ? colors : [...DEFAULT_SETTINGS.branchColors];
            await this.plugin.saveSettingsAndApply();
          })
      );

    new Setting(containerEl)
      .setName("Canvas background")
      .setDesc("CSS color for the map background. Leave empty to follow the theme.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. #1e1e2e")
          .setValue(s.canvasBackground)
          .onChange(async (value) => {
            s.canvasBackground = value.trim();
            await this.plugin.saveSettingsAndApply();
          })
      );

    new Setting(containerEl)
      .setName("Node style")
      .setDesc(
        "Underline: deeper notes sit on a branch-colored line (classic). " +
          "Boxed: every note gets its own light box, like the first level."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ underline: "Underline (classic)", boxed: "Boxed" })
          .setValue(s.nodeStyle)
          .onChange(async (value) => {
            s.nodeStyle = value === "boxed" ? "boxed" : "underline";
            await this.plugin.saveSettingsAndApply();
          })
      );

    new Setting(containerEl)
      .setName("Depth-scaled font")
      .setDesc("Slightly shrink text the deeper a node sits (CSS only).")
      .addToggle((toggle) =>
        toggle.setValue(s.depthScaledFont).onChange(async (value) => {
          s.depthScaledFont = value;
          await this.plugin.saveSettingsAndApply();
        })
      );

    // --------------------------------------------------------------- mobile
    new Setting(containerEl).setName("Mobile").setHeading();

    new Setting(containerEl)
      .setName("Action bar size")
      .setDesc("Scale factor for the bottom action bar on phones (1 = default).")
      .addSlider((slider) =>
        slider
          .setLimits(0.8, 1.6, 0.1)
          .setValue(s.mobileBarScale)
          .setDynamicTooltip()
          .onChange(async (value) => {
            s.mobileBarScale = value;
            await this.plugin.saveSettingsAndApply();
          })
      );

    new Setting(containerEl)
      .setName("Action bar bottom offset")
      .setDesc(
        "Distance of the action bar from the bottom edge (px), on top of the " +
          "device safe area. Raise it if it sits under Obsidian's own bar."
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 120, 4)
          .setValue(s.mobileBarBottomOffset)
          .setDynamicTooltip()
          .onChange(async (value) => {
            s.mobileBarBottomOffset = value;
            await this.plugin.saveSettingsAndApply();
          })
      );

    new Setting(containerEl)
      .setName("Action bar diagnostics")
      .setDesc(
        "Shows a small overlay with live viewport and keyboard numbers " +
          "while typing — only for debugging bar positioning. Leave off."
      )
      .addToggle((toggle) =>
        toggle.setValue(s.mobileBarDiagnostics).onChange(async (value) => {
          s.mobileBarDiagnostics = value;
          await this.plugin.saveSettingsAndApply();
        })
      );
  }

  /** Small helper: a numeric text field with a minimum bound. Empty or
   *  invalid input (incl. mid-typing states) keeps the current value —
   *  clearing the field used to apply 0 live and PERSIST it, collapsing
   *  the whole map (the settings "zero-trap"). */
  private numberSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    current: number,
    min: number,
    set: (value: number) => Promise<void> | void
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text.setValue(String(current)).onChange(async (value) => {
          if (value.trim() === "") return; // mid-edit: keep current value
          const n = Number(value);
          if (!Number.isFinite(n)) return; // garbage: keep current value
          await set(Math.max(min, n));
          await this.plugin.saveSettingsAndApply();
        })
      );
  }
}
