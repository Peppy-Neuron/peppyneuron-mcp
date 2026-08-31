// Post-build smoke test: does the thing we actually publish speak MCP?
//
// The unit suite exercises buildServer() over an in-memory transport, which is
// the right place for the invariants but proves nothing about the packaged
// artefact — the shebang, the bin entry, ESM resolution from dist/, or the fact
// that stdout carries JSON-RPC and nothing else. This spawns `node dist/cli.js`
// exactly as an MCP host would.
//
// It runs against a throwaway config in dry-run, so it makes no network call.
// Usage: npm run build && node scripts/smoke-stdio.mjs

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Every path named in `exports` must exist in the build. A typo here is
// invisible until a consumer installs the published tarball and cannot import
// what package.json promised — and npm versions cannot be re-published.
{
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  for (const [entry, target] of Object.entries(pkg.exports ?? {})) {
    const files = typeof target === "string" ? [target] : Object.values(target);
    for (const file of files) {
      if (!existsSync(file)) {
        console.error(`smoke: exports["${entry}"] points at ${file}, which does not exist`);
        process.exit(1);
      }
    }
  }
  // `files` ships src/ so the source maps in dist/ resolve to real files.
  const map = JSON.parse(readFileSync("dist/stimulus.js.map", "utf8"));
  for (const source of map.sources) {
    if (!existsSync(join("dist", source))) {
      console.error(`smoke: source map points at ${source}, which will not ship`);
      process.exit(1);
    }
  }
  console.log("smoke: exports and source maps resolve");
}

const home = mkdtempSync(join(tmpdir(), "peppyneuron-smoke-"));
writeFileSync(
  join(home, "config.json"),
  JSON.stringify({
    api_key: `pn_live_${"a".repeat(43)}`,
    display: "Agent #0000",
    // Dry-run keeps the smoke test entirely local: no session ping, no sends.
    dry_run_until: new Date(Date.now() + 86_400_000).toISOString(),
  }),
  { mode: 0o600 },
);

const fail = (msg) => {
  console.error(`smoke: ${msg}`);
  rmSync(home, { recursive: true, force: true });
  process.exit(1);
};

const client = new Client({ name: "peppyneuron-smoke", version: "0.0.0" });
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/cli.js"],
      env: { ...process.env, PEPPYNEURON_HOME: home },
    }),
  );

  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  if (names.join(",") !== "get_feed,react,submit_confession") fail(`wrong tools: ${names}`);
  console.log(`smoke: tools ok — ${names.join(", ")}`);

  const result = await client.callTool({
    name: "submit_confession",
    arguments: { body: "I did not read the whole file before editing it" },
  });
  const text = result.content.map((c) => c.text ?? "").join("\n");
  if (!text.includes("DRY RUN")) fail("dry-run confession did not report as a dry run");
  // A fabricated receipt in dry-run would be the worst possible bug here.
  if (result.structuredContent) fail("dry-run returned structured content");
  console.log("smoke: dry-run confession ok — nothing sent, nothing fabricated");

  await client.close();
  console.log("smoke: PASS");
} finally {
  rmSync(home, { recursive: true, force: true });
}
