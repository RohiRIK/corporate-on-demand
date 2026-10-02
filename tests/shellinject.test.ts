import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFor } from "../src/backend";
import { localRunner } from "../src/agent";

/**
 * The prompt must never reach a shell.
 *
 * SEC-01/SEC-02, found by Max. The chain was:
 *
 *   backend.ts  JSON.stringify(prompt)
 *   agent.ts    Bun.spawn(["sh", "-lc", args.join(" ")])
 *
 * JSON.stringify escapes the double quote and NOTHING ELSE. A backtick or a
 * $(...) inside the prompt survives it intact and is then evaluated by `sh -lc`.
 * Demonstrated before writing this file:
 *
 *   $ sh -lc 'echo "the value `echo EVALUATED` was wrong"'
 *   the value EVALUATED was wrong
 *
 * Reachable with no operator-controlled configuration at all: on a review retry
 * the prompt is the REVIEWER'S OWN REJECTION TEXT (land.ts -> work.reason ->
 * briefFor -> cron.task -> buildPrompt), and that text is model-authored.
 *
 * So a model that writes a rejection reason containing a backtick gets shell
 * execution inside the container.
 *
 * These tests spawn a real process with a marker that would create a FILE if it
 * were ever evaluated by a shell.
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-shell-"));
  dirs.push(dir);
  return dir;
}

describe("the prompt is data, never shell source", () => {
  test("buildFor emits the prompt RAW - no JSON quoting that looks like escaping", () => {
    // JSON.stringify is the trap: it looks like escaping and is not, for a shell.
    const prompt = "fix the value `id` and $(whoami)";
    const args = buildFor("opencode", "opencode/space-bunny-free", prompt, "t");
    expect(args[args.length - 1]).toBe(prompt);
  });

  test("running a prompt containing shell metacharacters does NOT evaluate them", async () => {
    const dir = scratch();
    const marker = join(dir, "PWNED");
    // If any shell is involved, this backtick creates the file.
    const prompt = `do the thing \`touch ${marker}\``;

    const result = await localRunner(["printf", "%s", prompt], 30_000, dir);

    expect(existsSync(marker)).toBe(false);
    // And the text survived intact rather than being mangled.
    expect(result.stdout).toContain("touch");
  });

  test("the runner takes an argv array, so an argument containing a space is ONE argument", async () => {
    const dir = scratch();
    const result = await localRunner(["printf", "[%s]", "one two three"], 30_000, dir);
    expect(result.stdout.trim()).toBe("[one two three]");
  });

  test("a non-zero exit code is still visible - the reason the shell was there", async () => {
    // The original comment claimed `sh -lc` was needed so "a non-zero opencode
    // exit is visible rather than swallowed". It is visible without a shell, and
    // the test pins that so nobody reinstates one to get this property back.
    const result = await localRunner(["sh", "-c", "exit 3"], 30_000, scratch());
    expect(result.code).toBe(3);
  });
});

// In afterAll, not at module top level: top-level code runs while bun is
// COLLECTING the tests, before any directory exists, and so deleted nothing.
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
