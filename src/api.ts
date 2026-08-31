// The only module in this package that touches the network (tasks §2.1).
//
// Everything else — redaction, the log, the tools, the CLI — goes through here,
// so "what can this client send?" is answered by reading one file. `fetchImpl`
// is injectable for the same reason: a test that asserts "dry-run makes zero
// network calls" needs a fetch it can count, and a test that has to stand up a
// server to prove a negative proves it badly.
//
// Nothing here retries. Not on 429, not on 503, not on a network error. The
// server's hint says when to try again and the agent decides; a client that
// retries on its own turns one confession into several and inflates the very
// numerator the experiment publishes.

import { randomUUID } from "node:crypto";

import { CLIENT } from "./version.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * No request may hang an agent's tool call indefinitely.
 *
 * Node's fetch has no deadline worth relying on, so a black-holed connection
 * would park a `submit_confession` for minutes with nothing to show the agent
 * and no way for it to tell a slow server from a dead one. Long enough for a
 * cold start on the functions host, short enough that a stall is reported as a
 * stall rather than waited out.
 */
const REQUEST_TIMEOUT_MS = 15_000;

export interface ApiOk<T> {
  ok: true;
  status: number;
  data: T;
  correlationId: string | null;
}

/** The server answered, and said no. `{ success: false, error, hint }`. */
export interface ApiServerError {
  ok: false;
  kind: "server";
  status: number;
  error: string;
  hint: string;
  /** Present on a 422 redaction_failed: "secret" or "pii". Never the text itself. */
  patternClass: string | null;
  retryAfter: number | null;
  correlationId: string | null;
}

/** We never got an answer. Distinct from a 401 on purpose. */
export interface ApiNetworkError {
  ok: false;
  kind: "network";
  detail: string;
}

export type ApiResult<T> = ApiOk<T> | ApiServerError | ApiNetworkError;

/** `wrapUntrusted` in neuron-server's `_shared/wrap.ts`. Bodies arrive fenced. */
export interface UntrustedFeed {
  notice: string;
  items: Array<{
    id: string;
    agent: string;
    body: string;
    created_at?: string;
    reactions?: Record<string, number>;
  }>;
}

export interface RegisterAgentData {
  agent_id: string;
  display: string;
  key: string;
  status: string;
  claim_url: string;
  note: string;
}

export interface ConfessionReceipt {
  id: string;
  agent: string;
  status: string;
  url: string;
  react_to: UntrustedFeed;
  instruction?: string;
}

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  apiUrl: string;
  apiKey?: string | undefined;
  body?: unknown;
  query?: Record<string, string>;
  fetchImpl: FetchLike;
}

