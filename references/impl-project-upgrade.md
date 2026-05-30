# Project Upgrade Flow

Deployed Corporate-on-Demand projects don't auto-update when the skill evolves. This guide is the formal process for upgrading an existing live project to match the current skill version.

## When to Use

- Skill version bumped with new features (departments, scripts, governance sections)
- User says "upgrade the company" or "bring project up to date"
- Gap analysis reveals missing departments, sections, or state fields
- Before a pivot — ensure the org is fully staffed first

## Upgrade Pipeline (5 gates)

### Gate 1 — Gap Analysis

**Do not guess. Inspect both sides.**

1. Read the skill's SKILL.md — note all listed departments, features, scripts
2. Read the skill's CHANGELOG.md — trace what was added since the project was last upgraded
3. Read the skill's `company-templates.md` — check which departments the project's template type expects
4. Inspect the live project:
   - `departments/` — which departments exist?
   - Each `SYSTEM.md` — which sections are present? (confluence, pivoting, grading, anti-slop, pipeline, inbox)
   - `CORPORATE.md` — which governance sections exist?
   - `state.json` — which tracking fields exist?
   - Cron jobs — which departments have cron jobs? What scripts do they use?
   - `~/.hermes/scripts/` — which data-collection scripts exist?
5. Produce a gap report:

```markdown
## Gap Report: <project> vs skill v<version>

### Missing Departments
| Department | Role | Impl Guide |
|-----------|------|------------|
| cto | Technical oversight | csuite-layer-plan.md |

### Missing SYSTEM.md Sections (across all departments)
- [ ] Confluence section
- [ ] Pivoting section (CEO only)

### Missing CORPORATE.md Sections
- [ ] Confluence
- [ ] Pivoting

### Missing state.json Fields
- [ ] confluence
- [ ] pivot
- [ ] style_palette

### Missing Cron Jobs
| Department | Schedule | Script needed |
|-----------|----------|---------------|

### Missing Scripts
| Script | Purpose |
|--------|---------|

### Missing Directories
- [ ] confluence/{decisions,technical,runbooks,postmortems}
```

### Gate 2 — Upgrade Plan

Based on the gap report, create an ordered execution plan:

1. **Governance first** — Update CORPORATE.md and DELEGATION.md with new sections
2. **State fields** — Add new fields to state.json
3. **Directories** — Create new directory structures
4. **Existing departments** — Patch SYSTEM.md files with new sections
5. **New departments** — Create SYSTEM.md, subdirectories, cron scripts, cron jobs
6. **Wiring** — Ensure cron job prompts reference new scripts and capabilities

Order matters: governance docs define rules that departments reference. state.json fields must exist before departments try to read/write them.

### Gate 3 — Execute

**For each new department, the full wiring is:**

1. Create department directory: `departments/<dept>/`
2. Create subdirectories: `departments/<dept>/inbox/`, `departments/<dept>/inbox/done/`, plus domain-specific artifact dirs
3. Write full SYSTEM.md with all required sections:
   - Identity (who you are, what you own)
   - Pipeline (mandatory stages)
   - Domain boundaries (must NOT touch)
   - Artifacts (what you produce and where)
   - Anti-slop contract (banned words, grading rubric)
   - Inbox protocol
   - Confluence section
   - Any role-specific sections (e.g., Pivoting for CEO)
4. Create data-collection shell script at `~/.hermes/scripts/arcade-<dept>.sh`:
   - Injects CORPORATE.md, SYSTEM.md, inbox, state.json, domain artifacts
   - For C-Suite roles: calls `csuite-report.ts --role <role>` instead of raw cat
5. Create cron job:
   - Prompt with full department identity
   - Script reference
   - Correct schedule (stagger to avoid collisions)
   - Correct delivery target (local vs telegram)
   - Correct toolsets
   - Workdir set to project root
6. Add department to `state.json`:
   - `departmentGrades.<dept>`
   - `ceoDirectives.<dept>`
   - Any role-specific fields

**For existing department SYSTEM.md patches:**
- Read each file first
- Append new sections at the end
- Don't overwrite existing content
- Use `patch` tool, never `write_file`

**For CORPORATE.md patches:**
- Add new sections before `## Control`
- Keep existing sections intact

### Gate 4 — Validate

Run validation checks:

```bash
BUN=~/.bun/bin/bun
SCRIPTS=~/.hermes/skills/devops/corporate-on-demand/scripts

# Validate project structure
$BUN $SCRIPTS/validate.ts --path <project>

# Verify all cron jobs are scheduled
hermes cron list | grep arcade

# Test each new data-collection script
bash ~/.hermes/scripts/arcade-<dept>.sh | head -20

# Verify state.json is valid JSON
python3 -c "import json; json.load(open('<project>/state.json'))"
```

### Gate 5 — Document

1. Note the upgrade in `confluence/decisions/UPGRADE-v<version>.md`
2. Update any project-level changelog
3. CEO should review new departments on next inspection cycle

## Upgrade Scope Reference

Quick reference for what each skill version added:

| Version | What was added |
|---------|---------------|
| v2.0 | Base 6 departments (CEO, Board, R&D, UX/UI, Infra, PM) |
| v3.0 | Skill refactor, scaffold.ts, validate.ts, templates |
| v3.2 | 20 impl guides, ideas backlog, strategy guide |
| v3.3 | QA, IT, DevOps, Security departments + grading rubrics |
| v3.4 | C-Suite layer (CTO, CISO, CPO, CFO scripts), shared tools |
| v3.5 | Confluence, Pivoting flow, project upgrade flow |
| v3.6 | Sprint Mode (org-wide acceleration, 6 levers), R&D Labs as default |

## Anti-Patterns

- **Blind scaffold over existing project** — scaffold.ts creates from scratch. For existing projects, use gap analysis + targeted patches.
- **Patching SYSTEM.md without reading it first** — each department's SYSTEM.md may have evolved through autonomous operation. Read before patching.
- **Adding departments without cron jobs** — a department directory without a cron job is dead. The full wiring (SYSTEM.md + script + cron + state.json entry) is the minimum viable department.
- **Guessing what's missing** — always inspect the live project. Don't assume from memory. The project may have evolved autonomously in ways not tracked by the skill.
- **Upgrading during active pivot** — if `state.json.pivot.active` is true, upgrades should wait unless the upgrade is required by the pivot.

## Automation Opportunity

A future `upgrade.ts` script could:
1. Read current project state
2. Compare against skill's template expectations
3. Generate a gap report
4. Optionally apply patches interactively

This doesn't exist yet. Until it does, use this manual flow.
