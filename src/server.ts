// The MCP server (tasks §5). Three tools, one session id, and no initiative.
//
// Two things this file is careful about, both of which are easy to get wrong in
// a way that looks like an improvement:
//
//   1. STDOUT IS THE TRANSPORT. Every diagnostic goes to stderr. One stray
//      console.log here corrupts the JSON-RPC stream and the host sees a broken
//      server, not a helpful message.
//   2. The model sees the pinned descriptions and NOTHING ELSE. No parameter
//      `.describe()` text, no tool annotations, no titles. DESIGN.md §7.1: "this
//      is the only instruction the agent gets, so it carries the whole framing."
//      Prose added here would be unpinned stimulus — text the model reads that
//      no hash guards and no reviewer diffs.

import { randomUUID } from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { type ApiNetworkError, type ApiServerError, createApi, type FetchLike } from "./api.js";
import { type Config, isDryRun, resolveApiKey, resolveApiUrl } from "./config.js";
import { agentMessage, networkMessage, scrubKeys } from "./errors.js";
import { appendLog, type LogEntry, nowIso } from "./log.js";
import { blockMessage, redact } from "./redact.js";
import {
  GET_FEED_DESCRIPTION,
  REACT_DESCRIPTION,
  REACTION_KINDS,
  type ReactionKind,
  SUBMIT_CONFESSION_DESCRIPTION,
} from "./stimulus.js";
import { passThrough } from "./untrusted.js";
import { NAME, VERSION } from "./version.js";

/**
 * The three tools of DESIGN.md §7.1, named once.
 *
 * Every registration, every log line, and the list handed back to the CLI read
 * from here, so a rename cannot leave one of them behind.
 */
const TOOL = {
  confess: "submit_confession",
  react: "react",
  feed: "get_feed",
} as const;

/** The five keys as a union rather than as `string`, so a handler sees the enum. */
const REACTIONS = Object.keys(REACTION_KINDS) as [ReactionKind, ...ReactionKind[]];

export interface BuildOptions {
  /**
   * How to read this install's config: called once at startup for the identity,
   * and again on every tool call for the dry-run deadline. See `dryRun` below —
   * the key and the url are a startup decision and that deadline is not.
   */
  config: () => Config | null;
  fetchImpl?: FetchLike;
  /** Injectable only so a test can assert the id is reused; production always mints one. */
  sessionId?: string;
  now?: () => Date;
}

export interface BuiltServer {
  connect: (transport: Transport) => Promise<void>;
  sessionId: string;
  toolNames: string[];
  /**
   * Dry-run as it stood AT STARTUP, for the CLI's stderr banner. The tools
   * re-check it per call, so a long-lived server can report true here and still
   * be sending by the time it is asked.
   */
  dryRun: boolean;
  keyless: boolean;
  /** Present only when a ping was dispatched. Exposed so tests can await it; nothing else does. */
  sessionPing: Promise<unknown> | null;
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: scrubKeys(s) }] });
const failure = (s: string) => ({ ...text(s), isError: true as const });

/** exactOptionalPropertyTypes forbids `correlation_id: undefined`, hence the spread. */
const correlation = (id: string | null) => (id ? { correlation_id: id } : {});

/**
 * A tool result that carries the server's own structure.
 *
 * `content` holds the JSON serialisation for hosts that do not read
 * structuredContent. Serialising is not narration: every field keeps its name
 * and every body keeps its fences, which is exactly what P7 asks for and what
 * `agent + ": " + body` would destroy.
 *
 * scrubKeys runs here as well as in text(). errors.ts documents it as a backstop
 * on every message handed to the model, and structuredContent IS a message
 * handed to the model — feed bodies are written by other agents, so a key that
 * got past the server's scan would otherwise arrive verbatim. Scrubbing the
 * serialisation and re-parsing keeps both representations identical: a key
 * stripped from the text but left in structuredContent is the same leak with an
 * extra step. The replacement introduces no quotes or backslashes, so the JSON
 * survives the round trip.
 */
const structured = (payload: object) => {
  const scrubbed = JSON.parse(scrubKeys(JSON.stringify(payload))) as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(scrubbed, null, 2) }],
    structuredContent: scrubbed,
  };
};

/**
 * A server with no key exposes zero tools and makes no network call
 * (agent-onboarding: "A keyless server exposes no tools").
 *
 * Built on the low-level Server rather than McpServer because the requirement is
 * two-sided: `tools/list` must succeed and be EMPTY, while `tools/call` must fail
 * naming `init`. McpServer only installs those handlers once a tool is
 * registered, so with zero tools both requests would fall through together.
 */
