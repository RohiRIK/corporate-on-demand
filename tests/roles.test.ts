import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { askRole, ROLE_BRIEFS } from "../src/roles";

/**
 * A read-only role never runs in /work.
 *
 * The reviewer and the meeting's voices are model calls with tool use, and they
 * used to start in `/work` - the main checkout, where merges happen. A reviewer
 * that inspected a branch by checking it out moved the checkout under the merge.
 */

describe("askRole", () => {
  test("each call gets its own directory, with the role's brief, removed afterwards", async () => {
    let seen = "";
    let brief = "";
    const out = await askRole("reviewer", "review-w-1", "the prompt", async (cron, workdir) => {
      seen = workdir;
      brief = readFileSync(`${workdir}/AGENTS.md`, "utf8");
      expect(cron.task).toBe("the prompt");
      expect(cron.expectTools).toBe(false);
      return "approve - fine";
    });
    expect(out).toBe("approve - fine");
    expect(seen).not.toBe("/work");
    expect(seen.startsWith("/work")).toBe(false);
    expect(brief).toContain("REVIEWER");
    expect(existsSync(seen)).toBe(false);
  });

  test("the directory is removed even when the runner throws", async () => {
    let seen = "";
    await expect(
      askRole("meeting", "meeting", "p", async (_cron, workdir) => {
        seen = workdir;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(seen)).toBe(false);
  });

  test("both briefs forbid changing files", () => {
    for (const brief of Object.values(ROLE_BRIEFS)) expect(brief).toContain("change any file");
  });
});
