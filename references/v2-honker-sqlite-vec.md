# Corporate-on-Demand v2: Honker + sqlite-vec Architecture

## Summary

Evolution from file-based state/inbox to a **single SQLite file** with three extensions:
- **Honker** — event-driven queues, pub/sub, scheduler (replaces inbox files)
- **sqlite-vec** — vector similarity search over artifacts (new capability)
- **FTS5** — full-text keyword search (built-in)

## Key Decisions

- **Hermes cron stays** — Honker does NOT replace Hermes cron. Hermes cron = agent brain (LLM reasoning). Honker = inter-department communication layer (queues replace inbox files).
- **Embedding model:** Cohere embed-v4 free tier (1024 dims, 1000 calls/month). Fallback: mark as `embed_status='pending'`, retry next day. System fully functional without embeddings.
- **Migration:** Big bang rewrite (not incremental).
- **Anti-slop v2:** Embedding-based quality scoring — cosine similarity to approved artifacts + golden references + existing LLM grading.
- **Single file:** All state in `project.db` — no state.json, no inbox text files.

## Honker vs Hermes Cron (Common Confusion)

| Layer | What | Purpose |
|-------|------|---------|
| Hermes cron | Spawns full agent session with LLM | Department "brain" |
| Honker scheduler | Fires DB-level event on cron expr | No LLM, just inserts queue row |
| Honker queue | `queue("dept").claim()` | Replaces inbox file reads |

Honker makes communication **atomic** (artifact + enqueue + log = one transaction) and **reliable** (dead-letter, retries, visibility timeout).

## Architecture Flow

```
Hermes cron fires dept →
  agent connects to project.db →
    claim() from department queue →
      LLM processes →
        atomic: artifact + embedding + enqueue next + stream log →
          exit
```

## Full Plan

See `.hermes/plans/2026-05-29-corporate-on-demand-v2-honker-sqlite-vec.md` for:
- Complete DB schema
- 4-phase migration plan
- ASCII flow diagrams
- Open decisions
- Risks & mitigations

## Tech Stack

| Component | Package | Notes |
|-----------|---------|-------|
| Honker | `honker` (pip) / `@russellthehippo/honker-bun` | Alpha, SQLite ext, Rust core |
| sqlite-vec | `sqlite-vec` | C ext, zero deps, brute-force KNN |
| Cohere | REST / SDK | Free tier embed-v4, 1024 dims |
| SQLite | System | WAL mode required for Honker |
