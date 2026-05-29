# IT Department Implementation

## Mission

Maintain the health, integrity, and hygiene of the corporate infrastructure: scripts, state files, inbox formats, and artifact organization. IT is the janitor and validator — it fixes operational plumbing so other departments can focus on their missions.

## SYSTEM.md Template

```markdown
# Department: IT

## Mission
Ensure operational health of corporate infrastructure — scripts, state, inboxes, and file hygiene.

## Owns
- State.json schema validation
- Data-collection script health (syntax, permissions, existence)
- Inbox format enforcement across all departments
- Stale artifact cleanup
- Log rotation and disk hygiene
- Orphan file detection

## Must NOT Touch
- Application code (repos, features, bugs)
- Cloud/server infrastructure (Docker, DNS, networking)
- Department content (reports, analyses, recommendations)
- Grading or performance evaluation (CEO's domain)
- Strategic decisions (Board's domain)

## Pipeline
1. **Scan** — Check all systems for issues
2. **Report** — Document findings
3. **Fix** — Auto-fix safe issues, flag risky ones
4. **Verify** — Confirm fixes worked

## Reports To
CEO (via outbox/)

## Receives Directives From
CEO, Board (via inbox/)

## Cycle Schedule
15 * * * * — Every hour at :15
```

## Pipeline Detail

### Phase 1: Scan

Run all checks and collect results into a findings array:

| Check | What | Severity |
|-------|------|----------|
| state.json schema | Required fields present, types correct | CRITICAL |
| SYSTEM.md existence | Every department has one | HIGH |
| Inbox format | Only .md files, valid frontmatter | MEDIUM |
| Script permissions | All .ts/.sh files executable | MEDIUM |
| Orphan files | Files not owned by any department | LOW |
| Stale artifacts | Reports older than retention period | LOW |
| Log size | Log files under size threshold | LOW |

### Phase 2: Report

Write scan results to `outbox/it-scan-<timestamp>.md`:

```markdown
# IT Scan Report — <timestamp>

## Summary
- Critical: <n>
- High: <n>
- Medium: <n>
- Low: <n>

## Findings
### [CRITICAL] state.json missing "departments.marketing.status"
- File: state.json
- Expected: string field "status"
- Action: Will add with default "unknown"

### [MEDIUM] departments/sales/inbox/old-note.txt
- Issue: Non-.md file in inbox
- Action: Flag for manual review
```

### Phase 3: Fix (Auto-fix Rules)

IT may auto-fix ONLY these categories:
- **state.json**: Add missing fields with safe defaults (`"unknown"`, `null`, `""`)
- **Permissions**: `chmod +x` on script files
- **Stale cleanup**: Archive (not delete) reports older than 30 days to `_archived/`
- **Log rotation**: Truncate logs over 1MB, keeping last 200 lines

IT must NOT auto-fix:
- Missing SYSTEM.md (flag for CEO — may indicate deeper issue)
- Content inside reports or artifacts
- Anything requiring domain knowledge

### Phase 4: Verify

Re-run the scan checks that had findings. Confirm:
- Auto-fixed issues now pass
- Flagged issues are recorded in outbox for CEO review

## Specific Checks — Implementation

### 1. Validate state.json Schema

```typescript
const REQUIRED_DEPT_FIELDS = ['status', 'lastRun', 'grade', 'mission', 'cronSchedule'];

function validateStateSchema(state: any): Finding[] {
  const findings: Finding[] = [];
  if (!state.departments) {
    findings.push({ severity: 'CRITICAL', msg: 'state.json missing "departments"' });
    return findings;
  }
  for (const [dept, data] of Object.entries(state.departments)) {
    for (const field of REQUIRED_DEPT_FIELDS) {
      if (!(field in (data as any))) {
        findings.push({
          severity: 'CRITICAL',
          msg: `departments.${dept} missing "${field}"`,
          autofix: () => { (data as any)[field] = field === 'status' ? 'unknown' : null; }
        });
      }
    }
  }
  return findings;
}
```

### 2. Check All SYSTEM.md Files Exist

