# Browser-Based Game Testing Patterns

Manual browser verification techniques for canvas-based games. Use when QA automation isn't available yet.

## Quick Playability Check (per game)

1. Navigate to game URL, click the game card
2. Wait 2-3 seconds for game loop to settle
3. Check canvas pixel composition:
   ```js
   const ctx = document.getElementById('gameCanvas').getContext('2d');
   const d = ctx.getImageData(0, 0, 600, 400).data;
   let bright = 0;
   for (let i = 0; i < d.length; i += 4)
     if (d[i] > 200 || d[i+1] > 200 || d[i+2] > 200) bright++;
   // >2000 bright pixels with score=0 = likely GAME OVER screen
   ```
4. Press arrow keys / space, then re-check canvas state after 500ms — did anything change?

## Common Failure Patterns

| Pattern | Symptom | Root Cause |
|---------|---------|------------|
| Instant GAME OVER | Score 0, bright text immediately | Auto-start without "Press to Start" — game moves before player reacts |
| Stuck player | Canvas renders but input does nothing | Player spawned inside wall/obstacle (e.g. Pac-Man tile issue) |
| No canvas content | Dark/empty canvas | JS error killed game loop — check console |
| Audio crash | `Failed to execute 'connect' on 'AudioNode'` | zzfx called before user interaction (AudioContext policy). Non-fatal but no sound. |

## Two-Phase Check

- **Phase 1 (500ms):** `hasGreen=true` → game loop is drawing the player entity
- **Phase 2 (3s):** `green=0, bright>2000` → player died, GAME OVER rendered

If Phase 1 passes but Phase 2 fails, the game auto-starts and dies before the player can react.

## Inline vs External Script Conflicts

Games can have BOTH an inline `<script>` in HTML and an external `<script src="js/games/...">`.
Check for collisions:
```js
// Find all inline game function definitions
document.querySelectorAll('script:not([src])').forEach(s => {
  if (s.textContent.includes('startSnake')) console.log('INLINE CONFLICT: startSnake');
});
```
The LAST definition wins (inline usually comes after external `<script>` tags).

## Mobile / Touch Control Testing

Touch controls dispatch synthetic `KeyboardEvent` from buttons. Three failure modes discovered:

### 1. Event target mismatch (`document` vs `window`)

Touch buttons dispatch `keydown` to `document` (line 154 in a typical setup):
```js
const fireKey = () => document.dispatchEvent(new KeyboardEvent('keydown', { key }));
```
But some games listen on `window`:
```js
window.addEventListener('keydown', onKeyDown);  // NEVER receives document events
```
Events dispatched on `document` do NOT bubble up to `window`. **Audit every game's listener target against the touch dispatch target.**

Quick check:
```js
// Find window listeners (potential touch-broken games)
// grep -n 'window.addEventListener.*key' index.html js/games/*.js
```

### 2. First-press sets direction (instant death)

If a game's "press to start" handler also sets direction from the key:
```js
if (waitingToStart) {
  waitingToStart = false;
  const nd = map[e.key];  // ArrowUp → direction = UP
  if (nd) direction = nd;  // Snake now moves UP, hits wall in 1s
}
```
On mobile, users naturally press ▲ first. Fix: ignore direction from the first keypress, keep default.

### 3. Missing `keyup` — continuous movement broken

Touch buttons that only fire `keydown` on `touchstart` without `keyup` on `touchend` break games that track held keys (Space Invaders movement, Breakout paddle, Pong). These games set `keys[key] = true` on keydown and `keys[key] = false` on keyup — without the up event, movement gets stuck in one direction forever.

Required pattern:
```js
btn.addEventListener('touchstart', e => { e.preventDefault(); fireKeyDown(); });
btn.addEventListener('touchend', e => { e.preventDefault(); fireKeyUp(); });
```

### Mobile QA Checklist

- [ ] Touch D-pad buttons appear when game launches
- [ ] Each direction button works (not just UP)
- [ ] Fire/action button works (Space Invaders 🔫, etc.)
- [ ] Continuous hold works (paddle games, movement)
- [ ] Game doesn't auto-die from first touch direction
- [ ] All games listen on `document` (not `window`) for keyboard events
