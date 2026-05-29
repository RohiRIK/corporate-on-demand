# Honker + sqlite-vec Integration Research

Research findings for Corporate-on-Demand v2 architecture (May 2026).

## Honker (SQLite NOTIFY/LISTEN + queues)

- **Repo:** github.com/russellromney/honker (2.6k stars, alpha, Rust core)
- **What it does:** Adds Postgres-style NOTIFY/LISTEN, durable work queues, streams, and scheduler to SQLite
- **Wake mechanism:** Polls `PRAGMA data_version` every 1ms (~3µs read), single-digit-ms cross-process delivery
- **WAL:** Auto-enabled on open but NOT required. Wake works in all journal modes.
- **Queue tables:** `_honker_live`, `_honker_dead` — regular SQLite rows, readable without extension
- **No filtered claims:** `claim_batch(queue_name, worker_id, batch_size)` — no routing key param. Use one queue per work type.
- **Scheduler:** Leader-elected, supports 5/6-field cron + `@every` intervals. Addressable rows (pause/resume/update).
- **Bun binding:** `@russellthehippo/honker-bun` (v0.2.2) — full API parity with Python binding
- **Fallback if extension breaks:** Raw SQL against queue tables: `UPDATE _honker_live SET state='claimed' WHERE queue=? AND state='pending' LIMIT 1 RETURNING *`

## sqlite-vec (vector search)

- **Repo:** github.com/asg017/sqlite-vec (Mozilla Builders project)
- **What it does:** Virtual table for KNN vector search in SQLite
- **Pure C, zero deps** — runs everywhere including WASM
- **npm package:** `sqlite-vec` — works with `bun:sqlite` directly
- **Combined with FTS5** for hybrid full-text + vector search
- **Performance:** Brute-force/flat index (no HNSW). Fine for hundreds/thousands of artifacts, not millions.

## Embedding Strategy (Resolved)

Both models output **1024 dimensions** — interchangeable in same `vec_artifacts` table:
- **Primary:** Cohere `embed-v4` (free tier: 1000 calls/month, 20 req/min). Supports `output_dimensions` param (256/512/1024/1536).
- **Fallback:** Ollama `mxbai-embed-large` (local, ~670MB, 1024 dims, zero cost)
- **Last resort:** Mark `embed_status='pending'`, retry next run. System works without embeddings.

## Architecture Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Language | Bun/TS | Both Honker-bun and sqlite-vec npm exist. Keeps scaffold consistency. |
| Queue naming | One per dept | Honker has no filtered claim. `queue("rnd")`, `queue("qa")`, `queue("ceo")`. |
| Golden refs | Auto-seed + rolling | First 5 artifacts >0.8 grade = initial set. Then rolling last 10 approved. |
| Embed dims | 1024 | Cohere + mxbai-embed-large both output 1024. Same table, no mixing issues. |
| Honker fallback | Plain SQL poll | Queue data is just rows. Remove extension, add poll loop. |

## Key Insight: Honker Does NOT Replace Hermes Cron

Hermes cron = spawns LLM agent sessions (the "brain").
Honker scheduler = fires DB-level events (inserts row into queue, no LLM).

They work together: Hermes cron fires department agent → agent connects to DB → claims from Honker queue → processes with LLM → enqueues result to next department's queue atomically.

Honker replaces **file-based inbox/outbox**, not the agent scheduling.
