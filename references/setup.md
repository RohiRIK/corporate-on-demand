# Setup Guide

Keep this lean. The *what* — which departments and C-tier you need — is decided in `strategy-guide.md` (classify your project + maturity) and the **Onboarding Combinations** menu in `company-templates.md`. Pick the combination closest to your product, then follow the steps below to wire it up.

## Step 1: Scaffold the Project

Use the scaffold tool or create manually:
```bash
bun ~/.hermes/skills/devops/corporate-on-demand/scripts/scaffold.ts \
  --name my-project --path ~/my-project --template saas
```

## Step 2: Create Data-Collection Scripts

Each department needs a shell script in `~/.hermes/scripts/` that collects context for the agent:

```bash
#!/bin/bash
# ~/.hermes/scripts/myproject-rnd.sh
PROJ="~/my-project"
DEPT="$PROJ/departments/rnd"

echo "=== CORPORATE GOVERNANCE ==="
cat "$PROJ/departments/CORPORATE.md"

echo "=== DEPARTMENT IDENTITY ==="
cat "$DEPT/SYSTEM.md"

echo "=== INBOX ==="
for f in "$DEPT/inbox"/*.md; do [ -f "$f" ] && echo "--- $f ---" && cat "$f"; done

echo "=== EXISTING RESEARCH ==="
ls -la "$DEPT/research/" 2>/dev/null
for f in "$DEPT/research"/*.md; do [ -f "$f" ] && echo "--- $f ---" && cat "$f"; done

echo "=== EXISTING PITCHES ==="
ls -la "$DEPT/pitches/" 2>/dev/null

echo "=== EXISTING SPECS ==="
ls -la "$DEPT/specs/" 2>/dev/null

echo "=== SHARED STATE ==="
cat "$PROJ/state.json"
```

Make executable: `chmod +x ~/.hermes/scripts/myproject-rnd.sh`

## Step 3: Create Cron Jobs

**Tailor every prompt to the product — the prompts below are skeletons, not boilerplate.** Before deploying, read the product (README, spec, existing code) and rewrite each department's prompt around *that product* — its domain and goals. A tailored prompt outperforms a generic one because the agent inherits real context instead of guessing it. Keep the stack open: tell R&D to scout and pitch better frameworks rather than hardcoding one.

> **Generic (weak):** "You are the R&D department. Follow research → pitch → spec → build."
> **Product-derived (strong):** "You are R&D for a browser arcade platform (Docker, canvas games mid-migration to LittleJS). Follow research → pitch → spec → build. Scout stronger game tech and pitch a migration when it raises framerate or dev velocity, with concrete before/after."

Use Hermes cron to create staggered jobs:

```python
# Recommended schedule — QA must run 20+ min after R&D/UX to test completed work
# Even hours:  :00 Board, :20 R&D, :45 IT, :55 Infra
# Odd hours:   :00 DevOps, :10 UX/UI, :40 QA, :50 PM

# R&D department — runs at :20 past even hours
hermes cron create \
  --name myproject-rnd \
  --schedule "20 */2 * * *" \
  --script myproject-rnd.sh \
  --prompt "You are the R&D department. Read your SYSTEM.md for identity and pipeline rules. Follow the pipeline strictly: research → pitch → spec → build. If a spec exists for your current directive, build to it; if none exists, write the spec this cycle and stop there. In research and pitches, scout stronger tech and pitch upgrades that materially raise quality, with concrete trade-offs." \
  --workdir ~/my-project \
  --toolsets terminal,file,browser \
  --deliver telegram

# UX department — runs at :10 past odd hours
hermes cron create \
  --name myproject-uxui \
  --schedule "10 1-23/2 * * *" \
  --script myproject-uxui.sh \
  --prompt "You are the UX/UI department. Read your SYSTEM.md. Follow research → design → build. Specify every change exactly — current state, proposed state, exact CSS/HTML. Push the craft: distinctive layouts, modern CSS, purposeful motion, and pitch framework/tooling upgrades when they materially raise quality. Name the technique, never say 'cutting-edge.'" \
  --workdir ~/my-project \
  --toolsets terminal,file,browser \
  --deliver telegram

# QA — runs at :40 past odd hours (20 min after R&D, 30 min after UX)
hermes cron create \
  --name myproject-qa \
  --schedule "40 1-23/2 * * *" \
  --script myproject-qa.sh \
  --prompt "You are the QA department..." \
  --workdir ~/my-project \
  --toolsets terminal,file,browser \
  --deliver telegram

# Infra — runs at :55 past even hours
hermes cron create \
  --name myproject-infra \
  --schedule "55 */2 * * *" \
  --script myproject-infra.sh \
  --prompt "You are the Infrastructure department..." \
  --workdir ~/my-project \
  --toolsets terminal,file \
  --deliver telegram

# CEO — twice daily
hermes cron create \
  --name myproject-ceo \
  --schedule "0 10,22 * * *" \
  --script myproject-ceo.sh \
  --prompt "You are the CEO. Inspect all departments, grade A-F, write directives. Reward concrete, ambitious work — real tech upgrades, fully specified designs, measurable before/after — and penalize filler and vague reports." \
  --workdir ~/my-project \
  --toolsets terminal,file,browser \
  --deliver telegram
```

