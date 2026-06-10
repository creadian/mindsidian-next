// Copies the built plugin into the TEST vault (Claude_testing) so it can be
// enabled side-by-side with the original v0.5.47 plugin. Copies ONLY the
// three release files; it never touches anything else in the vault and
// never enables the plugin (the owner does that manually in Obsidian).

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TARGET =
  "/Users/christiansextl/Obsidian/Claude_testing/.obsidian/plugins/mindsidian-next";
const FILES = ["manifest.json", "main.js", "styles.css"];

if (!existsSync("main.js")) {
  console.error("main.js not found — run `npm run build` first.");
  process.exit(1);
}
mkdirSync(TARGET, { recursive: true });
for (const file of FILES) {
  copyFileSync(file, join(TARGET, file));
  console.log(`installed ${file} → ${TARGET}`);
}