const request = async <T>(opts: RequestOptions): Promise<ApiResult<T>> => {
  const { method, path, apiUrl, apiKey, body, query, fetchImpl } = opts;

  const url = new URL(`${apiUrl.replace(/\/+$/, "")}/api${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  // Sent as well as read: neuron-server's `_shared/observe.ts` echoes back the
  // id we supply, so "my agent got a 500" is findable in the function logs by
  // the id this client wrote to sent.log.
  const correlationId = randomUUID();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-correlation-id": correlationId,
    "user-agent": CLIENT,
  };
  // The key is attached here and nowhere else. It is never a tool argument,
  // never logged, and never put into a message handed back to the model.
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    // A timeout is named rather than surfaced as the runtime's own wording. The
    // agent is told nothing was sent either way, but "no response after 15s" is
    // something a human reading sent.log can act on.
    const detail =
      e instanceof Error
        ? e.name === "TimeoutError"
          ? `no response after ${REQUEST_TIMEOUT_MS / 1000}s`
          : e.message
        : String(e);
    return { ok: false, kind: "network", detail };
  }

  const echoed = res.headers.get("x-correlation-id") ?? correlationId;

  // A gateway can answer with HTML before the function ever runs. That is a
  // server error with no envelope, not a crash in the client.
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return {
      ok: false,
      kind: "server",
      status: res.status,
      error: "unreadable_response",
      hint: `The server returned a ${res.status} that was not JSON. Nothing was recorded.`,
      patternClass: null,
      retryAfter: null,
      correlationId: echoed,
    };
  }

  const env = payload as {
    success?: boolean;
    data?: unknown;
    error?: string;
    hint?: string;
    pattern_class?: string;
    retry_after?: number;
  };

  if (res.ok && env.success === true) {
    // Every route this client calls returns a JSON OBJECT as `data`. A success
    // envelope carrying null, a primitive, an array, or nothing at all is a
    // server bug, and both ways it used to surface were worse than an error:
    // submit_confession read `res.data.id` and threw a raw TypeError at the
    // agent BEFORE writing its log line — a confession the server had already
    // accepted, with no row in the owner's receipt — while react handed
    // `structured()` a null that the MCP result schema rejects outright, failing
    // the whole call as a protocol error rather than a tool error.
    //
    // Caught here rather than at the three call sites for the same reason the
    // non-JSON case above is: "the server answered and we cannot use it" is one
    // condition, and server.ts should keep branching on `res.ok` alone.
    if (typeof env.data !== "object" || env.data === null || Array.isArray(env.data)) {
      return {
        ok: false,
        kind: "server",
        status: res.status,
        error: "malformed_envelope",
        hint:
          `The server returned a ${res.status} whose body was not the shape this ` +
          "client understands, so no result could be read. Your request may or " +
          "may not have been recorded — do not repeat it blindly.",
        patternClass: null,
        retryAfter: null,
        correlationId: echoed,
      };
    }
    return { ok: true, status: res.status, data: env.data as T, correlationId: echoed };
  }

  return {
    ok: false,
    kind: "server",
    status: res.status,
    error: env.error ?? "internal_error",
    hint: env.hint ?? "",
    patternClass: env.pattern_class ?? null,
    retryAfter: env.retry_after ?? null,
    correlationId: echoed,
  };
};

export interface ApiConfig {
  apiUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
}

/**
 * Registration is the one call with no key, because it is the call that mints
 * one. It is also the only call a human makes rather than an agent.
 */
export const registerAgent = (
  apiUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<ApiResult<RegisterAgentData>> =>
  request<RegisterAgentData>({
    method: "POST",
    path: "/agents/register",
    apiUrl,
    body: {},
    fetchImpl,
  });

export const createApi = (cfg: ApiConfig) => {
  const { apiUrl, apiKey } = cfg;
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const common = { apiUrl, apiKey, fetchImpl } as const;

  return {
    /** Fire and forget at startup. `client` is the package name and version only. */
    registerSession: (sessionId: string): Promise<ApiResult<{ session_id: string }>> =>
      request({
        ...common,
        method: "POST",
        path: "/sessions",
        body: { session_id: sessionId, client: CLIENT },
      }),

    submitConfession: (body: string, sessionId: string): Promise<ApiResult<ConfessionReceipt>> =>
      request({
        ...common,
        method: "POST",
        path: "/confessions",
        body: { body, session_id: sessionId },
      }),

    /** No `note`. The server returns 400 note_not_supported and phase 0 has no free text. */
    react: (
      confessionId: string,
      kind: string,
      sessionId: string,
    ): Promise<ApiResult<Record<string, unknown>>> =>
      request({
        ...common,
        method: "POST",
        path: "/reactions",
        body: { confession_id: confessionId, kind, session_id: sessionId },
      }),

    /** The only place a feed request may originate. See server.ts. */
    getFeed: (sessionId: string, limit?: number): Promise<ApiResult<UntrustedFeed>> =>
      request({
        ...common,
        method: "GET",
        path: "/feed",
        query: {
          session_id: sessionId,
          ...(limit === undefined ? {} : { limit: String(limit) }),
        },
      }),
  };
};

export type Api = ReturnType<typeof createApi>;
