/**
 * Output helpers shared by every CLI command.
 *
 * Central concern: the global `--json` flag. When JSON mode is on, commands
 * emit exactly ONE well-formed JSON value on stdout and suppress all
 * decorative output (spinners, tables, colour). This lets an AI agent (or any
 * script) parse results deterministically.
 */

import chalk from "chalk";
import Table from "cli-table3";
import prompts from "prompts";
import { Command } from "commander";

// ── JSON mode state ─────────────────────────────────────────────────────────

let jsonMode = false;
let consoleRedirected = false;

/**
 * Route the backend's chatty `console.log/info/warn/debug` (e.g. the `[redis]`
 * and `[queue]` lines) to stderr so that, in JSON mode, stdout carries exactly
 * one JSON value and nothing else. `console.error` already targets stderr.
 * `printJson` writes to stdout directly and is unaffected.
 */
function redirectNoiseToStderr(): void {
  if (consoleRedirected) return;
  consoleRedirected = true;
  const toErr = (...args: unknown[]): void => {
    process.stderr.write(args.map((a) => String(a)).join(" ") + "\n");
  };
  console.log = toErr as typeof console.log;
  console.info = toErr as typeof console.info;
  console.warn = toErr as typeof console.warn;
  console.debug = toErr as typeof console.debug;
}

/** Enable/disable JSON output mode (set from the global `--json` flag). */
export function setJsonMode(value: boolean): void {
  jsonMode = value;
  if (value) redirectNoiseToStderr();
}

/** Whether the current invocation should emit machine-readable JSON. */
export function isJsonMode(): boolean {
  return jsonMode;
}

// ── Printers ────────────────────────────────────────────────────────────────

/** Print a single JSON value followed by a newline. */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/**
 * Emit a command result. In JSON mode the `data` object is printed verbatim;
 * otherwise the provided `human` callback renders friendly output.
 */
export function printResult(data: unknown, human: () => void): void {
  if (jsonMode) {
    printJson(data);
  } else {
    human();
  }
}

/** Print an informational line (suppressed in JSON mode). */
export function info(message: string): void {
  if (!jsonMode) {
    process.stderr.write(message + "\n");
  }
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** Build a cli-table3 table with cyan headers. */
export function makeTable(head: string[]): Table.Table {
  return new Table({ head: head.map((h) => chalk.cyan(h)) });
}

/** Truncate a string to `max` characters, appending an ellipsis if cut. */
export function truncate(value: string, max = 40): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

/** Colour a post/account status string for the terminal. */
export function colourStatus(status: string): string {
  switch (status) {
    case "active":
    case "posted":
      return chalk.green(status);
    case "scheduled":
    case "processing":
      return chalk.blue(status);
    case "draft":
      return chalk.gray(status);
    case "failed":
      return chalk.red(status);
    case "needs_manual_login":
      return chalk.yellow(status);
    default:
      return status;
  }
}

// ── Commander helpers ───────────────────────────────────────────────────────

/**
 * Attach the global `--json` flag to a command. Applied to every leaf command
 * so `autopost <cmd> --json` works regardless of flag position.
 */
export function withJson(cmd: Command): Command {
  return cmd.option(
    "--json",
    "Output machine-readable JSON and suppress decorative output"
  );
}

/**
 * Wrap an async command action with uniform error handling: on throw, print a
 * clean error (or {"error": "..."} in JSON mode) and set a non-zero exit code.
 */
export function wrap<T extends unknown[]>(
  fn: (...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (jsonMode) {
        printJson({ error: message });
      } else {
        process.stderr.write(chalk.red(`✖ ${message}`) + "\n");
      }
      process.exitCode = 1;
    }
  };
}

// ── Interactive confirmation ────────────────────────────────────────────────

/**
 * Ask the user to confirm a destructive/irreversible action. Auto-confirms
 * (returns true) in JSON mode or when stdin is not a TTY so scripted/agent use
 * never hangs.
 */
export async function confirm(message: string): Promise<boolean> {
  if (jsonMode || !process.stdin.isTTY) return true;
  const res = await prompts({
    type: "confirm",
    name: "value",
    message,
    initial: false,
  });
  return res.value === true;
}
