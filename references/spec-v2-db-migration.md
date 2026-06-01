# Corporate-on-Demand v2: Unified Spec — SQLite + Honker + sqlite-vec

> **Status:** SPEC — no implementation yet.
> **Date:** 2026-06-01 (consolidated from research 2026-05-29)
> **Author:** Rohi Rikman

---

## Core Thesis

The central goal of v2 is **communication clarity**. The file-based system (state.json + inbox/ + outbox/) creates a communication blackhole where:

- CEO writes "QA downgraded to D" in a log that nobody reads
- P0 directives sit unprocessed in inbox/ for 5+ days because the cron prompt doesn't mention inbox
- state.json says Phase 2 when the org is actually in Phase 3
- 38 consecutive "all nominal" reports go undetected
- No one knows if a message was read, acknowledged, or acted on

**The DB is not the goal. Better inter-department communication is the goal.** The DB is the substrate that makes structured, trackable, queryable communication possible.

---

## Technology Stack

| Component | Package | Notes |
|-----------|---------|-------|
| Database | SQLite (WAL mode) | Single file, no server, embedded |
| Queues/Pub-Sub | Honker (`honker` pip / `@russellthehippo/honker-bun`) | Alpha, Rust core, SQLite extension |
| Vector Search | sqlite-vec (C extension, zero deps) | Brute-force KNN, fine for 100s-1000s of artifacts |
| Full-Text Search | FTS5 (built-in SQLite) | Keyword search |
| Embeddings | Primary: Cohere embed-v4 (free tier, 1024 dims). Fallback: Ollama mxbai-embed-large (local, 1024 dims) |
| Language | Bun/TS | Both Honker-bun and sqlite-vec npm exist |
| Dashboard | Static HTML + vanilla JS | No build step, reads DB via thin API layer |

### Honker vs Hermes Cron (Common Confusion)

| Layer | What | Purpose |
|-------|------|---------|
| Hermes cron | Spawns full agent session with LLM | Department "brain" |
| Honker scheduler | Fires DB-level event on cron expr | No LLM, just inserts queue row |
| Honker queue | `queue("dept").claim()` | Replaces inbox file reads |

Honker makes communication **atomic** (artifact + enqueue + log = one transaction) and **reliable** (dead-letter, retries, visibility timeout).

### Honker Technical Details

- **Repo:** github.com/russellromney/honker (2.6k stars, alpha)
- **Wake mechanism:** Polls `PRAGMA data_version` every 1ms (~3µs read), single-digit-ms cross-process delivery
- **WAL:** Auto-enabled on open but NOT required
- **Queue tables:** `_honker_live`, `_honker_dead` — regular SQLite rows, readable without extension
- **No filtered claims:** Use one queue per work type
- **Scheduler:** Leader-elected, supports 5/6-field cron + `@every` intervals
- **Fallback if extension breaks:** Raw SQL: `UPDATE _honker_live SET state='claimed' WHERE queue=? AND state='pending' LIMIT 1 RETURNING *`

---

## Architecture: Five Pillars

### Pillar 1: 📧 Mail System (replaces inbox/)

Treat inter-department communication as **email**. Real email semantics:

```sql
CREATE TABLE messages (
  id            INTEGER PRIMARY KEY,
  from_dept     TEXT NOT NULL,
  to_dept       TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  priority      TEXT CHECK(priority IN ('P0-CRITICAL','P1-HIGH','P2-MEDIUM','P3-LOW')),
  type          TEXT CHECK(type IN ('directive','escalation','report','ack','review-request','approval','rejection','info')),
  status        TEXT CHECK(status IN ('sent','delivered','read','acknowledged','acted','resolved','expired')),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at  DATETIME,
  read_at       DATETIME,
  acked_at      DATETIME,
  resolved_at   DATETIME,
  sla_deadline  DATETIME,
  sla_breached  BOOLEAN DEFAULT FALSE,
  thread_id     INTEGER REFERENCES messages(id),
  in_reply_to   INTEGER REFERENCES messages(id),
  tags          TEXT,   -- JSON array
  attachments   TEXT    -- JSON array of artifact references
);
```

**Key behaviors:**
- Lifecycle: `sent → delivered → read → acknowledged → acted → resolved`
- SLA auto-calculated from priority (P0=2h, P1=8h, P2=24h, P3=72h)
- Department cron starts with `SELECT * FROM messages WHERE to_dept = ? AND status IN ('sent','delivered') ORDER BY priority, created_at`

