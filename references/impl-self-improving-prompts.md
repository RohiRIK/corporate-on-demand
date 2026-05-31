# Self-Improving Prompts

The org sharpens its own department SYSTEM.md prompts over time by distilling recurring CEO feedback into permanent prompt lines. Every change is versioned, measured, and reversible.

> **Status:** Dormant until the v2 SQLite backbone lands (`plan-v2-honker-sqlite-vec.md`). The loop reads measured artifact history — grades, directives, prompt versions — from `project.db`. Without that table history there is no signal to mine, so keep this loop off until v2 ships. Spec: `spec-self-improving-prompts.md`.

## The Idea

The org already generates a clean training signal every day: CEO directives and corrections. When the same correction lands on the same department three times, it has earned a place in that department's prompt. Improvement here means **distilling feedback the org already gave** — not letting a model freestyle a rewrite.

## Who Does It

Separation of duties keeps the loop honest. The author of a prompt change is never its beneficiary.

| Role | Job |
|------|-----|
| **HR** | Reads grade trends and recurring corrections, surfaces candidates |
| **CTO** | Drafts the one-line prompt patch (a prompt is code, and code is CTO's domain) |
| **CEO / Board** | Approves or rejects — CEO for identity lines, Board vote for any gate change |

**No department edits its own SYSTEM.md. Ever.** This is the load-bearing rule of the whole mechanism — a department that grades well and also rewrites its own prompt will drift toward prompts that grade well rather than prompts that produce good work. HR may propose for others but never for HR. CTO may draft for others but never for a department it is graded alongside on the same artifact. Enforce this in code, not just documentation.

## The SYSTEM.md Lines

Add these to each owner's existing identity section. They read as capabilities the role already wants, because they are.

**HR SYSTEM.md — add under responsibilities:**

```markdown
## Prompt Signal (monthly, in the retro)
You watch how every other department performs and turn the patterns into prompt
candidates. Each retro cycle, surface for each department:
- its grade trend across the last few prompt versions
- any CEO correction that repeated 3+ times — that is a department asking, through
  the CEO's mouth, for a standing instruction it doesn't yet have
- rising slop-score, which means a prompt is going stale

You diagnose and propose candidates. You never draft the prompt line itself, and you
never propose anything for HR's own prompt — that belongs to another desk.
```

**CTO SYSTEM.md — add under responsibilities:**

```markdown
## Prompt Drafting (monthly, in the retro)
When HR surfaces a recurring correction, you write the one-line SYSTEM.md patch that
answers it — the smallest line that makes the correction unnecessary next time. A
prompt is code; refining it is your craft. Draft tight, justify it with the evidence
HR gathered, and hand it to the CEO for sign-off.

Two lines you must not cross: do not draft for a department you are graded alongside
on the same artifact, and do not touch a safety gate here. Gate changes are a
tech-stack pivot — they go through the Board, not this loop.
```

**CEO SYSTEM.md — add under oversight:**

```markdown
## Prompt Approval (monthly, in the retro)
You hold the pen on every prompt change. CTO drafts, you decide — accept the line,
reject it, or send it back for a tighter draft. One change per department per cycle
keeps the blast radius small and the cause of any regression legible. Anything that
touches a safety gate is above your desk alone: it needs a Board vote.
```

## Rulebook

1. A department never edits its own prompt.
2. Only recurring, evidenced feedback becomes a prompt line — no speculative rewrites.
3. Every change is versioned and reversible.
4. Identity and creative lines are freely tunable. **Safety gates — the spec gate, the anti-slop contract, domain boundaries — change only with explicit human or Board sign-off, treated as a tech-stack pivot.** Weakening a gate quietly is the one failure this whole design exists to prevent.
5. Grade anchors — the frozen golden-reference vectors and the human morning report — stay out of the loop's reach. The org may never grade itself with a rubric it also rewrote.
6. One prompt change per department per retro cycle.

## Runbook (monthly, inside the retro)

The retro already pauses to ask "what should change?" (`impl-retrospectives.md`, step 3.3). This loop gives that question a disciplined answer.

1. **Collect** — HR pulls per-department grade trend, corrections repeated 3+ times, and slop-score trend.
2. **Propose** — for each recurring correction, CTO drafts a one-line patch. Gate changes are excluded — they go to the pivot flow.
3. **Approve** — CEO accepts or rejects each line. Board votes on anything gate-adjacent.
4. **Apply** — bump the prompt version hash; record the change with its justifying evidence.
5. **Watch** — over the next few cycles, track the grade trend. If it drops past threshold, auto-flag for revert.
6. **Record** — write the cycle's changes and outcomes into the retro doc.

## Analytics (all v2-gated)

| Signal | What it catches |
|--------|-----------------|
| Prompt versioning | Every SYSTEM.md change gets a version hash; every artifact records the version that produced it |
| Grade-trend correlation | Average grade per department per prompt version — the before/after of each change |
| Recurring-directive detection | Same CEO correction to the same department 3+ times → a prompt-line candidate |
| Slop-score creep | Rising banned-word frequency or embedding similarity to recent output → the prompt is decaying |

## Guardrails

- **Revert-on-regression.** If a department's grade trend drops by 0.15 or more (on a 0–1 scale) over the watch window after a change, the change auto-flags for revert. The org can roll back its own brain.
- **Immutable safety gates.** Already covered in rule 4 — restated here because it is the guardrail that matters most. No quiet edits.
- **Anchored grading.** Grades anchor to frozen golden-reference vectors (seeded once, never auto-updated) and the human-read morning report.

## Deferred Scripts (Track B — build once v2 lands)

| Script | Does |
|--------|------|
| `prompt-version.ts` | Hash + version a SYSTEM.md; stamp artifacts with the producing version |
| `feedback-mine.ts` | Scan directives for the same correction repeated 3+ times per department |
| `grade-trend.ts` | Per-department grade trend per prompt version; detect regressions |
| `prompt-propose.ts` | Emit a draft one-line patch for CTO review (never auto-applies) |
| `prompt-apply.ts` | Apply an approved patch, bump version, log evidence |
| `prompt-revert.ts` | Roll back to a prior version on a regression flag |

All read/write the v2 `project.db` (departments, artifacts, grades, directives tables).

## Tuning From Real Data

The thresholds here — 3 repeats, 0.15 regression delta, the watch-window length — are starting points. Tune them once the org has run enough cycles to show what a real signal looks like versus noise. Open question worth settling early: should an approved patch run one canary cycle before full apply?
