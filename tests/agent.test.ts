import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

/**
 * The one test that talks to a real model.
 *
 * Everything else in this file is pure and instant. This one costs 4-5 seconds
 * and needs Docker plus the network, so it is the single point where "real agent
 * execution works" is true or false. It was verified by hand before this file
 * existed: exit 0, ~4.4s, credential-free, cost 0.
 *
 * It is kept to exactly ONE live test on purpose. The free provider has already
 * failed twice in one session, including a 180-second hang, so every extra live
 * assertion is extra flakiness in a build people are learning to ignore.
 */
describe("the agent runtime", () => {
  test("a real model call returns text, credential-free, at no cost", () => {
    const out = execFileSync(
      "docker",
      [
        "exec",
        "cod-sandbox-cod",
        "sh",
        "-lc",
        'cd /work && timeout 120 opencode run --pure --format json -m opencode/space-bunny-free "reply with exactly: AGENT_OK" 2>&1',
      ],
      { encoding: "utf8", timeout: 180_000 },
    );
    // The text event carries the model's actual answer.
    expect(out).toContain("AGENT_OK");
    // Free model: the token block must report no cost. If this ever fails, a
    // paid model has entered the system and the security posture changed -
    // that should fail the build loudly, not pass quietly.
    expect(out).toContain('"cost":0');
  }, 180_000);
});
