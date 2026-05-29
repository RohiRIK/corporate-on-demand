# Incident Response Protocol

## Overview

When Infra detects a platform issue during an audit, the incident response protocol kicks in. Based on severity, this can escalate from a simple Infra fix to full incident mode where all departments focus on resolution.

## Severity Levels

| Level | Name | Description | Examples |
|-------|------|-------------|----------|
| **P1** | Critical | Platform down or unusable | Server crash, build system broken, all games 404 |
| **P2** | Major | Game or feature broken | Specific game won't load, deploy failed, data corruption |
| **P3** | Minor | Cosmetic or low-impact | Styling glitch, typo, non-critical console warning |

## Trigger

Infra detects an issue during routine audit:

```
Infra audit cycle
       ↓
Issue detected (health check fail, broken deploy, error spike)
       ↓
Infra writes incident report to departments/infra/incidents/
       ↓
Infra assesses severity
       ↓
  P3 → Infra fixes directly, logs it
  P2 → Infra attempts fix, escalates if stuck
  P1 → Immediate incident mode
```

## state.json — Incident Mode

```json
{
  "incidentMode": {
    "active": true,
    "severity": "P1",
    "description": "Platform nginx container down, all games returning 502",
    "startedAt": "2025-03-14T14:30:00Z",
    "leadDepartment": "infra",
    "incidentId": "INC-20250314-001"
  }
}
```

## Escalation Path

### P3 — Minor
1. Infra fixes it within the current cycle
2. Logs fix in `departments/infra/incidents/<date>/`
3. No state.json change needed

### P2 — Major
1. Infra attempts fix
2. If fixed → log and close
3. If not fixed within 1 cycle:
   - Infra writes to CEO inbox: `ceo/inbox/incident-<id>.md`
   - CEO decides: escalate to incident mode or assign to specific dept

### P1 — Critical
1. Infra immediately sets `incidentMode` in `state.json`
2. Infra writes to CEO inbox with full details
3. **All departments** check `incidentMode` at cycle start
4. Normal pipeline is **suspended** — all depts focus on incident
5. Each dept contributes within their domain:
   - **R&D**: Debug code issues, hotfix builds
   - **UX**: Assess user-facing impact, create status page
   - **QA**: Verify fix candidates
   - **PM**: Communicate status, update changelog
   - **Infra**: Lead the fix, coordinate

## During Incident Mode

Every department's cycle start check:

```markdown
## Incident Check
Before starting your normal pipeline, read state.json and check incidentMode.active.
If true:
- Read incidentMode.severity and description
- Suspend normal work
- Focus on resolving the incident within your domain
- Write updates to departments/<your-dept>/incidents/<incidentId>/
- Do NOT work on backlog items until incident is resolved
```

## Incident Report Template

File: `departments/infra/incidents/<date>/INC-<id>.md`

```markdown
# Incident Report: INC-<YYYYMMDD>-<NNN>

**Severity:** P1 | P2 | P3
**Status:** Active | Mitigated | Resolved
**Started:** <timestamp>
**Detected by:** Infra audit
**Lead:** Infra

## Summary
Brief description of what's broken and user impact.

## Timeline
- HH:MM — Issue detected during audit
- HH:MM — Initial diagnosis: <findings>
- HH:MM — Fix attempted: <action taken>
- HH:MM — Escalated to incident mode / Resolved

## Root Cause
<To be filled after resolution>

## Impact
- Services affected: <list>
- Users affected: <scope>
- Duration: <time>

## Resolution
<Steps taken to fix>
```

## Postmortem Template

Written by PM after incident is resolved. File: `departments/pm/postmortems/INC-<id>-postmortem.md`

```markdown
# Postmortem: INC-<YYYYMMDD>-<NNN>

**Date:** <date>
**Severity:** P1 | P2 | P3
**Duration:** <start> to <end> (<total time>)
**Author:** PM Department

## Summary
What happened, in plain language.

## Timeline
Detailed chronological account of detection, response, and resolution.

## Root Cause
The underlying cause of the incident.

## What Went Well
- <positive aspects of the response>

## What Went Poorly
- <areas for improvement>

## Action Items
- [ ] <preventive measure 1> — Owner: <dept> — Due: <date>
- [ ] <preventive measure 2> — Owner: <dept> — Due: <date>

## Lessons Learned
Key takeaways for future incident prevention and response.
```

## Closing an Incident

1. Infra verifies the fix is stable
2. QA confirms functionality restored
3. Infra sets `incidentMode.active = false` in `state.json`
4. PM writes postmortem
5. Board reviews postmortem at next cycle
6. CEO evaluates response quality in next grading cycle
