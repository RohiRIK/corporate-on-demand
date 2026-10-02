import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { writeLandedBundle, importLanded, exportedSha, readManifest, exportPaths, removeExport, LANDED_REF } from "../src/export";

/**
 * Landed work leaves the container as data, not through a writable mount.
 *
 * The /landing bind pushed the landing repo's OWN HEAD - not the merged work -
 * and handed every agent a writable host repository to plant hooks in. The
 * replacement: a bundle in the state directory, fetched into the landing repo
 * on the host, fast-forward only, every object checked.
 */

const dirs: string[] = [];
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function work(seed = "one"): string {
  const dir = scratch("cod-exp-work-");
  git(dir, "init", "-q", "-b", "master", ".");
  // The seed matters: two repositories with the same content, author, message
  // and second produce the SAME commit, and then "unrelated" history descends.
  writeFileSync(join(dir, "a.md"), `${seed}\n`);
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "one");
  return dir;
}

function landing(): string {
  const dir = scratch("cod-exp-landing-");
  git(dir, "init", "-q", "-b", "main", ".");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "theirs");
  return dir;
}

function advance(dir: string, body: string): void {
  writeFileSync(join(dir, "a.md"), body);
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", body.trim());
}

describe("export", () => {
  test("the MERGED work arrives in the landing repo as cod-landed", () => {
    const repo = work();
    const state = scratch("cod-exp-state-");
    const target = landing();
    expect(writeLandedBundle(repo, "master", state)).toBeNull();
    const result = importLanded(state, target);
    expect(result.ok).toBe(true);
    expect(exportedSha(target)).toBe(git(repo, "rev-parse", "master"));
    // The landing repo's own branch is untouched.
    expect(git(target, "log", "--oneline", "main")).toContain("theirs");
  });

  test("a later landing fast-forwards it, and re-running is a no-op", () => {
    const repo = work();
    const state = scratch("cod-exp-state-");
    const target = landing();
    writeLandedBundle(repo, "master", state);
    importLanded(state, target);
    advance(repo, "two\n");
    writeLandedBundle(repo, "master", state);
    expect(importLanded(state, target).ok).toBe(true);
    expect(exportedSha(target)).toBe(git(repo, "rev-parse", "master"));
    expect(importLanded(state, target).reason).toContain("already exported");
  });

  test("history that does not descend is REFUSED, and --force takes it", () => {
    const repo = work();
    const state = scratch("cod-exp-state-");
    const target = landing();
    writeLandedBundle(repo, "master", state);
    importLanded(state, target);
    const before = exportedSha(target);
    // A purged and re-created volume: unrelated history.
    const fresh = work("a purged volume starts over");
    advance(fresh, "different\n");
    writeLandedBundle(fresh, "master", state);
    const refused = importLanded(state, target);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain("no longer descends");
    expect(exportedSha(target)).toBe(before);
    expect(importLanded(state, target, { force: true }).ok).toBe(true);
    expect(exportedSha(target)).toBe(git(fresh, "rev-parse", "master"));
  });

  test("a damaged bundle is refused, and the landing repo is left alone", () => {
    const repo = work();
    const state = scratch("cod-exp-state-");
    const target = landing();
    writeLandedBundle(repo, "master", state);
    const bundle = exportPaths(state).bundle;
    const bytes = readFileSync(bundle);
    bytes[bytes.length - 30] = bytes[bytes.length - 30]! ^ 0xff;
    writeFileSync(bundle, bytes);
    const result = importLanded(state, target);
    expect(result.ok).toBe(false);
    expect(exportedSha(target)).toBeNull();
  });

  test("objects that hash correctly but are MALFORMED are refused (fsck), not imported", () => {
    // A damaged pack fails its checksum anyway; this is the case only
    // transfer.fsckObjects catches - an object written by hand into the shared
    // store, which hashes fine and is not a valid commit.
    const repo = work();
    const state = scratch("cod-exp-state-");
    const target = landing();
    const tree = git(repo, "rev-parse", "HEAD^{tree}");
    const bad = execFileSync("git", ["-C", repo, "hash-object", "-t", "commit", "-w", "--literally", "--stdin"], {
      input: `tree ${tree}\nauthor nobody\ncommitter nobody\n\nhand-made\n`, encoding: "utf8",
    }).trim();
    git(repo, "update-ref", "refs/heads/master", bad);
    expect(writeLandedBundle(repo, "master", state)).toBeNull();
    const result = importLanded(state, target);
    expect(result.ok).toBe(false);
    expect(exportedSha(target)).toBeNull();
  });

  test("nothing landed yet is said plainly", () => {
    expect(importLanded(scratch("cod-exp-state-"), landing()).reason).toContain("nothing has landed yet");
  });

  test("a landing path that is not a repository is refused before anything is read", () => {
    const repo = work();
    const state = scratch("cod-exp-state-");
    writeLandedBundle(repo, "master", state);
    expect(importLanded(state, scratch("cod-exp-plain-")).ok).toBe(false);
  });

  test("the manifest records what was exported, and purge removes the export", () => {
    const repo = work();
    const state = scratch("cod-exp-state-");
    writeLandedBundle(repo, "master", state);
    expect(readManifest(state)?.sha).toBe(git(repo, "rev-parse", "master"));
    removeExport(state);
    expect(existsSync(exportPaths(state).dir)).toBe(false);
    expect(LANDED_REF).toBe("refs/heads/cod-landed");
  });
});
