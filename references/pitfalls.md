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
**Fix**: Use the real bun binary at `~/.bun/bin/bun`. Piping also works: `cat script.ts | bun run -`.

## 9. Scaffold Missing Anti-Slop Contract
**Problem**: `add-department.ts` scaffolds a minimal SYSTEM.md without an anti-slop contract section. Validator fails on `/anti-slop/i` check.
**Fix**: After running `add-department.ts`, append the full anti-slop contract to each new department's SYSTEM.md. Never ship a department with just the scaffold output.

## 10. Browser Toolset for E2E Departments
**Problem**: QA, R&D, and CEO need browser tools for E2E smoke tests, pre-ship checks, and visual spot-checks. Default `enabled_toolsets` is `["terminal", "file"]` which blocks browser-based testing.
**Fix**: Set `enabled_toolsets: ["terminal", "file", "browser"]` for QA, R&D, CEO cron jobs.

## 11. State Feedback Fields Stay Empty
**Problem**: `recentChanges`, `blockedTasks`, and `pendingEscalations` in state.json remain `[]` unless every department cron prompt explicitly says "after every action, append to recentChanges". Agents don't infer this from governance docs alone.
**Fix**: Every department cron prompt must contain explicit write instructions for these fields, including the exact JSON shape: `{"dept": "X", "action": "...", "artifact": "...", "timestamp": "ISO8601"}`.

## 12. Schema Migration Stale References
**Problem**: Renaming a state.json field (e.g. `gamePipeline` → `pipeline`) fixes the JSON but leaves stale references in cron prompts, scripts, and TS tools.
**Mitigation**: After any field rename, grep ALL consumers: state.json, cron prompts, shell scripts, TS tools, SYSTEM.md files. Run `validate.ts` + `report.ts` after migration.

## 13. New Department Checklist Gaps
**Problem**: `add-department.ts` scaffolds dirs + SYSTEM.md but does NOT create the data-collection shell script, the cron job, or the state.json department entry.
**Fix**: After scaffolding, manually create all three: shell script at `~/.hermes/scripts/arcade-<dept>.sh`, cron job with correct schedule/toolsets, and department entry in state.json.

## 14. Localhost Health Checks Hide LAN Failures
**Problem**: Department scripts that `curl localhost:PORT` report "healthy" even when LAN clients can't connect. Root cause: frontend JS hardcodes `localhost:3001` as the API URL, which resolves on the server but not on phones/tablets/other machines. From the server's perspective everything works — the bug is invisible to API-level checks.
**Detection**: At least one department (QA or Infra) must grep frontend source for hardcoded `localhost` references. Backend URLs must be relative or use the host IP. QA/R&D should open the site with browser tools and screenshot it — comparing game count on screen vs API response catches rendering mismatches that curl never will.
**Fix**: Give QA, R&D, CEO the `browser` toolset (pitfall #10). Add a static-analysis check to QA's SYSTEM.md: "scan index.html for hardcoded localhost references". Add visual spot-check to CEO inspection: "open site in browser, screenshot, verify game count matches API".
