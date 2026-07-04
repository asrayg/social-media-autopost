/**
 * `autopost post …` — create a Post (+ PostAssets) and either save it as a
 * draft, publish it inline now, or schedule it for the worker.
 */

import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { Command } from "commander";
import type { Post, SocialAccount, PostAsset } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { addPostJob } from "@/lib/queue";
import { postToInstagram } from "@/automation/instagram";
import { postToTikTok } from "@/automation/tiktok";
import { publishToTwitter } from "@/automation/twitter";
import { publishToLinkedIn } from "@/automation/linkedin";
import { publishToReddit } from "@/automation/reddit";
import { publishToYouTube } from "@/automation/youtube";
import { publishToBluesky } from "@/automation/bluesky";
import { publishToThreads } from "@/automation/threads";
import { publishToPinterest } from "@/automation/pinterest";
import { publishToFacebook } from "@/automation/facebook";
import { processImageForInstagram } from "@/media/processImage";
import { processVideoForPlatform, type VideoPlatform } from "@/media/processVideo";
import { ingestUrl } from "@/lib/mediaIngest";
import {
  POST_TYPES,
  PLATFORMS,
  getPlatformPostTypeConfig,
  postTypesForPlatform,
  validatePlatformAssets,
  type Platform,
  type PostType,
} from "@/lib/platforms";
import { MVP_USER_ID, resolveAccount } from "../lib/accounts";
import { markQueueUsed } from "../lib/runtime";
import { printResult, withJson, wrap, isJsonMode, confirm, info } from "../lib/output";

type PostWithAssets = Post & { account: SocialAccount; assets: PostAsset[] };

const ALL_TYPES = POST_TYPES;

interface ResolvedAsset {
  filePath: string;
  type: "image" | "video";
}

function inferAssetType(filePath: string): "image" | "video" {
  const ext = path.extname(filePath).toLowerCase();
  if ([".mp4", ".mov", ".avi", ".m4v", ".webm"].includes(ext)) return "video";
  return "image";
}

