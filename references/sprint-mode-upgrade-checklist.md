# Sprint Mode Upgrade Checklist

When upgrading a project to support Sprint Mode, verify ALL of these:

## Governance Layer
- [ ] CEO SYSTEM.md has Sprint Mode section with activation steps
- [ ] CEO SYSTEM.md includes the FULL sprintMode state.json schema (all fields)
- [ ] PM SYSTEM.md has proposal template (propose to CEO, cannot self-approve)
- [ ] Board SYSTEM.md has propose/acknowledge/veto authority documented

## Operational Departments
- [ ] EVERY department SYSTEM.md has Sprint Mode check-at-cycle-start section
- [ ] Including HR (commonly missed when HR is added manually post-scaffold)
- [ ] Section covers: parallel tracks, fast-track check, scope lock, standup

## CORPORATE.md
- [ ] Sprint Mode section with all 6 levers documented
- [ ] Max 5-day duration, auto-expiry, retrospective requirement

## state.json
- [ ] `sprintMode: null` field exists
- [ ] Schema matches skill spec (cronOverrides, parallelTracks, fastTrackDepts, standupEnabled, scopeLock, sprintObjectives, log[], expiresAt, maxDurationDays)

## Infrastructure
- [ ] `confluence/sprints/` directory exists for standups and retrospectives
- [ ] Data-collection scripts (.sh) inject sprint context when sprintMode.active is true
- [ ] Cron override mechanism documented — CEO knows cronOverrides are declarative, not automatic

## Known Gap: Cron Override Execution
cronOverrides in state.json do NOT automatically change real cron schedules.
Options to bridge:
1. CEO sends inbox to operator requesting schedule change
2. A script reads cronOverrides and calls the cron API to update schedules
3. Document as manual step in CEO SYSTEM.md

## Verification
After upgrade, run: `grep -rn "sprint" departments/*/SYSTEM.md | wc -l`
Expected: at least 6 references per department × number of departments.
Any department with 0 references is missing the section.