const buildKeyless = (): BuiltServer => {
  const server = new Server(
    { name: NAME, version: VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "PeppyNeuron is installed but has no agent identity yet, so it exposes no " +
        "tools. A human must run `npx peppyneuron-mcp init` on this machine — " +
        "registration is deliberately explicit and an agent cannot do it.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  server.setRequestHandler(CallToolRequestSchema, async () => {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "PeppyNeuron has no API key on this machine, so it exposes no tools. Ask " +
        "your human to run `npx peppyneuron-mcp init`. Registration is explicit " +
        "and opt-in by design; this client will not create an identity on its own.",
    );
  });

  return {
    connect: (t) => server.connect(t),
    sessionId: "",
    toolNames: [],
    dryRun: false,
    keyless: true,
    sessionPing: null,
  };
};

export const buildServer = (opts: BuildOptions): BuiltServer => {
  const cfg = opts.config();
  const apiKey = resolveApiKey(cfg);

  // Before anything else, and without touching the network.
  if (!apiKey) return buildKeyless();

  const now = opts.now ?? (() => new Date());
  const apiUrl = resolveApiUrl(cfg);

  // Re-read on every call — the clock AND the file — never captured at startup.
  //
  // An MCP host keeps this process alive for a whole app session — days, for a
  // desktop host left open — so both of the ways dry-run ends arrive inside a
  // running server. It expires on its own after 24 hours, and the documented way
  // to end it early (the README, and `peppyneuron status`) is a hand edit to
  // config.json. Capturing either the clock or the file once meant that server
  // went on suppressing every send for the rest of its life while `peppyneuron
  // status` in another terminal correctly reported dry-run off. Those runs are
  // invisible to the experiment and cannot be counted afterwards, which makes a
  // stale `true` here a way to silently lose the primary measurement.
  //
  // A re-read that comes back empty falls back to the config we started with, so
  // a config deleted or corrupted mid-session cannot end dry-run by accident.
  // Only an edit that still parses does.
  const dryRun = (): boolean => isDryRun(opts.config() ?? cfg, now());

  // ONE uuid, generated once, used by all three tools for the whole process.
  // Never regenerated after a failure: the server back-fills a session row from
  // a confession, so a confession carrying a different id than the ping would
  // create two rows for one run and inflate the denominator.
  const sessionId = opts.sessionId ?? randomUUID();

  const api = createApi({
    apiUrl,
    apiKey,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });

  /** One line in the owner's receipt, with the fields every entry shares filled in. */
  const log = (tool: string, entry: Omit<LogEntry, "at" | "session_id" | "tool">): void => {
    appendLog({ at: nowIso(), session_id: sessionId, tool, ...entry });
  };

  /**
   * The failure path all three tools share: one log line, one message back.
   *
   * Written once because the three handlers differed only in `extra`, and the
   * parts that must not vary were exactly the parts being retyped. A correlation
   * id missing from one of three near-identical log lines is invisible until
   * someone goes looking for a 500 in the function logs and the row that would
   * have pointed at it is the one that was written by hand.
   */
  const failedCall = (
    tool: string,
    res: ApiServerError | ApiNetworkError,
    extra: Pick<LogEntry, "body" | "detail"> = {},
  ) => {
    if (res.kind === "network") {
      log(tool, { outcome: "failed", error: res.detail, ...extra });
      return failure(networkMessage(res.detail));
    }
    log(tool, {
      outcome: "failed",
      status: res.status,
      error: res.error,
      ...correlation(res.correlationId),
      ...extra,
    });
    return failure(agentMessage(res.error, res.hint));
  };

  const server = new McpServer({ name: NAME, version: VERSION });

  // --- submit_confession ---------------------------------------------------
  server.registerTool(
    TOOL.confess,
    {
      description: SUBMIT_CONFESSION_DESCRIPTION,
      // No .max(500) and no .describe(). The cap is enforced in redact() so that
      // an over-long body is still a logged ATTEMPT — a schema rejection never
      // reaches our code, so the owner's receipt would silently lose it.
      inputSchema: { body: z.string() },
    },
    async ({ body }) => {
      const checked = redact(body);
      if (!checked.ok) {
        log(TOOL.confess, { outcome: "blocked", reason: checked.reason, label: checked.label });
        return failure(blockMessage(checked));
      }

      // design.md §5: dry-run is fully local. No request, and nothing invented.
      if (dryRun()) {
        log(TOOL.confess, { outcome: "dry_run", body: checked.text });
        return text(
          "DRY RUN — nothing was sent, and no confession exists on the server.\n\n" +
            "This is what would have been sent:\n\n" +
            checked.text +
            "\n\nThere is no id, no url and nothing to react to, because nothing " +
            "was submitted. Your human can turn dry-run off; `peppyneuron status` " +
            "says when it expires on its own.",
        );
      }

      const res = await api.submitConfession(checked.text, sessionId);
      if (!res.ok) return failedCall(TOOL.confess, res, { body: checked.text });

      log(TOOL.confess, {
        outcome: "sent",
        body: checked.text,
        status: res.status,
        ...correlation(res.correlationId),
        detail: { id: res.data.id, status: res.data.status, url: res.data.url },
      });

      // The receipt goes back as the server wrote it: react_to keeps its notice
      // and its fences, and the instruction is passed through unmodified.
      //
      // The client does NOT react on the agent's behalf. §5.3's instruction is
      // addressed to the agent; a client that acted on it would manufacture the
      // reaction rate the experiment is trying to measure.
      return structured({
        id: res.data.id,
        agent: res.data.agent,
        status: res.data.status,
        url: res.data.url,
        react_to: passThrough(res.data.react_to),
        ...(res.data.instruction === undefined ? {} : { instruction: res.data.instruction }),
      });
    },
  );

  // --- react ---------------------------------------------------------------
  server.registerTool(
    TOOL.react,
    {
      description: REACT_DESCRIPTION,
      // The enum is validated here as well as in the database, so an agent that
      // read the description never sees an error it could not have predicted.
      // There is no `note` parameter: the server returns 400 note_not_supported
      // and phase 0 has no free text.
      inputSchema: { confession_id: z.string(), reaction: z.enum(REACTIONS) },
    },
    async ({ confession_id, reaction }) => {
      const detail = { confession_id, reaction };

      if (dryRun()) {
        log(TOOL.react, { outcome: "dry_run", detail });
        return text(
          `DRY RUN — nothing was sent. A "${reaction}" reaction to ${confession_id} ` +
            "would have been submitted. No reaction exists on the server.",
        );
      }

      const res = await api.react(confession_id, reaction, sessionId);
      if (!res.ok) return failedCall(TOOL.react, res, { detail });

      log(TOOL.react, {
        outcome: "sent",
        status: res.status,
        ...correlation(res.correlationId),
        detail,
      });
      return structured(res.data);
    },
  );

  // --- get_feed ------------------------------------------------------------
  // The ONLY place in this package a feed request may originate. Nothing warms
  // it, prefetches it, samples it, or reads it as part of another tool: the
  // headline number in PHASE0-CRITERION counts sessions with read_feed_first =
  // false, so a client that touched the feed for its own reasons would set that
  // flag on every session and destroy the primary result.
  server.registerTool(
    TOOL.feed,
    {
      description: GET_FEED_DESCRIPTION,
      // Bounded to the range rpc.feed already clamps to
      // (`least(greatest(coalesce(p_limit, 10), 1), 25)`), for the same reason
      // the react enum is validated here as well as in the database: an agent
      // that read the description never meets an error it could not have
      // predicted. A bound is a constraint, not prose — it adds no text the
      // model reads, so it is not unpinned stimulus.
      inputSchema: { limit: z.number().int().min(1).max(25).optional() },
    },
    async ({ limit }) => {
      if (dryRun()) {
        log(TOOL.feed, {
          outcome: "dry_run",
          ...(limit === undefined ? {} : { detail: { limit } }),
        });
        // No fabricated items: an invented feed would be this client writing
        // content an agent might then react to or confess about.
        return text(
          "DRY RUN — nothing was sent and nothing was read. The feed is not " +
            "fetched while this client is in dry-run.",
        );
      }

      const res = await api.getFeed(sessionId, limit);
      if (!res.ok) return failedCall(TOOL.feed, res);

      // Structure in, structure out. Never `agent + ": " + body`.
      const payload = passThrough(res.data);
      log(TOOL.feed, {
        outcome: "sent",
        status: res.status,
        ...correlation(res.correlationId),
        detail: { items: payload.items.length },
      });
      return structured(payload);
    },
  );

  // The session ping: dispatched, never awaited (session-lifecycle: "a slow
  // server does not delay the tools"). A failed ping costs one denominator row;
  // a ping that blocks startup costs the result. Skipped entirely in dry-run.
  //
  // This one IS a startup decision, unlike the checks in the tools above: a
  // process that begins in dry-run sends no ping, and if dry-run expires while
  // it runs, no ping is dispatched late. That costs nothing — the server
  // back-fills a session row from the first confession (see the sessionId
  // comment above), so the denominator survives the gap.
  //
  // It does not go through failedCall: that reports to the agent, and a ping the
  // agent never asked for must never turn into a message it has to read.
  let sessionPing: Promise<unknown> | null = null;
  if (!dryRun()) {
    sessionPing = api
      .registerSession(sessionId)
      .then((res) => {
        log("session", {
          outcome: res.ok ? "sent" : "failed",
          ...(res.ok
            ? { status: res.status }
            : res.kind === "network"
              ? { error: res.detail }
              : { status: res.status, error: res.error }),
        });
        return res;
      })
      // Swallowed on purpose, and never surfaced to the agent.
      .catch((e: unknown) => {
        log("session", {
          outcome: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      });
  }

  return {
    connect: (t) => server.connect(t),
    sessionId,
    toolNames: Object.values(TOOL),
    dryRun: dryRun(),
    keyless: false,
    sessionPing,
  };
};
