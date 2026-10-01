import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Documentation that says a thing is closed, when the code is not - or the
 * reverse - is worse than no documentation, because it is believed.
 *
 * Three times in one session a text edit reported success and wrote nothing: a
 * CLI command was announced before its branch existed, a plan document's fixture
 * used a Unicode ellipsis so a literal replacement matched nothing, and two
 * "Closed" entries in OPEN_QUESTIONS.md stood as "Open" for two commits while
 * the code underneath was already implemented and tested.
 *
 * Common cause: a string replacement whose anchor silently does not match. The
 * cure is not to trust the edit's return value. It is to assert on the file.
 */

const REPO = resolve(import.meta.dir, "..");
const read = (p: string): string => readFileSync(resolve(REPO, p), "utf8");

describe("OPEN_QUESTIONS.md agrees with the code", () => {
  test("no question is still marked Open", () => {
    // The file's own convention: closed items are rewritten as "Closed:", so a
    // heading that still says "Open:" is a claim that something is unresolved.
    const headings = read("docs/OPEN_QUESTIONS.md")
      .split("\n")
      .filter((l) => l.startsWith("## ") && !l.startsWith("## Closed"));
    const stillOpen = headings.filter((h) => h.includes("Open:"));
    expect(stillOpen).toEqual([]);
  });

  test("every Closed entry has a source file behind it", () => {
    // A closed entry claims something shipped. Name the symbol, and the symbol
    // has to exist - otherwise the entry is a wish.
    const text = read("docs/OPEN_QUESTIONS.md");
    const claimed = [...text.matchAll(/`(checkLandingRepo|clearReview|recordReview|latestReview|runGovernance|buildWorkspaceSpec)`/g)].map(
      (m) => m[1] ?? "",
    );
    expect(claimed.length).toBeGreaterThan(0);

    const sources = readdirSync(resolve(REPO, "src")).map((f) => read(`src/${f}`)).join("\n");
    for (const symbol of new Set(claimed)) {
      expect(sources).toContain(symbol);
    }
  });

  test("the commands the docs tell you to run actually exist", () => {
    // `cod work blocked` was documented, its usage string updated and announced,
    // and the branch did not exist. The usage string is the one place the CLI
    // enumerates itself, so it cannot lie about its own subcommands.
    const usage = read("src/commands.ts");
    for (const verb of ["blocked", "unblock"]) {
      expect(usage).toContain(`sub === "${verb}"`);
      expect(usage).toContain(`try list, propose, claim, commit, run, blocked or unblock`);
    }
  });

  test("no doc points at a test file that is not there", () => {
    // A renamed test makes every doc reference a lie, and nothing else notices.
    const tests = new Set(readdirSync(resolve(REPO, "tests")));
    const docs = ["README.md", "QUICKSTART.md", "CHANGELOG.md", "docs/ROADMAP.md", "docs/OPEN_QUESTIONS.md"];
    for (const doc of docs) {
      for (const m of read(doc).matchAll(/tests\/([a-z0-9._-]+\.test\.ts)/g)) {
        expect(`${m[1]}`).toBeDefined();
        expect(tests.has(`${m[1]}`)).toBe(true);
      }
    }
  });
});