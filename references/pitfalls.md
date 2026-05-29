# Pitfalls & Failure Modes

## 1. Pipeline Skipping
**Problem**: Agents jump straight to BUILD without research/spec/design steps, producing low-quality output.
**Mitigation**: Prompt must explicitly say: "If no spec exists for your current directive, write the spec. Do NOT build yet." CEO grades pipeline compliance.

## 2. Domain Bleed
**Problem**: R&D touches CSS, UX writes game logic, Infra modifies application code. Departments step on each other's work.
**Mitigation**: Each SYSTEM.md must have an explicit "you MUST NOT touch" list. Examples:
- R&D: "Do NOT modify CSS, design tokens, or layout files"
- UX: "Do NOT modify game logic, backend routes, or Docker configs"
- Infra: "Do NOT modify application code, only infrastructure and deployment"

## 3. Rebuild Conflicts
**Problem**: Two departments modify the same files simultaneously, causing conflicts or overwrites.
**Mitigation**: Staggered schedules with minimum 15-minute gaps. Never tighten below 15 minutes. If a department needs files another is likely editing, use inbox delegation instead.

## 4. Slop Creep
**Problem**: Without active oversight, agent output quality degrades over time — more filler words, vaguer reports, less useful artifacts.
**Mitigation**: CEO inspection loop is essential, not optional. Regular grading creates feedback pressure. Anti-slop contract in every SYSTEM.md. PM cross-checks logs for substance.

## 5. Inbox Pile-up
**Problem**: Departments ignore inbox items, leading to stale delegation tasks and blocked cross-department work.
**Mitigation**: 
- Agents must process inbox at the start of every run
- CEO flags stale items (>3 cycles old) during inspection
- PM tracks inbox processing in status reports
- Escalation path: stale inbox → CEO directive → forced processing

## 6. State File Races
**Problem**: Two agents read/write state.json simultaneously, causing data loss or corruption.
**Mitigation**: Staggered schedules ensure only one agent runs at a time. The 15-minute gap provides margin. If using tighter schedules, implement file locking (flock). Never run two departments in parallel.

## 7. Log Bloat
**Problem**: Continuous logging without rotation fills disk and makes logs unusable for PM review.
**Mitigation**: PM or Infra department should rotate logs — keep last 50 entries per department. Implement in Infra's audit routine. CEO can directive log cleanup if sizes grow.

## 8. Snap Bun Sandbox
**Problem**: Snap-installed bun (`/snap/bin/bun`) is sandboxed and cannot access paths like `~/.hermes/`. Every `bun /path/to/script.ts` returns "Module not found".
**Mitigation**: Use the real bun binary at `~/.bun/bin/bun`. Piping also works: `cat script.ts | bun run -`.

## 9. Schema Migration Stale References
**Problem**: Renaming a state.json field (e.g. `gamePipeline` → `pipeline`) fixes the JSON but leaves stale references in cron job prompts, data-collection scripts, and TS tools. Agents then read/write the wrong field name, causing silent data loss.
**Mitigation**: After any state.json field rename, check ALL consumers:
1. `state.json` itself
2. All cron job prompts (`grep gamePipeline ~/.hermes/cron/jobs.json`)
3. Data-collection shell scripts (`~/.hermes/scripts/`)
4. TS tool scripts (report.ts, validate.ts, scaffold.ts)
5. Department SYSTEM.md files (if they reference field names)
Run `validate.ts` + `report.ts` after migration to catch remaining mismatches.
