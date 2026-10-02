/**
 * Test preload: the suite owns one temporary directory, and removes it.
 *
 * Every test that needs scratch space calls `mkdtempSync(join(tmpdir(), ...))`.
 * Measured before this existed: one run of the suite left ~120 directories and
 * 49 MB behind in /tmp, because thirteen files "cleaned up" with a loop at
 * module top level - which runs while bun is COLLECTING the tests, before any
 * of them has created anything, and so deletes nothing.
 *
 * Pointing TMPDIR at a per-run root fixes every file at once, including the
 * CLI processes the tests spawn, which inherit the variable. The root goes in
 * one `afterAll`, registered here so it runs once, after the last file.
 *
 * COD_KEEP_TEST_ARTIFACTS=1 keeps it, for debugging a failure.
 */

import { afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "cod-test-run-"));
process.env["TMPDIR"] = root;

afterAll(() => {
  if (process.env["COD_KEEP_TEST_ARTIFACTS"] === "1") {
    writeSync(2, `test artifacts kept at ${root}\n`);
    return;
  }
  rmSync(root, { recursive: true, force: true });
});
