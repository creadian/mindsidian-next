// Shadow-mode vault validation (design §1 Stage D): runs v2's
// parse → serialize → reparse → serialize READ-ONLY across every
// `mindmap-plugin` file in the vault and reports what a save would do.
// Writes nothing, ever. Run this before editing any real note with v2.

import { App, Notice } from "obsidian";
import type { ModelSettings } from "./model/types";
import { parseDocument } from "./model/parse";
import { serializeDocument } from "./model/serialize";

export async function validateVault(
  app: App,
  settings: ModelSettings
): Promise<void> {
  const files = app.vault.getMarkdownFiles().filter((f) => {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    return fm != null && fm["mindmap-plugin"] != null;
  });

  let identical = 0;
  const normalized: string[] = [];
  const failures: string[] = [];

  for (const file of files) {
    const text = await app.vault.cachedRead(file);
    const result = parseDocument(text, file.basename);
    if (!result.ok) {
      failures.push(`${file.path}: parse error — ${result.error}`);
      continue;
    }
    const once = serializeDocument(result.doc, settings);
    const reparsed = parseDocument(once, file.basename);
    const twice = reparsed.ok
      ? serializeDocument(reparsed.doc, settings)
      : null;
    if (twice !== once) {
      failures.push(`${file.path}: serialization is NOT idempotent`);
      continue;
    }
    if (once === text) identical++;
    else normalized.push(file.path);
  }

  // Full report to the console; one-line summary as a Notice.
  console.log(
    `[Mindsidian Next] Vault validation — ${files.length} mindmap file(s):\n` +
      `  byte-identical roundtrip: ${identical}\n` +
      `  would normalize on save:  ${normalized.length}` +
      (normalized.length ? `\n    - ${normalized.join("\n    - ")}` : "") +
      `\n  FAILURES: ${failures.length}` +
      (failures.length ? `\n    - ${failures.join("\n    - ")}` : "")
  );
  const summary =
    failures.length > 0
      ? `Validation: ${failures.length} FAILURE(S) — do not edit those files with v2 (see console).`
      : `Validation: ${files.length} file(s) OK — ${identical} byte-identical, ${normalized.length} would normalize (see console).`;
  new Notice(summary, 10000);
}
