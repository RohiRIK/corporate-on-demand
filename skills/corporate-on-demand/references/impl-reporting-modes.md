# Reporting Modes — Delivery Configuration

How departments deliver their cycle reports. **This is a mandatory setup decision.** If you skip it, the system defaults to Mode A (all messages delivered to your chat).

---

## Available Modes

### Mode A: All Messages (default)
Every department sends its full report to your chat after every cycle.

```json
"reporting": {
  "mode": "all"
}
```

- **Volume**: 20-40 messages/day (depends on department count and schedule)
- **Latency**: Instant — you see everything as it happens
- **Best for**: Initial setup, debugging the system, small orgs (3-4 departments)
- **Downside**: Noisy. Gets overwhelming fast with 6+ departments.

### Mode B: Tiered Delivery
Critical departments report to chat. Others save locally. Morning digest covers everything.

```json
"reporting": {
  "mode": "tiered",
  "alwaysDeliver": ["ceo", "qa"],
  "localOnly": ["it", "devops", "security", "infra"],
  "digestSchedule": "0 8 * * *"
}
```

- **Volume**: 4-8 messages/day + 1 morning digest
- **Latency**: CEO/QA instant, others delayed until digest
- **Best for**: Established orgs where you trust departments to work autonomously
- **Downside**: Infrastructure issues from silent departments may wait until morning

Configuration:
- `alwaysDeliver`: These departments send every cycle report to your chat
- `localOnly`: These departments save to `logs/` only — included in morning digest
- Any department not listed in either follows `alwaysDeliver` behavior

### Mode C: Smart Escalation
All departments save locally by default. Reports only reach your chat when something important happens.

```json
"reporting": {
  "mode": "smart",
  "escalationTriggers": ["p1", "shipped", "blocked", "incident"],
  "digestSchedule": "0 8 * * *"
}
```

- **Volume**: 0-5 messages/day (only when things happen) + 1 morning digest
- **Latency**: P1 issues instant, routine work delayed
- **Best for**: Mature orgs with proven pipelines — you only want to hear about exceptions
- **Downside**: Requires departments to correctly classify what's important

Escalation triggers (what causes a message to be sent):
- `p1` — P1 bug found or filed
- `shipped` — A game or feature was shipped to production
- `blocked` — Department is blocked and needs input
- `incident` — System down, container crash, data loss
- `grade_drop` — CEO grades a department below C
- `milestone` — Pipeline stage completed (e.g., spec→build transition)

Departments must include this logic in their cycle:
1. Run normal cycle, write results to local log
2. Check: did any escalation trigger fire?
3. If yes: include `ESCALATION: <trigger>` in report header, deliver to chat
4. If no: save locally, done

### Mode D: Dedicated Channel
All reports go to a separate Telegram group/channel. CEO summary goes to your DM.

```json
"reporting": {
  "mode": "channel",
  "channelTarget": "telegram:-100XXXXXXXXXX",
  "dmTarget": "origin",
  "channelDepts": ["rnd", "uxui", "infra", "pm", "it", "devops", "security", "qa"],
  "dmDepts": ["ceo"],
  "digestSchedule": "0 8 * * *"
}
```

- **Volume**: 1-2 messages/day in your DM, all traffic in the channel
- **Latency**: Everything is instant, just in different places
- **Best for**: Teams or multi-user setups where several people monitor the org
- **Downside**: Requires a separate Telegram group setup

Setup:
1. Create a Telegram group for the org
2. Add Hermes bot to the group
3. Run `/sethome` in the group to register it
4. Set `channelTarget` to that group's chat ID

### Mode E: Hybrid (combine any of the above)
Mix modes — some departments tiered, some smart, some in a channel.

```json
"reporting": {
  "mode": "hybrid",
  "rules": {
    "ceo": { "deliver": "origin", "always": true },
    "qa": { "deliver": "origin", "escalationOnly": ["p1", "shipped"] },
    "rnd": { "deliver": "origin", "escalationOnly": ["shipped", "blocked"] },
    "uxui": { "deliver": "local", "includeInDigest": true },
    "infra": { "deliver": "telegram:-100XXXXXXXXXX", "always": true },
    "pm": { "deliver": "local", "includeInDigest": true },
    "it": { "deliver": "local", "includeInDigest": true },
    "devops": { "deliver": "local", "escalationOnly": ["incident"] },
    "security": { "deliver": "local", "escalationOnly": ["p1", "incident"] }
  },
  "digestSchedule": "0 8 * * *"
}
```

- **Volume**: Fully customizable per department
- **Best for**: Large orgs with specific routing needs
- **Downside**: Most complex to configure

---

## Setup Instructions

### 1. Choose your mode
Add the `reporting` section to your `state.json`:

```json
{
  "orgName": "...",
  "reporting": {
    "mode": "tiered",
    ...
  }
}
```

### 2. Apply to cron jobs
Based on your mode, update each department's cron job `deliver` field:

| Mode | Cron `deliver` value |
|------|---------------------|
| `all` | `"telegram"` (or `"origin"`) for all jobs |
| `tiered` | `"telegram"` for `alwaysDeliver`, `"local"` for `localOnly` |
| `smart` | `"local"` for all — department prompt handles escalation |
| `channel` | `"telegram:<channel_id>"` for channel depts, `"origin"` for DM depts |
| `hybrid` | Per-department as defined in `rules` |

### 3. Update department prompts (Mode C / Smart only)
Each department prompt needs escalation logic. Add to the prompt:

```
REPORTING RULE: Your default delivery is local (file only).
If any of these triggers fire during your cycle, set your report header to "ESCALATION: <trigger>" and the system will deliver to chat:
- P1 bug found or filed
- Game or feature shipped to production
- You are blocked and need human input
- System incident (downtime, crash, data loss)
If none fired, save your report to logs/ only.
```

### 4. Morning digest
All modes (except Mode A) should have a morning digest cron that:
1. Reads all department logs from the last 24 hours
2. Summarizes key events, decisions, and metrics
3. Delivers to your chat

---

## Migration Between Modes

Switching modes is safe and reversible:

1. Update `reporting` in state.json
2. Update cron job `deliver` fields accordingly
3. No department SYSTEM.md changes needed (except adding/removing escalation logic for Mode C)

You can switch at any time. No data is lost — all reports are always saved to `logs/` regardless of delivery mode.

---

## Recommendations by Org Size

| Departments | Recommended Mode | Why |
|-------------|-----------------|-----|
| 3-4 | Mode A (all) | Low volume, easy to follow |
| 5-7 | Mode B (tiered) | Filter noise, keep oversight |
| 8-12 | Mode C (smart) | Only exceptions reach you |
| 12+ or multi-user | Mode D (channel) or E (hybrid) | Separate concerns |

---

## Default Behavior

**If `reporting` is not configured in state.json, the system defaults to Mode A** — every department delivers every cycle report to your chat. This ensures no reports are silently lost during initial setup.
