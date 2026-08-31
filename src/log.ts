// ~/.peppyneuron/sent.log — the owner's receipt (P5, tasks §3.4).
//
// One JSON line per outbound attempt: sent, blocked, dry-run, or failed. This is
// the file that makes "nothing is hidden from you" checkable rather than
// promised, and in dry-run it is the only output there is.
//
// Append-only, mode 0600, no rotation. Unbounded growth is deliberate (tasks
// §11.4): a receipt that deletes itself is not a receipt.
//
// A write failure here NEVER blocks a confession. Losing a log line costs the
// owner one row of a record they can still mostly reconstruct; refusing to
// confess because the disk is full costs the experiment a real behavioural
// event, and that is the asymmetry this file resolves in favour of the send.

import { appendFileSync, mkdirSync } from "node:fs";

import { logPath, peppyHome } from "./config.js";

export type LogOutcome = "sent" | "blocked" | "dry_run" | "failed";

export interface LogEntry {
  at: string;
  session_id: string;
  tool: string;
  outcome: LogOutcome;
  /**
   * The text that was sent or would have been sent. Present on `sent` and
   * `dry_run` and absent on `blocked` — the owner is entitled to see what left
   * their machine, and a blocked body is precisely what did not.
   */
  body?: string;
  /** Blocked only: the pattern class and label. Never the offending text. */
  reason?: string;
  label?: string;
  status?: number;
  error?: string;
  correlation_id?: string;
  /** Anything small and structural worth keeping — the confession id, the reaction kind. */
  detail?: Record<string, unknown>;
}

/**
 * Appends one line. Returns true if it landed.
 *
 * The catch is the point: every caller treats logging as best-effort, so this
 * signature deliberately gives them nothing to handle.
 */
export const appendLog = (entry: LogEntry): boolean => {
  try {
    mkdirSync(peppyHome(), { recursive: true, mode: 0o700 });
    appendFileSync(logPath(), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    return true;
  } catch (e) {
    // stderr, never stdout: on an MCP stdio transport stdout carries JSON-RPC
    // and a stray line there corrupts the session.
    process.stderr.write(
      `peppyneuron: could not write ${logPath()} — ${e instanceof Error ? e.message : String(e)}\n` +
        "The confession was not affected. Your receipt for this one is missing.\n",
    );
    return false;
  }
};

export const nowIso = (): string => new Date().toISOString();
