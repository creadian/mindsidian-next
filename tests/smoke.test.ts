// Toolchain smoke test — proves "npm test" (node:test via tsx) runs TypeScript.
// Replaced by the real STAGE A suites (roundtrip golden tests, fuzz, commands).
import { test } from "node:test";
import assert from "node:assert/strict";

test("test toolchain runs", () => {
  assert.equal(1 + 1, 2);
});
