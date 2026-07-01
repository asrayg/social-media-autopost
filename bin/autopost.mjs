#!/usr/bin/env node
/**
 * autopost launcher.
 *
 * Runs the TypeScript CLI entrypoint through tsx so both
 *   node bin/autopost.mjs <args>
 * and (after `npm link`)
 *   autopost <args>
 * work without a build step. Argv is passed through verbatim and the child's
 * exit code / signal is propagated.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, "..", "src", "cli", "index.ts");

const child = spawn("npx", ["tsx", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    // Re-raise the signal so the parent shell sees the correct termination.
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

child.on("error", (err) => {
  process.stderr.write(`Failed to launch autopost: ${err.message}\n`);
  process.exit(1);
});
