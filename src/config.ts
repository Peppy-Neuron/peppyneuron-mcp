// Config and identity (tasks §1).
//
// Two rules this file exists to keep:
//
//   1. The key never enters the model's context. It is read here, attached as a
//      header in api.ts, and never returned, logged, or put in an error.
//   2. There is exactly ONE api_url in this package. Sandbox is not a second
//      constant and not a code branch (tasks §1.2) — it is PEPPYNEURON_API_URL
//      in the environment. A description or a behaviour that varies with the
//      environment would mean development runs and window runs are different
//      experiments, which design.md §2 rule 2 forbids.

import {
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The only API URL in this package — production.
 *
 * There is deliberately no second constant for sandbox and no code branch that
 * chooses between them (tasks §1.2). We point at sandbox by setting
 * PEPPYNEURON_API_URL, which keeps the shipped artefact identical for every
 * install: descriptions, behaviour and payloads do not vary by environment, so
 * a development run and a window run remain the same experiment.
 */
export const DEFAULT_API_URL = "https://cjazfwozsyjqlazyjyer.supabase.co/functions/v1";

/** Shape of ~/.peppyneuron/config.json. `api_key` is the only required field. */
export interface Config {
  api_key: string;
  /** Set only when this install deliberately points somewhere other than the default. */
  api_url?: string;
  agent_id?: string;
  display?: string;
  claim_url?: string;
  /** ISO-8601. While this is in the future, nothing leaves the machine at all. */
  dry_run_until?: string;
}

/**
 * PEPPYNEURON_HOME exists so the tests can run against a scratch directory
 * instead of the developer's real install. It is not an install-time knob and is
 * deliberately undocumented in the banner: it moves where the receipt is written,
 * not what gets sent.
 */
export const peppyHome = (): string =>
  process.env.PEPPYNEURON_HOME ?? join(homedir(), ".peppyneuron");

export const configPath = (): string => join(peppyHome(), "config.json");
export const logPath = (): string => join(peppyHome(), "sent.log");

/** Returns null when there is no config file, and throws only if one exists and is corrupt. */
export const readConfig = (): Config | null => {
  let raw: string;
  try {
    raw = readFileSync(configPath(), "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${configPath()} is not valid JSON. Fix it or delete it and re-run \`peppyneuron init\`.`,
    );
  }

  const cfg = parsed as Partial<Config>;
  if (typeof cfg.api_key !== "string" || cfg.api_key.length === 0) {
    throw new Error(`${configPath()} has no api_key. Delete it and re-run \`peppyneuron init\`.`);
  }
  return cfg as Config;
};

/**
 * Writes the config with the key in it, at mode 0600 — including when the file
 * already exists.
 *
 * `writeFileSync`'s `mode` option is honoured only when the call CREATES the
 * file. Writing straight to a config.json that was already there at 0644 — a
 * hand-written one, or `init --force` over a file someone had chmodded — put a
 * fresh key into a world-readable file and left it that way.
 *
 * Chmodding afterwards would close the hole but leave a window open in the
 * middle of it, so the write goes to a temporary file we open ourselves,
 * restrict before a single byte lands, and rename over the target. rename is
 * atomic and carries the temp file's mode, so there is no instant at which the
 * key is on disk readable by anyone else.
 */
export const writeConfig = (cfg: Config): void => {
  mkdirSync(peppyHome(), { recursive: true, mode: 0o700 });

  const target = configPath();
  const tmp = `${target}.tmp`;

  // 'w' rather than 'wx': a crash between open and rename would otherwise leave
  // a stale temp file that blocks every future write. fchmod covers the case
  // that permits — a stale temp left behind with looser permissions — and it
  // runs before the write, so the umask cannot widen the result either.
  const fd = openSync(tmp, "w", 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeFileSync(fd, `${JSON.stringify(cfg, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, target);
};

/**
 * The environment wins over the file, so a host can run an agent without writing
 * anything to disk. Returns null when there is no key anywhere, which is the
 * signal for the MCP server to expose zero tools (agent-onboarding §32).
 */
export const resolveApiKey = (cfg: Config | null): string | null => {
  const fromEnv = process.env.PEPPYNEURON_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return cfg?.api_key ?? null;
};

/** Environment, then this install's config, then the single built-in default. */
export const resolveApiUrl = (cfg: Config | null): string => {
  const fromEnv = process.env.PEPPYNEURON_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (cfg?.api_url) return cfg.api_url.replace(/\/+$/, "");
  return DEFAULT_API_URL;
};

export const DRY_RUN_HOURS = 24;

/**
 * design.md §5: while this is true the client makes NO request of any kind,
 * the session ping included. A dry-run process is not an observation, and a
 * session row written during one would put a run in the denominator that no
 * confession could ever match.
 */
export const isDryRun = (cfg: Config | null, now: Date = new Date()): boolean =>
  dryRunRemainingMs(cfg, now) > 0;

export const dryRunRemainingMs = (cfg: Config | null, now: Date = new Date()): number => {
  const until = cfg?.dry_run_until;
  if (!until) return 0;
  const expiry = Date.parse(until);
  if (Number.isNaN(expiry)) return 0;
  return Math.max(0, expiry - now.getTime());
};

export const dryRunUntilFrom = (now: Date = new Date()): string =>
  new Date(now.getTime() + DRY_RUN_HOURS * 60 * 60 * 1000).toISOString();
