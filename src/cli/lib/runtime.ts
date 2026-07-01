/**
 * Process lifecycle helpers.
 *
 * The CLI reuses long-lived backend singletons (Prisma, the BullMQ queue, and
 * the ioredis connection). Those keep the event loop alive, so a one-shot CLI
 * invocation must tear them down before exiting. `cleanup()` closes only what
 * was actually used; the caller races it against a timeout and then force-exits
 * so the process can never hang on a wedged socket.
 */

import { prisma } from "@/lib/db";

let redisUsed = false;
let queueUsed = false;

/** Mark that a command opened the raw Redis connection (e.g. `status`). */
export function markRedisUsed(): void {
  redisUsed = true;
}

/** Mark that a command used the BullMQ queue (enqueue / remove / inspect). */
export function markQueueUsed(): void {
  queueUsed = true;
}

/** Best-effort teardown of every backend resource the CLI may have opened. */
export async function cleanup(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }

  if (queueUsed) {
    try {
      const { publishQueue } = await import("@/lib/queue");
      await publishQueue.close();
    } catch {
      /* ignore */
    }
  }

  if (redisUsed) {
    try {
      const { closeRedisConnection } = await import("@/lib/redis");
      await closeRedisConnection();
    } catch {
      /* ignore */
    }
  }
}
