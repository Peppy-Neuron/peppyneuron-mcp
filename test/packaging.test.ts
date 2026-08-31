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
  version: string;
  repository: { url: string; source: string };
  packages: Array<{ registryType: string; identifier: string; version: string }>;
}

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