**Message types:**
| Type | Semantics | Expected Response |
|------|-----------|-------------------|
| `directive` | Order from superior. Must be acted on. | `ack` + work product |
| `escalation` | Problem flagged upward. Requires decision. | `directive` back down |
| `report` | Informational output. No response required. | Optional `ack` |
| `review-request` | Artifact needs approval before proceeding. | `approval` or `rejection` |
| `ack` | "I received and understood this." | None |
| `info` | FYI, no action needed. | None |
### Pillar 2: 📚 Knowledge Base (replaces confluence/)

```sql
CREATE TABLE knowledge (
  id            INTEGER PRIMARY KEY,
  type          TEXT CHECK(type IN ('decision','runbook','workflow','architecture','standard','post-mortem','meeting-minutes')),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  author_dept   TEXT NOT NULL,
  version       INTEGER DEFAULT 1,
  parent_id     INTEGER REFERENCES knowledge(id),
  status        TEXT CHECK(status IN ('draft','review','approved','active','deprecated','archived')),
  approved_by   TEXT,
  approved_at   DATETIME,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME,
  superseded_by INTEGER REFERENCES knowledge(id),
  tags          TEXT,
  applies_to    TEXT,  -- JSON array of dept names
  last_reviewed DATETIME,
  review_interval_days INTEGER DEFAULT 7,
  stale         BOOLEAN GENERATED ALWAYS AS (
    julianday('now') - julianday(COALESCE(last_reviewed, created_at)) > review_interval_days
  ) STORED
);
```

**Key behaviors:**
- Stale detection automatic via computed `stale` column
- Version history preserved — `parent_id` chains
- `applies_to` tells HR which departments need a workflow in their SYSTEM.md
- Decisions require `approved_by` — no more unsigned decisions

### Pillar 3: 🎫 Ticket System (new)

```sql
CREATE TABLE tickets (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  type          TEXT CHECK(type IN ('bug','feature','task','incident','improvement')),
  priority      TEXT CHECK(priority IN ('P0-CRITICAL','P1-HIGH','P2-MEDIUM','P3-LOW')),
  reporter_dept TEXT NOT NULL,
  assignee_dept TEXT NOT NULL,
  status        TEXT CHECK(status IN ('open','in-progress','blocked','review','resolved','closed','wontfix')),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at    DATETIME,
  blocked_at    DATETIME,
  blocked_by    INTEGER REFERENCES tickets(id),
  resolved_at   DATETIME,
  closed_at     DATETIME,
  sla_deadline  DATETIME,
  sla_breached  BOOLEAN DEFAULT FALSE,
  resolution    TEXT,
  verified_by   TEXT,
  verified_at   DATETIME,
  related_messages TEXT,   -- JSON array of message IDs
  related_knowledge TEXT   -- JSON array of knowledge IDs
);
```

**Key behaviors:**
- Auto-escalation: SLA passes + status != 'resolved' → escalation to Board
- Dependencies: `blocked_by` another ticket. Board sees dependency graph
- Verification gate: R&D resolves, ticket not `closed` until QA `verified_by`

### Pillar 4: 📊 Dashboard (new — web UI)

Real-time web interface for platform owner (Rohi) to monitor everything.

**Technology:** Static HTML + JS, reads DB via thin API layer, auto-refresh every 30s.

**Sections:**
- **Overview** — Phase progress, active tickets by priority, SLA breach count, department grade cards
- **Mail Activity** — Unread/unresolved per dept, message flow diagram (who→whom), SLA breach timeline, avg response time
- **Department Status** — Per-dept card: grade + history sparkline, open tickets, unread messages, last cycle summary, utilization score, rubber-stamp detection
- **Ticket Board** — Kanban view (Open→In Progress→Review→Resolved→Closed), SLA countdown timers, dependency arrows
- **Knowledge Base Browser** — Searchable docs, freshness indicator, version history
- **Timeline / Activity Feed** — Real-time event feed (messages, tickets, grades, deploys), filterable
- **Cost & Utilization** — Token usage per dept over time, idle detection, cost heatmap

### Pillar 5: 🔗 Communication Protocol

#### Protocol Rules
1. Every message MUST have a type
2. `directive` and `escalation` MUST have a priority
3. P0/P1 messages auto-generate a ticket if one doesn't exist
4. Every directive MUST be acknowledged within 1 cycle
5. Unacknowledged P0 after 2h → auto-escalation to Board
6. Unacknowledged P1 after 8h → auto-escalation to CEO

