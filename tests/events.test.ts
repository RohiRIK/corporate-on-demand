import { describe, expect, test } from "bun:test";
import { parseEventStream, describeRun } from "../src/events";

/**
 * Parsing the opencode event stream.
 *
 * The three fixtures are the REAL lines from the verified call in
 * tests/agent.test.ts, trimmed of their timestamps. Writing them from an
 * observed run rather than from the documentation is the point: the shape
 * here is the shape the runtime actually emits.
 */
const REAL = [
  '{"type":"step_start","sessionID":"ses_f0f9","part":{"type":"step-start"}}',
  '{"type":"text","sessionID":"ses_f0f9","part":{"type":"text","text":"E2E_OK","time":{"start":1,"end":2}}}',
  '{"type":"step_finish","sessionID":"ses_f0f9","part":{"type":"step-finish","reason":"stop","tokens":{"total":7799,"input":5854,"output":5,"reasoning":0,"cache":{"write":0,"read":1940}},"cost":0}}',
].join("\n");

describe("parseEventStream", () => {
  test("reads the answer, the step count and the tokens from a real stream", () => {
    const parsed = parseEventStream(REAL);
    expect(parsed.answer).toBe("E2E_OK");
    expect(parsed.steps.length).toBe(1);
    expect(parsed.tokens?.total).toBe(7799);
    expect(parsed.tokens?.cost).toBe(0);
  });

  test("concatenates several text parts in order", () => {
    const two = [
      '{"type":"text","part":{"type":"text","text":"one "}}',
      '{"type":"text","part":{"type":"text","text":"two"}}',
    ].join("\n");
    expect(parseEventStream(two).answer).toBe("one two");
  });

  test("a truncated final line is skipped, not thrown on", () => {
    // The expected shape of a killed process. Losing the answer to a stray
    // line would be worse than ignoring the line.
    const parsed = parseEventStream(`${REAL}\n{"type":"text","part":{"tex`);
    expect(parsed.answer).toBe("E2E_OK");
    expect(parsed.unparsed.length).toBe(1);
  });

  test("a stream with no completion event reports null tokens, not zeros", () => {
    // Zero tokens and "never finished" are different facts. Collapsing them
    // would let a call that died mid-stream report as a free successful run.
    const parsed = parseEventStream('{"type":"step_start","part":{"type":"step-start"}}');
    expect(parsed.tokens).toBeNull();
  });

  test("empty input is an empty answer, not a crash", () => {
    const parsed = parseEventStream("");
    expect(parsed.answer).toBe("");
    expect(parsed.tokens).toBeNull();
  });

  test("a line that is JSON but not an event is unparsed, not an answer", () => {
    const parsed = parseEventStream('{"hello":"world"}');
    expect(parsed.answer).toBe("");
    expect(parsed.unparsed).toEqual(['{"hello":"world"}']);
  });

  test("counts every step_start, not just the first", () => {
    const many = [
      '{"type":"step_start","part":{"type":"step-start"}}',
      '{"type":"text","part":{"type":"text","text":"a"}}',
      '{"type":"step_start","part":{"type":"step-start"}}',
      '{"type":"text","part":{"type":"text","text":"b"}}',
    ].join("\n");
    const parsed = parseEventStream(many);
    expect(parsed.steps.length).toBe(2);
    expect(parsed.answer).toBe("ab");
  });
});

describe("describeRun", () => {
  test("summarises a completed run in one line", () => {
    expect(describeRun(parseEventStream(REAL))).toContain("7799 tokens");
  });

  test("says so when the run never completed", () => {
    const parsed = parseEventStream('{"type":"step_start","part":{"type":"step-start"}}');
    expect(describeRun(parsed)).toContain("no completion event");
  });
});
