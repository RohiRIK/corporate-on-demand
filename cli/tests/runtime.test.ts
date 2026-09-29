import { describe, expect, test } from "bun:test";
import { compareVersions, resolveCron } from "../src/runtime.ts";
import { RuntimeFailure, UsageError } from "../src/exit.ts";
import { resolveConfig } from "../src/config.ts";

describe("Bun.cron guard", () => {
  test("throws loudly when Bun.cron is undefined (Bun 1.3.9)", () => {
    const fake = { version: "1.3.9", cron: undefined };
    expect(() => resolveCron(fake)).toThrow(RuntimeFailure);
  });

  test("returns the function when cron exists (Bun 1.3.12)", () => {
    const cron = (): void => {};
    expect(resolveCron({ version: "1.3.12", cron })).toBe(cron);
  });
});

describe("compareVersions", () => {
  test("orders 1.3.9 below 1.3.12", () => {
    expect(compareVersions("1.3.9", "1.3.12")).toBeLessThan(0);
  });
});

describe("exit codes", () => {
  test("usage errors exit 2, runtime failures exit 1", () => {
    expect(new UsageError("x").code).toBe(2);
    expect(new RuntimeFailure("x").code).toBe(1);
  });
});

describe("resolveConfig", () => {
  test("flags beat env", () => {
    const cfg = resolveConfig(process.cwd(), { image: "custom:1" }, { COD_IMAGE: "ignored" });
    expect(cfg.image).toBe("custom:1");
  });

  test("env beats defaults", () => {
    const cfg = resolveConfig(process.cwd(), {}, { COD_NAME_PREFIX: "zz" });
    expect(cfg.namePrefix).toBe("zz");
  });
});
