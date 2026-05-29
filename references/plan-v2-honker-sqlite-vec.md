# Corporate-on-Demand v2: SQLite + Honker + sqlite-vec

> **Status:** PLANNING — no implementation yet.
> **Goal:** Evolve the corporate-on-demand skill to use a unified SQLite backbone with event-driven queues (Honker) and semantic search (sqlite-vec), replacing file-based state/inbox.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         project.db (SQLite)                          │
│                                                                     │
│  ┌───────────────┐  ┌───────────────────┐  ┌────────────────────┐  │
│  │   Honker      │  │   sqlite-vec      │  │   FTS5             │  │
│  │               │  │                   │  │                    │  │
│  │ • Queues      │  │ • vec_artifacts   │  │ • Full-text index  │  │
│  │ • Streams     │  │ • Embeddings      │  │ • Keyword search   │  │
│  │ • Scheduler   │  │ • Similarity KNN  │  │                    │  │
│  │ • Pub/Sub     │  │                   │  │                    │  │
│  └───────────────┘  └───────────────────┘  └────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   Core Tables                                │    │
│  │  departments | artifacts | directives | state | grades       │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Flow: Department Communication

```
  ┌──────────┐         ┌──────────┐         ┌──────────┐
  │   R&D    │         │    QA    │         │   CEO    │
  │  (cron)  │         │  (cron)  │         │  (cron)  │
  └────┬─────┘         └────┬─────┘         └────┬─────┘
       │                     │                     │
       │  1. claim() from    │                     │
       │     queue("rnd")    │                     │
       │                     │                     │
       ▼                     │                     │
  ┌─────────┐                │                     │
  │ Process │                │                     │
  │ + LLM   │                │                     │
  └────┬────┘                │                     │
       │                     │                     │
       │  2. Single atomic transaction:            │
       │     • INSERT artifact                     │
       │     • INSERT vec_artifacts (embedding)    │
       │     • queue("qa").enqueue(artifact_id)    │
       │     • stream("log").publish(event)        │
       │                     │                     │
       ▼                     ▼                     │
  ┌─────────────────────────────┐                  │
  │        project.db           │                  │
  │   queue("qa") has new job   │                  │
  └─────────────────────────────┘                  │
                                │                  │
       3. QA cron fires,        │                  │
          claim() picks up job  │                  │
                                ▼                  │
                           ┌─────────┐             │
                           │ QA runs │             │
                           │ pipeline│             │
                           └────┬────┘             │
                                │                  │
                                │  4. Grade < threshold?
                                │     → queue("ceo").enqueue(escalation)
                                │                  │
                                ▼                  ▼
                           ┌──────────────────────────┐
                           │  CEO reads escalations   │
                           │  + issues directives     │
                           │  → queue("rnd").enqueue  │
                           └──────────────────────────┘
```

---

## Embedding Strategy

```
┌────────────────────────────────────────────────────────────┐
│                    Embedding Flow                            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Department produces artifact                              │
│         │                                                  │
│         ▼                                                  │
│  ┌─────────────────┐    Success    ┌───────────────────┐  │
│  │  Cohere embed-v4│─────────────▶│  Store in          │  │
│  │  (1024 dims)    │              │  vec_artifacts      │  │
│  └────────┬────────┘              └───────────────────┘  │
│           │                                               │
│           │ Rate limit / API failure                      │
│           ▼                                               │
│  ┌─────────────────┐  Success     ┌───────────────────┐  │
│  │  Ollama local   │─────────────▶│  Store in          │  │
│  │  mxbai-embed-   │              │  vec_artifacts      │  │
│  │  large (1024)   │              │  (same table!)      │  │
│  └────────┬────────┘              └───────────────────┘  │
│           │                                               │
│           │ Ollama also down (rare)                       │
│           ▼                                               │
│  ┌─────────────────┐                                     │
│  │  Mark as        │   Next run, retry:                  │
│  │  pending_embed  │──▶ SELECT * FROM artifacts          │
│  │  in artifacts   │     WHERE embed_status='pending'    │
│  └─────────────────┘                                     │
│                                                           │
│  System works WITHOUT embeddings:                         │
│  • Queues still deliver                                   │
│  • Pipelines still run                                    │
│  • FTS5 keyword search still works                        │
│  • Only semantic search is degraded                       │
│                                                           │
└────────────────────────────────────────────────────────────┘
```

**Embedding models (both 1024 dimensions — interchangeable in same table):**
- **Primary:** Cohere `embed-v4` (free tier, 1000 calls/month, `output_dimensions=1024`)
- **Fallback:** Ollama `mxbai-embed-large` (local, zero cost, ~670MB model)
- **Last resort:** `embed_status = 'pending'` — retry next run. System fully functional without embeddings.

