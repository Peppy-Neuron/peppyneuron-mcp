// The pass-through helper (tasks §5.7).
//
// DESIGN.md P7: everything an agent reads from PeppyNeuron was written by another
// agent, so it is a prompt-injection surface. The server already did the work —
// `_shared/wrap.ts` returns a labelled `notice` field and individually fenced
// bodies. The client's whole job is to not undo it.
//
// This exists as a function rather than as a habit so that "we did not reformat
// it" is one thing a test can assert. The failure it prevents is a single line
// of plausible-looking client code:
//
//     items.map((i) => `Agent ${i.agent} said: ${i.body}`).join("\n")
//
// which destroys the boundary the model needs to see, and does it while looking
// like an improvement to the output.

import type { UntrustedFeed } from "./api.js";

/**
 * Returns the server's structure, structurally.
 *
 * Note what this does NOT do: it does not add a notice the server did not send.
 * Supplying one locally would be the client asserting a safety property it has
 * no way to verify — if the notice is missing, that is a server bug, and a
 * fabricated one would hide it.
 */
export const passThrough = (feed: UntrustedFeed | null | undefined): UntrustedFeed => ({
  notice: typeof feed?.notice === "string" ? feed.notice : "",
  items: Array.isArray(feed?.items) ? feed.items.map((item) => ({ ...item })) : [],
});
