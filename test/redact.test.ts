// The redaction corpus (tasks §7.1).
//
// The pattern sets in src/redact.ts are copied verbatim from
// neuron-server/supabase/functions/_shared/scan.ts. Duplicated code stays
// correct only if something notices when one copy moves, and that something is
// this file: every pattern in both sets has a case here, and the two fixtures
// the server's own suite uses appear verbatim so the overlap is explicit rather
// than assumed.
//
// NOTE (tasks §11.3): the corpus is currently one-directional. neuron-server's
// suite has exactly two redaction fixtures, not a shared corpus, so this file
// catches drift on OUR side only. Porting it to the server is a downstream
// obligation, recorded in tasks.md.

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_BODY, redact, reducePaths } from "../src/redact.js";

interface Case {
  label: string;
  body: string;
  reason: "secret" | "pii";
  patternLabel: string;
}

const BLOCKED: Case[] = [
  // --- secrets, one per SECRET_PATTERNS entry ---
  {
    label: "an sk- key (verbatim from neuron-server's suite)",
    body: "I pasted sk-ABCDEFGHIJKLMNOPQRSTUVWX into a commit",
    reason: "secret",
    patternLabel: "an API key",
  },
  {
    label: "a GitHub token",
    body: `I committed ghp_${"A".repeat(20)} to the repo`,
    reason: "secret",
    patternLabel: "an API key",
  },
  {
    label: "a Slack token",
    body: "I logged xoxb-1234567890-abcdef by mistake",
    reason: "secret",
    patternLabel: "an API key",
  },
  {
    label: "our own key — the client will not transmit it even if asked to",
    body: `I found my own key pn_live_${"a".repeat(43)} and thought it was funny`,
    reason: "secret",
    patternLabel: "an API key",
  },
  {
    label: "an AWS key",
    body: "I hardcoded AKIAIOSFODNN7EXAMPLE in the test",
    reason: "secret",
    patternLabel: "an AWS key",
  },
  {
    label: "a JWT",
    body: "I echoed eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP into the log",
    reason: "secret",
    patternLabel: "a JWT",
  },
  {
    label: "a private key",
    body: "I pasted -----BEGIN RSA PRIVATE KEY----- into a scratch file",
    reason: "secret",
    patternLabel: "a private key",
  },
  {
    label: "a connection string",
    body: "I used postgres://admin:hunter2@db.internal:5432/prod directly",
    reason: "secret",
    patternLabel: "a connection string",
  },
  {
    label: "an env-style assignment",
    body: "I left STRIPE_SECRET_KEY=sk_live_abcdefghij in the shell history",
    reason: "secret",
    patternLabel: "a secret in an env-style assignment",
  },
  // --- pii, one per PII_PATTERNS entry ---
  {
    label: "an email address (verbatim from neuron-server's suite)",
    body: "I emailed nobody@example.com by mistake",
    reason: "pii",
    patternLabel: "an email address",
  },
  {
    label: "a phone number",
    body: "I put 555 123 4567 in the fixture instead of a fake one",
    reason: "pii",
    patternLabel: "a phone number",
  },
];

for (const c of BLOCKED) {
  test(`blocked: ${c.label}`, () => {
    const r = redact(c.body);
    assert.equal(r.ok, false, "should have been blocked");
    if (r.ok) return;
    assert.equal(r.reason, c.reason);
    assert.equal(r.label, c.patternLabel);
  });
}

test("a block never echoes the offending text", () => {
  // The agent would put it straight back into its context, and plausibly into
  // its next confession. This is the whole reason the result carries a class and
  // a label rather than a diff.
  for (const c of BLOCKED) {
    const r = redact(c.body);
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(r).includes(c.body), false, `${c.label} leaked the body`);
  }
});

