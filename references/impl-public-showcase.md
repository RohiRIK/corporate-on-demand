# Public Showcase — Publishing a Project Repo

## When to Use
When making a corporate-on-demand project publicly visible on GitHub as a demonstration of autonomous multi-agent development.

## What to Keep (showcase value)
- **All SYSTEM.md** — shows how each department operates
- **CORPORATE.md, DELEGATION.md** — governance structure
- **Confluence** — decisions, pivot docs, upgrade docs
- **Inbox (including done/)** — cross-department communication flow is one of the most impressive parts. Shows CEO directives → execution → completion
- **R&D pipeline** — research → pitches → specs (autonomous work artifacts)
- **Creative artifacts** — scripts, creative direction docs
- **QA screenshots + test plans + regression reports + bug reports**
- **Board minutes** — autonomous governance in action
- **CEO reviews** — inspection cycle output
- **CTO architecture + directives**
- **Security advisories + audits + hardening**
- **DevOps pipelines** — CI/CD design docs
- **PM changelogs + reports + standards**
- **UX/UI designs + research + styleguide**
- **IT scans + fixes** — housekeeping proof
- **Analytics reports**
- **state.json** — the shared org brain
- **All app code** (backend, frontend, docker-compose)

## What to Exclude
- Temp/throwaway scripts at project root (`tmp_*.py`, `*_update*.py`, one-off `.sh`)
- Machine-generated JSON cycle logs (`logs/*.json`, `departments/*/logs/*.json`)
- `.hermes/` directory (local Hermes plans)
- Throwaway helper scripts inside departments (`_update_state.py`)

Use `templates/gitignore-public-repo` as a starting point.

## Security Check Before Push
```bash
# Scan for secrets — must return zero real hits
grep -r 'token\|secret\|password\|api.key\|apikey\|API_KEY' \
  --include='*.json' --include='*.js' --include='*.py' \
  --include='*.sh' --include='*.env' -l
ls .env* 2>/dev/null
```
False positives: budget "tokens" (in-game resource tracking) are not secrets.

## Hosting
- **GitHub Pages** — free, zero config, works for static frontends. Requires public repo on free tier.
- **Vercel** — free tier, auto-deploy on push, custom domain support.
- Both work post-pivot (LittleJS is pure client-side JS, no server needed).

## Deployment Flow
1. Create `.gitignore` from `templates/gitignore-public-repo`
2. `git rm --cached` excluded files already tracked
3. Security scan (no secrets)
4. `gh repo create --public -s . --push`
5. Send CEO directive to DevOps for GitHub Pages setup
6. Link the live demo in the skill's README

## README.md Ownership

For public repos, README.md is the public face and must be actively maintained:

**Owner:** PM department (primary), QA (validation)

**PM responsibilities:**
1. Write and maintain README.md — accurate, professional, concise
2. After every architecture change or pivot phase, verify accuracy
3. Grep for stale references before committing (banned words: localhost, docker, backend, etc.)
4. Add README review to PM's cycle checklist

**QA responsibilities:**
1. After PM updates README, validate: no stale references, all URLs work, department count matches, architecture description is current
2. Add README validation to regression checklist

**Confluence decision:** Write a `confluence/decisions/` doc defining the README standard — what must be included, what's banned, quality expectations. This is the source of truth PM follows.

**Common README staleness:** After migrating from Docker/backend to static (e.g. GitHub Pages), the README still references localhost, docker compose, backend API, config panels. PM must rewrite, not just patch — the old structure doesn't apply.

## CEO Directive Template
DevOps should receive a directive covering:
- Enable GitHub Pages (main branch)
- Verify README renders correctly
- Add GitHub topics/tags
- Set up auto-deploy on push
- Coordinate with QA for live site verification
