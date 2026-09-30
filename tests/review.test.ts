import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgeReview, mechanicalChecks, canMerge, REVIEW_SKILL } from "../src/review";

/**
 * Stage 4: something reviews, and something lands.
 *
 * The policy is decided and was unbuilt. An agent finishes work on its branch;
 * a reviewer checks scope, tests and security - and nothing more; one retry
 * with the review as feedback; the CEO merges.
 *
 * Two rules that are easy to get wrong and expensive to get right:
 *   - MECHANICAL checks are deterministic and never delegated to a model. A
 *     secret in a diff is found by reading the diff; asking a model whether it
 *     thinks there is a secret is how a secret ships.
 *   - The reviewer does NOT fix. A review that lands its own fix has no author
 *     accountable for it.
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-review-"));
  dirs.push(dir);
  return dir;
}

/**
 * A change in the department's OWN area. Deliberately not `src/`: in this system
 * `src/` IS a global path, so a "harmless" fixture touching it would be refused
 * for radius rather than for anything it did - and a fixture that trips a check
 * it is not testing teaches the wrong lesson.
 */
const GOOD_DIFF = [
  "diff --git a/notes/answer.md b/notes/answer.md",
  "+++ b/notes/answer.md",
  "@@ -1 +1,2 @@",
  "+The answer is 43.",
].join("\n");

const CLEAN = { ok: true, findings: [] as string[] };

describe("mechanicalChecks", () => {
  test("a clean, in-radius diff passes", () => {
    const result = mechanicalChecks(GOOD_DIFF);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test("a SECRET in a diff is refused outright, not judged", () => {
    // Deterministic and non-negotiable. A model asked "does this look like a
    // credential" will sometimes say no, and the cost is a live key.
    const result = mechanicalChecks(`${GOOD_DIFF}\n+const key = "sk-live-abc123def456";`);
    expect(result.ok).toBe(false);
    expect(result.findings.join(" ")).toContain("secret");
  });

  test("a private key is refused whatever it is called", () => {
    expect(mechanicalChecks("+-----BEGIN RSA PRIVATE KEY-----").ok).toBe(false);
  });

  test("an AWS-shaped key is refused", () => {
    expect(mechanicalChecks('+AWS = "AKIAIOSFODNN7EXAMPLE"').ok).toBe(false);
  });

  test("a MERGE or PUSH in the diff is refused", () => {
    // Agents have no authority to land anything. A diff that does is out of
    // policy however good the code is.
    expect(mechanicalChecks(`${GOOD_DIFF}\n+git push origin main`).ok).toBe(false);
    expect(mechanicalChecks(`${GOOD_DIFF}\n+git merge master`).ok).toBe(false);
  });

  test("a global file is refused, because its radius is not the reviewer's", () => {
    const result = mechanicalChecks("+++ b/src/workspace.ts");
    expect(result.ok).toBe(false);
    expect(result.findings.join(" ")).toContain("global");
  });

  test("the diff HEADER is not scanned as if it were content", () => {
    // `+++ b/notes/a.md` starts with a plus and would otherwise be read as a
    // changed line.
    expect(mechanicalChecks("+++ b/notes/a.md\n+plain text").findings).toEqual([]);
  });

  test("findings quote the offending line, so a rejection is actionable", () => {
    const result = mechanicalChecks('+const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";');
    expect(result.findings[0] ?? "").toMatch(/secret/i);
    expect((result.findings[0] ?? "").length).toBeGreaterThan(10);
  });
});

describe("judgeReview", () => {
  test("a model reviewer returns a verdict and a reason", async () => {
    const verdict = await judgeReview({
      diff: GOOD_DIFF, task: "record the answer", mechanical: mechanicalChecks(GOOD_DIFF),
      ask: async () => "approve - the change is small and does what it says",
    });
    expect(verdict.outcome).toBe("approve");
    expect(verdict.reason.length).toBeGreaterThan(5);
  });

  test("a request for changes is distinct from a refusal", async () => {
    // The retry depends on telling them apart: changes means try again with
    // feedback, reject means stop.
    const verdict = await judgeReview({
      diff: GOOD_DIFF, task: "x", mechanical: CLEAN,
      ask: async () => "request changes - there is no test",
    });
    expect(verdict.outcome).toBe("request-changes");
  });

  test("a REJECT says so plainly", async () => {
    const verdict = await judgeReview({
      diff: GOOD_DIFF, task: "x", mechanical: CLEAN, ask: async () => "reject - this is out of scope",
    });
    expect(verdict.outcome).toBe("reject");
  });

  test("a MECHANICAL failure is never overridden by a model's approval", async () => {
    // The whole point of doing the checks deterministically: a model cannot
    // talk a secret past the boundary.
    const leaky = `${GOOD_DIFF}\n+const key = "sk-live-abc123def456";`;
    const verdict = await judgeReview({
      diff: leaky, task: "x", mechanical: mechanicalChecks(leaky),
      ask: async () => "approve, looks fine to me",
    });
    expect(verdict.outcome).toBe("reject");
    expect(verdict.reason).toContain("secret");
  });

  test("a model that says nothing usable is a REJECT, not an approval", async () => {
    // Defaulting to approve on an unreadable answer is the fail-open direction,
    // and the one that actually ships bad merges.
    const verdict = await judgeReview({ diff: GOOD_DIFF, task: "x", mechanical: CLEAN, ask: async () => "" });
    expect(verdict.outcome).toBe("reject");
  });

  test("a model that rambles without a verdict is a REJECT", async () => {
    // A paragraph is not an approval, however agreeable it sounds.
    const verdict = await judgeReview({
      diff: GOOD_DIFF, task: "x", mechanical: CLEAN,
      ask: async () => "This looks quite good to me, nice work, maybe ship it?",
    });
    expect(verdict.outcome).toBe("reject");
  });

  test("a reviewer that cannot be reached does not approve", async () => {
    const verdict = await judgeReview({
      diff: GOOD_DIFF, task: "x", mechanical: CLEAN,
      ask: async () => { throw new Error("provider down"); },
    });
    expect(verdict.outcome).toBe("reject");
  });

  test("the reviewer is given its rules, not asked to invent them", () => {
    // The reviewer's scope: scope, tests, security - and nothing more. A
    // reviewer with opinions rewrites the author's work.
    expect(REVIEW_SKILL).toContain("scope");
    expect(REVIEW_SKILL.toLowerCase()).toContain("do not rewrite");
  });
});

describe("canMerge", () => {
  test("only an APPROVED item may land", () => {
    expect(canMerge({ outcome: "approve" })).toBe(true);
    expect(canMerge({ outcome: "request-changes" })).toBe(false);
    expect(canMerge({ outcome: "reject" })).toBe(false);
  });

  test("a GLOBAL change is never merged by a reviewer", () => {
    // Blast radius decides who lands it. A reviewer approving is not authority.
    expect(canMerge({ outcome: "approve" }, 2)).toBe(false);
    expect(canMerge({ outcome: "approve" }, 1)).toBe(true);
    expect(canMerge({ outcome: "approve" }, 0)).toBe(true);
  });
});

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
