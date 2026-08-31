// What we write to ~/.peppyneuron, and who can read it.
//
// Both files here hold something the owner would not want world-readable: the
// API key in config.json, and in sent.log the confession bodies themselves. Both
// used to be written with the `mode` option of writeFileSync/appendFileSync,
// which node honours only when the call CREATES the file — so a config or a log
// that already existed at 0644 stayed at 0644 while fresh secrets were written
// into it. The tests that matter are therefore the second-write ones.

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { configPath, logPath, readConfig, writeConfig } from "../src/config.js";
import { appendLog, nowIso } from "../src/log.js";
import { FAKE_KEY, withHome } from "./helpers.js";

const modeOf = (path: string): string => (statSync(path).mode & 0o777).toString(8);

const entry = (body: string) => ({
  at: nowIso(),
  session_id: "11111111-1111-4111-8111-111111111111",
  tool: "submit_confession",
  outcome: "sent" as const,
  body,
});

test("a fresh config.json is created 0600", async () => {
  await withHome(async () => {
    writeConfig({ api_key: FAKE_KEY });
    assert.equal(modeOf(configPath()), "600");
  });
});

test("writing over an existing 0644 config.json restricts it", async () => {
  await withHome(async (home) => {
    // What `init --force` hits on a machine where the file was hand-written, or
    // chmodded, or created by some other tool.
    mkdirSync(home, { recursive: true });
    writeFileSync(configPath(), '{"api_key":"old"}\n');
    chmodSync(configPath(), 0o644);
    assert.equal(modeOf(configPath()), "644", "precondition: the file starts world-readable");

    writeConfig({ api_key: FAKE_KEY });

    assert.equal(modeOf(configPath()), "600", "the new key must not be left world-readable");
    assert.equal(readConfig()?.api_key, FAKE_KEY, "and the write must actually have landed");
  });
});

test("the temp file writeConfig renames through is not left behind", async () => {
  await withHome(async () => {
    writeConfig({ api_key: FAKE_KEY });
    assert.throws(() => statSync(`${configPath()}.tmp`), /ENOENT/);
  });
});

test("a stale 0644 temp file cannot widen the config it becomes", async () => {
  await withHome(async (home) => {
    // The cost of opening with 'w' rather than 'wx' is that a crash can leave a
    // temp file behind. This is the case that permits, and the fchmod that runs
    // before the write is what makes it safe.
    mkdirSync(home, { recursive: true });
    writeFileSync(`${configPath()}.tmp`, "leftover\n");
    chmodSync(`${configPath()}.tmp`, 0o644);

    writeConfig({ api_key: FAKE_KEY });

    assert.equal(modeOf(configPath()), "600");
    assert.equal(readConfig()?.api_key, FAKE_KEY);
  });
});

test("a fresh sent.log is created 0600", async () => {
  await withHome(async () => {
    appendLog(entry("I claimed the tests passed"));
    assert.equal(modeOf(logPath()), "600");
  });
});

test("appending to an existing 0644 sent.log restricts it", async () => {
  await withHome(async (home) => {
    mkdirSync(home, { recursive: true });
    writeFileSync(logPath(), "");
    chmodSync(logPath(), 0o644);
    assert.equal(modeOf(logPath()), "644", "precondition: the log starts world-readable");

    appendLog(entry("I did not read the whole file"));

    assert.equal(modeOf(logPath()), "600", "confession bodies must not stay world-readable");
    const [first] = readFileSync(logPath(), "utf8").trim().split("\n");
    assert.ok(first);
    assert.equal(JSON.parse(first).body, "I did not read the whole file");
  });
});

test("appendLog appends rather than truncating", async () => {
  // Opening with 'a' is load-bearing: the receipt is the whole of P5, and a log
  // that kept only the last line would be worse than no log at all.
  await withHome(async () => {
    appendLog(entry("first"));
    appendLog(entry("second"));
    const lines = readFileSync(logPath(), "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(
      lines.map((l) => JSON.parse(l).body),
      ["first", "second"],
    );
  });
});
