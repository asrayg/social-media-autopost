/**
 * `autopost posts …` — inspect and manage posts.
 *
 * Subcommands:
 *   list    table of posts (filter by status/platform/limit)
 *   get     full detail incl. assets + publish attempts
 *   retry   re-enqueue a failed/scheduled post
 *   cancel  remove the queue job and mark the post a draft
 */

import chalk from "chalk";
import { Command } from "commander";
import { prisma } from "@/lib/db";
import { addPostJob, removeJob } from "@/lib/queue";
import { MVP_USER_ID } from "../lib/accounts";
import { markQueueUsed } from "../lib/runtime";
import {
  makeTable,
  printResult,
  withJson,
  wrap,
  colourStatus,
  truncate,
  confirm,
} from "../lib/output";

// ── posts list ────────────────────────────────────────────────────────────────

function registerList(posts: Command): void {
  withJson(
    posts
      .command("list")
      .description("List posts")
      .option("--status <status>", "Filter by status")
      .option("--platform <platform>", "Filter by platform")
      .option("--limit <n>", "Max rows (default 20)")
  ).action(
    wrap(
      async (opts: { status?: string; platform?: string; limit?: string }) => {
        const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
        if (Number.isNaN(limit) || limit < 1) {
          throw new Error(`Invalid --limit "${opts.limit}" (expected a positive integer).`);
        }

        const rows = await prisma.post.findMany({
          where: {
            userId: MVP_USER_ID,
            ...(opts.status ? { status: opts.status } : {}),
            ...(opts.platform ? { platform: opts.platform } : {}),
          },
          take: limit,
          orderBy: { createdAt: "desc" },
          include: { account: true, assets: { orderBy: { order: "asc" } } },
        });

        printResult(rows, () => {
          if (rows.length === 0) {
            console.log(chalk.gray("No posts match."));
            return;
          }
          const table = makeTable([
            "id",
            "platform",
            "type",
            "status",
            "account",
            "scheduledAt",
            "caption",
          ]);
          for (const p of rows) {
            table.push([
              p.id,
              p.platform,
              p.type,
              colourStatus(p.status),
              p.account.username,
              p.scheduledAt ? p.scheduledAt.toISOString() : "-",
              truncate(p.caption, 30),
            ]);
          }
          console.log(table.toString());
        });
      }
    )
  );
}

// ── posts get ─────────────────────────────────────────────────────────────────

function registerGet(posts: Command): void {
  withJson(
    posts
      .command("get")
      .description("Show full detail for a post")
      .argument("<id>", "Post id")
  ).action(
    wrap(async (id: string) => {
      const post = await prisma.post.findUnique({
        where: { id },
        include: {
          assets: { orderBy: { order: "asc" } },
          attempts: { orderBy: { createdAt: "desc" } },
          account: true,
        },
      });

      if (!post) {
        throw new Error(`Post not found: ${id}`);
      }

      printResult(post, () => {
        console.log(chalk.bold(`Post ${post.id}`));
        console.log(`  platform:    ${post.platform}`);
        console.log(`  type:        ${post.type}`);
        console.log(`  status:      ${colourStatus(post.status)}`);
        console.log(`  account:     @${post.account.username} (${post.account.id})`);
        console.log(`  scheduledAt: ${post.scheduledAt ? post.scheduledAt.toISOString() : "-"}`);
        console.log(`  bullJobId:   ${post.bullJobId ?? "-"}`);
        if (post.errorMessage) console.log(`  error:       ${chalk.red(post.errorMessage)}`);
        console.log(`  caption:     ${post.caption}`);

        console.log(chalk.bold(`\n  Assets (${post.assets.length}):`));
        for (const a of post.assets) {
          console.log(
            `    [${a.order}] ${a.type}  ${a.filePath}${a.processedPath ? ` -> ${a.processedPath}` : ""}`
          );
        }

        console.log(chalk.bold(`\n  Publish attempts (${post.attempts.length}):`));
        for (const at of post.attempts) {
          console.log(
            `    ${at.createdAt.toISOString()}  ${colourStatus(at.status)}${at.error ? `  ${chalk.red(at.error)}` : ""}`
          );
        }
      });
    })
  );
}

// ── posts retry ───────────────────────────────────────────────────────────────

function registerRetry(posts: Command): void {
  withJson(
    posts
      .command("retry")
      .description("Re-enqueue a failed or scheduled post")
      .argument("<id>", "Post id")
  ).action(
    wrap(async (id: string) => {
      const post = await prisma.post.findUnique({
        where: { id },
        select: { id: true, status: true, scheduledAt: true },
      });
      if (!post) {
        throw new Error(`Post not found: ${id}`);
      }
      if (post.status !== "failed" && post.status !== "scheduled") {
        throw new Error(
          `Only failed or scheduled posts can be retried (current status: "${post.status}").`
        );
      }

      // Reset error state and re-queue. Respect a future scheduledAt, otherwise
      // run as soon as possible.
      await prisma.post.update({
        where: { id },
        data: { status: "scheduled", errorMessage: null, bullJobId: null },
      });

      markQueueUsed();
      const runAt =
        post.scheduledAt && post.scheduledAt > new Date() ? post.scheduledAt : null;
      const job = await addPostJob(id, runAt);

      const updated = await prisma.post.update({
        where: { id },
        data: { bullJobId: job.id ?? null },
        include: {
          assets: { orderBy: { order: "asc" } },
          attempts: { orderBy: { createdAt: "desc" } },
          account: true,
        },
      });

      printResult(updated, () => {
        console.log(
          chalk.green(`✔ Re-enqueued post ${id} (jobId ${job.id}, status scheduled).`)
        );
      });
    })
  );
}

// ── posts cancel ──────────────────────────────────────────────────────────────

function registerCancel(posts: Command): void {
  withJson(
    posts
      .command("cancel")
      .description("Remove the queue job and mark the post a draft (no delete)")
      .argument("<id>", "Post id")
  ).action(
    wrap(async (id: string) => {
      const post = await prisma.post.findUnique({
        where: { id },
        select: { id: true, status: true, bullJobId: true },
      });
      if (!post) {
        throw new Error(`Post not found: ${id}`);
      }
      if (post.status === "processing") {
        throw new Error("Cannot cancel a post that is currently being published.");
      }

      const ok = await confirm(`Cancel post ${id} and reset it to draft?`);
      if (!ok) {
        throw new Error("Aborted by user.");
      }

      markQueueUsed();
      // addPostJob uses the postId as the BullMQ jobId, so either works.
      await removeJob(post.bullJobId ?? post.id).catch(() => {});

      const updated = await prisma.post.update({
        where: { id },
        data: { status: "draft", bullJobId: null },
        include: {
          assets: { orderBy: { order: "asc" } },
          account: true,
        },
      });

      printResult(updated, () => {
        console.log(chalk.green(`✔ Cancelled post ${id}; queue job removed, status set to draft.`));
      });
    })
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerPosts(program: Command): void {
  const posts = program.command("posts").description("Inspect and manage posts");
  registerList(posts);
  registerGet(posts);
  registerRetry(posts);
  registerCancel(posts);
}
