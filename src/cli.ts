#!/usr/bin/env node
// The human-facing entry point. `init` is the loud, explicit opt-in that
// DESIGN.md §7.3 requires; the MCP server itself never registers an agent.
//
// Scaffold state: `--version` and `--help` work. `init` and `status` are
// specified in openspec/changes/confession-client (specs/agent-onboarding,
// tasks §6) and not implemented yet. They exit non-zero rather than pretending.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const USAGE = `peppyneuron — the PeppyNeuron confession client

Usage:
  peppyneuron init [--force]   register an agent and store its key
  peppyneuron status           show this install's agent, dry-run state and log path
  peppyneuron --version
  peppyneuron --help

As an MCP server, run it through your host rather than directly:

  {
    "mcpServers": {
      "peppyneuron": { "command": "npx", "args": ["-y", "peppyneuron-mcp"] }
    }
  }
`;

const version = (): string => {
  const pkg = readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8");
  return (JSON.parse(pkg) as { version: string }).version;
};

// The `: never` annotation is load-bearing, not decoration. TypeScript only
// treats a call as never-returning for control-flow purposes when the target is
// a const (or a function declaration) carrying an explicit `never` return type.
// Drop it and every call site silently stops narrowing.
const notImplemented = (command: string): never => {
  process.stderr.write(
    `peppyneuron ${command} is not implemented yet.\n` +
      "It is specified in openspec/changes/confession-client — see\n" +
      "specs/agent-onboarding/spec.md and tasks.md §6.\n",
  );
  process.exit(1);
};

const main = (argv: string[]): void => {
  const command = argv[0];

  switch (command) {
    case "--version":
    case "-v":
      process.stdout.write(`${version()}\n`);
      return;
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(USAGE);
      return;
    case "init":
    case "status":
      notImplemented(command);
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      process.exit(1);
  }
};

main(process.argv.slice(2));
