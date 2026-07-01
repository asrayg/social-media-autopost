/**
 * Singleton ioredis connection used across the application.
 *
 * BullMQ requires a raw ioredis instance (or compatible connection options) —
 * it does NOT accept the URL string directly. This module owns the single
 * connection and re-exports it so queue and worker modules share the same
 * underlying socket rather than opening redundant connections.
 *
 * Reconnect strategy: exponential back-off capped at 30 s, unlimited retries.
 */

import IORedis from "ioredis";
import { env } from "@/lib/env";

let connection: IORedis | null = null;

/**
 * Return the process-level Redis singleton, creating it on first call.
 *
 * Safe to call from module-level code because the connection is created lazily;
 * the REDIS_URL env var is only read when this function is first invoked so
 * Next.js edge-runtime module evaluation does not blow up during build.
 */
export function getRedisConnection(): IORedis {
  if (connection) {
    return connection;
  }

  connection = new IORedis(env.REDIS_URL, {
    // BullMQ instructs ioredis NOT to use the blocking BLPOP command, which
    // means the connection can be shared by multiple BullMQ components.
    maxRetriesPerRequest: null,

    // Keep the socket alive so Redis doesn't close idle connections.
    keepAlive: 10_000,

    // Reconnection strategy: exponential back-off capped at 30 s.
    retryStrategy(times: number): number | null {
      const delay = Math.min(1_000 * 2 ** times, 30_000);
      console.warn(
        `[redis] Connection attempt ${times} failed. Retrying in ${delay}ms…`
      );
      return delay;
    },
  });

  connection.on("connect", () => {
    console.info("[redis] Connected.");
  });

  connection.on("ready", () => {
    console.info("[redis] Ready to accept commands.");
  });

  connection.on("error", (err: Error) => {
    console.error("[redis] Error:", err.message);
  });

  connection.on("close", () => {
    console.warn("[redis] Connection closed.");
  });

  connection.on("reconnecting", (delay: number) => {
    console.info(`[redis] Reconnecting in ${delay}ms…`);
  });

  return connection;
}

/**
 * Gracefully close the Redis connection.
 * Call this during process shutdown after BullMQ workers have stopped.
 */
export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
    console.info("[redis] Connection closed gracefully.");
  }
}
