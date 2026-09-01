import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfigPath, loadConfig, resolveRoot } from "./config.js";

describe("configuration", () => {
  it("uses XDG paths and the documented root precedence", () => {
    expect(defaultConfigPath({ XDG_CONFIG_HOME: "/config" })).toBe(
      path.join("/config", "markhq", "config.json")
    );
    expect(resolveRoot("/cli", { root: "/config-root" }, { MARKHQ_ROOT: "/env" })).toBe("/cli");
    expect(resolveRoot(undefined, { root: "/config-root" }, { MARKHQ_ROOT: "/env" })).toBe("/env");
  });

  it("warns for unknown keys while accepting the configuration", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "markhq-config-"));
    const file = path.join(directory, "config.json");
    await writeFile(
      file,
      JSON.stringify({
        root: "/tmp/data",
        future: true,
        defuddle: { useAsync: false, futureOption: true }
      })
    );
    const result = await loadConfig(file);
    expect(result.config.root).toBe("/tmp/data");
    expect(result.warnings).toHaveLength(2);
  });

  it("rejects known keys with invalid types", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "markhq-config-"));
    const file = path.join(directory, "config.json");
    await writeFile(file, JSON.stringify({ timeoutMs: "slow" }));
    await expect(loadConfig(file)).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });
});
