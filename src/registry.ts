/**
 * Which model should this job use?
 *
 * Measured, not guessed. We were pinned to ONE model on a shared best-effort
 * pool and rode it to roughly a 25% success rate - and the cause is documented
 * per-model rot, not general bad luck: independent testers report muse-spark
 * 500s, `mimo-v2.5-free` rate-limited, `deepseek-v4-flash-free` retired
 * upstream. On the Kilo side `qwen3.8-27b:free` was already rate-limited the
 * first time it was called. So the fix is to ROTATE, not to hope.
 *
 * A model that answers but fails the assertion counts as a FAILURE here, and
 * that is the load-bearing part. It is not a provider error - it is a wrong
 * answer - so no amount of HTTP-level health checking would ever catch it. The
 * assertion is what makes it visible, and this is what acts on it.
 *
 * In-memory on purpose. This is a heuristic for spreading load and ejecting
 * repeat offenders, not a ledger: losing it costs nothing and re-learns in a
 * few calls. Anything durable here would be a second source of truth to keep in
 * step with the work ledger, for a problem that does not need one.
 */

export interface Attempt {
  readonly backend: string;
  readonly model: string;
  readonly ok: boolean;
  readonly at: number;
}

export interface Candidate {
  readonly backend: string;
  readonly model: string;
}

interface Stats {
  ok: number;
  fail: number;
  consecutiveFail: number;
  /** When the model was last seen failing, used to keep it out after a trip. */
  lastFailAt: number;
  tripped: boolean;
}

export class Registry {
  private readonly stats = new Map<string, Stats>();
  private cursor = 0;

  public constructor(
    /** Consecutive failures before a model is ejected. */
    private readonly threshold = 2,
  ) {}

  private key(backend: string, model: string): string {
    return `${backend}::${model}`;
  }

  private entry(key: string): Stats {
    const found = this.stats.get(key);
    if (found !== undefined) return found;
    const fresh: Stats = { ok: 0, fail: 0, consecutiveFail: 0, lastFailAt: 0, tripped: false };
    this.stats.set(key, fresh);
    return fresh;
  }

  public record(attempt: Attempt): void {
    const s = this.entry(this.key(attempt.backend, attempt.model));
    if (attempt.ok) {
      s.ok += 1;
      s.consecutiveFail = 0;
      s.tripped = false;
      return;
    }
    s.fail += 1;
    s.consecutiveFail += 1;
    s.lastFailAt = attempt.at;
    if (s.consecutiveFail >= this.threshold) s.tripped = true;
  }

  /**
   * May this model be used right now?
   *
   * A tripped model stays out until it actually succeeds. Letting a tripped
   * model back in "to see" is how a broken model stays in the pool: it fails
   * the probe, that failure is not recorded, and the next real job pays for it
   * again.
   */
  public healthy(backend: string, model: string): boolean {
    return !this.entry(this.key(backend, model)).tripped;
  }

  /**
   * Choose a model for the next job.
   *
   * Rotates first, then sorts by observed success rate. The rotation matters
   * more than the ranking: two models that have never been tried look equally
   * good forever, and one model pinned through a pool is the failure this file
   * exists to prevent.
   */
  public pick(candidates: readonly Candidate[]): Candidate | null {
    if (candidates.length === 0) return null;

    const healthy = candidates.filter((c) => this.healthy(c.backend, c.model));
    // Everything is ejected. Dispatch anyway. Refusing to work is its own kind
    // of silent failure, and it looks identical to the provider outage we were
    // trying to survive.
    const pool = healthy.length > 0 ? healthy : candidates;

    const offset = this.cursor % pool.length;
    this.cursor += 1;
    const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];

    const rate = (c: Candidate): number => {
      const s = this.stats.get(this.key(c.backend, c.model));
      if (s === undefined || s.ok + s.fail === 0) return 0.5;
      return s.ok / (s.ok + s.fail);
    };

    const best = Math.max(...rotated.map(rate));
    const tied = rotated.filter((c) => rate(c) === best);
    return tied[Math.floor(Math.random() * tied.length)] ?? null;
  }

  /** One line for the operator: what this registry currently believes. */
  public describe(): string {
    if (this.stats.size === 0) return "no model has been tried yet";
    return [...this.stats.entries()]
      .map(([key, s]) => `${key} ${s.ok}/${s.ok + s.fail}${s.tripped ? " (ejected)" : ""}`)
      .join("; ");
  }
}
