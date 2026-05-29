# LanceDB + Honker Integration Notes

Research from May 2026 on replacing cron+state.json+inbox with event-driven architecture.

## Honker (SQLite extension, Rust-based)

GitHub: russellromney/honker (2.6k stars, alpha, April 2026)
Adds Postgres-style NOTIFY/LISTEN to SQLite with:

- **Work queues** — at-least-once, retries, priority, delayed jobs, dead-letter table
- **Durable streams** — per-consumer offsets, replay from checkpoint
- **Ephemeral pub/sub** — NOTIFY/LISTEN across processes
- **Atomic with business writes** — enqueue + INSERT same transaction
- **Built-in scheduler** — cron expressions, pause/resume/cancel
- **~1ms delivery** — polls PRAGMA data_version every 1ms
- Bindings: Python, Node, Bun, Rust, Go, Ruby, Elixir, .NET, JVM

Key property: queue and business write commit together or roll back together. No dual-write problem.

## LanceDB (embedded vector DB)

- Serverless, embedded (like SQLite but uses Lance columnar format — separate files)
- Vector + full-text + SQL search in one table
- Multimodal: raw data, embeddings, metadata together
- Designed for RAG, agents, semantic search

## Mapping to Corporate-on-Demand Architecture

### Honker replaces polling/cron for inter-department comms

| Current | With Honker |
|---------|-------------|
| Staggered cron schedules | Event-driven: department wakes on queue message |
| state.json polling | Durable stream per department |
| Inbox files (JSON) | Work queue with retries + dead-letter |
| CEO checks grades on schedule | LISTEN on "escalation" channel |
| Lost messages on crash | Atomic enqueue + artifact write |

### LanceDB adds semantic layer

- Store department outputs as embeddings → semantic cross-department search
- CEO queries "what did R&D produce related to X?" without keyword match
- Anti-slop grading: compare output embedding similarity to known-good examples
- Cross-department context without explicit handoff files

### Combined architecture

- SQLite = single source of truth (state, queues, business data)
- Honker = event-driven messaging on same SQLite file
- LanceDB = semantic retrieval layer (separate Lance files)

## Open Design Questions

1. **Latency vs simplicity** — Does the system need sub-second reaction or is 5-min cron fine? Real-time adds complexity.
2. **Single file vs two stores** — LanceDB uses its own format, not SQLite. Acceptable tradeoff?
3. **Migration scope** — Full replacement of cron+state.json+inbox, or hybrid (Honker for hot path, cron for periodic housekeeping)?
4. **Failure semantics** — Dead-letter table maps naturally to CEO escalation. Define thresholds.
