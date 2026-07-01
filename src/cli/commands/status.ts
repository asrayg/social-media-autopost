/**
 * `autopost status` — report backend reachability and content counts.
 */

import chalk from "chalk";
import { Command } from "commander";
import { prisma } from "@/lib/db";
import { getRedisConnection } from "@/lib/redis";
import { MVP_USER_ID } from "../lib/accounts";
import { markRedisUsed } from "../lib/runtime";
import { makeTable, printResult, withJson, wrap, colourStatus } from "../lib/output";

/** All Post.status values, in lifecycle order. */
const POST_STATUSES = [
  "draft",
  "scheduled",
  "processing",
  "posted",
  "failed",
] as const;

async function checkPostgres(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  markRedisUsed();
  try {
    const conn = getRedisConnection();
    const pong = await Promise.race([
      conn.ping(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2500)
      ),
    ]);
    return pong === "PONG";
  } catch {
    return false;
  }
}

export function registerStatus(program: Command): void {
  withJson(
    program
      .command("status")
      .description("Show Postgres/Redis reachability and account/post counts")
  ).action(
    wrap(async () => {
      const [postgres, redis] = await Promise.all([
        checkPostgres(),
        checkRedis(),
      ]);

      let accounts: number | null = null;
      const posts: Record<string, number> = {
        total: 0,
        draft: 0,
        scheduled: 0,
        processing: 0,
        posted: 0,
        failed: 0,
      };

      if (postgres) {
        accounts = await prisma.socialAccount.count({
          where: { userId: MVP_USER_ID },
        });

        const grouped = await prisma.post.groupBy({
          by: ["status"],
          where: { userId: MVP_USER_ID },
          _count: { _all: true },
        });

        for (const g of grouped) {
          const n = g._count._all;
          posts[g.status] = (posts[g.status] ?? 0) + n;
          posts.total += n;
        }
      }

      const data = {
        postgres,
        redis,
        accounts,
        posts: postgres ? posts : null,
      };

      printResult(data, () => {
        const dot = (ok: boolean) => (ok ? chalk.green("●") : chalk.red("●"));
        console.log(chalk.bold("autopost status"));
        console.log(
          `  ${dot(postgres)} Postgres  ${postgres ? chalk.green("reachable") : chalk.red("unreachable")}`
        );
        console.log(
          `  ${dot(redis)} Redis     ${redis ? chalk.green("reachable") : chalk.red("unreachable")}`
        );

        if (!postgres) {
          console.log(chalk.yellow("\n  Counts unavailable (Postgres unreachable)."));
          return;
        }

        console.log(`\n  Accounts: ${chalk.bold(String(accounts))}`);
        const table = makeTable(["Post status", "Count"]);
        for (const s of POST_STATUSES) {
          table.push([colourStatus(s), String(posts[s] ?? 0)]);
        }
        table.push([chalk.bold("total"), chalk.bold(String(posts.total))]);
        console.log(table.toString());
      });
    })
  );
}
