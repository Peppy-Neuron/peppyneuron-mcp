// `init`'s refusal path, driven through the real entry point.
//
// Spawned rather than imported, because init's whole contract is a side effect:
// it writes a file, prints to a specific stream, and exits with a code. Calling
// the function would test none of that, and process.exit makes it awkward to
// call twice in one process anyway.
//
// Every case here must REFUSE before reaching the network, so PEPPYNEURON_API_URL
// points at an address that cannot resolve: if a test ever gets as far as
// registering, it fails loudly instead of quietly talking to something.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { configPath } from "../src/config.js";
import { FAKE_KEY, withHome } from "./helpers.js";

const UNREACHABLE = "https://peppyneuron-must-not-be-reached.invalid";

const runInit = (home: string, env: Record<string, string> = {}, args: string[] = []) =>
  spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "init", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PEPPYNEURON_HOME: home,
      PEPPYNEURON_API_URL: UNREACHABLE,
      ...env,
    },
  });

test("init refuses when a key is already in the config file", async () => {
  await withHome(async (home) => {
    writeFileSync(configPath(), JSON.stringify({ api_key: FAKE_KEY, display: "Agent #1188" }));

    const r = runInit(home);

    assert.equal(r.status, 1);
    assert.match(r.stderr, /already has an agent/);
    assert.match(r.stderr, /SECOND/);
    assert.match(r.stderr, /Agent #1188/);
    assert.doesNotMatch(r.stdout, /Registering against/, "it must refuse before the network");
  });
});

test("init refuses when the key is in the environment and no config file exists", async () => {
  // The gap this closes: guarding on the config file alone let this case walk
  // past the warning and mint a second agent for one install, which splits the
  // machine's sessions across two identities and corrupts the per-agent rates.
  await withHome(async (home) => {
    const r = runInit(home, { PEPPYNEURON_API_KEY: FAKE_KEY });

    assert.equal(r.status, 1);
    assert.match(r.stderr, /already has an agent/);
    assert.match(r.stderr, /PEPPYNEURON_API_KEY in this environment/);
    assert.doesNotMatch(r.stdout, /Registering against/, "it must refuse before the network");
    assert.equal(existsSync(configPath()), false, "and must not write a config file");
  });
});

test("the refusal never prints the key it found", async () => {
  await withHome(async (home) => {
    const r = runInit(home, { PEPPYNEURON_API_KEY: FAKE_KEY });
    assert.equal(`${r.stdout}${r.stderr}`.includes("pn_live_"), false);
  });
});

test("--force gets past the guard, and the banner still comes before the network", async () => {
  await withHome(async (home) => {
    const r = runInit(home, { PEPPYNEURON_API_KEY: FAKE_KEY }, ["--force"]);

    // Registration fails — the URL is unresolvable — but only AFTER the banner,
    // which is the ordering agent-onboarding requires: consent that arrives
    // after the request is not consent.
    assert.equal(r.status, 1);
    assert.match(r.stdout, /What leaves your machine|Registering against/);
    assert.match(r.stderr, /Registration failed. No config file was written/);
    assert.equal(existsSync(configPath()), false);
  });
});
