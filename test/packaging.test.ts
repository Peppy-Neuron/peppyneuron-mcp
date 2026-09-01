// Publishing metadata that must agree across files.
//
// The MCP Registry hosts metadata only: it fetches the npm tarball and checks
// that `mcpName` in the published package.json matches `name` in server.json,
// and that the versions line up. A mismatch is not caught by anything else in
// this repo — it surfaces as a rejected `mcp-publisher publish` AFTER the npm
// version is already published and therefore already burned.
//
// release-please is configured to bump server.json's two version fields via
// `extra-files`. This test is the backstop for that config being wrong: drift
// fails a pull request instead of a release.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

interface ServerJson {
  name: string;
  description: string;
  version: string;
  repository: { url: string; source: string };
  packages: Array<{ registryType: string; identifier: string; version: string }>;
}

/**
 * server.schema.json's own limits, for the fields we actually set.
 *
 * Copied rather than fetched: the suite never touches the network, and a test
 * that silently skips when offline is worse than no test. The schema URL is in
 * server.json if these ever need re-checking.
 */
const MAX_DESCRIPTION = 100;
const NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;

const read = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;

const pkg = read<{ name: string; version: string; mcpName: string; homepage: string }>(
  "../package.json",
);
const server = read<ServerJson>("../server.json");

test("server.json name matches package.json mcpName", () => {
  // The registry verifies this pair to prove the npm package and the registry
  // entry are the same project.
  assert.equal(server.name, pkg.mcpName);
});

test("server.json points at this npm package", () => {
  const npm = server.packages.find((p) => p.registryType === "npm");
  assert.ok(npm, "server.json must declare an npm package");
  assert.equal(npm.identifier, pkg.name);
});

test("every version in server.json equals the package version", () => {
  assert.equal(server.version, pkg.version, "server.json version drifted");
  for (const p of server.packages) {
    assert.equal(
      p.version,
      pkg.version,
      `server.json packages[].version drifted (${p.identifier})`,
    );
  }
});

test("the description fits what the registry accepts", () => {
  // Learned the expensive way: `mcp-publisher publish` rejected a 181-character
  // description with a 422 AFTER 0.1.1 was already on npm. Every other field the
  // registry validates is checked above; this is the one that got through, and
  // the cost of missing it is the same — a rejected publish against a version
  // number that cannot be reused.
  assert.ok(
    server.description.length <= MAX_DESCRIPTION,
    `server.json description is ${server.description.length} characters; the registry ` +
      `rejects anything over ${MAX_DESCRIPTION}.`,
  );
  assert.ok(server.description.trim().length > 0, "the registry requires a description");
});

test("the server name matches the registry's own pattern", () => {
  // A name the schema refuses is another 422 that only surfaces at publish time.
  assert.match(server.name, NAME_PATTERN);
});

test("the namespace is the reverse-DNS of our own domain", () => {
  // This is what forces DOMAIN-based auth rather than GitHub auth: an
  // `io.github.*` name would be signed with a GitHub OAuth flow, while
  // `com.peppyneuron/*` requires proving control of peppyneuron.com. If this
  // assertion is ever changed, the publishing procedure changes with it.
  const host = new URL(pkg.homepage).hostname.replace(/^www\./, "");
  const reversed = host.split(".").reverse().join(".");
  assert.equal(server.name.split("/")[0], reversed);
  assert.doesNotMatch(server.name, /^io\.github\./);
});
