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
   * Flags this engine takes that are not universal.
   *
   * Empty on purpose, and that is the finding rather than an omission. I read
   * `--auto` as an opencode extension and stripped it from the kilo command;
   * kilo then refused every autonomous run with "run ended with an
   * auto-rejected permission; pass --auto for autonomous use". It has the flag
   * too, it is not in `kilo run --help`, and both engines want it.
   *
   * Kept as a field because the two will not stay identical forever, and the
   * next divergence should be a one-line change in review rather than a
   * discovery in production.
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
    // `--auto` too, and REQUIRED: without it every tool call is
    // auto-rejected and no autonomous work happens at all.
    extra: ["--auto"],
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
  // A bare id means "the default engine", which is opencode: it is what
  // DEFAULT_MODEL names and what every workspace written before this change
  // uses, so requiring a prefix would break all of them for no benefit.
  const prefix = model.includes("/") ? model.split("/")[0] : "opencode";
  const match = BACKENDS.find((b) => b.id === prefix);
  if (match === undefined) {
    // Not a whitelist, and deliberately so: the `models` list is a CURATED
    // DEFAULT POOL for rotation, not the set of everything an engine can run.
    // Routing by prefix keeps a workspace working the day either side lists a
    // model the other has not heard of. What is refused is an unknown ENGINE,
    // because that is the mistake worth catching loudly.
    throw new Error(`no engine handles model "${model}"; known engines: ${BACKENDS.map((b) => b.id).join(", ")}`);
  }
  return match.id;
}

/** Is this model in the curated default pool? Used by the budget-safety tests. */
export function isAdvertised(model: string): boolean {
  return BACKENDS.some((b) => b.models.includes(model));
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
  // Enforced here, at the lowest level, rather than only in the caller: a
  // model dispatched on an engine that cannot serve it fails as a provider
  // error, which is the most expensive possible way to report a typo.
  const routed = backendForModel(model);
  if (routed !== backendId) {
    throw new Error(`model "${model}" belongs to the ${routed} engine, not ${backendId}`);
  }
  // `--auto` sits right after `--pure`, where opencode expects it. Splicing it
  // in afterwards would produce a command that parses and then misbehaves,
  // which is worse than one that fails loudly.
  const args = [backend.bin, "run", "--pure", ...backend.extra, "--format", "json", "-m", model, "--title", title];
  // RAW, not JSON.stringify(prompt).
  //
  // This argument used to be JSON-quoted because the runner joined everything
  // into `sh -lc`. JSON escaping and shell escaping are not the same thing:
  // JSON escapes the double quote and leaves `$` and the backtick completely
  // intact. The prompt therefore reached a shell as shell SOURCE, and the
  // prompt on a review retry is the REVIEWER'S OWN MODEL-AUTHORED REJECTION
  // TEXT. A model writing a reason containing a backtick got command execution
  // inside the container, with no operator-controlled configuration involved.
  //
  // There is no shell now, so the raw string is passed as one argv element and
  // cannot be reinterpreted. Proven in tests/shellinject.test.ts.
  return [...args, prompt];
}
