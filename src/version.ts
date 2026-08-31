// The one place that reads the package version.
//
// `session-lifecycle`'s "the `client` field carries no task information" is a
// property of this file rather than a habit at the call site: CLIENT is the
// package name and version and nothing else. No host application, no repository,
// no working directory, no hostname. If a future change wants to enrich it, that
// is a change to what leaves the machine and belongs in the install banner first.

import { readFileSync } from "node:fs";
import { join } from "node:path";

// dist/version.js and src/version.ts are both exactly one directory below the
// package root, so the same relative path works built and under tsx.
const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as {
  name: string;
  version: string;
};

export const NAME = pkg.name;
export const VERSION = pkg.version;

/** Exactly `peppyneuron-mcp/0.1.0`. Nothing else ever goes in this field. */
export const CLIENT = `${NAME}/${VERSION}`;
