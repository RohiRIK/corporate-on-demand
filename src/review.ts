/**
 * Review and merge - Stage 4.
 *
 * An agent finishes work on its branch. Something has to check it and something
 * has to land it. The policy was decided and unbuilt: a reviewer checks scope,
 * tests and security and nothing more; one retry with the review as feedback;
 * the CEO merges.
 *
 * This was deliberately after the agents could act. A reviewer watching an
 * agent that cannot act reviews nothing, and a merge policy over a company that
 * does not propose its own work has nothing to merge.
 *
 * **Two things are decided here, not delegated.**
 *
 * The MECHANICAL checks are deterministic: a secret, a merge, a push, a global
 * path. Asking a model "does this look like a credential" will sometimes say no,
 * and the cost of being wrong is a live key. So the model never gets a vote on
 * any of it.
 *
 * The reviewer DOES NOT FIX. A review that lands its own fix has no author
 * accountable for it, which is the property that makes a review worth having.
 */

import { isGlobalPath } from "./boundary";

/** What a mechanical check found. Never "probably fine". */
export interface MechanicalResult {
  readonly ok: boolean;
  readonly findings: readonly string[];
}

/**
 * Patterns that are refused without a model being asked.
 *
 * Deliberately biased towards false positives. A rejected diff costs one retry;
 * a shipped key costs the company.
 */
const SECRET_PATTERNS: readonly { readonly re: RegExp; readonly label: string }[] = [
  { re: /sk-[A-Za-z0-9_-]{12,}/, label: "an OpenAI-style secret (sk-...)" },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/, label: "a GitHub token (ghp_/gho_/...)" },
  { re: /AKIA[0-9A-Z]{16}/, label: "an AWS access key id" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "a private key" },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: "a Slack token" },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, label: "a JWT" },
  { re: /api[_-]?key\s*[:=]\s*["'][^"']{12,}["']/i, label: "an inline api key assignment" },
];

/** Actions no agent may take, whatever else the diff says. */
const FORBIDDEN_ACTIONS: readonly { readonly re: RegExp; readonly label: string }[] = [
  { re: /^\+.*\bgit\s+push\b/m, label: "a push (agents have no authority to land anything)" },
  { re: /^\+.*\bgit\s+merge\b/m, label: "a merge (the CEO lands, not the author)" },
  { re: /^\+.*--force(-with-lease)?\b/m, label: "a force push" },
];

/**
 * The deterministic checks. No model involved, ever.
 *
 * Returns the offending line in each finding so a rejection is something the
 * author can act on rather than a verdict they have to argue with.
 */
export function mechanicalChecks(diff: string): MechanicalResult {
  const findings: string[] = [];

  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(line)) findings.push(`secret: ${pattern.label} in \`${line.trim().slice(0, 60)}\``);
    }
  }
  for (const pattern of FORBIDDEN_ACTIONS) {
    if (pattern.re.test(diff)) findings.push(`boundary: the diff contains ${pattern.label}`);
  }

  // A global path in the diff is out of the reviewer's authority entirely: the
  // radius decides who lands it, and a reviewer approving is not that authority.
  for (const line of diff.split("\n")) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m?.[1] !== undefined && isGlobalPath(m[1])) {
      findings.push(`global: ${m[1]} is a global path; only the CEO lands changes there`);
    }
  }

  return { ok: findings.length === 0, findings };
}

export type ReviewOutcome = "approve" | "request-changes" | "reject";

export interface ReviewVerdict {
  readonly outcome: ReviewOutcome;
  readonly reason: string;
  readonly mechanical: readonly string[];
}

/** The reviewer's actual brief. Kept as data so the test can read it. */
export const REVIEW_SKILL = [
  "You are reviewing one change. Check, in this order:",
  "1. scope - does it do what it says, and nothing else",
  "2. correctness - would this break something that works",
  "3. tests - is there a test that fails without it",
  "4. secrets and boundary - mechanical, already decided for you",
  "Answer with exactly one of: approve, request changes, reject - then one sentence why.",
  "Do not rewrite it. Do not approve because it is small. You do not land it.",
].join("\n");

export interface ReviewInput {
  readonly diff: string;
  readonly task: string;
  readonly mechanical: MechanicalResult;
  /** The model's answer. Injected, so this is testable without a provider. */
  readonly ask: (prompt: string) => Promise<string>;
}

/**
 * Judge one change.
 *
 * Order matters and is the whole design: the mechanical result is consulted
 * FIRST and cannot be overridden. A model that approves a diff containing a key
 * still gets a reject, because the check that found the key was not a judgement
 * call.
 *
 * An unreadable answer is a reject, not an approval. Failing open here is the
 * one direction that actually ships bad merges.
 */
export async function judgeReview(input: ReviewInput): Promise<ReviewVerdict> {
  if (!input.mechanical.ok) {
    return {
      outcome: "reject",
      reason: `refused before review: ${input.mechanical.findings.join("; ")}`,
      mechanical: input.mechanical.findings,
    };
  }

  let answer: string;
  try {
    answer = await input.ask(`${REVIEW_SKILL}\n\nTask: ${input.task}\n\nDiff:\n${input.diff}`);
  } catch (error) {
    return {
      outcome: "reject",
      reason: `the reviewer could not be reached: ${(error as Error).message}`,
      mechanical: [],
    };
  }

  const text = answer.trim().toLowerCase();
  const outcome: ReviewOutcome = text.startsWith("approve")
    ? "approve"
    : text.startsWith("request")
      ? "request-changes"
      : text.startsWith("reject")
        ? "reject"
        // Unreadable, or a paragraph instead of a verdict. Refuse rather than
        // guess: a reviewer that cannot answer has not approved anything.
        : "reject";

  const reason = answer.trim() === ""
    ? "the reviewer returned nothing usable, which is not approval"
    : answer.trim().slice(0, 300);

  return { outcome, reason, mechanical: [] };
}

/**
 * May this change be landed?
 *
 * Two conditions and they are different: the reviewer approved it, AND the blast
 * radius is something a reviewer may land. Radius 2 is the CEO's alone.
 */
export function canMerge(verdict: { readonly outcome: ReviewOutcome }, radius = 0): boolean {
  return verdict.outcome === "approve" && radius < 2;
}
