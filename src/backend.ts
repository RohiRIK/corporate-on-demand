/**
 * The two agent engines, and the command each one needs.
 *
 * They speak the same JSONL contract because one IS the other: `@kilocode/cli`
 * is an opencode fork - its package keywords include `opencode` and its own
 * startup log line prints `opencode`. So the difference is the BINARY and the
 * MODEL POOL, not the wire format, and that is what makes running both cheap.
 *
 * Running both is deliberate rather than indecisive. Because they share an
 * engine, switching to one alone would diversify the model pool but NOT the
 * failure modes: the upstream JSONL truncation bug
 * (anomalyco/opencode#31435, #29866, #26855) would follow us either way, and
 * whether `@kilocode/cli@7.8.1` contains those fixes is unverified. Two engines
 * give a real per-engine health signal, and a bug in one does not silently
 * disable the other.
 *
 * Measured on this host, credential-free, on 2026-09-30: Zen ~25% success over
 * four attempts, Kilo's free models 12/12. That is one afternoon on one prompt,
 * not a reliability study - but it is the difference between a system that
 * cannot finish its work and one that usually can.
 */

export interface Backend {
  readonly id: string;
  readonly bin: string;
  /**
   * Free, credential-free model ids.
   *
   * Every one of these was verified keyless. There is a test that fails the
   * build if a paid model id ever appears here, because `kilo/anthropic/*`
   * returns 401 PAID_MODEL_AUTH_REQUIRED and a $0 system should not be one
   * careless edit away from a bill.
   */
  readonly models: readonly string[];
  /**
   * Flags this engine needs that the other does not have.
   *
   * `--auto` is an opencode extension; passing it to kilo is a usage error. It
   * is declared rather than discovered at 3am, and it is PLACED in buildFor
   * rather than filtered afterwards, because the position matters.
   */
  readonly extra: readonly string[];
}

export const BACKENDS: readonly Backend[] = [
  {
    id: "opencode",
    bin: "opencode",
    // Zen's free set. NOT every id ends in "-free": `big-pickle` is free
    // without announcing it, so a suffix check is the wrong test here - which
    // is exactly why the tests assert the declared list instead.
    models: [
      "opencode/space-bunny-free",
      "opencode/big-pickle",
      "opencode/nemotron-3.5-lightning-free",
    ],
    extra: ["--auto"],
  },
  {
    id: "kilo",
    bin: "kilo",
    models: [
      // Auto-router: picks a model per call, which is rotation for free.
      "kilo/kilo-auto/free",
      // OpenRouter's free pool, reachable without a key THROUGH kilo. That is a
      // genuinely independent origin, which we do not have any other way.
      "kilo/openrouter/free",
      "kilo/stepfun/step-3.7-flash:free",
      "kilo/poolside/laguna-s-2.1:free",
      "kilo/nvidia/nemotron-3.5-lightning:free",
      "kilo/cohere/north-mini-code:free",
    ],
    extra: [],
  },
];

function backendById(backendId: string): Backend {
  const found = BACKENDS.find((b) => b.id === backendId);
  if (found === undefined) throw new Error(`unknown backend "${backendId}"`);
  return found;
}

export function modelIds(backendId: string): readonly string[] {
  return backendById(backendId).models;
}

/**
 * The engine for a model id.
 *
 * The model id decides the engine, so the workspace schema does not grow a
 * field and the decision stays visible in `cod.json` where an operator can read
 * it. An unknown model is an error rather than a default, because falling back
 * would dispatch on the wrong engine and report the mistake as a provider
 * problem.
 */
export function backendForModel(model: string): string {
  const match = BACKENDS.find((b) => b.models.includes(model));
  if (match === undefined) {
    throw new Error(`no engine advertises model "${model}"; add it to src/backend.ts`);
  }
  return match.id;
}

/**
 * The argv for one run.
 *
 * NO `--dir` on either engine: measured to fail on a git worktree with an
 * opaque "Unexpected server error". Confinement is the spawn's `cwd`, set by
 * `localRunner`.
 *
 * The prompt is JSON-quoted so a task containing quotes or newlines cannot
 * break out of the command.
 */
export function buildFor(backendId: string, model: string, prompt: string, title: string): string[] {
  const backend = backendById(backendId);
  // `--auto` sits right after `--pure`, where opencode expects it. Splicing it
  // in afterwards would produce a command that parses and then misbehaves,
  // which is worse than one that fails loudly.
  const args = [backend.bin, "run", "--pure", ...backend.extra, "--format", "json", "-m", model, "--title", title];
  return [...args, JSON.stringify(prompt)];
}
