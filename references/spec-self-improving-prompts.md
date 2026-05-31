# Spec: Self-Improving Prompts

> **Status:** SPEC — no implementation yet.
> **Depends on:** SQLite + sqlite-vec v2 backbone (`plan-v2-honker-sqlite-vec.md`) for measurable artifact history.
> **Hosted on:** Retrospectives loop (`impl-retrospectives.md`), monthly cadence.

## Goal

The org improves its own department SYSTEM.md prompts over time by **distilling recurring CEO feedback into permanent prompt lines** — never by letting a model freely rewrite a prompt. Every change is versioned, measured, and reversible.

## Core Principle

The org already produces a clean training signal: CEO directives and corrections. When the same correction repeats, it graduates from a transient directive into a standing prompt line. Improvement = distillation of feedback the org already gave, not invention.

## Who Does It (separation of duties)

| Role | Job | Rule |
|------|-----|------|
| **HR** | Detects the signal — grade trends, recurring corrections | Reads data only; proposes nothing to its own prompt |
| **CTO** | Drafts the prompt patch (prompt = code = CTO domain) | May not draft for a department it is graded alongside on the same artifact |
| **CEO / Board** | Approves or rejects the patch | CEO for normal lines; Board vote for any gate change |

**Hard rule:** no department edits its own SYSTEM.md. Author is never the beneficiary.

## Analytics That Drive It

1. **Prompt versioning** — every SYSTEM.md change gets a version hash; every artifact records the prompt version that produced it.
2. **Grade-trend correlation** — average grade per department per prompt version. Compare the window before vs after each change.
3. **Recurring-directive detection** — same CEO correction to the same department ≥ N times (default N=3) within a window → candidate prompt line.
4. **Slop-score creep** — rising banned-word frequency or embedding similarity to recent output (from anti-slop v2) → flag the prompt as decaying.

## Guardrails (non-negotiable)

- **Revert-on-regression.** If a department's grade trend drops by ≥ threshold (default 0.15 on 0–1 scale) over M cycles after a prompt change, auto-flag that change for revert. The org can roll back its own brain.
- **Immutable safety gates.** The spec gate, anti-slop contract, and domain boundaries cannot be weakened without explicit human sign-off, treated as a `tech-stack` pivot (proposal → Board vote → approve). Identity/creative lines are freely tunable.
- **Anchored grading.** Grades are anchored to frozen golden-reference vectors (seeded once, never auto-updated) and the human-read morning report. The org may never grade itself with a rubric it also rewrote.

## Rulebook (governance)

1. A department never edits its own prompt.
2. Only recurring, evidenced feedback becomes a prompt line — no speculative rewrites.
3. Every change is versioned and reversible.
4. Safety gates need human sign-off; identity lines do not.
5. Grade anchors (golden refs, morning report) are out of the loop's reach.
6. One prompt change per department per retro cycle (bounded blast radius).

## Runbook (monthly, inside the retro)

1. **Collect** — HR queries: per-department grade trend, directives repeated ≥ N times, slop-score trend.
2. **Propose** — for each recurring correction, CTO drafts a one-line SYSTEM.md patch (append or replace an identity/creative line). Gate changes are excluded here — they go to the pivot flow.
3. **Approve** — CEO (or Board for gate-adjacent changes) accepts or rejects each patch.
4. **Apply** — bump the prompt version hash; record the change with its justifying evidence.
5. **Watch** — over the next M cycles, monitor grade trend. If it regresses past threshold, auto-flag and revert.
6. **Record** — write the cycle's changes + outcomes to the retro doc.

## TypeScript Scripts

| Script | Does |
|--------|------|
| `prompt-version.ts` | Hash + version a SYSTEM.md; stamp artifacts with the producing version |
| `feedback-mine.ts` | Scan directives for the same correction repeated ≥ N times per department |
| `grade-trend.ts` | Compute per-department grade trend per prompt version; detect regressions |
| `prompt-propose.ts` | Given mined feedback, emit a draft one-line patch for CTO review (no auto-apply) |
| `prompt-apply.ts` | Apply an approved patch, bump version, log evidence |
| `prompt-revert.ts` | Roll back to a prior prompt version on regression flag |

All read/write the v2 `project.db` (departments, artifacts, grades, directives tables).

## Acceptance Criteria

- [ ] Every SYSTEM.md has a version hash; every artifact records the prompt version that produced it.
- [ ] `feedback-mine.ts` surfaces a correction repeated ≥ N times as a prompt-line candidate.
- [ ] `grade-trend.ts` reports grade-before vs grade-after for any prompt change.
- [ ] No department can apply a change to its own prompt (enforced, not just documented).
- [ ] A prompt change that regresses grades ≥ threshold over M cycles is auto-flagged for revert.
- [ ] A change touching a safety gate is blocked unless a human/Board approval is recorded.
- [ ] Golden-reference vectors and the morning-report anchor are never modified by this loop.
- [ ] One bounded change per department per retro cycle; all changes logged to the retro doc with justifying evidence.

## Open Questions

- Default thresholds (N repeats, regression delta, M watch cycles) — tune from real data.
- Does HR own this, or a dedicated "Org Design" sub-agent? (HR is the cheaper start.)
- Should approved patches require a one-cycle canary before full apply?
