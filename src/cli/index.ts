/**
 * autopost — CLI entrypoint.
 *
 * IMPORTANT: `./lib/loadenv` MUST be imported first (before any `@/lib/*`
 * module) so the project's .env is loaded into process.env before backend
 * modules that read env vars are evaluated.
 */

import "./lib/loadenv";

import { Command } from "commander";
import { setJsonMode } from "./lib/output";
import { cleanup } from "./lib/runtime";
import { registerStatus } from "./commands/status";
import { registerAccounts } from "./commands/accounts";
import { registerPost } from "./commands/post";
import { registerPosts } from "./commands/posts";
import { registerWorker } from "./commands/worker";

const program = new Command();

program
  .name("autopost")
  .description(
    "CLI for the social-media-autopost scheduler (accounts, posts, publishing, worker)."
  )
  .version("0.1.0")
  // Root-level --json so `autopost --json <cmd>` also works; each leaf command
  // additionally declares --json for `autopost <cmd> --json`.
  .option("--json", "Output machine-readable JSON and suppress decorative output");

// Register commands.
registerStatus(program);
registerAccounts(program);
registerPost(program);
registerPosts(program);
registerWorker(program);

// Resolve the effective --json flag (leaf or root) before each action runs.
program.hook("preAction", (_thisCommand, actionCommand) => {
  setJsonMode(actionCommand.optsWithGlobals().json === true);
});

/** Tear down backend resources, bounded by a timeout, then exit. */
async function finish(code: number): Promise<never> {
  await Promise.race([
    cleanup(),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);
  process.exit(code);
}

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

function currentExitCode(): number {
  const code = Number(process.exitCode ?? 0);
  return Number.isNaN(code) ? 1 : code;
}

main()
  .then(() => finish(currentExitCode()))
  .catch(async (err) => {
    // Unexpected error outside the per-command wrap (e.g. commander internals).
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`✖ ${message}\n`);
    const code = currentExitCode();
    await finish(code !== 0 ? code : 1);
  });
