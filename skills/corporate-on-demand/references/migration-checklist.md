# Migration Checklist — Adding Departments

When adding N new departments to an existing Corporate-on-Demand deployment, complete ALL steps. Missing any one causes silent failures (empty state fields, validator failures, agents unaware of new peers).

## Pre-flight
- [ ] Read `references/ideas.md` or `references/impl-<dept>-dept.md` for the department spec
- [ ] Decide cron schedule — check existing schedule for collisions (use staggered minutes)

## Per department (repeat for each)
1. **Scaffold**: `$BUN $SCRIPTS/add-department.ts --path $PROJECT --name <dept> --focus "..." --pipeline "step1,step2,..."`
2. **Replace SYSTEM.md**: The scaffold generates a minimal one. Write a full SYSTEM.md with:
   - Identity and mission
   - Pipeline stages (numbered)
   - Ownership (what this dept owns)
   - Domain boundaries ("Must NOT touch" section)
   - Grading rubric (A-F scale)
   - **Anti-slop contract** (scaffold does NOT include this — pitfall #9)
3. **Create artifact subdirectories**: e.g. `test-plans/`, `bug-reports/`, `audits/`
4. **Create data-collection script**: `~/.hermes/scripts/arcade-<dept>.sh` — must cat SYSTEM.md, inbox, state.json, relevant data, CORPORATE.md
5. **Make script executable**: `chmod +x`
6. **Create cron job**: with full prompt including:
   - Pipeline enforcement (one step per cycle)
   - recentChanges write instruction with exact JSON shape
   - blockedTasks and pendingEscalations instructions
   - Anti-slop rules
   - CEO directive reading
   - inbox/done protocol
7. **Update state.json**: Add `ceoDirectives.<dept>` with first-run directive

## Post-flight (once, after all departments added)
8. **Update morning report script**: Add new dept names to the department loop AND new artifact subdirectory names to the subdir loop
9. **Update existing cron prompts**: Append migration notice to ALL existing department prompts listing new departments and their responsibilities — agents can't route inbox to departments they don't know about (pitfall #11)
10. **Run validator**: `$BUN $SCRIPTS/validate.ts --path $PROJECT` — must be 0 failures
11. **Verify scripts**: `bash ~/.hermes/scripts/arcade-<dept>.sh` — must produce output without errors
12. **Write MIGRATION-LOG.md**: Document date, changes, new schedule

## Common mistakes
- Forgetting anti-slop contract in SYSTEM.md (validator catches this)
- Forgetting to update morning report (new dept work won't appear in briefing)
- Not telling existing departments about new peers (they can't delegate)
- Setting cron schedule that collides with existing departments
- Not adding first-run CEO directive (dept has no initial task)
