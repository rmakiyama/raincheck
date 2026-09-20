import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULTS,
  defaultConfigPath,
  defaultCredentialsPath,
  loadConfig,
  loadCredentials,
  OPTIONS,
  OptionError,
  resolveOptions,
  resolveSecret,
} from "../src/config.ts";

describe("default paths", () => {
  it("honour XDG_CONFIG_HOME", () => {
    expect(defaultCredentialsPath({ XDG_CONFIG_HOME: "/x" })).toBe(
      "/x/raincheck/credentials.json",
    );
    expect(defaultConfigPath({ XDG_CONFIG_HOME: "/x" })).toBe(
      "/x/raincheck/config.json",
    );
  });

  it("fall back to ~/.config", () => {
    expect(defaultCredentialsPath({})).toMatch(
      /\/\.config\/raincheck\/credentials\.json$/,
    );
    expect(defaultConfigPath({})).toMatch(
      /\/\.config\/raincheck\/config\.json$/,
    );
  });
});

describe("OPTIONS", () => {
  it("holds integers to their minimum", () => {
    expect(OPTIONS.days.accepts(1)).toBe(true);
    expect(OPTIONS.days.accepts(0)).toBe(false);
    expect(OPTIONS.days.accepts(1.5)).toBe(false);
    expect(OPTIONS.top.accepts(0)).toBe(true);
    expect(OPTIONS.collection.accepts(-1)).toBe(true);
    expect(OPTIONS.collection.accepts(NaN)).toBe(false);
  });
});

describe("resolveOptions", () => {
  it("uses the built-in defaults when nothing else is given", () => {
    expect(resolveOptions({}, {})).toEqual(DEFAULTS);
  });

  it("takes config.json over the built-in defaults", () => {
    expect(resolveOptions({}, { days: 14, top: 5 })).toEqual({
      ...DEFAULTS,
      days: 14,
      top: 5,
    });
  });

  it("takes a flag over config.json", () => {
    const resolved = resolveOptions(
      { days: "3", collection: "-1" },
      { days: 14, top: 5 },
    );
    expect(resolved).toMatchObject({ days: 3, top: 5, collection: -1 });
  });

  it("leaves limit and top unset when neither source has them", () => {
    const resolved = resolveOptions({}, {});
    expect(resolved.limit).toBeUndefined();
    expect(resolved.top).toBeUndefined();
  });

  it("rejects a flag that breaks its rule, naming the flag", () => {
    expect(() => resolveOptions({ days: "0" }, {})).toThrow(OptionError);
    expect(() => resolveOptions({ days: "0" }, {})).toThrow(
      "--days must be an integer >= 1",
    );
    expect(() => resolveOptions({ concurrency: "3abc" }, {})).toThrow(
      "--concurrency must be an integer >= 1",
    );
    expect(() => resolveOptions({ top: "" }, {})).toThrow(
      "--top must be an integer >= 0",
    );
  });
});

describe("loadConfig", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "raincheck-"));
    path = join(dir, "config.json");
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const write = (body: string) => writeFile(path, body);

  it("returns {} when the file does not exist", async () => {
    expect(await loadConfig({ path })).toEqual({});
  });

  it("reads every option", async () => {
    await write(
      '{"days":14,"limit":50,"top":5,"collection":-1,"concurrency":2}',
    );
    expect(await loadConfig({ path })).toEqual({
      days: 14,
      limit: 50,
      top: 5,
      collection: -1,
      concurrency: 2,
    });
  });

  it("leaves absent keys undefined and ignores unknown ones", async () => {
    await write('{"top":5,"jsonl":true,"future":1}');
    expect(await loadConfig({ path })).toEqual({ top: 5 });
  });

  it("rejects values the flag would reject, naming the key", async () => {
    await write('{"days":0}');
    await expect(loadConfig({ path })).rejects.toThrow(
      `${path}: "days" must be an integer >= 1`,
    );
    await write('{"concurrency":0}');
    await expect(loadConfig({ path })).rejects.toThrow(
      '"concurrency" must be an integer >= 1',
    );
    await write('{"collection":1.5}');
    await expect(loadConfig({ path })).rejects.toThrow(
      '"collection" must be an integer',
    );
  });

  it("rejects strings even when numeric", async () => {
    await write('{"days":"7"}');
    await expect(loadConfig({ path })).rejects.toThrow(
      '"days" must be an integer >= 1',
    );
  });

  it("rejects a credential, pointing at credentials.json", async () => {
    await write('{"days":7,"typesafe_api_key":"k"}');
    await expect(loadConfig({ path })).rejects.toThrow(
      `${path}: "typesafe_api_key" is a secret; move it to ${join(dir, "credentials.json")}`,
    );
  });

  it("rejects invalid JSON with the path in the message", async () => {
    await write("{oops");
    await expect(loadConfig({ path })).rejects.toThrow(
      `${path}: not valid JSON`,
    );
  });
});

describe("loadCredentials", () => {
  let dir: string;
  let path: string;
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "raincheck-"));
    path = join(dir, "credentials.json");
    warnings.length = 0;
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const write = async (body: string, mode = 0o600) => {
    await writeFile(path, body);
    await chmod(path, mode);
  };

  it("returns {} when the file does not exist", async () => {
    expect(await loadCredentials({ path, warn })).toEqual({});
    expect(warnings).toEqual([]);
  });

  it("reads both keys", async () => {
    await write('{"typesafe_api_key":"k","raindrop_token":"t"}');
    expect(await loadCredentials({ path, warn })).toEqual({
      typesafeApiKey: "k",
      raindropToken: "t",
    });
    expect(warnings).toEqual([]);
  });

  it("leaves absent keys undefined and ignores unknown ones", async () => {
    await write('{"raindrop_token":"t","future":1}');
    expect(await loadCredentials({ path, warn })).toEqual({
      raindropToken: "t",
    });
  });

  it("warns when the file is readable by others", async () => {
    await write('{"raindrop_token":"t"}', 0o644);
    await loadCredentials({ path, warn });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("chmod 600");
    expect(warnings[0]).toContain(path);
  });

  it("rejects invalid JSON with the path in the message", async () => {
    await write("{oops");
    await expect(loadCredentials({ path, warn })).rejects.toThrow(
      `${path}: not valid JSON`,
    );
  });

  it("rejects non-object documents", async () => {
    await write('["k"]');
    await expect(loadCredentials({ path, warn })).rejects.toThrow(
      "expected a JSON object",
    );
  });

  it("rejects empty or non-string values", async () => {
    await write('{"typesafe_api_key":""}');
    await expect(loadCredentials({ path, warn })).rejects.toThrow(
      '"typesafe_api_key" must be a non-empty string',
    );
    await write('{"raindrop_token":42}');
    await expect(loadCredentials({ path, warn })).rejects.toThrow(
      '"raindrop_token" must be a non-empty string',
    );
  });
});

describe("resolveSecret", () => {
  it("prefers the environment", () => {
    expect(resolveSecret("K", "file", { K: "env" })).toBe("env");
  });

  it("falls back to the file when env is unset or empty", () => {
    expect(resolveSecret("K", "file", {})).toBe("file");
    expect(resolveSecret("K", "file", { K: "" })).toBe("file");
  });

  it("returns undefined when neither is set", () => {
    expect(resolveSecret("K", undefined, {})).toBeUndefined();
  });
});
