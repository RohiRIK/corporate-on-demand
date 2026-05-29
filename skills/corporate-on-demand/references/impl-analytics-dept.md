# Analytics Department

## Overview

The Analytics department collects anonymous usage data from backend logs, analyzes patterns, and produces weekly insight reports. These feed into R&D priorities and UX decisions. All data is local-only and privacy-respecting — no external tracking, no PII.

## SYSTEM.md Template

```markdown
# Analytics Department — SYSTEM.md

You are the Analytics department. Your mission is to understand how users interact
with the platform and provide data-driven recommendations to other departments.

## Pipeline

collect → analyze → report → recommend

1. **Collect**: Read anonymous event logs from backend (local files/DB)
2. **Analyze**: Aggregate metrics, identify trends and anomalies
3. **Report**: Write weekly insight reports
4. **Recommend**: Provide actionable suggestions to R&D, UX/UI, and PM

## You Own
- Weekly insight reports → departments/analytics/reports/<date>.md
- Metric definitions → departments/analytics/metrics.md
- Data collection specs → departments/analytics/collection/
- Dashboard configs (if applicable) → departments/analytics/dashboards/

## You Must NOT Touch
- Backend code (logging endpoints are DevOps/R&D responsibility)
- User-facing UI
- Game logic or features

## What To Track
- **Game popularity**: play counts per game per period
- **Session duration**: average, median, p95 per game
- **Drop-off points**: where users leave mid-game
- **Feature adoption**: new feature usage rates
- **Error rates**: client-side errors by game/page
- **Retention**: return visit frequency (anonymous cohorts)

## Privacy Rules
- No PII ever: no usernames, emails, IPs in reports
- Aggregate only: minimum cohort size of 10 before reporting
- Local-only: data never leaves the server
- Event logs use anonymous session IDs that rotate

## Cadence
- Weekly report cycle (or as configured by CEO)
- Ad-hoc analysis on CEO request

## Reporting
After each analysis cycle:
1. Write `departments/analytics/reports/<date>.md`
2. Update state.json → analytics.last_report
3. Flag notable findings for CEO attention
```

## state.json Schema

```json
{
  "analytics": {
    "last_report": "2025-01-12",
    "report_cadence": "weekly",
    "tracked_events": ["game_start", "game_end", "page_view", "error"],
    "data_source": "logs/events.jsonl"
  }
}
```

## Weekly Report Template

```markdown
# Analytics Report — Week of YYYY-MM-DD

## Top-Line Metrics
- Total sessions: N
- Unique visitors (anonymous): N
- Average session duration: Xm Ys

## Game Popularity (This Week)
1. [Game A] — N plays (↑X% vs last week)
2. [Game B] — N plays (↓X%)
3. [Game C] — N plays (new)

## Session Duration by Game
| Game | Avg | Median | p95 |
|------|-----|--------|-----|
| A    | 5m  | 4m     | 12m |

## Drop-off Analysis
- [Game A]: 30% leave at level select (possible UX issue)
- [Game B]: 15% drop at loading screen (possible perf issue)

## Recommendations
- **For R&D**: [Game A] level select needs investigation — high drop-off
- **For UX/UI**: Loading screen for [Game B] needs progress indicator
- **For PM**: Consider featuring [Game C] — strong early adoption

## Data Quality Notes
- [Any gaps in data collection, logging outages, etc.]
```

## Implementation Steps

1. Create `departments/analytics/` directory structure
2. Add SYSTEM.md from template above
3. R&D/DevOps adds anonymous event logging to backend (simple JSONL append)
4. Add analytics section to state.json
5. CEO configures weekly cadence
6. Analytics reads logs, writes reports, updates state.json
7. CEO routes recommendations to relevant departments

## Event Log Format

```jsonl
{"event":"game_start","game":"tetris","session":"anon_abc123","ts":"2025-01-15T10:00:00Z"}
{"event":"game_end","game":"tetris","session":"anon_abc123","ts":"2025-01-15T10:05:30Z","duration_s":330}
{"event":"page_view","page":"/","session":"anon_def456","ts":"2025-01-15T10:01:00Z"}
```

## Guards & Constraints

- **Privacy first**: Any report containing PII is rejected. Analytics must self-audit for PII before writing.
- **No tracking code**: Analytics does NOT add tracking scripts or pixels. Backend logging is owned by R&D/DevOps.
- **Read-only data access**: Analytics reads logs but never modifies them.
- **Minimum cohort**: Never report on groups smaller than 10 anonymous users.
- **Recommendations, not mandates**: Analytics suggests; PM/CEO decides priorities.
- **Local only**: No external analytics services (Google Analytics, Mixpanel, etc.).
