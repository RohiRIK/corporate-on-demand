# Setup Guide

## Step 1: Scaffold the Project

Use the scaffold tool or create manually:
```bash
bun ~/.hermes/skills/devops/corporate-on-demand/scripts/scaffold.ts \
  --name my-project --path /home/rohi/my-project --template saas
```

## Step 2: Create Data-Collection Scripts

Each department needs a shell script in `~/.hermes/scripts/` that collects context for the agent:

```bash
#!/bin/bash
# ~/.hermes/scripts/myproject-rnd.sh
PROJ="/home/rohi/my-project"
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

Use Hermes cron to create staggered jobs:

```python
# R&D department — runs at :25 past even hours
hermes cron create \
  --name myproject-rnd \
  --schedule "25 */2 * * *" \
  --script myproject-rnd.sh \
  --prompt "You are the R&D department. Read your SYSTEM.md for identity and pipeline rules. Follow the pipeline strictly: research → pitch → spec → build. If no spec exists for your current directive, write the spec. Do NOT build yet." \
  --workdir /home/rohi/my-project \
  --toolsets terminal,file \
  --deliver telegram

# UX department — runs at :15 past odd hours
hermes cron create \
  --name myproject-uxui \
  --schedule "15 1-23/2 * * *" \
  --script myproject-uxui.sh \
  --prompt "You are the UX/UI department..." \
  --workdir /home/rohi/my-project \
  --toolsets terminal,file \
  --deliver telegram

# Infra — runs at :50 past even hours
hermes cron create \
  --name myproject-infra \
  --schedule "50 */2 * * *" \
  --script myproject-infra.sh \
  --prompt "You are the Infrastructure department..." \
  --workdir /home/rohi/my-project \
  --toolsets terminal,file \
  --deliver telegram

# CEO — twice daily
hermes cron create \
  --name myproject-ceo \
  --schedule "0 10,22 * * *" \
  --script myproject-ceo.sh \
  --prompt "You are the CEO. Inspect all departments, grade A-F, write directives..." \
  --workdir /home/rohi/my-project \
  --toolsets terminal,file,browser \
  --deliver telegram
```

## Step 4: Validate

```bash
bun ~/.hermes/skills/devops/corporate-on-demand/scripts/validate.ts \
  --path /home/rohi/my-project
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
- Re-run alignment check (Step 6) after any structural change