## Step 3.5: Seed Workflow Library

The scaffold does NOT create `confluence/workflows/`. Create it manually after scaffolding:

```bash
mkdir -p ~/my-project/confluence/workflows
```

Seed with initial workflow documents. At minimum:
- `README.md` — index with selection table (which context → which workflow)
- `tdd.md` — Test-Driven Development (bug fixes, new mechanics, refactoring)
- `e2e-first.md` — E2E-First (new features, UI changes, user-facing work)
- `spike.md` — Spike/Exploration (unknown approaches, research)

For game projects, also add:
- `creative-pipeline.md` — game migration with creative polish
- `qa-game-verification.md` — per-game browser verification checklist
- `qa-release-gate.md` — 3 blocking gates before release
- `qa-bug-report.md` — structured bug report format

See `references/qa-workflow-templates.md` for ready-to-use QA templates.

**Why this matters:** HR and PM depend on workflows existing to do their jobs. Without seeded workflows, the workflow bridge and gap analysis processes have nothing to work with. PM will identify gaps, but initial workflows should exist from day 1.

## Step 4: Validate

```bash
bun ~/.hermes/skills/devops/corporate-on-demand/scripts/validate.ts \
  --path ~/my-project
```

## Step 5: Add Morning Report

Create a daily digest cron that summarizes overnight activity. The data-collection script should gather:
- Platform health (API, Docker status)
- All department artifacts modified in the last 12 hours (find -mmin -720)
- state.json snapshot
- Log entries from overnight cycles

```bash
# Morning report script — collects overnight data
#!/bin/bash
PROJ="/path/to/project"
echo "=== HEALTH ===" && curl -s http://localhost:<port>/api/health
echo "=== OVERNIGHT DEPARTMENT WORK ==="
for dept in ceo board rnd uxui infra pm; do
  DDIR="$PROJ/departments/$dept"
  find "$DDIR" -name '*.md' -mmin -720 -exec echo "--- {} ---" \; -exec cat {} \;
done
echo "=== STATE ===" && cat "$PROJ/state.json"
```

Cron job: schedule `0 8 * * *`, deliver to telegram. Prompt should compile a structured briefing:
- Platform status + game count
- Per-department activity summary (skip inactive)
- Pipeline status (researched/pitched/specced/built)
- Changes shipped
- Issues/risks needing attention

## Step 6: Run Alignment Check

After deployment and after any structural changes, run validate + report and compare output against the skill spec:

```bash
BUN=~/.bun/bin/bun
SCRIPTS=~/.hermes/skills/devops/corporate-on-demand/scripts
$BUN $SCRIPTS/validate.ts --path /path/to/project   # structural check
$BUN $SCRIPTS/report.ts --path /path/to/project      # content check
```

Common gaps to look for:
- state.json field names don't match architecture.md schema
- SYSTEM.md missing domain-boundary rules (pitfalls.md §3: domain bleed)
- inbox/done/ directories not created
- Cron prompts reference old field names after schema migration
- Orphan scripts from pre-corporate structure

When fixing field renames (e.g. `gamePipeline` → `pipeline`), check ALL consumers:
1. state.json itself
2. All cron job prompts (they reference fields by name)
3. Data-collection shell scripts
4. TS tool scripts (report.ts, validate.ts)

## Step 7: Iterate

- CEO inspections drive quality improvement
- Adjust SYSTEM.md prompts based on actual output quality
- Add/remove departments as the project evolves
- Use `add-department.ts` for new departments
- **IMPORTANT**: After `add-department.ts`, REPLACE the generated SYSTEM.md with a full version including: identity, pipeline, ownership, domain boundaries, grading rubric, and anti-slop contract. The scaffold output is minimal and will fail validation without these sections.
- For departments that do E2E testing (QA, R&D, CEO), set `enabled_toolsets: ["terminal", "file", "browser"]` on their cron jobs.
- Re-run alignment check (Step 6) after any structural change