#### Department Discovery

```sql
CREATE TABLE departments (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL,   -- 'engineering', 'quality', 'operations', 'executive'
  capabilities  TEXT NOT NULL,   -- JSON array
  accepts_types TEXT NOT NULL,   -- JSON array of message types
  schedule      TEXT NOT NULL,   -- cron expression
  system_md     TEXT NOT NULL,   -- SYSTEM.md content
  pipeline      TEXT NOT NULL,   -- JSON array of stages
  status        TEXT DEFAULT 'idle',
  last_cycle_at DATETIME,
  current_grade TEXT DEFAULT 'A',
  grade_history TEXT,            -- JSON array of {grade, timestamp, reason}
  config        TEXT             -- JSON extra config
);
```

#### Pub/Sub Topics

```sql
CREATE TABLE subscriptions (
  dept_id  TEXT REFERENCES departments(id),
  topic    TEXT NOT NULL,
  PRIMARY KEY (dept_id, topic)
);
-- Topics: 'deploy', 'p0-alert', 'phase-change', 'grade-change', 'security-alert', 'knowledge-new'
```

#### Handoff Protocol

```sql
CREATE TABLE handoffs (
  id            INTEGER PRIMARY KEY,
  ticket_id     INTEGER REFERENCES tickets(id),
  from_dept     TEXT NOT NULL,
  to_dept       TEXT NOT NULL,
  handoff_type  TEXT CHECK(handoff_type IN ('review','verify','deploy','approve')),
  status        TEXT CHECK(status IN ('pending','accepted','rejected','completed')),
  context       TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at  DATETIME
);
-- Flow: R&D→CTO(review)→QA(verify)→DevOps(deploy)→QA(post-deploy verify)→closed
```

---

## Artifacts & Embeddings

```sql
CREATE TABLE artifacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_id       TEXT NOT NULL REFERENCES departments(id),
  content       TEXT NOT NULL,
  pipeline_stage TEXT,
  grade         REAL,              -- 0.0-1.0 quality score
  embed_status  TEXT DEFAULT 'pending', -- pending | done | failed
  created_at    TEXT DEFAULT (datetime('now')),
  metadata      TEXT               -- JSON
);

CREATE TABLE grades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER REFERENCES artifacts(id),
  grader_dept TEXT NOT NULL,
  score       REAL NOT NULL,
  reasoning   TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE vec_artifacts USING vec0(
  id       INTEGER PRIMARY KEY,
  embedding FLOAT[1024]
);

CREATE VIRTUAL TABLE artifacts_fts USING fts5(
  content, content=artifacts, content_rowid=id
);
```

**Embedding strategy:** Cohere embed-v4 (free, 1024d) → Ollama mxbai-embed-large (local, 1024d) → mark `pending`, retry next run. System works fully without embeddings (queues + FTS5 still function).

**Anti-Slop via Semantic Scoring:**
1. FTS5: banned word check ("synergy", "leverage", "delve") → instant FAIL
2. sqlite-vec: cosine similarity to last 10 approved artifacts (>0.95 = slop)
3. sqlite-vec: distance from golden references (auto-seeded: first 5 artifacts >0.8 grade)
4. LLM grading (existing pipeline)

---

## State Management (replaces state.json)

```sql
CREATE TABLE state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,      -- JSON
  updated_by TEXT NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE state_history (
  id         INTEGER PRIMARY KEY,
  key        TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at DATETIME NOT NULL,
  reason     TEXT
);
```

Now we see: "CEO changed QA grade from A to D at 14:00 because of missed Snake bug" — no more ghost grades.

---

## Audit Trail

```sql
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  timestamp   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dept        TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  details     TEXT  -- JSON
);
```

Cross-department queries become trivial:
- "What did everyone do in 24h?" → `SELECT * FROM audit_log WHERE timestamp > datetime('now','-24 hours')`
- "How many times did Infra say 'all nominal'?" → one query

---

## Automatic Behaviors

**SLA Auto-Escalation** (no-agent cron, every 15 min):
```sql
SELECT id, subject, to_dept, priority, sla_deadline FROM messages
WHERE status IN ('sent','delivered') AND sla_deadline < datetime('now') AND sla_breached = FALSE;
```

