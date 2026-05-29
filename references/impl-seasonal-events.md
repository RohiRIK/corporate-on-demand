# Seasonal Events & Themed Cycles

## Overview

The CEO can declare a theme that temporarily changes the platform's look and content. Themes are additive (layered on top of defaults) and reversible (removed cleanly when they expire). UX/UI handles visual changes; R&D adds themed game variants or content.

## state.json Schema

```json
{
  "theme": {
    "name": "winter-wonderland",
    "startedAt": "2025-12-15T00:00:00Z",
    "expiresAt": "2025-01-05T00:00:00Z",
    "active": true,
    "departments": {
      "uxui": { "applied": true, "artifacts": ["departments/uxui/themes/winter-wonderland/"] },
      "rnd": { "applied": true, "artifacts": ["departments/rnd/events/winter-wonderland/"] }
    }
  }
}
```

## Artifacts

```
departments/
  uxui/
    themes/
      winter-wonderland/
        theme.css          # Overlay styles (snowflakes, color palette)
        banner.md          # Banner text/config
        assets/            # Themed images, icons
  rnd/
    events/
      winter-wonderland/
        config.json        # Event-specific game configs
        featured-games.md  # Which games to highlight
        variants/          # Themed game variants (e.g., snow-tetris)
```

## Implementation Steps

### 1. CEO declares theme

CEO adds theme to state.json and issues directives:

```
THEME DECLARED: "Winter Wonderland" (Dec 15 – Jan 5)

UX/UI: Create themed overlay at departments/uxui/themes/winter-wonderland/.
Include: seasonal color palette, snowflake CSS animation, holiday banner.
Changes must be additive — use CSS overrides, not modifications to base styles.

R&D: Create event content at departments/rnd/events/winter-wonderland/.
Include: featured holiday-themed games, optional seasonal variants.
Do NOT modify existing game code — add new files or config overlays only.
```

### 2. UX/UI applies theme

- Creates theme directory with overlay CSS and assets
- Theme is loaded conditionally based on state.json `theme.active`
- Base styles are NEVER modified — theme is a separate layer

### 3. R&D adds event content

- Creates event config with featured games list
- Optionally adds themed game variants as new files
- Existing game code is unchanged

### 4. CEO expires theme

When `expiresAt` passes or CEO manually deactivates:
1. Set `theme.active = false` in state.json
2. UX/UI removes theme CSS loading (or it auto-disables via active flag)
3. Themed content remains in directories for potential reuse but is not served

## Theme Examples

### Holiday Themes
- **Winter Wonderland** (Dec–Jan): Snow effects, blue/white palette, holiday games featured
- **Lunar New Year** (Jan–Feb): Red/gold palette, lantern animations
- **Summer Arcade** (Jun–Aug): Bright colors, beach theme, outdoor game variants

### Weekly Featured Game
- Not a full theme — just a `featured_game` field in state.json
- UX/UI highlights it on the homepage
- Rotates weekly by CEO directive

### Seasonal Challenges
- Time-limited game challenges or achievements
- R&D adds challenge config: `departments/rnd/events/<name>/challenge.json`
- Track completion in analytics events

## Theme CSS Overlay Pattern

```css
/* departments/uxui/themes/winter-wonderland/theme.css */
/* ADDITIVE ONLY — never override base layout, only add visual flair */

:root[data-theme="winter-wonderland"] {
  --accent-color: #4a90d9;
  --bg-overlay: url('/themes/winter-wonderland/snow-bg.webp');
}

.theme-banner {
  display: block; /* hidden by default in base CSS */
  background: var(--accent-color);
}

.snowflake-animation {
  /* purely additive animation layer */
}
```

## Guards & Constraints

- **Additive only**: Themes add CSS/content overlays. They NEVER modify base styles, layouts, or game logic.
- **Reversible**: Removing a theme = setting `active: false`. No cleanup of base code needed.
- **Budget-aware**: Theme work counts against department budgets. CEO should allocate extra tokens for theme cycles.
- **Expiration enforced**: CEO must check `expiresAt` and deactivate expired themes. Stale themes are a bug.
- **No theme conflicts**: Only one theme active at a time. CEO must deactivate before activating another.
- **Reusable**: Theme directories persist for annual reuse. Next year's "Winter Wonderland" can start from last year's.
