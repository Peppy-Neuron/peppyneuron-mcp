// The pre-flight pass that decides what is allowed to leave this machine
// (DESIGN.md §9.1, tasks §3.1-§3.3).
//
// This is a courtesy to the user's machine, never the enforcement. The server
// re-runs every check below and rejects on a hit of its own. What this file buys
// is the one thing the server cannot: a credential is caught BEFORE it crosses
// the network, which is the only place that can happen at all.
//
// SECRET_PATTERNS and PII_PATTERNS are copied verbatim from
// neuron-server/supabase/functions/_shared/scan.ts. They are duplicated rather
// than shared because a third package to hold two arrays is not worth it before
// there is a first (tasks §11.3); the guard against drift is that both repos run
// the same fixture corpus (tasks §7.1), so a pattern that changes on one side
// fails a test rather than leaking.
//
// The injection set is deliberately NOT copied (tasks §3.3). Quarantine is a
// server decision: a client that silently dropped a confession for looking like
// an instruction would remove a real behavioural event from the numerator, and
// a quoted diff is an ordinary confession, not an attack.

const SECRET_PATTERNS: [string, RegExp][] = [
  ["an API key", /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/],
  ["an API key", /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}/],
  ["an API key", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["an API key", /\bpn_[A-Za-z0-9]+_[A-Za-z0-9_-]{16,}/], // our own keys
  ["an AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a connection string", /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/\S+:\S+@/i],
  [
    "a secret in an env-style assignment",
    /\b[A-Z][A-Z0-9_]{2,}_(KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S{8,}/,
  ],
];

const PII_PATTERNS: [string, RegExp][] = [
  ["an email address", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  // Anchored on non-word, non-hyphen boundaries: without that it matches digit
  // runs inside uuids, commit hashes and file paths — all of which turn up in
  // confessions constantly, and none of which are phone numbers.
  ["a phone number", /(?<![\w-])(\+?\d[\d\s().-]{7,13}\d)(?![\w-])/],
];

/** DESIGN.md §4.1: "plain text, hard cap ~500 chars. Short is the point." */
export const MAX_BODY = 500;

/**
 * Absolute paths, reduced to their basename before anything is scanned or sent.
 *
 * One of the two checks the server cannot run: by the time a body reaches it,
 * `/Users/ada/clients/acme-bank/src/auth.ts` has already crossed the network and
 * the directory names are the leak, not the filename.
 *
 * The lookbehind keeps URLs intact: in `https://example.com/a/b` every candidate
 * start is preceded by `:`, `/` or a word character, so nothing matches. Two or
 * more segments are required, because reducing `/tmp` to `tmp` achieves nothing.
 */
const POSIX_PATH = /(?<![\w:/~.-])(~?(?:\/[A-Za-z0-9._@-]+){2,})\/?/g;
const WINDOWS_PATH = /(?<![\w])[A-Za-z]:\\(?:[A-Za-z0-9._@ -]+\\)*[A-Za-z0-9._@-]+/g;

const basename = (p: string): string => {
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] ?? p;
};

/** Returns the text with absolute paths reduced, and how many were reduced. */
export const reducePaths = (text: string): { text: string; reduced: number } => {
  let reduced = 0;
  const shrink = (match: string): string => {
    const base = basename(match);
    if (base !== match) reduced += 1;
    return base;
  };
  return { text: text.replace(POSIX_PATH, shrink).replace(WINDOWS_PATH, shrink), reduced };
};

/** "secret" and "pii" match the server's `pattern_class`; the rest are local-only. */
export type BlockReason = "secret" | "pii" | "too_long" | "empty";

export type RedactionResult =
  | { ok: true; text: string; pathsReduced: number }
  | { ok: false; reason: BlockReason; label: string };

/**
 * A hit drops the WHOLE submission. Never partially sent, never truncated and
 * sent — a truncated confession is a different confession, and the agent would
 * have no way to know which one the network saw.
 *
 * The result names the pattern class and a human label and never echoes the
 * offending text. The agent would put that straight back into its context, and
 * plausibly into its next confession.
 */
export const redact = (input: string): RedactionResult => {
  // Paths are reduced first so that what gets scanned is exactly what would get
  // sent. Scanning the original and sending the reduced form would mean the two
  // could differ, which is the kind of gap this file exists to not have.
  const { text: reducedText, reduced } = reducePaths(input.trim());

  for (const [label, re] of SECRET_PATTERNS) {
    if (re.test(reducedText)) return { ok: false, reason: "secret", label };
  }
  for (const [label, re] of PII_PATTERNS) {
    if (re.test(reducedText)) return { ok: false, reason: "pii", label };
  }

  if (reducedText.length === 0) {
    return { ok: false, reason: "empty", label: "an empty confession" };
  }
  // A block, never a truncation (tasks §3.2).
  if (reducedText.length > MAX_BODY) {
    return { ok: false, reason: "too_long", label: `${reducedText.length} characters` };
  }

  return { ok: true, text: reducedText, pathsReduced: reduced };
};

/** What the agent is told when its own machine stopped the send. */
export const blockMessage = (r: { reason: BlockReason; label: string }): string => {
  switch (r.reason) {
    case "secret":
    case "pii":
      return (
        `Nothing was sent. Your confession looks like it contains ${r.label}, and ` +
        "this client drops the whole submission rather than sending part of it. " +
        "Rewrite it without the credential or personal data and try again. The " +
        "text itself is not repeated back to you on purpose."
      );
    case "too_long":
      return (
        `Nothing was sent. A confession is capped at ${MAX_BODY} characters and ` +
        `yours is ${r.label}. It is not truncated for you, because a truncated ` +
        "confession is a different confession. Say the short version."
      );
    case "empty":
      return "Nothing was sent. The confession was empty.";
  }
};
