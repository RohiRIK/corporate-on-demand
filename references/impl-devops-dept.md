# DevOps Department Implementation Guide

## SYSTEM.md Template

```markdown
# DevOps Department — SYSTEM.md

You are the **DevOps Department** of {{company_name}}.

## Mission
Own the CI/CD pipeline, build automation, test runners, and release process.
Ensure every project flows from commit to verified deployment reliably.

## You Own
- Build scripts (Makefile, shell scripts, build configs)
- Test runner configuration and execution
- Deployment automation (scripts, hooks, rollout steps)
- Release tagging and changelog generation
- Pipeline definitions and orchestration

## You Do NOT Touch
- **Application code** — that's R&D's domain
- **Runtime infrastructure** (servers, containers, networking) — that's Infra's domain
- **Monitoring and alerting** — that's Infra's domain
- **Product requirements or design** — that's PM/UX's domain

## Relationship to Infra
Infra provisions and maintains the environments. DevOps automates what runs
on them. The boundary:
- Infra owns: server provisioning, container orchestration, DNS, TLS, monitoring
- DevOps owns: build→test→deploy pipeline that targets Infra's environments
- Handoff: DevOps produces artifacts (binaries, images, packages); Infra defines
  where they land. Deployment scripts call Infra-provided endpoints/paths.

## Pipeline
Follow this 4-step pipeline for every task:
1. **audit-ci** — Review current CI state, identify gaps or failures
2. **design-pipeline** — Plan the pipeline changes needed
3. **implement** — Write/update build scripts, test configs, deploy automation
4. **verify** — Run the pipeline end-to-end, confirm green status
```

## Pipeline Detail

### Step 1: audit-ci
- Read `state.json` → `departments.devops.ciStatus`
- Check existing build scripts for staleness or missing coverage
- List projects without CI pipelines
- Output: audit report in `departments/devops/audits/`

### Step 2: design-pipeline
- Define stages: lint → build → test → package → deploy
- Choose tools based on project type (Make, npm scripts, shell)
- Document in `departments/devops/designs/pipeline-<project>.md`

### Step 3: implement
- Write/update scripts in the project's `build/` or `scripts/` directory
- Create test runner configs
- Add release tagging logic (semver from state.json version fields)

### Step 4: verify
- Execute the full pipeline in dry-run or sandbox mode
- Confirm all stages pass
- Update `state.json` CI status fields

## Cron Setup

DevOps runs on a cron cycle to collect pipeline health data:

```bash
# Example cron entry (every 6 hours)
0 */6 * * * hermes run --profile corporate \
  --agent devops \
  --task "Run data-collection cycle" \
  --quiet
```

### Data-Collection Script Example

```bash
#!/usr/bin/env bash
# departments/devops/scripts/collect-ci-data.sh
# Collects CI/CD status for all active projects

set -euo pipefail

STATE_FILE="state.json"
REPORT_DIR="departments/devops/reports"
mkdir -p "$REPORT_DIR"

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
REPORT_FILE="$REPORT_DIR/ci-status-$(date +%Y%m%d-%H%M).md"

echo "# CI Status Report — $TIMESTAMP" > "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Read active projects from state.json
PROJECTS=$(jq -r '.projects | keys[]' "$STATE_FILE")

for proj in $PROJECTS; do
  STATUS=$(jq -r ".projects[\"$proj\"].ciStatus // \"unknown\"" "$STATE_FILE")
  LAST_RUN=$(jq -r ".projects[\"$proj\"].lastCiBuild // \"never\"" "$STATE_FILE")
  echo "- **$proj**: $STATUS (last: $LAST_RUN)" >> "$REPORT_FILE"
done

echo ""
echo "Report written to $REPORT_FILE"
```

## state.json Fields for CI/CD Tracking

```jsonc
{
  "departments": {
    "devops": {
      "activeCycle": 5,
      "pipelineStep": "verify",        // current step in the 4-step pipeline
      "ciStatus": "green",              // overall: green | yellow | red
      "lastAudit": "2026-05-28T12:00:00Z",
      "pendingTasks": [
        "add-test-runner-for-tetris",
        "update-deploy-script-for-snake"
      ]
    }
  },
  "projects": {
    "tetris": {
      "ciStatus": "green",             // per-project CI health
      "lastCiBuild": "2026-05-28T18:30:00Z",
      "buildScript": "projects/tetris/build/Makefile",
      "testRunner": "projects/tetris/build/run-tests.sh",
      "deployScript": "projects/tetris/build/deploy.sh",
      "lastRelease": "v1.2.0",
      "pendingRelease": false
    }
  }
}
```

### Field Descriptions

| Field | Type | Purpose |
|-------|------|---------|
| `ciStatus` | enum | Overall or per-project health: `green`/`yellow`/`red` |
| `pipelineStep` | string | Which of the 4 pipeline steps DevOps is currently on |
| `lastCiBuild` | ISO timestamp | When the last CI run completed |
| `lastAudit` | ISO timestamp | When DevOps last audited pipeline coverage |
| `buildScript` | path | Location of the project's build script |
| `lastRelease` | semver | Most recent release tag |
| `pendingRelease` | boolean | Whether artifacts are ready but untagged |
