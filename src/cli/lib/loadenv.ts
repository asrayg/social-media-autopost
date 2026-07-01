/**
 * Loads the project's `.env` file into `process.env` BEFORE any backend module
 * (which reads env vars) is imported.
 *
 * This module must be the FIRST import in the CLI entrypoint so that its
 * side-effect (populating process.env) runs before `@/lib/db`, `@/lib/env`,
 * etc. are evaluated. ES module evaluation is depth-first in import order, so
 * importing this first guarantees the ordering.
 *
 * We rely on Node's built-in `process.loadEnvFile` (Node >= 20.12). tsx does
 * NOT auto-load `.env`, so without this the CLI would see undefined DATABASE_URL
 * / REDIS_URL / SESSIONS_DIR when run outside `next dev`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

// .../<projectRoot>/src/cli/lib/loadenv.ts  ->  projectRoot is three levels up.
const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..", "..", "..");

try {
  // Load the project's canonical .env. If a variable is already present in the
  // real environment it is NOT overwritten by loadEnvFile.
  process.loadEnvFile(path.join(projectRoot, ".env"));
} catch {
  // No .env file (or already provided via the real environment) — ignore and
  // let the individual env getters throw a clear error if something required is
  // genuinely missing.
}
