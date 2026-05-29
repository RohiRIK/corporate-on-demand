# Corporate-on-Demand — Strategic Planning Guide

Decision framework for building the right organization based on project needs. Start here before scaffolding.

---

## Step 1: Classify Your Project

| Type | Signal | Template |
|------|--------|----------|
| **Game platform** | Browser games, arcade, interactive entertainment | `game` |
| **SaaS product** | Web app with users, auth, API, billing | `saas` |
| **Content platform** | Blog, docs site, publishing, CMS | `content` |
| **Developer tools** | CLI, SDK, library, API framework | `devtools` |
| **Homelab / Self-hosted** | Docker services, dashboards, IoT, automation | `homelab` |
| **Data pipeline** | ETL, analytics, dashboards, data warehouse | `data` |

If your project doesn't fit — use the closest template and customize departments.

---

## Step 2: Maturity Stage

Your project's maturity determines which departments and mechanisms you need.

### Stage 0 — Idea (nothing built yet)
**Goal**: Get something running fast.

**Departments**: CEO + R&D + Infra (3 only)
**Skip**: Board, PM, UX/UI, HR, QA, Analytics — they add overhead with nothing to manage yet.

**Mechanisms**:
- Fast-track ON by default — no bureaucracy until you have a product
- Single pipeline: research → build (skip pitch/spec for first iteration)
- CEO runs every cycle, not just 2x/day

**When to graduate**: You have a working product accessible on the network.

---

### Stage 1 — MVP (something works)
**Goal**: Polish, stabilize, add structure.

**Add departments**: UX/UI + PM (now 5 total)
**Add mechanisms**:
- Full R&D pipeline enforced (research → pitch → spec → build)
- Anti-slop contract activated
- PM starts changelogs and documentation

**Cron cadence**: Every 2 hours

**When to graduate**: 3+ features/games live, stable for 24h+, docs exist.

---

### Stage 2 — Growing (multiple features, active development)
**Goal**: Coordination, quality, governance.

**Add departments**: Board + QA (now 7 total)
**Add mechanisms**:
- Board meetings for cross-department coordination
- QA testing after each R&D build
- Cross-department meetings for design reviews
- KPI tracking started
- Incident response protocol activated

**Cron cadence**: Every 2 hours, staggered

**When to graduate**: 5+ features, multiple departments producing daily, need for oversight.

---

### Stage 3 — Mature (stable product, ongoing evolution)
**Goal**: Sustainability, innovation, self-improvement.

**Add departments**: IT + DevOps + Security (now 10 total)
**Add mechanisms**:
- Department budgets (scope tokens) — prevent runaway changes
- Retrospectives — monthly self-assessment
- SLA contracts between departments
- Seasonal events / themed cycles
- R&D Labs for experimentation
- Analytics department for usage insights
- HR for performance trends

**Cron cadence**: Every 2 hours, consider reducing some departments to every 4h

**When to graduate**: You don't. This is the steady state. Focus on incremental improvement.

---

### Stage 4 — Enterprise (large scope, multiple products)
**Goal**: Scale the organization itself.

**Add**: Additional R&D teams (R&D-games, R&D-platform), specialized QA, HR active
**Mechanisms**:
- CEO department creation for new product lines
- Mentorship / shadowing across teams
- Internal newsletter for visibility
- External partnership / plugin ecosystem
- Multiple Board meetings per day
- Gibbush days quarterly

---

## Step 3: Choose Your Departments

### Core (always needed)

| Department | Why | When to add |
|-----------|-----|-------------|
| **CEO** | Quality oversight, direction, grades | Stage 0 — always |
| **R&D** | Builds the actual product | Stage 0 — always |
| **Infra** | Keeps it running (Docker, health, networking) | Stage 0 — always |

### Standard (most projects need these)

| Department | Why | When to add |
|-----------|-----|-------------|
| **UX/UI** | Design, CSS, user experience | Stage 1 — when you have users |
| **PM** | Documentation, changelogs, standards | Stage 1 — when you ship changes |
| **Board** | Coordination, strategic decisions | Stage 2 — when 3+ depts exist |
| **QA** | Testing, regression, bug reports | Stage 2 — when you have features to break |

### Advanced (add based on need)

| Department | Why | When to add |
|-----------|-----|-------------|
| **IT** | System health, script maintenance, cleanup | Stage 3 — when corporate system is complex |
| **DevOps** | CI/CD, build automation, releases | Stage 3 — when deployment is non-trivial |
| **Security** | Vulnerability scanning, hardening | Stage 3 — when exposed to network |
| **Analytics** | Usage tracking, data-driven decisions | Stage 3 — when you have real users |
| **HR** | Performance trends, onboarding | Stage 4 — when 8+ departments exist |

---

## Step 4: Choose Your Mechanisms

### Decision Matrix