**Embed logic (pseudocode):**
```typescript
async function embedArtifact(text: string): Promise<Float64Array | null> {
  try {
    return await cohere.embed(text, { dimensions: 1024 });
  } catch (e) {
    if (isRateLimit(e)) {
      try {
        return await ollama.embed("mxbai-embed-large", text); // also 1024
      } catch {
        return null; // mark pending, retry later
      }
    }
    throw e;
  }
}
```

---

## Database Schema (Draft)

```sql
-- Extensions loaded on connect
-- load_extension('honker')
-- load_extension('vec0')

------------------------------------------------------------
-- Core tables
------------------------------------------------------------

CREATE TABLE departments (
    id          TEXT PRIMARY KEY,    -- 'rnd', 'qa', 'ceo'
    name        TEXT NOT NULL,
    system_md   TEXT NOT NULL,       -- SYSTEM.md content
    pipeline    TEXT NOT NULL,       -- JSON: ["stage1","stage2"]
    status      TEXT DEFAULT 'idle', -- idle | working | blocked
    last_run_at TEXT,
    config      TEXT                 -- JSON: extra config
);

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

CREATE TABLE directives (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_dept   TEXT NOT NULL,
    to_dept     TEXT NOT NULL,
    content     TEXT NOT NULL,
    priority    INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'active', -- active | completed | cancelled
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE grades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id INTEGER REFERENCES artifacts(id),
    grader_dept TEXT NOT NULL,       -- who graded
    score       REAL NOT NULL,       -- 0.0-1.0
    reasoning   TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

------------------------------------------------------------
-- Vector table (sqlite-vec)
------------------------------------------------------------

CREATE VIRTUAL TABLE vec_artifacts USING vec0(
    id       INTEGER PRIMARY KEY,
    embedding FLOAT[1024]           -- Cohere embed-v4 dimensions
);

------------------------------------------------------------
-- Full-text search (FTS5)
------------------------------------------------------------

CREATE VIRTUAL TABLE artifacts_fts USING fts5(
    content,
    content=artifacts,
    content_rowid=id
);

------------------------------------------------------------
-- Honker queues & streams (created via API, not DDL)
------------------------------------------------------------
-- db.queue("rnd")       -- R&D inbox
-- db.queue("qa")        -- QA inbox
-- db.queue("ceo")       -- CEO inbox
-- db.queue("embed")     -- Embedding retry queue
-- db.stream("activity") -- Global activity log
```

---

## Anti-Slop via Semantic Scoring

```
┌──────────────────────────────────────────────────────────┐
│              Quality Assessment Pipeline                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  New artifact arrives at QA                              │
│         │                                                │
│         ├──▶ 1. FTS5: banned word check (fast)          │
│         │       "synergy", "leverage", "delve"...       │
│         │       → instant FAIL if found                 │
│         │                                                │
│         ├──▶ 2. sqlite-vec: cosine similarity to        │
│         │       last 10 APPROVED artifacts from          │
│         │       same department                          │
│         │       → too similar (>0.95)? flag as slop     │
│         │       → reasonable range (0.4-0.85)? good     │
│         │                                                │
│         ├──▶ 3. sqlite-vec: distance from "golden       │
│         │       reference" vectors (seeded manually      │
│         │       or from first approved outputs)          │
│         │       → below threshold? flag for review      │
│         │                                                │
│         └──▶ 4. LLM grading (existing pipeline)         │
│                 CEO grades with anti-slop contract       │
│                                                          │
│  Final grade = weighted combo of steps 2-4              │
│  (step 1 is a hard gate, not a score)                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Migration from v1 (Big Bang)

### Phase 1: Foundation
| # | Task | Description |
|---|------|-------------|
| 1 | Schema design | Finalize tables, indexes, constraints |
| 2 | DB init script | `init-db.ts` — creates project.db with all extensions |
| 3 | Honker integration | Queue/stream creation, worker patterns |
| 4 | sqlite-vec setup | Vector table, Cohere embed wrapper with fallback |

### Phase 2: Core Rewrite
| # | Task | Description |
|---|------|-------------|
| 5 | Replace state.json | Read/write state via SQLite `departments` table |
| 6 | Replace inbox files | Departments claim() from Honker queues |
| 7 | Artifact storage | Content + embedding in single transaction |
| 8 | Activity stream | Replace log files with `stream("activity")` |

### Phase 3: Enhanced Features
| # | Task | Description |
|---|------|-------------|
| 9 | Semantic search API | Helper: "find related artifacts" via vec_artifacts |
| 10 | Anti-slop v2 | Embedding-based quality scoring (see pipeline above) |
| 11 | Cross-dept context | Departments can query related work from other depts |
| 12 | CEO dashboard | `report.ts` reads from DB instead of scanning files |

### Phase 4: Tooling & Skill Update
| # | Task | Description |
|---|------|-------------|
| 13 | Update scaffold.ts | New project creates .db instead of file tree |
| 14 | Update validate.ts | Checks DB integrity, queue health, vec coverage |
| 15 | Update add-department.ts | INSERT into departments + create queue |
| 16 | Embed retry job | Periodic: retry `embed_status='pending'` artifacts |
| 17 | Update SKILL.md | Document new architecture, tools, examples |

---

## Hermes Cron Integration

```
┌────────────────────────────────────────────────────────────┐
│                  Runtime Model                              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Hermes cron job (per department):                         │
│                                                            │
│    1. Load SYSTEM.md identity from DB                      │
│    2. Connect to project.db (load extensions)              │
│    3. queue("dept").claim("dept-worker")                   │
│       → gets pending jobs (or empty = idle)                │
│    4. LLM processes each job (agent reasoning)             │
│    5. Atomic write:                                        │
│       • Store artifact + embedding                         │
│       • Enqueue to next department                         │
│       • Publish to activity stream                         │
│    6. Update department status                             │
│    7. Exit                                                 │
│                                                            │
│  CEO cron (less frequent):                                 │
│    1. Read stream("activity") since last run               │
│    2. Review grades, check escalations                     │
│    3. Issue directives → queue("target-dept")              │
│    4. Semantic query: "any stalled work?" via vec search   │
│                                                            │
│  Embed retry cron (daily):                                 │
│    1. SELECT WHERE embed_status='pending'                  │
│    2. Batch call Cohere                                    │
│    3. Update vec_artifacts + embed_status='done'           │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## Dependencies & Requirements