**Rubber-Stamp Detection** (Board runs each meeting):
```sql
SELECT dept, COUNT(*) as identical_count FROM (
  SELECT dept, details, LAG(details) OVER (PARTITION BY dept ORDER BY timestamp) as prev
  FROM audit_log WHERE action = 'cycle_completed'
) WHERE details = prev GROUP BY dept HAVING identical_count >= 3;
```

**Stale Knowledge Detection:**
```sql
SELECT id, title, type FROM knowledge WHERE status = 'active' AND stale = TRUE ORDER BY last_reviewed;
```

**Department Utilization:**
```sql
SELECT dept,
  COUNT(CASE WHEN action != 'cycle_completed' THEN 1 END) * 100.0 /
  NULLIF(COUNT(CASE WHEN action = 'cycle_completed' THEN 1 END), 0) as utilization_pct
FROM audit_log WHERE timestamp > datetime('now', '-24 hours') GROUP BY dept;
```

---

## Runtime Model

```
Hermes cron fires dept →
  agent connects to project.db (load Honker + sqlite-vec + FTS5) →
    claim() from department queue →
      LLM processes →
        atomic transaction: artifact + embedding + enqueue next + stream log →
          exit

CEO cron (3x/day):
  1. Read stream("activity") since last run
  2. Review grades, check escalations
  3. Issue directives → queue("target-dept")
  4. Semantic query: "any stalled work?" via vec search

Embed retry cron (daily):
  1. SELECT WHERE embed_status='pending'
  2. Batch call Cohere/Ollama
  3. Update vec_artifacts + embed_status='done'
```

---

## Migration Path (v1 files → v2 DB)

**Phase 1: Schema + Migration Script**
- Create project.db with all tables
- Migrate inbox/, outbox/, confluence/ → DB
- Parse state.json → state + state_history tables
- Register departments from SYSTEM.md → departments table

**Phase 2: Dual-Write**
- Cron scripts write to BOTH files and DB
- Dashboard reads from DB, validate matches

**Phase 3: DB-Primary**
- Cron scripts read/write DB only
- Files generated as read-only exports (for git history)

**Phase 4: Files Removed**
- No inbox/, outbox/ directories
- confluence/ lives in knowledge table
- SYSTEM.md still exists but reads runtime config from DB

---

## Resolved Decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Bun or Python? | Bun/TS | Both Honker-bun and sqlite-vec npm exist |
| 2 | Embedding dims | 1024 | Cohere + mxbai-embed-large both 1024, interchangeable |
| 3 | Queue naming | One per dept | Honker has no filtered claim |
| 4 | Golden references | Auto-seed + rolling | First 5 artifacts >0.8 = initial set, then rolling last 10 |
| 5 | WAL mode | Non-issue | Honker auto-enables WAL |
| 6 | Honker fallback | Poll plain SQLite | Queue tables are regular rows |
| 7 | Embedding fallback | Cohere → Ollama → pending | Cloud → local → graceful degradation |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Honker is alpha | Queue loss, bugs | Fallback: poll artifacts table directly |
| Cohere rate limit | No new embeddings | System works without vectors, retry next day |
| sqlite-vec brute-force at scale | Slow queries | At our scale (100s of artifacts) irrelevant |
| Single SQLite = single writer | Concurrent blocks | WAL mode + short transactions |
| Big bang migration | Downtime | One-time migration script: files → DB |

---

## Open Questions

1. **Honker maturity** — Still alpha. Fallback: implement queues as regular SQLite tables with polling (good enough for 2h cron cycles)
2. **sqlite-vec necessity** — Do we need semantic search in v2, or is FTS5 sufficient?
3. **Dashboard hosting** — Arcade container? Separate? Local-only?
4. **Notification delivery** — Dashboard only, or also push to Telegram on SLA breach?
5. **Backward compatibility** — Keep files for git diff, or go full DB?
6. **A2A protocol alignment** — Worth conforming to A2A format for future interop?

---

## Success Criteria

- [ ] All inter-department communication via Honker queues (no inbox files)
- [ ] State queryable via SQL (no state.json)
- [ ] Semantic search: "find related artifacts" returns relevant results
- [ ] Graceful degradation when Cohere unavailable
- [ ] Anti-slop scoring uses embedding similarity + LLM grading
- [ ] Single project.db contains all state
- [ ] Dashboard provides real-time platform oversight
- [ ] SLA tracking + auto-escalation functional
- [ ] Ticket system with dependency tracking operational
- [ ] scaffold/validate/report scripts work with new architecture

*Consolidated: 2026-06-01 from research (2026-05-29) + spec (2026-06-01)*


