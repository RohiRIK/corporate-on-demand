# AGENTS.md — Corporate on Demand Skill Development Guide

Guidelines for developing and maintaining this skill. Not part of the skill's operational logic.

---

## Conventions

- **Use create-skill workflow for new tooling.** Follow create-skill conventions (SKILL.md router + references/ + scripts/, validate). Don't dump raw files.
- **Explain-then-execute.** When adding a new capability (Sprint Mode, Labs, new dept), explain the plan and get confirmation before writing files. The user wants to review scope first.
- **Snap bun is sandboxed.** Use `~/.bun/bin/bun` (real binary) for scripts that access paths outside the snap sandbox.
- **Never create nested skill dir.** Don't create `skills/<skill-name>/` inside the skill itself. Causes `skill_view` ambiguity.

## Version Bump Checklist

1. ☐ Create/update impl guide in `references/`
2. ☐ Add routing entry in SKILL.md workflow routing table
3. ☐ Bump `version` in SKILL.md frontmatter
4. ☐ Add CHANGELOG.md entry (same version)
5. ☐ Update README.md — version badges, feature tables, architecture diagram, department counts, doc map
6. ☐ Check if live projects need upgrading (`impl-project-upgrade.md` 5-gate flow)

The user audits changelog completeness. Never treat version/changelog as afterthoughts.

## Public Repo Publishing

When pushing a project to a public GitHub repo:
1. Scan for secrets/tokens/API keys first
2. Create `.gitignore` — exclude temp scripts, machine-generated JSON logs, `.hermes/` internal plans, throwaway py files
3. `git rm --cached` already-tracked excluded files before pushing
4. Keep `inbox/done/` — it proves cross-department communication actually works (CEO directive → execution → completion)

## Inspecting Live Projects

- **"What can we improve?" means the LIVE PROJECT, not the skill.** Inspect the deployed project (state.json, departments/, cron jobs, artifacts) against the skill's features. Don't compare skill docs to each other.
