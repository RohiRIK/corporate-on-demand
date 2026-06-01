# Corporate-on-Demand — Gap Analysis & Upgrade Plan

Source: arcade-platform live project analysis (2026-05-31). Security dept (6h cron) blocked pivot for 26 hours on a trivial eval() check.

## Phase 1 — Fix Data-Collection Scripts (highest impact)

The root cause of slow pivots: departments don't receive actionable pivot context.

1. Patch `scaffold.ts` `generateDataScript()` to inject:
   - Extracted pivot context block (phase, executionPhase, frozenDepartments)
   - "FROZEN" guard when dept is in `frozenDepartments`
   - CEO directive for THIS dept (extracted from state.json, not buried in raw JSON)
   - Relevant confluence docs (`confluence/decisions/`)
   - DELEGATION.md
   - Blocker status if this dept blocks others
   - State staleness warning if state.json `lastUpdated` >4h old

2. Same enrichment for `generateCsuiteDataScript()`

3. Add `references/impl-data-scripts.md` documenting what each agent receives vs should receive

## Phase 2 — Blocker Detection & Escalation

4. Add critical-path tagging to Gate 2 pivot tracking:
   ```json
   "gate2_blockers": ["security", "cto"],
   "gate2_deadlines": { "rnd": "<timestamp>", "security": "<timestamp>" }
   ```
5. Differentiate mandatory vs optional reviewers:
   - Mandatory (Security for arch pivots, CTO for tech pivots): never assume "no impact" on timeout
   - Optional: "no response = no impact" after 2 cycles (existing behavior)
6. Add auto-escalation rule: blocker past deadline → operator triggers one-shot run
7. Create `fast-track.ts` script (currently docs-only, all steps manual)
8. Document on-demand department trigger mechanism

## Phase 3 — Pivot ↔ Sprint Integration

9. Cross-reference Sprint Mode in `impl-pivoting.md` at Gates 2 and 6
10. Add auto-sprint trigger: if gate stalls >50% of deadline with <50% responses → recommend Sprint Mode
11. Allow deeper C-suite boost (2h instead of 4h cap) during active pivots with blocker status

## Phase 4 — Make Confluence Live

12. Add READ instruction to SYSTEM.md template in `scaffold.ts`
13. Add READ instruction to CORPORATE.md template
14. Add "check confluence" as standard pipeline prefix step
15. Add grading criterion: "-1 for ignoring existing confluence decisions"
16. Change "optional and additive" to mandatory for decisions
17. Board meeting template: add "Confluence Review" agenda item
18. Add staleness/orphan detection for confluence docs

## Phase 5 — State.json Cleanup

19. Formalize pivot fields in schema: `executionPhase`, `frozenDepartments`
20. Add `lastUpdated` timestamp to state.json
21. Implement `recentChanges` pruning (keep last 20, warn at 40)
22. Remove or implement dead fields: `incidentMode`, `meetings`, `metrics`, `budgets`, `slaContracts`
23. Fix `style_palette` type mismatch (scaffold=object, staleness-check=array)
24. Fix `writeState` TOCTOU race in `lib/utils.ts`

## Phase 6 — Automation Gaps

25. Implement schedule optimization in `scaffold.ts` (QA buffer rule from impl-schedule-optimization.md)
26. Auto-execute cron creation in scaffold (optional `--create-cron` flag)
27. Add script-level pipeline enforcement (validate pipeline progression, not just prompt-based)
28. Add inbox staleness auto-escalation (>3 cycles → CEO inbox)

## Dead State Fields (scaffolded but never used)

| Field | Scaffolded | Read by script | Status |
|-------|-----------|----------------|--------|
| `incidentMode` | ✅ | ❌ | Dead |
| `meetings` | ✅ | ❌ | Dead (only board-meeting.ts) |
| `metrics` | ✅ | ❌ | Dead |
| `budgets` | ✅ | ❌ | Dead |
| `slaContracts` | ✅ | ❌ | Dead |
| `warnings` | referenced in fast-track | ❌ | Dead |
| `confluence` tracking | ✅ | ❌ | Dead |
