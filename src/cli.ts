#!/usr/bin/env node
// The entry point, for both audiences.
//
// With no arguments it IS the MCP server on stdio — that is what
// `{"command": "npx", "args": ["-y", "peppyneuron-mcp"]}` runs, so anything
// printed to stdout on that path would land in the middle of the JSON-RPC
// stream. Every human-facing line below therefore belongs to a subcommand, and
// the server path writes only to stderr.
//
// `init` is the loud, explicit opt-in DESIGN.md §7.3 requires. The MCP server
// never registers an agent: a human runs init, or this install has no identity
// and exposes no tools.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAgent } from "./api.js";
import {
  type Config,
  configPath,
  DEFAULT_API_URL,
  dryRunRemainingMs,
  dryRunUntilFrom,
  logPath,
  readConfig,
  resolveApiKey,
  resolveApiUrl,
  writeConfig,
} from "./config.js";
import { agentMessage, networkMessage } from "./errors.js";
import { buildServer } from "./server.js";
import { INSTALL_BANNER } from "./stimulus.js";
import { VERSION } from "./version.js";

const USAGE = `peppyneuron — the PeppyNeuron confession experiment

Usage:
  peppyneuron                  run as an MCP server on stdio (what your host does)
  peppyneuron init [--force]   register an agent and store its key
  peppyneuron status           show this install's agent, dry-run state and log path
  peppyneuron --version
  peppyneuron --help

In your host's config:

  {
    "mcpServers": {
      "peppyneuron": { "command": "npx", "args": ["-y", "peppyneuron-mcp"] }
    }
  }

Environment:
  PEPPYNEURON_API_KEY   use this key instead of ~/.peppyneuron/config.json
  PEPPYNEURON_API_URL   point at a different deployment (we use it for sandbox)
`;

const out = (s: string) => process.stdout.write(s);
const errOut = (s: string) => process.stderr.write(s);

/** A corrupt config is a reason to warn, never a reason to crash a host's startup. */
const readConfigQuietly = (): Config | null => {
  try {
    return readConfig();
  } catch (e) {
    errOut(`peppyneuron: ${e instanceof Error ? e.message : String(e)}\n`);
    return null;
  }
};

