/**
 * The secret scan CI runs before anything is published (scripts/secret-scan.sh).
 *
 * It knew three credential shapes while the runtime redaction (src/redact.ts)
 * knew seven, so a Google key, a Slack token, a fine-grained GitHub token or a
 * private key could be committed and pushed with a green build. And it scanned
 * only the tree, so a secret committed and deleted in the next commit was
 * published with the history and never seen.
 *
 * Each sample below is assembled at run time - a literal would trip the very
 * scan under test when this file is committed.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "scripts", "secret-scan.sh");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-secretscan-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "nothing to see\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

function scan(dir: string, range?: string): { code: number; out: string } {
  const r = spawnSync("sh", [SCRIPT, ...(range === undefined ? [] : [range])], { cwd: dir, encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

const j = (...parts: string[]): string => parts.join("");

/** One plausible-looking sample per family src/redact.ts redacts. */
const SAMPLES: Record<string, string> = {
  "openai-style key": j("sk-", "proj", "A1b2C3d4E5f6G7h8I9j0"),
  "github token": j("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2"),
  "github fine-grained token": j("github", "_pat_", "11ABCDEFG0123456789_abcdefghij"),
  "slack token": j("xo", "xb-", "1234567890-abcdefghij"),
  "aws access key id": j("AK", "IA", "ABCDEFGHIJKLMNOP"),
  "google api key": j("AI", "za", "SyA-0123456789abcdefghijklmnopqrstu"),
  "private key": j("-----BEGIN ", "RSA PRIVATE", " KEY-----"),
};

describe("the scan knows every shape the runtime redacts", () => {
  test("a clean repository passes", () => {
    expect(scan(repo()).code).toBe(0);
  });

  for (const [family, sample] of Object.entries(SAMPLES)) {
    test(`a committed ${family} fails the tree scan`, () => {
      const dir = repo();
      writeFileSync(join(dir, "config.txt"), `value = ${sample}\n`);
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "oops");
      const result = scan(dir);
      expect(`${family}:${result.code}`).toBe(`${family}:1`);
      expect(result.out).toContain("config.txt");
    });
  }

  test("every family redact.ts names has a sample here", async () => {
    // So a pattern added to redaction without one here fails loudly, rather
    // than leaving the two lists to drift apart again.
    const source = await Bun.file(join(import.meta.dir, "..", "src", "redact.ts")).text();
    const names = [...source.matchAll(/\{ name: "([^"]+)", re: /g)].map((m) => m[1] ?? "");
    const notCredentialShapes = new Set(["bearer header", "jwt"]);
    for (const name of names.filter((n) => !notCredentialShapes.has(n))) {
      expect(Object.keys(SAMPLES)).toContain(name);
    }
  });
});

describe("the range scan sees what the tree no longer does", () => {
  test("a secret committed and then deleted fails the range scan, not the tree scan", () => {
    const dir = repo();
    const base = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "leak.txt"), `token ${SAMPLES["github token"]}\n`);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "add");
    unlinkSync(join(dir, "leak.txt"));
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "remove");
    expect(scan(dir).code).toBe(0);
    expect(scan(dir, `${base}..HEAD`).code).toBe(1);
  });

  test("REMOVING a secret is the fix, not a leak", () => {
    const dir = repo();
    writeFileSync(join(dir, "leak.txt"), `token ${SAMPLES["slack token"]}\n`);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "add");
    const afterLeak = git(dir, "rev-parse", "HEAD");
    unlinkSync(join(dir, "leak.txt"));
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "remove");
    expect(scan(dir, `${afterLeak}..HEAD`).code).toBe(0);
  });

  test("this repository's own tree is clean", () => {
    expect(scan(join(import.meta.dir, "..")).code).toBe(0);
  });
});
