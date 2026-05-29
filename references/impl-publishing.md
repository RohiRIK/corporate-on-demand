# Publishing & Distribution

## How Users Install This Skill

### Direct URL (works now, any Hermes user)
```bash
hermes skills install https://raw.githubusercontent.com/<owner>/<repo>/main/SKILL.md
```

### Tap (auto-updates)
```bash
hermes skills tap add <owner>/<repo>
```

## Registry Status (as of May 2026)

### Hermes Skills Hub
- No self-serve publish command exists
- `hermes skills publish --to github` creates a PR on YOUR repo (fork+PR), not a registry submission
- Community skills appear via sources: `official`, `skills-sh`, `browse-sh`, `lobehub`, `clawhub`
- No way to push into these from CLI — each has its own intake process

### ClawHub (clawhub.ai)
- `hermes skills publish --to clawhub` prints "not yet supported"
- Manual submission at https://clawhub.ai/publish-skill (requires GitHub sign-in)
- This is OpenClaw's registry, not Hermes-native

### skills.sh
- No submit form, no login, no API for publishing
- Automatic indexing via install telemetry: `npx skills add <owner>/<repo>`
- Once installed by users, appears on leaderboard automatically
- Read-only API (search, list, detail, audit)

## Pre-Publish Checklist
Before distributing:
1. Version in SKILL.md frontmatter matches latest changes
2. Author field set to actual author (not "Hermes Agent")
3. No hardcoded `/home/<user>/` paths — use `~/` or `$PROJ`
4. Project-specific files clearly marked as examples (rename `foo.md` → `example-foo.md`)
5. CHANGELOG.md exists and is current
6. README.md exists with install instructions
7. `hermes skills publish --to github --repo <owner>/<repo>` scan passes (verdict: SAFE)

## Revoking Registry Access to GitHub
If you authorized ClawHub/OpenClaw and want to revoke:
1. https://github.com/settings/installations — find claw/openclaw → **Uninstall**
2. https://github.com/settings/apps/authorizations — find claw/openclaw → **Revoke**
