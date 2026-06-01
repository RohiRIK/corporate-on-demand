# Role Expansion — Filling Gaps Instead of Removing Departments

## Problem

Static/simple projects end up with departments (Infra, IT, DevOps) that run every 2 hours but report "all nominal" — burning tokens on repetitive checks with no actionable output. First instinct is to merge or remove them. Better approach: expand their charter to fill real operational gaps.

## Expansion Candidates

### Infra → Infra & Performance
| Existing | Added |
|----------|-------|
| Health checks, CPU/RAM, uptime | Lighthouse CI (perf/a11y/SEO scores, alert if <80) |
| Container status | Post-deploy smoke test (verify live site after deploy) |
| Log monitoring | Bundle size tracking (JS/CSS budget, alert if exceeded) |
| | Asset optimization recommendations (unminified JS, unused CSS) |

### IT → IT & Operations Intelligence
| Existing | Added |
|----------|-------|
| Repo structure scans | **Inbox watchdog** — scan all dept inboxes, escalate P0/P1 stuck >4h |
| JSON validation | Dependency audit (`npm outdated`, flag 2+ major behind) |
| Log naming | Documentation freshness (confluence docs stale >7 days) |
| Orphan file detection | Cross-department sync (state.json vs actual repo state) |

### DevOps → DevOps & Release Engineering
| Existing | Added |
|----------|-------|
| CI/CD pipeline | Post-deploy verification (hash compare local vs live) |
| Docker builds | Deploy diff report (what changed, which games affected) |
| npm audit | Playwright E2E foundation (test suite for all games) |
| | Release notes generation |

## Implementation Steps

1. Write `confluence/decisions/` document with full spec (what, why, success criteria)
2. Send HR inbox message with exact SYSTEM.md additions per department
3. Send each department an inbox notification about their expanded role
4. Send CEO a tracking message with implementation checklist
5. HR updates SYSTEM.md files on next cycle
6. Departments pick up new responsibilities on their next cycle after SYSTEM.md update

## Success Criteria

- Zero "all nominal, nothing to do" cycles
- Infra reports Lighthouse scores every cycle
- IT catches stuck inbox messages within 4 hours
- DevOps verifies every deploy within 10 minutes

## Arcade Platform Case Study (June 2026)

- Infra ran 38 cycles of "Backend healthy, 23MB RAM" on a static GitHub Pages site
- IT ran 22 consecutive "all clean" cycles checking JSON naming
- HR inbox had 5 P1 messages stuck for a week — nobody noticed because IT didn't have an inbox watchdog
- After expansion: IT would have caught the HR bottleneck in 2 cycles (4 hours)

## Key Principle

Every department cycle must produce **actionable data**. If a department can only say "everything is fine," it needs more responsibility — not removal.
