import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupRef, describeDiagnostic, logDirs } from "../src/diagnose";

/**
 * Turning `agent exited 1: no detail` into an actual cause.
 *
 * opencode writes structured logs under ~/.local/share/opencode/log/ and puts a
 * `ref=err_...` id in its JSONL error event. That id is the join key: it is the
 * same id in both places, so a log line can be pulled for a failure we only
 * know by its message. Without it, every provider error is the same sentence
 * and the log is the only place the reason exists.
 */

/**
 * A directory containing `log/`, returned as the LOG DIRECTORY itself - which
 * is what `lookupRef` takes. The two being conflated in a test is how a
 * diagnostic silently never finds anything in production.
 */
function scratch(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "cod-diag-")), "log");
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("lookupRef", () => {
  test("finds the log line carrying the ref", () => {
    const dir = scratch();
    writeFileSync(
      join(dir, "2026-09-30.log"),
      [
        "INFO service=server starting",
        "ERROR service=server ref=err_a7a9b326 error=RateLimitError provider=zen",
        "INFO service=server done",
      ].join("\n"),
    );
    const hit = lookupRef("err_a7a9b326", [dir]);
    expect(hit).toContain("RateLimitError");
    expect(hit).toContain("zen");
  });

  test("returns null when the ref is not in any log", () => {
    const dir = scratch();
    writeFileSync(join(dir, "a.log"), "INFO nothing here");
    expect(lookupRef("err_nope", [dir])).toBeNull();
  });

  test("does not throw when the log directory does not exist at all", () => {
    // The engine may not have written anything yet, and a missing directory is
    // not an error worth failing a job over.
    const missing = join(mkdtempSync(join(tmpdir(), "cod-diag-")), "never-created");
    expect(lookupRef("err_a7a9b326", [missing])).toBeNull();
    expect(describeDiagnostic("err_a7a9b326", [missing])).toContain("no log entry");
  });

  test("searches every log file, not just the newest", () => {
    const dir = scratch();
    writeFileSync(join(dir, "old.log"), "ERROR ref=err_older error=OldProblem");
    writeFileSync(join(dir, "new.log"), "ERROR ref=err_newer error=NewProblem");
    expect(lookupRef("err_older", [dir])).toContain("OldProblem");
    expect(lookupRef("err_newer", [dir])).toContain("NewProblem");
  });

  test("never returns a whole log file, only the one line", () => {
    // A log can be megabytes. Returning it would put a wall of text in the
    // operator's results line.
    const dir = scratch();
    const filler = Array.from({ length: 500 }, (_, i) => `INFO line ${i}`).join("\n");
    writeFileSync(join(dir, "big.log"), `${filler}\nERROR ref=err_x error=Found\n${filler}`);
    const hit = lookupRef("err_x", [dir]);
    expect(hit).toContain("Found");
    expect(hit?.split("\n").length).toBe(1);
  });
});

describe("describeDiagnostic", () => {
  test("says plainly that there is no log to look at", () => {
    expect(describeDiagnostic("err_x", [scratch()])).toContain("no log entry");
  });

  test("gives the line when there is one", () => {
    const dir = scratch();
    writeFileSync(join(dir, "a.log"), "ERROR ref=err_x error=Timeout upstream");
    expect(describeDiagnostic("err_x", [dir])).toContain("Timeout upstream");
  });
});


describe("two engines, two log directories", () => {
  test("the KILO log directory is searched too", () => {
    // Measured: Kilo is a fork that renamed the data directory. Searching only
    // opencode's means every Kilo failure silently finds nothing, which is
    // indistinguishable from there being nothing to find.
    const root = scratch();
    const kilo = join(root, "kilo-log");
    mkdirSync(kilo, { recursive: true });
    writeFileSync(join(kilo, "opencode.log"), "ERROR ref=err_kilo_1 error=KiloSpecificProblem");
    expect(lookupRef("err_kilo_1", [join(root, "opencode-log"), kilo])).toContain("KiloSpecificProblem");
  });

  test("a directory that does not exist is skipped, not fatal", () => {
    const root = scratch();
    const kilo = join(root, "kilo-log");
    mkdirSync(kilo, { recursive: true });
    writeFileSync(join(kilo, "a.log"), "ERROR ref=err_x error=Found");
    expect(lookupRef("err_x", [join(root, "nope"), kilo])).toContain("Found");
  });

  test("logDirs covers BOTH engines by default", () => {
    const dirs = logDirs();
    expect(dirs.some((d) => d.includes("opencode"))).toBe(true);
    expect(dirs.some((d) => d.includes("kilo"))).toBe(true);
  });
});
