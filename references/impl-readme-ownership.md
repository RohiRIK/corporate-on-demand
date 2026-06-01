# README & Public Documentation Ownership

## Problem

README.md goes stale fast in corporate-on-demand projects. Architecture changes (backend removed, hosting moved, departments added) happen through autonomous cron cycles, but nobody updates the README unless explicitly told to.

Public repos are especially sensitive — the README is the first thing visitors see.

## Ownership

**PM owns README.md.** This is not optional. PM's SYSTEM.md must include:

```markdown
## README Maintenance

You own README.md. After every architecture change, pivot phase completion, or department addition/removal:
1. Verify README accuracy
2. Grep for banned terms: localhost, docker, backend (if removed), config tab, any stale tech
3. Update department table to match actual department count
4. Verify all URLs work
5. Commit changes
```

## Quality Standard

README must be:
- **Accurate** — reflects current architecture, not a past version
- **Professional** — clean formatting, no broken links, no stale references
- **Concise** — overview with links to docs/ for details
- **Public-facing** — no internal config, no exposed admin details

README must NOT contain:
- References to removed components (old backend, old hosting, old engine)
- Internal config details (self-improvement controls, admin panels)
- Localhost URLs (if project is deployed)
- Docker instructions (if project no longer uses Docker)

## QA Validation

QA should include README validation in their regression checklist:
- Grep for banned words after every PM cycle
- Verify department count matches reality
- Verify architecture description matches reality
- Report discrepancies back to PM inbox

## Setup

When creating a project or upgrading to this standard:

1. Add README maintenance section to PM's SYSTEM.md
2. Add README validation to QA's regression checklist
3. Send CEO directive to PM with P1 priority if README is currently stale
4. Add banned-word list to confluence decisions so all departments know what terms are retired

## Lesson Learned

The arcade platform README referenced Docker, backend API, localhost, nginx, Config tab, and 6 departments when the project had already moved to static GitHub Pages with 17 departments and no backend. This was live on a public repo for days before being caught. PM must proactively check README after architecture changes — don't wait for someone to notice.
