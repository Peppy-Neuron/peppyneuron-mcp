// Ed25519 keypair for MCP Registry domain authentication.
//
// The registry docs generate this with `openssl genpkey -algorithm Ed25519`,
// which fails on stock macOS: Apple ships LibreSSL, and LibreSSL 3.3 has no
// Ed25519. Node's crypto does, and produces byte-identical material, so this
// avoids making `brew install openssl` a prerequisite for publishing.
//
//   node scripts/registry-key.mjs new ~/.peppyneuron-registry/key.pem
//       generates the pair, writes the private key at mode 0600, and prints
//       ONLY the public half — the line to host at
//       https://peppyneuron.com/.well-known/mcp-registry-auth
//
//   node scripts/registry-key.mjs private ~/.peppyneuron-registry/key.pem
//       prints the raw private key as hex, for `mcp-publisher login http
//       --private-key`. Printing a secret is the whole job, so it is a separate
//       command you have to mean.
//
// The private key is the credential that lets anyone publish under
// com.peppyneuron/*. It must never enter a repository. Keep it in a password
// manager, and in the MCP_REGISTRY_KEY GitHub Actions secret that the `registry`
// job in .github/workflows/publish.yml reads — the hex printed by the `private`
// command below is exactly what that secret holds. GitHub OIDC cannot stand in
// for it: the registry grants an OIDC-authenticated workflow `io.github.<owner>/*`
// only, never a domain namespace.

import { generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

// PKCS#8 for Ed25519 is a 16-byte header then the 32-byte seed; SPKI is a
// 12-byte header then the 32-byte public key. Both end in the raw material,
// which is what the registry's `p=` value and `--private-key` want.
const rawFrom = (der) => der.subarray(-32);

const expand = (p) => resolve(p.startsWith("~") ? p.replace(/^~/, homedir()) : p);

const [, , command, pathArg] = process.argv;
if (!command || !pathArg) {
  console.error("usage: registry-key.mjs <new|private> <path-to-key.pem>");
  process.exit(1);
}
const keyPath = expand(pathArg);

if (command === "new") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });

  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  writeFileSync(keyPath, pem, { mode: 0o600 });
  chmodSync(keyPath, 0o600);

  const pub = rawFrom(publicKey.export({ type: "spki", format: "der" })).toString("base64");

  console.log(`private key written to ${keyPath} (mode 0600) — never commit it\n`);
  console.log("Host this exact line, with no trailing newline issues, at");
  console.log("https://peppyneuron.com/.well-known/mcp-registry-auth :\n");
  console.log(`v=MCPv1; k=ed25519; p=${pub}\n`);
  console.log("The equivalent DNS TXT record, if you ever switch to DNS auth:");
  console.log(`peppyneuron.com. IN TXT "v=MCPv1; k=ed25519; p=${pub}"`);
} else if (command === "private") {
  const priv = createPrivateKey(readFileSync(keyPath, "utf8"));
  // Re-derive the public key so a mismatched or corrupt file fails here rather
  // than as an opaque rejection from the registry.
  createPublicKey(priv);
  console.log(rawFrom(priv.export({ type: "pkcs8", format: "der" })).toString("hex"));
} else {
  console.error(`unknown command: ${command}`);
  process.exit(1);
}
