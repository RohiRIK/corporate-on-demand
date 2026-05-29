# Company Templates

Pre-built configurations for different project types. Use with `scaffold.ts --template <name>`.

---

## 1. Game Studio (`--template game`)

The original Corporate-on-Demand use case — an arcade platform with multiple browser games.

### Departments
| Dept | SYSTEM.md Focus | Pipeline |
|------|----------------|----------|
| rnd | Game design, mechanics, JS/Canvas game development | research → pitch → spec → build |
| uxui | Game UI, CSS design system, player experience | research → design → build |
| infra | Docker hosting, Nginx, health monitoring, deployment | audit → runbook → execute |
| pm | Game documentation, changelogs, submission standards | review → changelog |
| board | Strategic direction, game portfolio planning | synthesize → coordinate → document |
| ceo | Quality oversight, play-testing, grading | inspect → grade → direct |

### Example CEO Directives
- "Research Tetris as the next game for the arcade platform"
- "Document the current design system tokens"
- "Write a baseline health audit for the Docker stack"
- "Compile a changelog from last week's improvements"

### Reference
See `references/arcade-platform.md` for the full implementation case study.

---

## 2. SaaS Product Company (`--template saas`)

A web SaaS product with features, users, and infrastructure.

### Departments
| Dept | SYSTEM.md Focus | Pipeline |
|------|----------------|----------|
| rnd | Feature development, API design, backend/frontend code | research → pitch → spec → build |
| uxui | Product design, user flows, responsive UI, accessibility | research → design → build |
| infra | Cloud infrastructure, CI/CD, monitoring, scaling | audit → runbook → execute |
| pm | Roadmap tracking, release notes, user-facing docs | review → changelog |
| board | Product strategy, market positioning, prioritization | synthesize → coordinate → document |
| ceo | Quality oversight, product review, customer perspective | inspect → grade → direct |

### Pipeline Adaptations
- R&D specs must include API contract changes and migration plans
- UX designs must include mobile/responsive considerations
- Infra audits include uptime metrics and cost analysis

### Example CEO Directives
- "Research OAuth2 integration for third-party login"
- "Design the onboarding flow for new users"
- "Audit current cloud costs and identify savings"
- "Write release notes for v2.3"

---

## 3. Content Platform (`--template content`)

A publishing platform (blog, CMS, media site).

### Departments
| Dept | SYSTEM.md Focus | Pipeline |
|------|----------------|----------|
| rnd | Publishing tools, editor features, content APIs | research → pitch → spec → build |
| uxui | Reader experience, typography, content layout | research → design → build |
| editorial | Content quality, style guide enforcement, editorial standards | review → edit → publish |
| infra | CDN, media storage, performance, caching | audit → runbook → execute |
| pm | Content calendar, analytics reporting, contributor docs | review → report |
| ceo | Quality oversight, content strategy, reader perspective | inspect → grade → direct |

### Pipeline Adaptations
- Editorial has a unique pipeline: review → edit → publish
- UX research includes reading analytics and scroll-depth data
- Infra audits include page load times and CDN hit rates

### Example CEO Directives
- "Research markdown-based editor improvements"
- "Design a dark mode reading experience"
- "Review last month's top-performing content for patterns"
- "Audit CDN cache hit rates and optimize"

---

## 4. DevTools Company (`--template devtools`)

Building CLI tools, SDKs, or developer-facing products.

### Departments
| Dept | SYSTEM.md Focus | Pipeline |
|------|----------------|----------|
| rnd | CLI/SDK development, API design, plugin architecture | research → pitch → spec → build |
| uxui | Developer experience, documentation site, error messages | research → design → build |
| infra | Release pipeline, package registry, CI/CD, versioning | audit → runbook → execute |
| pm | Changelog, migration guides, API docs, semver tracking | review → changelog |
| board | Developer ecosystem strategy, integration priorities | synthesize → coordinate → document |
| ceo | Quality oversight, dogfooding, developer perspective | inspect → grade → direct |

### Pipeline Adaptations
- R&D specs must include breaking change analysis and migration path
- UX "designs" are often documentation structure and error message copy
- Infra manages npm/PyPI/crates publishing pipelines
- PM tracks semver strictly — breaking changes require board approval

### Example CEO Directives
- "Research plugin system architecture patterns"
- "Design better error messages for the top 10 user-reported issues"
- "Audit the release pipeline for reproducibility"
- "Write migration guide for v3 breaking changes"

---

## 5. Home Automation Lab (`--template homelab`)

IoT and home automation with Docker-based services.

### Departments
| Dept | SYSTEM.md Focus | Pipeline |
|------|----------------|----------|
| rnd | Integration development, protocol bridges, automation rules | research → pitch → spec → build |
| uxui | Dashboard design, mobile-friendly UI, status visualization | research → design → build |
| infra | Docker Swarm/Compose, IoT networking, monitoring, backups | audit → runbook → execute |
| pm | Device inventory, integration docs, troubleshooting guides | review → report |
| ceo | Quality oversight, real-world testing, reliability focus | inspect → grade → direct |

### Pipeline Adaptations
- R&D research includes protocol documentation (Zigbee, Z-Wave, MQTT)
- Infra audits include device connectivity and resource usage
- UX designs must work on small screens and touch interfaces
- No board department — CEO handles strategy directly

### Example CEO Directives
- "Research Zigbee2MQTT integration for the new sensors"
- "Design a unified dashboard for all temperature sensors"
- "Audit Docker container resource usage and set limits"
- "Document the backup and restore procedure"

---

## 6. Data Pipeline Shop (`--template data`)

ETL pipelines, data warehousing, and analytics.

### Departments
| Dept | SYSTEM.md Focus | Pipeline |
|------|----------------|----------|
| rnd | ETL development, data transforms, pipeline logic | research → pitch → spec → build |
| uxui | Dashboards, data visualization, report templates | research → design → build |
| infra | Pipeline orchestration (Airflow/Dagster), storage, scheduling | audit → runbook → execute |
| pm | Data catalog, lineage documentation, SLA tracking | review → report |
| board | Data strategy, source prioritization, compliance | synthesize → coordinate → document |
| ceo | Quality oversight, data accuracy verification, SLA review | inspect → grade → direct |

### Pipeline Adaptations
- R&D specs must include data schema changes and backward compatibility
- UX "designs" are dashboard layouts and visualization choices
- Infra audits include pipeline run times, failure rates, storage growth
- PM tracks data SLAs and freshness guarantees

### Example CEO Directives
- "Research incremental loading for the orders pipeline"
- "Design a real-time revenue dashboard"
- "Audit pipeline failure rates for last 30 days"
- "Document data lineage for the customer analytics table"
