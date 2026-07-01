/**
 * BullMQ queue for the "publish-post" pipeline.
 *
 * Exports:
 *  - publishQueue   — the Queue instance (add jobs, inspect counts, etc.)
 *  - addPostJob     — helper that calculates the correct delay and enqueues
 *  - getJob         — retrieve a Job by its BullMQ job-id
 *  - removeJob      — remove a job from the queue (cancels scheduled jobs)
 */

import { Queue, Job, JobsOptions, ConnectionOptions } from "bullmq";
import { getRedisConnection } from "@/lib/redis";

// ── Types ────────────────────────────────────────────────────────────────────

/** The data payload stored inside every "publish-post" BullMQ job. */
export interface PublishJobData {
  /** The Prisma Post.id that should be published. */
  postId: string;
}

// ── Default job options ───────────────────────────────────────────────────────

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  /** Retry up to 2 times total (1 initial attempt + 1 retry). */
  attempts: 2,

  backoff: {
    /** Wait a fixed 30 seconds before each retry. */
    type: "fixed",
    delay: 30_000,
  },

  /**
   * Keep the last 100 completed and failed jobs for inspection in Bull Board
   * or similar dashboards. Avoids unbounded growth of the Redis keyspace.
   */
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
};

// ── Queue singleton ───────────────────────────────────────────────────────────

let _publishQueue: Queue<PublishJobData> | null = null;

/**
 * Return the process-level Queue singleton, creating it on first call.
 * Lazy so Next.js build-time module evaluation doesn't require Redis.
 */
function getPublishQueue(): Queue<PublishJobData> {
  if (!_publishQueue) {
    _publishQueue = new Queue<PublishJobData>("publish-post", {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: getRedisConnection() as unknown as ConnectionOptions,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return _publishQueue;
}

/** @deprecated Use getPublishQueue() internally; this export is for compat. */
export const publishQueue = new Proxy({} as Queue<PublishJobData>, {
  get(_target, prop) {
    return (getPublishQueue() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Add a publish job to the queue.
 *
 * If `scheduledAt` is a future date the job is delayed until that moment;
 * if it is `null` or in the past the job is enqueued for immediate processing.
 *
 * @param postId      The Prisma Post.id to publish.
 * @param scheduledAt The desired publish time, or null for "now".
 * @returns           The created BullMQ Job.
 */
export async function addPostJob(
  postId: string,
  scheduledAt: Date | null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Job<PublishJobData, any, string>> {
  const delay = calculateDelay(scheduledAt);

  const jobName = `post:${postId}` as string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const job = (await getPublishQueue().add(
    jobName as any,
    { postId },
    {
      ...DEFAULT_JOB_OPTIONS,
      delay,
      /**
       * Use the postId as the deduplication key so that re-scheduling an
       * already-queued post replaces the existing job rather than creating a
       * duplicate.
       */
      jobId: postId,
    }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  )) as unknown as Job<PublishJobData, any, string>;

  console.info(
    `[queue] Job added — postId=${postId} delay=${delay}ms jobId=${job.id}`
  );

  return job;
}

/**
 * Retrieve a BullMQ Job by its job-id.
 *
 * @param jobId  The BullMQ job-id (for posts this equals the postId).
 * @returns      The Job, or `undefined` if it no longer exists in the queue.
 */
export async function getJob(
  jobId: string
): Promise<Job<PublishJobData> | undefined> {
  return getPublishQueue().getJob(jobId);
}

/**
 * Remove a job from the queue entirely, cancelling any pending delay.
 *
 * Silently succeeds if the job does not exist (e.g. already processed).
 *
 * @param jobId  The BullMQ job-id (for posts this equals the postId).
 */
export async function removeJob(jobId: string): Promise<void> {
  const job = await getPublishQueue().getJob(jobId);

  if (!job) {
    console.info(`[queue] removeJob — job not found, nothing to remove (jobId=${jobId})`);
    return;
  }

  await job.remove();
  console.info(`[queue] Job removed — jobId=${jobId}`);
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Calculate the BullMQ delay in milliseconds.
 *
 * A delay of 0 means "process immediately".  BullMQ does not support negative
 * delays so past dates are coerced to 0.
 */
function calculateDelay(scheduledAt: Date | null): number {
  if (!scheduledAt) {
    return 0;
  }

  const delay = scheduledAt.getTime() - Date.now();
  return Math.max(0, delay);
}
