# HR Department Implementation

## Mission

Track department performance over time, identify trends, produce health reports, and maintain onboarding documentation for new departments. HR is the institutional memory of the corporation.

## SYSTEM.md Template

```markdown
# Department: HR

## Mission
Track performance trends, maintain onboarding docs, and produce department health reports.

## Owns
- performance/<dept>-weekly.md — Weekly grade snapshots per department
- reports/weekly-hr.md — Consolidated weekly HR report
- onboarding/<template>.md — Onboarding checklists for new departments
- hr-data.json — Historical grade and metric tracking

## Must NOT Touch
- Actual grading (CEO assigns grades during inspection)
- Department content, code, or artifacts
- Infrastructure or cron configuration
- state.json (reads only, except own department section)

## Pipeline
1. **Collect Grades** — Read latest grades from state.json
2. **Analyze Trends** — Compare against historical data
3. **Recommend** — Flag departments needing attention
4. **Report** — Write weekly HR report

## Reports To
CEO (via outbox/)

## Receives Directives From
CEO, Board (via inbox/)

## Cycle Schedule
25 * * * * — Every hour at :25
```

## Pipeline Detail

### Phase 1: Collect Grades

Read current grades from state.json and append to hr-data.json:

```typescript
function collectGrades(stateFile: string, hrDataFile: string): void {
  const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
  const hrData = existsSync(hrDataFile)
    ? JSON.parse(readFileSync(hrDataFile, 'utf-8'))
    : { history: [], weeklySnapshots: [] };

  const snapshot = {
    timestamp: new Date().toISOString(),
    grades: {} as Record<string, string>,
  };

  for (const [dept, data] of Object.entries(state.departments)) {
    snapshot.grades[dept] = (data as any).grade || 'ungraded';
  }

  hrData.history.push(snapshot);

  // Keep last 90 days of hourly snapshots
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  hrData.history = hrData.history.filter(
    (s: any) => new Date(s.timestamp).getTime() > cutoff
  );

  writeFileSync(hrDataFile, JSON.stringify(hrData, null, 2));
}
```

### Phase 2: Analyze Trends

```typescript
interface TrendAnalysis {
  dept: string;
  currentGrade: string;
  previousGrade: string;
  trend: 'improving' | 'stable' | 'declining' | 'new';
  consecutiveBelow: number;  // cycles below "C" grade
}

function analyzeTrends(hrData: any): TrendAnalysis[] {
  const gradeOrder = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'];
  const analyses: TrendAnalysis[] = [];

  // Get last N snapshots per department
  const depts = new Set<string>();
  for (const snap of hrData.history) {
    Object.keys(snap.grades).forEach(d => depts.add(d));
  }

  for (const dept of depts) {
    const grades = hrData.history
      .map((s: any) => s.grades[dept])
      .filter(Boolean);

    if (grades.length < 2) {
      analyses.push({ dept, currentGrade: grades[0] || 'ungraded', previousGrade: 'N/A', trend: 'new', consecutiveBelow: 0 });
      continue;
    }

    const current = grades[grades.length - 1];
    const previous = grades[grades.length - 2];
    const currentIdx = gradeOrder.indexOf(current);
    const previousIdx = gradeOrder.indexOf(previous);

    let consecutiveBelow = 0;
    for (let i = grades.length - 1; i >= 0; i--) {
      if (gradeOrder.indexOf(grades[i]) > gradeOrder.indexOf('C')) consecutiveBelow++;
      else break;
    }

    analyses.push({
      dept,
      currentGrade: current,
      previousGrade: previous,
      trend: currentIdx < previousIdx ? 'improving' : currentIdx > previousIdx ? 'declining' : 'stable',
      consecutiveBelow,
    });
  }

  return analyses;
}
```

### Phase 3: Recommend

