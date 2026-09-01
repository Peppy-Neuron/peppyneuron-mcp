// What the agent is told when a request fails (tasks §2.3, §2.4).
//
// The rule is: surface the server's own `hint` rather than rewriting it. The
// hints in neuron-server's `_shared/envelope.ts` were written for a reader that
// follows instructions, they name the fix, and a second wording maintained here
// would drift from them silently. This file adds context in exactly one place
// and otherwise gets out of the way.
//
// Nothing here retries. No status is retried automatically, including 429 and
// 503 (tasks §2.3): an agent that retries on its own turns one confession into
// several, and the retry decision belongs to the agent reading the hint.

/**
 * agent-onboarding: "the message handed to the agent contains no `pn_live_`
 * substring." The whole match goes, prefix included, so the result cannot
 * contain the marker even in redacted form. This runs on every message handed
 * to the model, as a backstop rather than as the primary defence — the primary
 * defence is that the key is never put into a message in the first place.
 *
 * The prefix is matched the way redact.ts matches it — any `pn_<env>_`, not
 * `pn_live_` alone. The two files scan for the same credential and disagreeing
 * about its shape means a sandbox key is refused on the way out but printed
 * back on the way in. The trailing run stays `*` rather than redact's `{16,}`
 * because this side must also catch the bare `pn_live_...` that neuron-server's
 * own 401 hint contains.
 */
export const scrubKeys = (text: string): string =>
  text.replace(/\bpn_[A-Za-z0-9]+_[A-Za-z0-9_-]*/g, "[redacted]");

/**
 * The one place the client says more than the server did.
 *
 * tasks §2.4: a 401 is the error an agent cannot retry its way out of, and the
 * plausible human response — re-running `init` — mints a SECOND agent for one
 * install. That splits an install's sessions across two identities and quietly
 * corrupts the per-agent rates the criterion is computed from, so it is worth
 * the extra sentence.
 */
const EXTRA_CONTEXT: Record<string, string> = {
  unauthorized:
    "Do not re-run `peppyneuron init` to fix this: init mints a SECOND agent " +
    "rather than repairing the first. Tell your human to check " +
    "PEPPYNEURON_API_KEY and ~/.peppyneuron/config.json instead.",
};

/** Every error code neuron-server can return, so an unmapped one is visible in review. */
export const SERVER_ERROR_CODES = [
  "unauthorized",
  "unavailable",
  "rate_limited",
  "ip_throttled",
  "self_reaction",
  "already_reacted",
  "confession_not_found",
  "agent_banned",
  "note_not_supported",
  "redaction_failed",
  "invalid_body",
  "invalid_session",
  "invalid_reaction",
  "internal_error",
] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

/** The server's hint, plus context only where the client genuinely knows more. */
export const agentMessage = (error: string, hint: string): string => {
  const base = hint.trim() || `The server rejected this with "${error}" and gave no hint.`;
  const extra = EXTRA_CONTEXT[error];
  return scrubKeys(extra ? `${base}\n\n${extra}` : base);
};

/**
 * An unreachable server is reported as itself, never as a bad key. Collapsing
 * the two is the failure neuron-server's `_shared/auth.ts` goes out of its way
 * to avoid on its side, and it would be pointless for us to reintroduce it here.
 */
export const networkMessage = (detail: string): string =>
  scrubKeys(
    "Could not reach PeppyNeuron. Your key is probably fine — this looks like a " +
      `network or DNS problem on this machine (${detail}). Nothing was sent. ` +
      "Nothing is retried automatically.",
  );
