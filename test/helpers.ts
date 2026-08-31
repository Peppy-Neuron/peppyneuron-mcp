// Shared harness.
//
// Two things every test here needs, and one it must never have.
//
//   - A scratch ~/.peppyneuron. PEPPYNEURON_HOME points config.ts and log.ts at
//     a temp directory, so a test run cannot read or overwrite the developer's
//     real key.
//   - A fetch it can count. Most of the invariants in tasks §7 are NEGATIVE —
//     "zero network calls", "no feed request" — and the only honest way to prove
//     a negative is to own the transport and look at the list afterwards.
//
// What it must never have is a real network. Nothing in this directory reaches
// the internet; task 7.9's end-to-end run against a live stack is a separate,
// deliberately separate, thing.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { FetchLike } from "../src/api.js";
import type { BuiltServer } from "../src/server.js";

/** Runs `fn` with PEPPYNEURON_HOME pointed at a fresh directory, then removes it. */
const MANAGED_ENV = ["PEPPYNEURON_HOME", "PEPPYNEURON_API_KEY", "PEPPYNEURON_API_URL"] as const;

export const withHome = async <T>(fn: (home: string) => Promise<T> | T): Promise<T> => {
  const saved = new Map(MANAGED_ENV.map((k) => [k, process.env[k]]));
  const home = mkdtempSync(join(tmpdir(), "peppyneuron-test-"));

  // The key and url vars are cleared, not just the home directory: a developer
  // who exports PEPPYNEURON_API_KEY in their shell would otherwise have the
  // suite silently testing their real credentials against these fakes.
  for (const k of MANAGED_ENV) delete process.env[k];
  process.env.PEPPYNEURON_HOME = home;

  try {
    return await fn(home);
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  }
};

export interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-correlation-id": "test-correlation" },
  });

/**
 * A fetch that records every call and answers from `responder`.
 *
 * The default responder throws, so a test that expects no traffic fails loudly
 * on the first request rather than quietly passing with a stubbed 200.
 */
export const recorder = (
  responder: (call: RecordedCall) => Response = (c) => {
    throw new Error(`unexpected network call to ${c.url}`);
  },
) => {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
    };
    calls.push(call);
    return responder(call);
  };
  return { calls, fetchImpl };
};

/** Paths only, so assertions read as `/api/sessions` rather than a full URL. */
/**
 * The route below the deployment base, so assertions read as `/api/sessions`
 * rather than `/functions/v1/api/sessions` — the base is a config value, and a
 * test that hard-coded it would fail the day we point somewhere else.
 */
export const routeOf = (url: string): string => {
  const path = new URL(url).pathname;
  const i = path.indexOf("/api/");
  return i === -1 ? path : path.slice(i);
};

export const paths = (calls: RecordedCall[]): string[] => calls.map((c) => routeOf(c.url));

/** Speaks real MCP to the built server over an in-memory pair. */
export const connectClient = async (built: BuiltServer): Promise<Client> => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "peppyneuron-test", version: "0.0.0" });
  await Promise.all([built.connect(serverTransport), client.connect(clientTransport)]);
  return client;
};

/** The text a tool handed back, joined only for assertions — never in src/. */
export const resultText = (result: unknown): string => {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
};

/**
 * The structured payload a tool returned. The SDK types a CallToolResult as an
 * open record, so reading it back in a test needs one widening — kept here so
 * the assertions stay about behaviour rather than about casts.
 */
export const structuredOf = <T>(result: unknown): T =>
  (result as { structuredContent: T }).structuredContent;

export const FAKE_URL = "https://sandbox.invalid/functions/v1";
export const FAKE_KEY = `pn_live_${"a".repeat(43)}`;
