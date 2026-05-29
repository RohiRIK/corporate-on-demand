# KPI Dashboard & Metrics

## Overview

The PM/IT department maintains a `metrics.json` file updated each cycle with per-department KPIs. The CEO uses these metrics alongside subjective grades for objective evaluation. Optionally, a dashboard can be rendered as HTML on the platform itself.

## metrics.json Schema

```json
{
  "lastUpdated": "2025-03-14T16:00:00Z",
  "cycle": 42,
  "departments": {
    "r-and-d": {
      "gamesShipped": 5,
      "gamesInProgress": 2,
      "pipelineThroughputDays": 3.2,
      "buildsThisCycle": 1,
      "buildSuccessRate": 1.0,
      "openBugsAssigned": 3,
      "codeQuality": "good"
    },
    "ux": {
      "designDocsProduced": 8,
      "implementationRate": 0.75,
      "designConsistencyScore": "high",
      "briefsInProgress": 2,
      "revisionsRequested": 1
    },
    "infra": {
      "uptimePercent": 99.8,
      "auditFrequency": "every cycle",
      "lastAuditDate": "2025-03-14T15:00:00Z",
      "runbookCoverage": 0.9,
      "incidentsThisPeriod": 0,
      "deploySuccessRate": 1.0
    },
    "pm": {
      "changelogFreshness": "current",
      "lastChangelogUpdate": "2025-03-14T15:30:00Z",
      "docCoverage": 0.85,
      "reportCadence": "every cycle",
      "reportsProduced": 12
    },
    "qa": {
      "testsRun": 45,
      "passRate": 0.91,
      "bugsFound": 4,
      "bugsVerified": 3,
      "regressionRuns": 6
    },
    "board": {
      "decisionsMade": 8,
      "actionItemsTotal": 12,
      "actionItemsCompleted": 10,
      "completionRate": 0.83,
      "meetingsHeld": 4
    }
  }
}
```

## Per-Department Metrics

### R&D
| Metric | Description | Good Target |
|--------|-------------|-------------|
| `gamesShipped` | Total games deployed to platform | Trending up |
| `gamesInProgress` | Active builds in pipeline | 1-3 |
| `pipelineThroughputDays` | Avg days from brief to deploy | < 5 |
| `buildSuccessRate` | Builds that pass QA first try | > 0.8 |
| `openBugsAssigned` | Unresolved bugs assigned to R&D | Trending down |
| `codeQuality` | Subjective: poor/fair/good/excellent | good+ |

### UX
| Metric | Description | Good Target |
|--------|-------------|-------------|
| `designDocsProduced` | Total design specs created | Trending up |
| `implementationRate` | % of designs that became builds | > 0.7 |
| `designConsistencyScore` | Adherence to design system | high |
| `revisionsRequested` | Times Board/CEO asked for redo | < 2/cycle |

### Infra
| Metric | Description | Good Target |
|--------|-------------|-------------|
| `uptimePercent` | Platform availability | > 99.5% |
| `auditFrequency` | How often audits run | Every cycle |
| `runbookCoverage` | % of systems with documented runbooks | > 0.85 |
| `incidentsThisPeriod` | Number of incidents | 0 |
| `deploySuccessRate` | Deploys without rollback | > 0.95 |

### PM
| Metric | Description | Good Target |
|--------|-------------|-------------|
| `changelogFreshness` | Is changelog up to date? | "current" |
| `docCoverage` | % of features/games documented | > 0.8 |
| `reportCadence` | How often reports are produced | Every cycle |
| `reportsProduced` | Total reports written | Trending up |

### QA
| Metric | Description | Good Target |
|--------|-------------|-------------|
| `testsRun` | Total test cases executed | Trending up |
| `passRate` | % of tests passing | > 0.9 |
| `bugsFound` | Bugs discovered this period | Context-dependent |
| `bugsVerified` | Fix verifications completed | Close to bugsFound |

### Board
| Metric | Description | Good Target |
|--------|-------------|-------------|
| `decisionsMade` | Strategic decisions this period | Active governance |
| `actionItemsCompleted` | Completed vs total action items | > 0.8 ratio |
| `completionRate` | Action item completion rate | > 0.8 |

## Who Maintains metrics.json

**PM department** updates `metrics.json` at the end of each cycle by:

1. Reading each department's output folders for counts
2. Checking `state.json` for incident/uptime data
3. Aggregating into the schema above
4. Writing to `metrics.json` at the project root

## CEO Usage

The CEO reads `metrics.json` during evaluation cycles to:

- Compare objective metrics against subjective department grades
- Identify trends (improving/declining departments)
- Justify grade changes with data
- Set targets for next period

```markdown
## CEO Evaluation Checklist
1. Read metrics.json
2. Compare each dept's metrics to targets
3. Cross-reference with grades in state.json
4. Adjust grades if metrics diverge from current grade
5. Write feedback citing specific metrics
```

## Optional: HTML Dashboard

PM can generate a dashboard page deployed on the platform:

```html
<!-- departments/pm/dashboard/index.html -->
<!DOCTYPE html>
<html>
<head>
  <title>Company KPI Dashboard</title>
  <style>
    body { font-family: system-ui; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.5rem; }
    .card h3 { color: #38bdf8; margin-top: 0; }
    .metric { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #334155; }
    .value { font-weight: bold; color: #4ade80; }
  </style>
</head>
<body>
  <h1>📊 KPI Dashboard</h1>
  <p>Last updated: <span id="updated"></span></p>
  <div class="grid" id="dashboard"></div>
  <script>
    fetch('/metrics.json')
      .then(r => r.json())
      .then(data => {
        document.getElementById('updated').textContent = data.lastUpdated;
        const grid = document.getElementById('dashboard');
        for (const [dept, metrics] of Object.entries(data.departments)) {
          const card = document.createElement('div');
          card.className = 'card';
          card.innerHTML = `<h3>${dept.toUpperCase()}</h3>` +
            Object.entries(metrics).map(([k, v]) =>
              `<div class="metric"><span>${k}</span><span class="value">${v}</span></div>`
            ).join('');
          grid.appendChild(card);
        }
      });
  </script>
</body>
</html>
```

Infra can deploy this alongside the main platform for CEO and Board access.