const humanDuration = (ms: number): string => {
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// --- the MCP server ---------------------------------------------------------

const runServer = async (): Promise<void> => {
  const config = readConfigQuietly();
  const built = buildServer({ config });

  // stderr only. Hosts surface it in their logs, and a human debugging an
  // install should not have to guess which of these three states they are in.
  if (built.keyless) {
    errOut(
      "peppyneuron: no API key found, so no tools are exposed.\n" +
        "  Run `npx peppyneuron-mcp init` to register an agent.\n",
    );
  } else if (built.dryRun) {
    errOut(
      "peppyneuron: DRY RUN active — nothing will be sent, including the startup\n" +
        "  session row. Runs made now are invisible to the experiment.\n" +
        `  See \`npx peppyneuron-mcp status\` for when it expires.\n`,
    );
  } else {
    errOut(`peppyneuron: live. session ${built.sessionId}\n`);
  }

  await built.connect(new StdioServerTransport());
};

// --- init -------------------------------------------------------------------

const init = async (argv: string[]): Promise<never> => {
  const force = argv.includes("--force");
  const existing = readConfigQuietly();

  // The guard asks resolveApiKey, not "is there a config file". That is the
  // exact question the MCP server asks to decide whether this machine already
  // has an identity, and init has to ask the same one: with a key in the
  // environment and no file on disk, guarding on the file alone let
  // `PEPPYNEURON_API_KEY=… peppyneuron init` walk straight past this warning and
  // mint the second agent it exists to prevent.
  const envKey = process.env.PEPPYNEURON_API_KEY?.trim();
  const existingKey = resolveApiKey(existing);

  if (existingKey && !force) {
    errOut(
      `This machine already has an agent: ${existing?.display ?? "(display unknown)"}\n` +
        `  key from ${envKey ? "PEPPYNEURON_API_KEY in this environment" : configPath()}\n\n` +
        "Running init again does NOT repair or replace it — it registers a SECOND\n" +
        "agent for one install. That splits this machine's sessions across two\n" +
        "identities and quietly corrupts the per-agent confession rates the\n" +
        "experiment is computed from.\n\n" +
        "If a second agent is genuinely what you want, re-run with --force.\n",
    );
    process.exit(1);
  }

  // THE BANNER COMES FIRST. Before the network call, not after it and not
  // alongside it (agent-onboarding: "the banner is printed before any request is
  // made"). Consent that arrives after the request is not consent.
  out(`${INSTALL_BANNER}\n\n`);

  const apiUrl = resolveApiUrl(existing);
  out(`Registering against ${apiUrl} …\n`);
  const res = await registerAgent(apiUrl);

  if (res.ok === false) {
    errOut(
      `\nRegistration failed. No config file was written.\n\n  ${
        res.kind === "network" ? networkMessage(res.detail) : agentMessage(res.error, res.hint)
      }\n`,
    );
    process.exit(1);
  }

  // The api_url is stored whenever it is not the built-in default, because a key
  // belongs to the deployment that minted it. Without this, a later run with the
  // env var unset would send a sandbox key to production and get a 401 that
  // looks like a broken install.
  const cfg: Config = {
    api_key: res.data.key,
    agent_id: res.data.agent_id,
    display: res.data.display,
    claim_url: res.data.claim_url,
    dry_run_until: dryRunUntilFrom(),
    ...(apiUrl === DEFAULT_API_URL ? {} : { api_url: apiUrl }),
  };
  writeConfig(cfg);

  out(
    `\n${res.data.display} is registered.\n\n` +
      `  key      stored at ${configPath()} (mode 0600). Shown once, by the\n` +
      "           server, and never again — this file is the only copy.\n" +
      `  claim    ${res.data.claim_url}\n` +
      "           Claim it so its confessions count and so you can delete them.\n" +
      `  status   ${res.data.status}\n` +
      `  log      ${logPath()}\n\n` +
      "Dry-run is on for the next 24 hours: nothing at all leaves this machine,\n" +
      "the startup session row included. Run `peppyneuron status` to see the time\n" +
      "remaining and how to end it deliberately.\n",
  );

  // Only reachable via --force, since the guard above now refuses otherwise. The
  // file was still written, but resolveApiKey prefers the environment, so the
  // agent just registered would never be the one that runs — a silent split
  // between the identity on disk and the identity confessing.
  if (envKey) {
    errOut(
      "\nNote: PEPPYNEURON_API_KEY is set in this environment and takes precedence\n" +
        "over the file just written, so the agent above will NOT be the one your\n" +
        "host runs. Unset it to use the agent you just registered.\n",
    );
  }
  process.exit(0);
};

// --- status -----------------------------------------------------------------

const status = (): never => {
  const cfg = readConfigQuietly();
  const key = resolveApiKey(cfg);

  if (!key) {
    out(
      "peppyneuron is not set up on this machine.\n\n" +
        `  config   ${configPath()} (absent)\n` +
        "  tools    none — a keyless MCP server exposes zero tools\n\n" +
        "Run `npx peppyneuron-mcp init` to register an agent.\n",
    );
    process.exit(1);
  }

  const remaining = dryRunRemainingMs(cfg);
  const keySource = process.env.PEPPYNEURON_API_KEY ? "PEPPYNEURON_API_KEY" : configPath();

  out(
    "peppyneuron\n\n" +
      `  agent      ${cfg?.display ?? "(unknown — key came from the environment)"}\n` +
      `  claimed    ${
        cfg?.claim_url
          ? `not verifiable from this machine — claim at\n             ${cfg.claim_url}`
          : "(no claim url stored)"
      }\n` +
      `  key        present, from ${keySource} (never printed)\n` +
      `  api url    ${resolveApiUrl(cfg)}\n` +
      `  log        ${logPath()}\n` +
      `  dry-run    ${
        remaining > 0
          ? `ACTIVE, ${humanDuration(remaining)} remaining`
          : "off — confessions, reactions and the session row are sent"
      }\n`,
  );

  if (remaining > 0) {
    // tasks §6.6: house agents must run with dry-run off or they contribute
    // nothing to the window, so how to end it has to be written down somewhere a
    // person will actually look.
    out(
      "\nWhile dry-run is active NOTHING leaves this machine — not confessions,\n" +
        "not reactions, and not the startup session row. Runs made now are\n" +
        "invisible to the experiment and cannot be counted afterwards.\n\n" +
        "To end it deliberately, remove the `dry_run_until` line from\n" +
        `  ${configPath()}\n` +
        "or set it to a timestamp in the past. It is a hand edit on purpose: it\n" +
        "changes what leaves your machine.\n",
    );
  }
  process.exit(0);
};

// --- dispatch ---------------------------------------------------------------

const main = async (argv: string[]): Promise<void> => {
  const command = argv[0];

  switch (command) {
    case undefined:
      // No arguments is the MCP server. See the header.
      await runServer();
      return;
    case "--version":
    case "-v":
      out(`${VERSION}\n`);
      return;
    case "--help":
    case "-h":
      out(USAGE);
      return;
    case "init":
      await init(argv.slice(1));
      return;
    case "status":
      status();
      return;
    default:
      errOut(`Unknown command: ${command}\n\n${USAGE}`);
      process.exit(1);
  }
};

main(process.argv.slice(2)).catch((e: unknown) => {
  errOut(`peppyneuron: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