| Component | Package | Language | Notes |
|-----------|---------|----------|-------|
| Honker | `honker` (pip) or `@russellthehippo/honker-bun` | Python/Bun | Alpha, but functional |
| sqlite-vec | `sqlite-vec` | C extension | Loadable, zero deps |
| FTS5 | Built into SQLite | — | Already available |
| Cohere | `cohere` SDK or REST | Python/curl | Free tier: 1000 embeds/month |
| SQLite | System | — | WAL mode for concurrency |

---

## Resolved Decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Bun or Python? | **Bun/TS** | Both Honker (`@russellthehippo/honker-bun`) and sqlite-vec (npm) have full Bun support. Keeps consistency with existing scaffold scripts. |
| 2 | Embedding dimensions | **1024 dims** | Cohere embed-v4 (1024) + Ollama mxbai-embed-large (1024) — same dimensions, vectors interchangeable in same table. |
| 3 | Queue naming | **One queue per department** | Honker has no filtered claim. `queue("rnd")`, `queue("qa")`, `queue("ceo")`, `queue("embed")` — intended pattern. |
| 4 | Golden references | **Auto-seed + rolling** | First 5 artifacts scoring >0.8 become initial golden set. After that, rolling window of last 10 approved artifacts. Self-improving, no manual curation. |
| 5 | WAL mode | **Non-issue** | Honker auto-enables WAL on open. `PRAGMA data_version` wake works in all journal modes. No conflict with tooling. |
| 6 | Honker fallback | **Poll plain SQLite** | Queue tables (`_honker_live`, `_honker_dead`) are regular SQLite rows. Without extension: raw SQL claim with `UPDATE...WHERE state='pending' LIMIT 1 RETURNING *`. Data intact. |
| 7 | Embedding fallback | **Cohere → Ollama → pending** | Cloud quality when available, local fallback when rate-limited, graceful degradation when both are down. |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Honker is alpha software | Queue loss, bugs | Fallback: poll `artifacts` table directly; Honker is convenience not hard dependency |
| Cohere rate limit hit | No new embeddings | Graceful degradation — system works without vectors, retry next day |
| sqlite-vec brute-force is slow at scale | Slow semantic queries | At corporate-on-demand scale (100s of artifacts, not millions) this won't matter |
| Single SQLite file = single writer | Concurrent cron jobs block | WAL mode + short transactions. Honker designed for this. |
| Big bang migration breaks existing projects | Downtime | One-time migration script: reads old files → populates DB |

---

## Success Criteria

- [ ] All inter-department communication via Honker queues (no inbox files)
- [ ] State queryable via SQL (no state.json)
- [ ] Semantic search working: "find related artifacts" returns relevant results
- [ ] System degrades gracefully when Cohere is unavailable
- [ ] Anti-slop scoring uses embedding similarity alongside existing LLM grading
- [ ] Single `project.db` file contains all project state
- [ ] scaffold/validate/report scripts work with new architecture
- [ ] Existing templates (game/saas/etc.) migrated to new schema

---

*Plan created: 2026-05-29 | Next step: Review and approve, then start Phase 1*