```typescript
function checkSystemMds(deptDir: string): Finding[] {
  const findings: Finding[] = [];
  const depts = readdirSync(deptDir).filter(d =>
    !d.startsWith('_') && statSync(join(deptDir, d)).isDirectory()
  );
  for (const dept of depts) {
    const systemMd = join(deptDir, dept, 'SYSTEM.md');
    if (!existsSync(systemMd)) {
      findings.push({
        severity: 'HIGH',
        msg: `${dept}/SYSTEM.md missing — flag for CEO`,
        autofix: null  // DO NOT auto-create
      });
    }
  }
  return findings;
}
```

### 3. Verify Inbox Format

```typescript
function checkInboxes(deptDir: string): Finding[] {
  const findings: Finding[] = [];
  for (const dept of listDepartments(deptDir)) {
    const inbox = join(deptDir, dept, 'inbox');
    if (!existsSync(inbox)) continue;
    for (const file of readdirSync(inbox)) {
      if (!file.endsWith('.md')) {
        findings.push({
          severity: 'MEDIUM',
          msg: `${dept}/inbox/${file} — non-.md file in inbox`,
          autofix: null  // flag only
        });
      }
    }
  }
  return findings;
}
```

### 4. Check Script Permissions

```typescript
import { accessSync, constants, chmodSync } from 'fs';

function checkScriptPermissions(deptDir: string): Finding[] {
  const findings: Finding[] = [];
  // Find all .ts and .sh files in scripts/ directories
  for (const dept of listDepartments(deptDir)) {
    const scriptsDir = join(deptDir, dept, 'scripts');
    if (!existsSync(scriptsDir)) continue;
    for (const script of readdirSync(scriptsDir)) {
      const p = join(scriptsDir, script);
      try {
        accessSync(p, constants.X_OK);
      } catch {
        findings.push({
          severity: 'MEDIUM',
          msg: `${dept}/scripts/${script} not executable`,
          autofix: () => chmodSync(p, 0o755)
        });
      }
    }
  }
  return findings;
}
```

### 5. Detect Orphan Files

```typescript
function detectOrphans(corpRoot: string): Finding[] {
  // Walk all files, check against each department's "Owns" list from SYSTEM.md
  // Any file not claimed by any department and not in a known location = orphan
  const findings: Finding[] = [];
  const ownedPaths = collectAllOwnedPaths(corpRoot);
  const allFiles = walkDir(corpRoot);
  for (const file of allFiles) {
    if (!ownedPaths.has(file) && !isKnownLocation(file)) {
      findings.push({
        severity: 'LOW',
        msg: `Orphan file: ${file}`,
        autofix: null
      });
    }
  }
  return findings;
}
```

## Cron Schedule

```
15 * * * *   # Every hour at :15
```

Runs after CEO (at :00) so it can validate any changes the CEO cycle made.

## Data-Collection Script Template

```typescript
// departments/it/scripts/data-collection.ts
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CORP_ROOT = join(__dirname, '..', '..', '..');
const DEPT_DIR = join(CORP_ROOT, 'departments');
const STATE_FILE = join(CORP_ROOT, 'state.json');
const OUTBOX = join(__dirname, '..', 'outbox');

interface Finding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  msg: string;
  autofix: (() => void) | null;
}

// Phase 1: Scan
const findings: Finding[] = [
  ...validateStateSchema(JSON.parse(readFileSync(STATE_FILE, 'utf-8'))),
  ...checkSystemMds(DEPT_DIR),
  ...checkInboxes(DEPT_DIR),
  ...checkScriptPermissions(DEPT_DIR),
  ...detectOrphans(CORP_ROOT),
];

// Phase 2: Report
const report = formatReport(findings);
writeFileSync(join(OUTBOX, `it-scan-${Date.now()}.md`), report);

// Phase 3: Fix
const fixed: string[] = [];
for (const f of findings) {
  if (f.autofix) {
    f.autofix();
    fixed.push(f.msg);
  }
}

// Phase 4: Verify
const postFixFindings = [/* re-run checks */];
const verifyReport = formatVerifyReport(fixed, postFixFindings);
writeFileSync(join(OUTBOX, `it-verify-${Date.now()}.md`), verifyReport);

// Update state
const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
state.departments.it.lastRun = new Date().toISOString();
state.departments.it.status = findings.some(f => f.severity === 'CRITICAL') ? 'degraded' : 'healthy';
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
```
