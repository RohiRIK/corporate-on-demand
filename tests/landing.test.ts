import { describe, expect, test } from "bun:test";
import { buildWorkspaceSpec, assertMountAllowed, containerNameForFile, workVolume } from "../src/docker";
import { Workspace } from "../src/workspace";
import type { Config } from "../src/config";

/**
 * The landing repository is the only new WRITABLE host mount this project can
 * be given, so the thing worth testing is not that it works - it is that it is
 * ABSENT unless asked for.
 *
 * `buildWorkspaceSpec` exists for this. The spec was an inline literal inside
 * `up()`, where no test could see the mount list, and an untestable security
 * boundary is not one.
 */

const config = {
  workspaceFile: "/tmp/ws/acme.json",
  stateDir: "/tmp/ws/state",
  image: "cod-sandbox:test",
} as unknown as Config;

const workspace = {
  version: 1,
  company: { name: "Acme", purpose: "ship" },
  timezone: "UTC",
  departments: [{ name: "engineering", purpose: "build", workers: [{ name: "builder", role: "b", model: "m", skills: [] }] }],
  crons: [],
} as unknown as Workspace;

describe("the default container gets NOTHING extra", () => {
  test("there is no /landing mount at all", () => {
    const spec = buildWorkspaceSpec(config, workspace);
    expect(spec.mounts.some((m) => m.target === "/landing")).toBe(false);
  });

  test("the mount list is exactly the three it has always had", () => {
    // Named, not counted: a fourth unrelated mount would otherwise slip in
    // unnoticed, and a count would not say WHAT changed.
    const spec = buildWorkspaceSpec(config, workspace);
    expect(spec.mounts.map((m) => m.target)).toEqual(["/cod/cod.json", "/cod", "/work"]);
  });

  test("the workspace FILE is still mounted read-only", () => {
    // Deliberate: it is what stops the system rewriting the operator's config.
    const spec = buildWorkspaceSpec(config, workspace);
    expect(spec.mounts.find((m) => m.target === "/cod/cod.json")?.readOnly).toBe(true);
  });

  test("the docker socket is still refused", () => {
    expect(() => assertMountAllowed("/var/run/docker.sock")).toThrow();
  });
});

describe("opting in", () => {
  const withLanding = { ...workspace, landing: { repo: "/srv/shared" } } as unknown as Workspace;

  test("the named repo is mounted read-write at a FIXED target", () => {
    const spec = buildWorkspaceSpec(config, withLanding);
    const mount = spec.mounts.find((m) => m.target === "/landing");
    expect(mount).toBeDefined();
    expect(mount?.readOnly).toBe(false);
    expect(mount?.source).toBe("/srv/shared");
  });

  test("the docker socket cannot be smuggled in as a landing repo", () => {
    // The landing path is a new way in, so it goes through the SAME guard as
    // every other mount rather than around it.
    const evil = { ...workspace, landing: { repo: "/var/run/docker.sock" } } as unknown as Workspace;
    expect(() => buildWorkspaceSpec(config, evil)).toThrow();
  });

  test("nothing else about the container changes", () => {
    const before = buildWorkspaceSpec(config, workspace);
    const after = buildWorkspaceSpec(config, withLanding);
    expect(after.name).toBe(before.name);
    expect(after.image).toBe(before.image);
    expect(after.user).toBe(before.user);
    expect(after.network).toBe(before.network);
  });

  test("the default spec still names the container and volume the same way", () => {
    // The extraction must not have quietly changed the identity rules, which
    // were themselves a bug once already.
    const spec = buildWorkspaceSpec(config, workspace);
    expect(spec.name).toBe(containerNameForFile(config.workspaceFile));
    expect(spec.mounts.find((m) => m.target === "/work")?.source).toBe(workVolume(config));
  });
});
