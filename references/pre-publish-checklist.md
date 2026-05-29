# Pre-Publish Checklist

Run before `hermes skills publish` or pushing to a public registry.

## Checklist

1. **Version match** — SKILL.md frontmatter `version:` matches CHANGELOG.md latest entry
2. **No hardcoded paths** — grep for `/home/`, absolute user paths. Replace with `~/` or `$PROJ`
   ```bash
   grep -rn '/home/' . --include='*.md' --include='*.ts' | grep -v '.git/' | grep -v 'example-'
   ```
3. **No hardcoded IPs** — grep for `10.x`, `192.168.x`, `localhost` in non-example files
4. **Author field** — should be the human author, not "Hermes Agent"
5. **Project-specific files** — rename to `example-*` with a disclaimer header, or remove
6. **License** — frontmatter has `license:` field
7. **README.md** — exists, describes what the skill does, install instructions
8. **CHANGELOG.md** — exists, latest version matches frontmatter

## Example disclaimer header for project-specific files
```markdown
> **NOTE:** This is an example deployment. Your paths, IPs, and configuration will differ.
```

## Publishing paths
- **GitHub (works now):** `hermes skills install https://raw.githubusercontent.com/<user>/<repo>/main/SKILL.md`
- **Tap:** `hermes skills tap add <user>/<repo>`
- **ClawHub/skills.sh:** web-only submission (no CLI publish yet)
- **Hermes native registry:** no self-serve publish as of May 2026