const CLEAN = [
  "I claimed the tests passed before I ran them",
  "I spent 4,000 tokens avoiding a regex",
  "I retried error 500 three times instead of reading it",
  "I used commit a1b2c3d4e5f6 as the base without verifying it",
  "I skipped the 550e8400-e29b-41d4-a716-446655440000 case because it was slow",
  "I guessed the port was 5432 rather than looking it up",
  "I told my human it would take 10 minutes. It took 90.",
];

for (const body of CLEAN) {
  test(`clean: ${body.slice(0, 40)}…`, () => {
    const r = redact(body);
    assert.equal(r.ok, true, `wrongly blocked: ${JSON.stringify(redact(body))}`);
  });
}

test("FIXED: an ISO date no longer reads as a phone number", () => {
  // Was a pinned known-issue test asserting the opposite. neuron-server's
  // scan.ts now matches a phone SHAPE rather than any 9-15 character digit run,
  // and this file mirrors that pattern verbatim.
  //
  // Kept rather than deleted because the failure it guards is silent: redaction
  // drops the whole confession, and tasks §11.1 records that a locally blocked
  // confession never reaches the server, so a regression here would cost the
  // phase-0 numerator real behavioural events with nothing anywhere reporting
  // the gap.
  const r = redact("I claimed the tests passed on 2026-08-31 without running them");
  assert.equal(r.ok, true, `wrongly blocked: ${JSON.stringify(r)}`);
});

test("the same relaxation does not let a real phone number through", () => {
  const r = redact("I told the customer to call +1 415 555 2671 and never logged it");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.label, "a phone number");
});

test("the other shapes the old pattern ate are sendable too", () => {
  // IPv4, a bare row count and an epoch timestamp in millis. None were recorded
  // in §11.5, which named only the ISO date; all three were dropped.
  for (const body of [
    "I hit 127.0.0.1:8080 instead of staging and reported success",
    "the job processed 123456789 rows before I noticed the filter was off",
    "I stamped everything 1756819200000 and never checked the clock",
  ]) {
    const r = redact(body);
    assert.equal(r.ok, true, `wrongly blocked: ${JSON.stringify(r)}`);
  }
});
// --- path reduction (tasks §3.2) -------------------------------------------

test("absolute paths are reduced to their basename", () => {
  assert.equal(
    reducePaths("I edited /Users/ada/clients/acme-bank/src/auth.ts blind").text,
    "I edited auth.ts blind",
  );
  assert.equal(
    reducePaths("I opened C:\\Users\\ada\\work\\secret-client\\main.ts twice").text,
    "I opened main.ts twice",
  );
  assert.equal(reducePaths("I skipped ~/dev/thing/test/x.test.ts").text, "I skipped x.test.ts");
});

test("urls and relative paths are left alone", () => {
  // Reducing a URL would corrupt an ordinary confession; the directory names in
  // a relative path are not the leak that absolute paths are.
  const url = "I copied the snippet from https://example.com/docs/a/b without reading it";
  assert.equal(reducePaths(url).text, url);
  const rel = "I edited src/a/b.ts without reading all of it";
  assert.equal(reducePaths(rel).text, rel);
});

test("the reduced text is what gets scanned", () => {
  // Scanning the original and sending the reduced form would let the two differ.
  const r = redact("I read /home/ada/notes/todo.txt and lied about it");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.text, "I read todo.txt and lied about it");
    assert.equal(r.pathsReduced, 1);
  }
});

// --- the length cap (tasks §3.2) -------------------------------------------

test(`${MAX_BODY} characters is allowed and ${MAX_BODY + 1} is blocked, never truncated`, () => {
  const atCap = redact("x".repeat(MAX_BODY));
  assert.equal(atCap.ok, true);
  if (atCap.ok) assert.equal(atCap.text.length, MAX_BODY);

  const over = redact("x".repeat(MAX_BODY + 1));
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.reason, "too_long");
});

test("an empty confession is blocked before it reaches the network", () => {
  assert.equal(redact("   ").ok, false);
});
