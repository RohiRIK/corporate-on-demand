# CEO-Driven Department Creation

## When to Create a New Department

The CEO identifies a gap during routine inspection cycles:
- A recurring problem no existing department owns
- A capability missing from the corporate structure
- Workload in an existing department that should be split
- A strategic initiative requiring dedicated focus

## Step-by-Step Process

### 1. Proposal (CEO)

During inspection, CEO writes a proposal in the board inbox:

```markdown
# Department Proposal: <Name>

## Gap Identified
<What problem or capability gap was found>

## Proposed Mission
<One-sentence mission statement>

## Owned Artifacts
<What files/directories this department will own>

## Dependencies
<Which existing departments it interacts with>

## Justification
<Why existing departments can't cover this>
```

### 2. Board Approval

The Board reviews during its next cycle:
- Checks for overlap with existing departments
- Validates the mission is scoped and measurable
- Approves, rejects, or requests revision
- If approved, writes directive to CEO inbox: `APPROVED: Create <dept>`

### 3. Scaffold via add-department.ts

```bash
npx ts-node scripts/add-department.ts \
  --name "<dept-name>" \
  --mission "<one-line mission>" \
  --cron "<schedule>"
```

This script creates:
```
departments/<dept-name>/
├── SYSTEM.md          # Department identity and rules
├── inbox/             # Incoming directives
├── outbox/            # Reports and outputs
├── artifacts/         # Owned files
└── scripts/
    └── data-collection.ts  # Cycle entry point
```

### 4. SYSTEM.md Template for New Departments

```markdown
# Department: <Name>

## Mission
<One-sentence mission from proposal>

## Owns
- <artifact-path-1>
- <artifact-path-2>

## Must NOT Touch
- Other departments' artifacts
- Infrastructure or cron configuration
- state.json (except own section via approved schema)

## Pipeline
1. Read inbox for directives
2. <domain-specific step>
3. <domain-specific step>
4. Write report to outbox
5. Update own section in state.json

## Reports To
CEO (via outbox/)

## Receives Directives From
CEO, Board (via inbox/)

## Cycle Schedule
<cron expression> — <human description>
```

### 5. Cron Schedule Allocation

Find a free slot by checking existing schedules:

```bash
# List all current corporate cron jobs
hermes cron list | grep corporate

# Common allocation pattern (stagger by 10-15 min):
# CEO:    */60 min, offset 0   → 0 * * * *
# Board:  */60 min, offset 10  → 10 * * * *
# Dept A: */60 min, offset 20  → 20 * * * *
# Dept B: */60 min, offset 30  → 30 * * * *
```

Rules:
- Never overlap with existing department cycles
- Leave 5+ min buffer between consecutive departments
- Heavier departments get less frequent cycles (every 2h, 4h)
- IT and HR run at least hourly

Register the cron job:
```bash
hermes cron add "<dept-name>-cycle" \
  --schedule "<cron>" \
  --task "Run <dept-name> department cycle" \
  --context "departments/<dept-name>"
```

### 6. Data-Collection Script Template

```typescript
// departments/<dept-name>/scripts/data-collection.ts
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DEPT_ROOT = join(__dirname, '..');
const INBOX = join(DEPT_ROOT, 'inbox');
const OUTBOX = join(DEPT_ROOT, 'outbox');
const STATE_FILE = join(DEPT_ROOT, '..', '..', 'state.json');

// 1. Read directives
const directives = readdirSync(INBOX).filter(f => f.endsWith('.md'));

// 2. Load current state
const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));

// 3. Process directives
for (const directive of directives) {
  const content = readFileSync(join(INBOX, directive), 'utf-8');
  // TODO: domain-specific processing
}

// 4. Update state
state.departments['<dept-name>'] = {
  lastRun: new Date().toISOString(),
  status: 'healthy',
  // domain-specific metrics
};
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// 5. Write cycle report to outbox
const report = `# <Dept> Cycle Report — ${new Date().toISOString()}
## Directives Processed: ${directives.length}
## Status: OK
`;
writeFileSync(join(OUTBOX, `report-${Date.now()}.md`), report);
```

### 7. state.json Updates

Add the new department entry:

```json
{
  "departments": {
    "<dept-name>": {
      "created": "2026-01-15T00:00:00Z",
      "status": "active",
      "lastRun": null,
      "grade": "pending",
      "mission": "<mission>",
      "cronSchedule": "<cron>"
    }
  }
}
```

### 8. First Directive

CEO places an initial directive in the new department's inbox:

```markdown
# Initial Directive: Establish Operations

1. Verify your SYSTEM.md is accurate
2. Run your first data-collection cycle
3. Produce your first report to outbox
4. Confirm healthy status in state.json

Due: Next cycle
Priority: HIGH
```

## Rollback: Decommissioning a Department

When a department is no longer needed:

1. **CEO proposes decommission** → Board approves
2. **Freeze the department**: set `status: "frozen"` in state.json
3. **Remove cron job**: `hermes cron remove "<dept-name>-cycle"`
4. **Archive artifacts**: `mv departments/<dept-name> departments/_archived/<dept-name>-<date>/`
5. **Update state.json**: set `status: "decommissioned"`, add `decommissionedAt`
6. **Notify dependent departments** via their inboxes
7. **Reassign owned artifacts** to other departments or mark as unowned
8. **HR records final grade** in performance history

Never delete — always archive. The audit trail matters.
