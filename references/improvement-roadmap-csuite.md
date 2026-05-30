# Corporate-on-Demand — C-Suite Improvement Roadmap

Post C-Suite scripts creation (v3.4.2, 2026-05-31). All items identified during review session.

## A. C-Suite Integration Gaps (high priority)

1. **SYSTEM.md generation for C-Suite is generic** — scaffold creates CTO/CISO/CPO dirs but their SYSTEM.md doesn't reference the new scripts (`csuite-report.ts`, `grade.ts`, etc.). Agents are blind to their own tools.
2. **Data-collection scripts are dumb** — scaffold generates `<name>-cto.sh` that just `cat` files. Should call `csuite-report.ts --role cto` instead.
3. **No C-Suite cron schedule in scaffold output** — CTO/CISO/CPO schedules undefined. Proposed: CTO every 6h, CISO every 12h, CPO every 8h (with staleness-check).
4. **csuite-layer-plan.md stale** — still lists scripts as "planned" even though all are built and tested. Needs: update status + add full authority model + board meeting flow.

## B. architecture.md Outdated (high priority)

5. **Folder structure missing C-Suite** — shows ceo/rnd/uxui/infra/pm/board but no cto/ciso/cpo.
6. **Schedule table missing C-Suite** — only 5 departments + CEO 2x/day.
7. **state.json schema incomplete** — missing `style_palette`, `metrics`, `budgets`, `incidentMode`, `meetings`, `fastTrack` fields (added in v3.3.0 but architecture.md not updated).

## C. Script Improvements (medium priority)

8. **board-meeting.ts doesn't compose** — duplicates collection logic instead of calling `csuite-report.ts`.
9. **report.ts vs csuite-report.ts overlap** — deprecate `report.ts` or make it a thin wrapper around `csuite-report.ts --role ceo`.
10. **validate.ts doesn't check C-Suite dirs** — needs CTO/CISO/CPO structure verification.
11. **scaffold.ts cron output** — should emit proper `hermes cron create` commands for C-Suite roles with correct schedules.

## D. ideas.md Stale (medium priority)

12. **Priority table outdated** — items 1-8 and 14 already implemented (DevOps, QA, IT, Security depts, cross-dept meetings, fast-track, incident response) but still listed as future.
13. **Duplicate reference files** — `plan-v2-honker-sqlite-vec.md` and `v2-honker-sqlite-vec.md` may overlap. Dedupe.

## E. Missing Tooling (lower priority)

14. **No health-check script** — run all validators + check cron health + state.json consistency.
15. **No backup/snapshot script** — save state.json + key artifacts before major changes.
16. **No metrics collection script** — described in impl-kpi-dashboard.md but no script exists.

## Recommended Priority Order

| Order | What | Items |
|---|---|---|
| 1 | Fix scaffold SYSTEM.md for C-Suite | #1 |
| 2 | Fix data-collection scripts | #2 |
| 3 | Update architecture.md | #5-7 |
| 4 | Update csuite-layer-plan.md | #4 |
| 5 | Deprecate report.ts, compose board-meeting | #8-9 |
| 6 | Clean ideas.md | #12 |
| 7 | Dedupe v2 plan references | #13 |
| 8 | Update validate.ts for C-Suite | #10 |
| 9 | Add health-check script | #14 |
