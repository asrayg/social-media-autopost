/**
 * Publish Worker — BullMQ worker process for the "publish-post" queue.
 *
 * Run with:
 *   npm run worker          (tsx src/workers/publish.worker.ts)
 *
 * Responsibilities:
 *   1. Pull the Post from the DB (with SocialAccount and Assets).
 *   2. Mark Post.status = "processing".
 *   3. Route to the correct platform automation (Instagram / TikTok).
 *   4. Mark Post.status = "posted" on success.
 *   5. Mark Post.status = "failed" and record Post.errorMessage on failure.
 *   6. Write a PublishAttempt row after every attempt (success or failure).
 *   7. Shut down gracefully on SIGTERM / SIGINT.
 */

import { Worker, Job, ConnectionOptions } from "bullmq";
import { env, validateEnv } from "@/lib/env";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getRedisConnection, closeRedisConnection } from "@/lib/redis";
import type { PublishJobData } from "@/lib/queue";
import { publishToInstagram } from "@/automation/instagram";
import { publishToTikTok } from "@/automation/tiktok";
import { processImageForInstagram } from "@/media/processImage";
import { processVideoForPlatform } from "@/media/processVideo";

// ── Initialisation ────────────────────────────────────────────────────────────

// Validate all required environment variables immediately so the process exits
// with a clear message rather than a cryptic runtime error later.
validateEnv();

// ── Worker ────────────────────────────────────────────────────────────────────

const QUEUE_NAME = "publish-post";

const worker = new Worker<PublishJobData>(
  QUEUE_NAME,
  async (job: Job<PublishJobData>) => {
    const { postId } = job.data;
    const attemptNumber = job.attemptsMade + 1;

    logger.info("Processing publish job", {
      jobId: job.id,
      postId,
      attempt: attemptNumber,
    });

    // ── 1. Fetch the Post with its SocialAccount and Assets ────────────────

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        account: true,
        assets: true,
      },
    });

    if (!post) {
      // The post was deleted between scheduling and processing — nothing to do.
      logger.warn("Post not found — skipping job", { postId });
      return;
    }

    // Guard against re-processing a post that already succeeded (e.g. a stale
    // retry after a partial infrastructure failure).
    if (post.status === "posted") {
      logger.info('Post already marked "posted" — skipping', { postId });
      return;
    }

    // ── 2. Mark status = "processing" ──────────────────────────────────────

    await prisma.post.update({
      where: { id: postId },
      data: { status: "processing" },
    });

    logger.info("Post status set to processing", { postId });

    // ── 2b. Process media assets before publishing ─────────────────────────
    //
    // For every asset (in `order`) we run the platform-appropriate media
    // pipeline and persist the resulting processedPath (plus dimensions /
    // duration / size) back to the DB and onto the in-memory asset so the
    // automation can read `asset.processedPath ?? asset.filePath`.
    //
    // Processing is best-effort: a failure for one asset logs a warning and
    // leaves `processedPath` null so the automation falls back to the raw
    // `filePath`. It must never fail the whole post.

    const mediaPlatform = post.account.platform.toLowerCase();
    const orderedAssets = [...post.assets].sort((a, b) => a.order - b.order);

    for (const asset of orderedAssets) {
      try {
        if (asset.type === "image") {
          const result = await processImageForInstagram(
            asset.filePath,
            env.PROCESSED_DIR,
            postId,
            asset.order
          );

          await prisma.postAsset.update({
            where: { id: asset.id },
            data: {
              processedPath: result.outputPath,
              width: result.width,
              height: result.height,
              sizeBytes: result.sizeBytes,
            },
          });

          // Mutate the in-memory asset so the automation sees processedPath.
          asset.processedPath = result.outputPath;
          asset.width = result.width;
          asset.height = result.height;
          asset.sizeBytes = result.sizeBytes;

          logger.info("Processed image asset", {
            postId,
            assetId: asset.id,
            order: asset.order,
            processedPath: result.outputPath,
          });
        } else if (asset.type === "video") {
          if (mediaPlatform !== "instagram" && mediaPlatform !== "tiktok") {
            throw new Error(
              `Unsupported platform "${post.account.platform}" for video processing`
            );
          }

          const result = await processVideoForPlatform(
            asset.filePath,
            env.PROCESSED_DIR,
            postId,
            mediaPlatform
          );

          await prisma.postAsset.update({
            where: { id: asset.id },
            data: {
              processedPath: result.outputPath,
              width: result.width,
              height: result.height,
              durationSecs: result.durationSecs,
              sizeBytes: result.sizeBytes,
            },
          });

          // Mutate the in-memory asset so the automation sees processedPath.
          asset.processedPath = result.outputPath;
          asset.width = result.width;
          asset.height = result.height;
          asset.durationSecs = result.durationSecs;
          asset.sizeBytes = result.sizeBytes;

          logger.info("Processed video asset", {
            postId,
            assetId: asset.id,
            order: asset.order,
            processedPath: result.outputPath,
          });
        } else {
          logger.warn("Unknown asset type — skipping media processing", {
            postId,
            assetId: asset.id,
            type: asset.type,
          });
        }
      } catch (err) {
        // Non-fatal: leave processedPath null and let the automation fall back
        // to the raw filePath. Do NOT fail the post on a media error.
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("Media processing failed — falling back to raw file", {
          postId,
          assetId: asset.id,
          type: asset.type,
          error: message,
        });
      }
    }

    // ── 3. Route to the correct platform automation ────────────────────────

    let publishError: Error | null = null;

    try {
      const platform = post.account.platform.toLowerCase();

      logger.info("Routing to platform automation", { postId, platform });

      if (platform === "instagram") {
        await publishToInstagram(post);
      } else if (platform === "tiktok") {
        await publishToTikTok(post);
      } else {
        throw new Error(
          `Unsupported platform "${post.account.platform}" for postId=${postId}`
        );
      }
    } catch (err) {
      publishError = err instanceof Error ? err : new Error(String(err));
    }

    // ── 4 / 5. Update Post status ─────────────────────────────────────────

    if (publishError) {
      logger.error("Publish automation failed", {
        postId,
        error: publishError.message,
        attempt: attemptNumber,
      });

      await prisma.post.update({
        where: { id: postId },
        data: {
          status: "failed",
          errorMessage: publishError.message,
        },
      });
    } else {
      logger.info("Publish automation succeeded", { postId });

      await prisma.post.update({
        where: { id: postId },
        data: {
          status: "posted",
          errorMessage: null,
        },
      });
    }

    // ── 6. Record a PublishAttempt for every attempt ───────────────────────

    await prisma.publishAttempt.create({
      data: {
        postId,
        platform: post.account.platform,
        status: publishError === null ? "success" : "failed_submit",
        error: publishError?.message ?? null,
      },
    });

    logger.info("PublishAttempt recorded", {
      postId,
      attemptNumber,
      success: publishError === null,
    });

    // Re-throw so BullMQ can apply the retry back-off on failure.
    if (publishError) {
      throw publishError;
    }
  },
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: getRedisConnection() as unknown as ConnectionOptions,

    /**
     * Process one job at a time per worker process.  For higher throughput,
     * run multiple worker processes rather than increasing concurrency here, so
     * each Playwright browser session remains isolated.
     */
    concurrency: 1,

    /**
     * Lock duration in milliseconds.  The lock is extended automatically every
     * lockRenewTime (default: lockDuration / 2).  Set this high enough to
     * cover a full Playwright session including upload and confirmation wait.
     */
    lockDuration: 5 * 60 * 1_000, // 5 minutes
  }
);

