/**
 * `autopost worker` — convenience wrapper that runs the existing BullMQ publish
 * worker (src/workers/publish.worker.ts) via tsx. Streams the worker's output
 * and stays attached until it exits (Ctrl-C to stop).
 */

import path from "node:path";
import { spawn } from "node:child_process";
import chalk from "chalk";
import { Command } from "commander";
import { projectRoot } from "../lib/loadenv";
import { withJson, wrap, isJsonMode, printJson } from "../lib/output";

export function registerWorker(program: Command): void {
  withJson(
    program
      .command("worker")
      .description("Run the BullMQ publish worker (tsx src/workers/publish.worker.ts)")
  ).action(
    wrap(async () => {
      const workerPath = path.join(projectRoot, "src", "workers", "publish.worker.ts");

      if (isJsonMode()) {
        printJson({ starting: true, worker: workerPath });
      } else {
        console.log(chalk.gray(`Starting worker: tsx ${workerPath}`));
      }

      await new Promise<void>((resolve) => {
        const child = spawn("npx", ["tsx", workerPath], {
          stdio: "inherit",
          cwd: projectRoot,
        });

        child.on("error", (err) => {
          process.exitCode = 1;
          if (isJsonMode()) printJson({ error: err.message });
          else console.error(chalk.red(`✖ Failed to start worker: ${err.message}`));
          resolve();
        });

        child.on("exit", (code) => {
          process.exitCode = code ?? 0;
          resolve();
        });
      });
    })
  );
}