/** Collector for repeatable `--media` flags. */
function collectMedia(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

interface PostOptions {
  account: string;
  type: string;
  caption: string;
  media: string[];
  mediaUrl: string[];
  at?: string;
  now?: boolean;
  draft?: boolean;
}

// ── Inline media processing (mirrors publish.worker.ts, best-effort) ──────────

async function processAssetsInline(post: PostWithAssets): Promise<void> {
  const platform = post.account.platform.toLowerCase();
  const ordered = [...post.assets].sort((a, b) => a.order - b.order);

  for (const asset of ordered) {
    try {
      if (asset.type === "image") {
        const result = await processImageForInstagram(
          asset.filePath,
          env.PROCESSED_DIR,
          post.id,
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
        asset.processedPath = result.outputPath;
      } else if (asset.type === "video") {
        const videoPlatform =
          platform === "youtube" && post.type === "short" ? "youtube_short" : platform;
        const result = await processVideoForPlatform(
          asset.filePath,
          env.PROCESSED_DIR,
          post.id,
          videoPlatform as VideoPlatform
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
        asset.processedPath = result.outputPath;
      }
    } catch (err) {
      // Non-fatal — fall back to the raw file, exactly like the worker.
      const message = err instanceof Error ? err.message : String(err);
      info(chalk.yellow(`  media processing failed (using raw file): ${message}`));
    }
  }
}

// ── Inline publish (mirrors publish.worker.ts routing + bookkeeping) ──────────

async function publishInline(post: PostWithAssets): Promise<PostWithAssets> {
  const platform = post.account.platform.toLowerCase();

  await prisma.post.update({
    where: { id: post.id },
    data: { status: "processing" },
  });

  const spinner = isJsonMode()
    ? null
    : ora({ text: "Processing media…", stream: process.stderr }).start();

  await processAssetsInline(post);

  if (spinner) spinner.text = `Publishing to ${platform}…`;

  let publishError: Error | null = null;
  try {
    if (platform === "instagram") {
      await postToInstagram(post);
    } else if (platform === "tiktok") {
      await postToTikTok(post);
    } else if (platform === "twitter") {
      await publishToTwitter(post);
    } else if (platform === "linkedin") {
      await publishToLinkedIn(post);
    } else if (platform === "reddit") {
      await publishToReddit(post);
    } else if (platform === "youtube") {
      await publishToYouTube(post);
    } else if (platform === "bluesky") {
      await publishToBluesky(post);
    } else if (platform === "threads") {
      await publishToThreads(post);
    } else if (platform === "pinterest") {
      await publishToPinterest(post);
    } else if (platform === "facebook") {
      await publishToFacebook(post);
    } else {
      throw new Error(`Unsupported platform "${platform}"`);
    }
  } catch (err) {
    publishError = err instanceof Error ? err : new Error(String(err));
  }

  const updated = await prisma.post.update({
    where: { id: post.id },
    data: {
      status: publishError ? "failed" : "posted",
      errorMessage: publishError?.message ?? null,
    },
    include: {
      assets: { orderBy: { order: "asc" } },
      account: true,
    },
  });

  await prisma.publishAttempt.create({
    data: {
      postId: post.id,
      platform: post.account.platform,
      status: publishError === null ? "success" : "failed_submit",
      error: publishError?.message ?? null,
    },
  });

  if (spinner) {
    if (publishError) spinner.fail(`Publish failed: ${publishError.message}`);
    else spinner.succeed("Published.");
  }

  if (publishError) {
    // Surface as a command error (non-zero exit) while the DB reflects "failed".
    throw new Error(`Publish to ${platform} failed: ${publishError.message}`);
  }

  return updated as PostWithAssets;
}

// ── Command ───────────────────────────────────────────────────────────────────

export function registerPost(program: Command): void {
  withJson(
    program
      .command("post")
      .description("Create a post and draft, publish now, or schedule it")
      .requiredOption("--account <idOrUsername>", "Target account (id or username)")
      .requiredOption(
        "--type <type>",
        `Post type (${ALL_TYPES.join(" | ")})`
      )
      .requiredOption("--caption <text>", "Post caption")
      .option(
        "--media <path>",
        "Local media file path (repeat for carousel)",
        collectMedia,
        []
      )
      .option(
        "--media-url <url>",
        "Public media URL or Google Drive share link (repeat for carousel); " +
          "downloaded locally. Ordered after all --media entries.",
        collectMedia,
        []
      )
      .option("--at <iso8601>", "Schedule time (ISO-8601); defaults to now")
      .option("--now", "Publish immediately, inline (runs real automation)")
      .option("--draft", "Save as a draft without scheduling")
  ).action(
    wrap(async (opts: PostOptions) => {
      const type = opts.type.toLowerCase() as PostType;
      if (!ALL_TYPES.includes(type as (typeof ALL_TYPES)[number])) {
        throw new Error(`Invalid --type "${opts.type}". Must be one of: ${ALL_TYPES.join(", ")}`);
      }

      if (opts.now && opts.draft) {
        throw new Error("--now and --draft cannot be combined.");
      }

      const media = opts.media ?? [];
      const mediaUrls = opts.mediaUrl ?? [];
      const account = await resolveAccount(opts.account);
      const platform = account.platform.toLowerCase() as Platform;

      if (!PLATFORMS.includes(platform)) {
        throw new Error(`Unsupported account platform "${account.platform}".`);
      }
      if (!getPlatformPostTypeConfig(platform, type)) {
        const allowed = postTypesForPlatform(platform).join(", ");
        throw new Error(`Type "${type}" is not valid for ${platform}. Allowed: ${allowed}`);
      }

      // Resolve media into local absolute paths. Order: all --media (local)
      // paths first, then all --media-url entries in declaration order.
      const resolvedAssets: ResolvedAsset[] = [];

      // Local --media files.
      for (const m of media) {
        const abs = path.resolve(m);
        try {
          await fs.access(abs);
        } catch {
          throw new Error(`Media file not found: ${m}`);
        }
        resolvedAssets.push({ filePath: abs, type: inferAssetType(abs) });
      }

      // Remote --media-url entries: download each into UPLOAD_DIR.
      for (const url of mediaUrls) {
        const spinner = isJsonMode()
          ? null
          : ora({ text: `Downloading ${url}…`, stream: process.stderr }).start();
        try {
          const asset = await ingestUrl(url, resolvedAssets.length);
          if (spinner) spinner.succeed(`Downloaded ${url} (${asset.filename}).`);
          resolvedAssets.push({ filePath: asset.filePath, type: asset.type });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (spinner) spinner.fail(`Failed to download ${url}: ${message}`);
          throw new Error(`Failed to ingest --media-url "${url}": ${message}`);
        }
      }

      const assetError = validatePlatformAssets({
        platform,
        type,
        assets: resolvedAssets,
      });
      if (assetError) {
        throw new Error(assetError);
      }

      // Determine scheduling / mode.
      let scheduledAt: Date | null = null;
      if (!opts.now && !opts.draft) {
        scheduledAt = opts.at ? new Date(opts.at) : new Date();
        if (Number.isNaN(scheduledAt.getTime())) {
          throw new Error(`Invalid --at value "${opts.at}" (expected ISO-8601).`);
        }
      }

      const status = opts.draft ? "draft" : opts.now ? "processing" : "scheduled";

      const post = (await prisma.post.create({
        data: {
          userId: MVP_USER_ID,
          socialAccountId: account.id,
          platform: account.platform,
          type,
          caption: opts.caption,
          scheduledAt,
          status: opts.now ? "draft" : status, // set to draft first; publishInline flips to processing
          assets: {
            create: resolvedAssets.map((asset, i) => ({
              filePath: asset.filePath,
              type: asset.type,
              order: i,
            })),
          },
        },
        include: {
          assets: { orderBy: { order: "asc" } },
          account: true,
        },
      })) as PostWithAssets;

      // ── Draft ────────────────────────────────────────────────────────────────
      if (opts.draft) {
        printResult(post, () => {
          console.log(chalk.green(`✔ Draft created (id ${post.id}).`));
        });
        return;
      }

      // ── Publish now (inline) ──────────────────────────────────────────────────
      if (opts.now) {
        const ok = await confirm(
          `Publish now to the LIVE ${platform} account @${account.username}?`
        );
        if (!ok) {
          throw new Error("Aborted by user.");
        }
        const published = await publishInline(post);
        printResult(published, () => {
          console.log(chalk.green(`✔ Posted to ${platform} (id ${published.id}).`));
        });
        return;
      }

      // ── Scheduled (worker handles it) ─────────────────────────────────────────
      markQueueUsed();
      const job = await addPostJob(post.id, scheduledAt);
      const updated = await prisma.post.update({
        where: { id: post.id },
        data: { bullJobId: job.id ?? null },
        include: {
          assets: { orderBy: { order: "asc" } },
          account: true,
        },
      });

      printResult(updated, () => {
        console.log(
          chalk.green(
            `✔ Scheduled post ${updated.id} for ${scheduledAt?.toISOString()} (jobId ${job.id}).`
          )
        );
        console.log(chalk.gray("  Run `autopost worker` to process the queue."));
      });
    })
  );
}
