// Plugin entry point. STAGE D will replace this hello-world placeholder with
// view registration, the Kanban-pattern view swap, settings, and the command table.
// For now it only proves the toolchain builds and the plugin loads.
import { Plugin, Notice } from "obsidian";

export default class MindsidianNextPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addCommand({
      id: "hello",
      name: "Hello from the v2 prototype",
      callback: () => new Notice("Mindsidian Next (v2 prototype) is alive."),
    });
  }
}