// ── Event listeners ───────────────────────────────────────────────────────────

worker.on("completed", (job: Job<PublishJobData>) => {
  logger.info("Job completed", { jobId: job.id, postId: job.data.postId });
});

worker.on("failed", (job: Job<PublishJobData> | undefined, err: Error) => {
  const postId = job?.data.postId ?? "unknown";
  const attempt = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts.attempts ?? 2;

  if (attempt >= maxAttempts) {
    logger.error("Job exhausted all retry attempts", {
      jobId: job?.id,
      postId,
      attempt,
      maxAttempts,
      error: err.message,
    });
  } else {
    logger.warn("Job failed, will retry", {
      jobId: job?.id,
      postId,
      attempt,
      maxAttempts,
      error: err.message,
    });
  }
});

worker.on("error", (err: Error) => {
  logger.error("Worker error", { error: err.message, stack: err.stack });
});

worker.on("stalled", (jobId: string) => {
  logger.warn("Job stalled", { jobId });
});

// ── Startup ───────────────────────────────────────────────────────────────────

logger.info(`Worker started. Listening on queue "${QUEUE_NAME}"`);

// ── 7. Graceful shutdown ──────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Shutting down gracefully…`);

  try {
    // Stop accepting new jobs and wait for the active job (if any) to finish.
    await worker.close();
    logger.info("Worker closed.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Error while closing worker", { error: message });
  }

  try {
    await prisma.$disconnect();
    logger.info("Prisma disconnected.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Error while disconnecting Prisma", { error: message });
  }

  try {
    await closeRedisConnection();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Error while closing Redis connection", { error: message });
  }

  logger.info("Shutdown complete.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