| Mechanism | Problem it solves | Effort | Add when... |
|-----------|------------------|--------|-------------|
| **Anti-slop contract** | Agents produce filler/vague output | Low | Always — from day 1 |
| **Mandatory pipelines** | Agents skip steps, ship half-baked work | Low | Stage 1+ |
| **Domain boundaries** | Departments step on each other's files | Low | Stage 1+ |
| **Cross-dept meetings** | Departments work in silos | Low | 2+ departments need to coordinate |
| **Fast-track** | High-priority work stuck in pipeline | Low | CEO needs an urgency lever |
| **Incident response** | No structured reaction to failures | Low | Stage 2+ |
| **KPI dashboard** | CEO grades by gut feel, not data | Medium | Stage 2+ |
| **Department budgets** | One department makes 20 changes in a cycle | Low | Stage 3+ or after an incident |
| **Retrospectives** | Processes calcify, no self-improvement | Low | Monthly, Stage 2+ |
| **SLA contracts** | Inbox tasks sit unanswered for days | Low | Stage 3+ |
| **Gibbush days** | Innovation stalls, everything is bureaucracy | Low | Quarterly, Stage 2+ |
| **R&D Labs** | Can't experiment without full pipeline | Medium | Stage 3+ |
| **Seasonal events** | Content feels stale | Low | Stage 2+ |
| **Internal newsletter** | Human operator can't track all departments | Low | Stage 3+ |
| **Mentorship** | Knowledge silos, blind spots | Low | Stage 3+ |
| **CEO dept creation** | No process for growing the org | Medium | Stage 3+ |
| **Analytics** | Building blind — no user data | Medium | Stage 3+ |
| **HR** | Can't track long-term performance | Medium | Stage 4 |
| **Plugin ecosystem** | Want external contributions | Medium | Stage 4 |

---

## Step 5: Cron Schedule Design

### Principles
1. **Board runs first** — sets the table for other departments
2. **R&D and UX/UI don't overlap** — they share files
3. **QA runs after R&D** — tests what was just built
4. **PM runs last** — documents what everyone else did
5. **CEO runs separately** — oversight, not in the cycle
6. **Morning report** — daily briefing for the human operator

### Schedule Templates

**Small org (3-5 departments, every 2h)**:
```
:00  Board (or skip if < 4 depts)
:15  R&D
:30  UX/UI
:45  Infra
:55  PM
```

**Medium org (6-8 departments, staggered even/odd hours)**:
```
Even hours:    :00 Board    :25 R&D      :50 Infra
Odd hours:     :15 UX/UI    :30 QA       :40 PM
CEO:           10:00, 22:00
Morning:       08:00
```

**Large org (9+ departments, 3-tier schedule)**:
```
Even hours:    :00 Board    :15 R&D      :30 QA       :45 Infra
Odd hours:     :00 UX/UI    :15 DevOps   :30 IT       :45 PM
Every 4h:      Security, Analytics
Every 6h:      HR
Daily:         CEO (10:00, 16:00, 22:00), Morning report (08:00)
Weekly:        Retrospective trigger, Newsletter
```

---

## Step 6: Growth Triggers

How to know when to level up:

| Signal | Action |
|--------|--------|
| Departments stepping on each other's files | Add domain boundaries, cross-dept meetings |
| Same bugs keep coming back | Add QA department |
| CEO can't review everything in one inspection | Add Board, reduce CEO to 1x/day |
| Deployment is manual or fragile | Add DevOps department |
| Stale artifacts accumulating, scripts breaking | Add IT department |
| Building features nobody uses | Add Analytics department |
| Agent output quality declining over weeks | Add HR, activate retrospectives |
| Innovation has stopped, only incremental changes | Trigger gibbush day, open R&D Labs |
| External interest in contributing | Build plugin ecosystem |
| Everything feels slow and bureaucratic | Review budgets, consider fast-track, reduce departments |

### Shrinking Triggers (equally important)

| Signal | Action |
|--------|--------|
| A department produces nothing useful for 5+ cycles | CEO pauses or decommissions it |
| Two departments overlap significantly | Merge into one, update SYSTEM.md |
| Cron costs exceed value (too many runs, too much token spend) | Reduce cadence, merge departments |
| Human operator overwhelmed by Telegram messages | Consolidate reports, reduce frequency |

---

## Step 7: Example Builds

### "I want to build a local arcade with browser games"
→ Template: `game`
→ Start: Stage 0 (CEO + R&D + Infra)
→ First cycle: R&D researches Snake, builds it, Infra Dockerizes
→ Graduate to Stage 1 after 3 games
→ Add UX/UI for design system, PM for game submission standard
→ See: `references/arcade-platform.md`

### "I want a self-hosted SaaS dashboard"
→ Template: `saas`
→ Start: Stage 1 (CEO + R&D + UX/UI + Infra + PM)
→ R&D builds API + frontend, UX/UI designs, Infra Dockerizes
→ Add QA early — SaaS bugs affect users directly
→ Add DevOps for CI/CD pipeline
→ Add Security for auth/input validation audit

### "I want a homelab management dashboard"
→ Template: `homelab`
→ Start: Stage 0 (CEO + R&D + Infra)
→ R&D builds integrations, Infra manages Docker Swarm
→ Add UX/UI for dashboard design
→ Add Security early — homelab is network-exposed
→ Analytics useful for monitoring device health

### "I want a documentation / content site"
→ Template: `content`
→ Start: Stage 1 (CEO + R&D + UX/UI + PM)
→ Skip Infra initially if using static hosting
→ PM is critical — owns content quality standards
→ Add Board for editorial calendar
→ Seasonal events for content campaigns

### "I want a CLI tool / developer SDK"
→ Template: `devtools`
→ Start: Stage 1 (CEO + R&D + PM + Infra)
→ PM owns API docs, migration guides, changelog
→ Add DevOps for release pipeline (semver, npm/crate publish)
→ QA critical — developers have zero tolerance for bugs
→ UX/UI focuses on DX (error messages, help text, docs site)

### "I want a data pipeline / ETL system"
→ Template: `data`
→ Start: Stage 1 (CEO + R&D + Infra + PM)
→ R&D builds transforms, Infra manages orchestration
→ Add QA for data validation tests
→ Add Analytics (meta: analytics on your analytics pipeline)
→ Security for data access controls
→ Board for data strategy and source prioritization
