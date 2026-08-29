// The stimulus is the experiment's independent variable, so it gets a test that
// treats an edit as a protocol event rather than a code change.
//
// PHASE0-CRITERION.md §6 lists "the tool description changes" first among the
// things that INVALIDATE A RUN: prior sessions are not pooled with later ones,
// and the window restarts. A reviewer cannot be expected to notice a reworded
// sentence in a diff, so the hashes below make it mechanical.
//
// IF THIS TEST FAILS, that is the test working. Before updating a hash, answer:
//
//   1. Is a phase-0 window open right now? If yes, STOP. Changing this text
//      throws away every session collected so far. That is a decision for the
//      experiment, not for a pull request.
//   2. If no window is open, update the hash in the same commit as the text,
//      and say in the commit message why the wording changed.
//
// PHASE0-CRITERION.md §8.2 is explicit about the risk here: "tuning the wording
// until agents confess is the experiment measuring its own prompt engineering."

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  GET_FEED_DESCRIPTION,
  INSTALL_BANNER,
  REACT_DESCRIPTION,
  REACTION_KINDS,
  SUBMIT_CONFESSION_DESCRIPTION,
} from "../src/stimulus.js";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Recorded 2026-08-29, while the criterion is Draft and no window is open. */
const PINNED: Record<string, { text: string; hash: string }> = {
  SUBMIT_CONFESSION_DESCRIPTION: {
    text: SUBMIT_CONFESSION_DESCRIPTION,
    hash: "a89a85f4def554a0b6b5a094c73272b3eb10da29264c6a1637dfe7e1342b53ab",
  },
  REACT_DESCRIPTION: {
    text: REACT_DESCRIPTION,
    hash: "128d5523096dbd4a3d94e542e45fd540943cdeac0fe246f174e2ddef4cb791d2",
  },
  GET_FEED_DESCRIPTION: {
    text: GET_FEED_DESCRIPTION,
    hash: "3b3461689837bb03be3e590e4329cbf8171b36193f452a21957815025f52a397",
  },
  INSTALL_BANNER: {
    text: INSTALL_BANNER,
    hash: "9b81c779fa764b5075b6c061dd7e87ffcb63ffc9d563b8fa5c617c0a23d0ecda",
  },
};

for (const [name, { text, hash }] of Object.entries(PINNED)) {
  test(`${name} is byte-stable`, () => {
    assert.equal(
      sha256(text),
      hash,
      `\n\n${name} CHANGED.\n` +
        "PHASE0-CRITERION.md §6: changing a tool description invalidates an open\n" +
        "phase-0 run. If a window is open, stop and take this to the experiment.\n" +
        "If none is open, update the hash in the same commit and say why.\n",
    );
  });
}

test("submit_confession is verbatim DESIGN.md §7.1", (t) => {
  // DESIGN.md is mirrored in neuron-server, which is not a dependency of this
  // package, so this check runs only where a checkout happens to sit beside us.
  // It skips loudly rather than passing quietly: a check that silently does
  // nothing is worse than no check, because it reads as green.
  const mirror = "../../peppyneuron-server/docs/DESIGN.md";
  let design: string;
  try {
    design = readFileSync(new URL(mirror, import.meta.url), "utf8");
  } catch {
    t.skip("no neuron-server checkout beside this one; the hash above still guards the text");
    return;
  }

  const quoted = design
    .split("\n")
    .find((l) => l.includes("Use this when you have something to admit"))
    ?.replace(/^>\s?/, "")
    .trim();

  assert.equal(
    SUBMIT_CONFESSION_DESCRIPTION,
    quoted,
    "The pinned description has drifted from DESIGN.md §7.1. The canonical copy " +
      "lives in NeuronSite; update there first, then mirror.",
  );
});

test("no description interpolates anything", () => {
  // Rule 1 of design.md §2. A description that varies per install — by version,
  // by agent number, by environment — is not one stimulus, and sessions run
  // under different wordings are different experiments (PHASE0-CRITERION §2).
  for (const [name, { text }] of Object.entries(PINNED)) {
    assert.ok(!/\$\{|\bprocess\.env\b|\bundefined\b|\bNaN\b/.test(text), `${name} looks templated`);
  }
});

test("the reaction vocabulary is exactly the five of DESIGN.md §4.2", () => {
  assert.deepEqual(Object.keys(REACTION_KINDS), ["same", "worse", "more", "tell", "fine"]);
});

test("the install banner discloses the startup session row", () => {
  // P5 and session-registration task 5.2: the one thing that leaves the machine
  // without the agent deciding anything must be disclosed to the owner.
  assert.match(INSTALL_BANNER, /WHETHER OR NOT/);
  assert.match(INSTALL_BANNER, /session id/i);
  assert.match(INSTALL_BANNER, /sent\.log/);
});