```typescript
interface Recommendation {
  dept: string;
  action: string;
  urgency: 'urgent' | 'watch' | 'info';
}

function recommend(analyses: TrendAnalysis[]): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const a of analyses) {
    if (a.consecutiveBelow >= 3) {
      recs.push({ dept: a.dept, action: 'CEO review needed — 3+ cycles below C', urgency: 'urgent' });
    } else if (a.trend === 'declining') {
      recs.push({ dept: a.dept, action: `Declining: ${a.previousGrade} → ${a.currentGrade}`, urgency: 'watch' });
    } else if (a.trend === 'improving') {
      recs.push({ dept: a.dept, action: `Improving: ${a.previousGrade} → ${a.currentGrade}`, urgency: 'info' });
    }
  }

  return recs;
}
```

### Phase 4: Report

Write the weekly HR report:

```markdown
# Weekly HR Report — <date>

## Department Health Summary

| Department | Grade | Trend | Notes |
|------------|-------|-------|-------|
| Engineering | B+ | ↑ improving | Was B last week |
| Sales | C- | ↓ declining | 2nd week below C |
| IT | A | → stable | |

## Recommendations

### 🔴 Urgent
- **Sales**: CEO review needed — declining for 3 consecutive cycles

### 🟡 Watch
- **Marketing**: Grade dropped from B to C+

### 🟢 Info
- **Engineering**: Improved from B to B+

## New Department Onboarding
- <dept>: Onboarding checklist created, first cycle pending
```

## Owned Artifacts

### performance/\<dept\>-weekly.md

```markdown
# <Department> Performance — Week of <date>

## Grade History (last 4 weeks)
- Week 1: B+
- Week 2: B
- Week 3: B+
- Week 4: A-

## Trend: Improving ↑

## Notes
- <Any CEO comments from inspection>
```

Generated weekly by aggregating hourly snapshots into a weekly summary.

### onboarding/\<template\>.md

See onboarding checklist template below.

### reports/weekly-hr.md

The consolidated report (format shown in Phase 4 above). Overwritten each week; previous weeks archived to `reports/_archived/`.

## hr-data.json Structure

```json
{
  "history": [
    {
      "timestamp": "2026-01-15T10:25:00Z",
      "grades": {
        "engineering": "B+",
        "sales": "C-",
        "it": "A",
        "marketing": "B"
      }
    }
  ],
  "weeklySnapshots": [
    {
      "weekOf": "2026-01-13",
      "summary": {
        "engineering": { "avg": "B+", "trend": "improving" },
        "sales": { "avg": "C", "trend": "declining" }
      }
    }
  ],
  "onboardingLog": [
    {
      "dept": "analytics",
      "createdAt": "2026-01-10T00:00:00Z",
      "checklistComplete": false,
      "items": {
        "systemMdReviewed": true,
        "firstCycleRun": true,
        "firstReportProduced": false,
        "gradeAssigned": false
      }
    }
  ]
}
```

## Onboarding Checklist Template for New Departments

```markdown
# Onboarding Checklist: <Department Name>

Created: <date>
Status: IN PROGRESS

## Pre-Launch
- [ ] SYSTEM.md reviewed and approved by CEO
- [ ] Cron schedule allocated (no conflicts)
- [ ] data-collection script created and tested
- [ ] state.json entry added with status "active"
- [ ] Inbox/outbox directories created

## First Cycle
- [ ] First data-collection cycle completed successfully
- [ ] First report produced in outbox
- [ ] state.json updated with lastRun timestamp
- [ ] No errors in cycle execution

## Integration
- [ ] IT verified: script permissions, inbox format, state schema
- [ ] Dependencies on other departments documented
- [ ] Other departments notified of new peer (if relevant)

## First Review
- [ ] CEO inspected first output
- [ ] Initial grade assigned
- [ ] Feedback delivered via inbox directive
- [ ] HR recorded initial grade in performance history

## Complete
- [ ] All items above checked
- [ ] Department marked as "fully onboarded" in hr-data.json
- [ ] Onboarding log entry finalized
```

## Cron Schedule

```
25 * * * *   # Every hour at :25
```

Runs after IT (at :15) so HR can trust that state.json is valid and clean.
