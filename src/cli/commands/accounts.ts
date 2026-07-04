/**
 * `autopost accounts …` — manage social accounts.
 *
 * Subcommands:
 *   list                 table of accounts
 *   add                  create a SocialAccount row
 *   login <idOrUsername> open a visible browser for manual login
 *   check <idOrUsername> headless session validity check
 */

import chalk from "chalk";
import ora from "ora";
import { Command } from "commander";
import { chromium } from "playwright";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getSessionPath } from "@/lib/storage";
import { openAccountBrowser, getActivePage } from "@/automation/browser";
import {
  PLATFORM_LOGIN_URLS,
  PLATFORM_CHECK_URLS,
  ensureSessionDir,
} from "@/app/api/accounts/[id]/_browser-utils";
import {
  MVP_USER_ID,
  ensureMvpUser,
  resolveAccount,
} from "../lib/accounts";
import {
  makeTable,
  printResult,
  withJson,
  wrap,
  colourStatus,
  info,
  isJsonMode,
} from "../lib/output";
import { PLATFORMS } from "@/lib/platforms";

const SUPPORTED_PLATFORMS = PLATFORMS;

// ── accounts list ─────────────────────────────────────────────────────────────

function registerList(accounts: Command): void {
  withJson(
    accounts.command("list").description("List all social accounts")
  ).action(
    wrap(async () => {
      const rows = await prisma.socialAccount.findMany({
        where: { userId: MVP_USER_ID },
        orderBy: { createdAt: "desc" },
      });

      printResult(rows, () => {
        if (rows.length === 0) {
          console.log(chalk.gray("No accounts. Add one with `autopost accounts add`."));
          return;
        }
        const table = makeTable(["id", "platform", "username", "status"]);
        for (const a of rows) {
          table.push([a.id, a.platform, a.username, colourStatus(a.status)]);
        }
        console.log(table.toString());
      });
    })
  );
}

// ── accounts add ──────────────────────────────────────────────────────────────

function registerAdd(accounts: Command): void {
  withJson(
    accounts
      .command("add")
      .description("Create a new social account row")
      .requiredOption(
        "--platform <platform>",
        `Platform (${SUPPORTED_PLATFORMS.join(" | ")})`
      )
      .requiredOption("--username <username>", "Account username / handle")
      .option(
        "--app-password <password>",
        "Bluesky app password (from Settings → App Passwords). Connects instantly, no browser login."
      )
  ).action(
    wrap(async (opts: { platform: string; username: string; appPassword?: string }) => {
      const platform = opts.platform.toLowerCase();
      const username = opts.username;

      if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
        throw new Error(
          `Unsupported platform "${opts.platform}". Supported: ${SUPPORTED_PLATFORMS.join(", ")}`
        );
      }

      // Bluesky stores API credentials instead of a browser session.
      const credentials =
        platform === "bluesky" && opts.appPassword
          ? { identifier: username, appPassword: opts.appPassword.trim() }
          : undefined;

      // Ensure the FK target exists before inserting the account.
      await ensureMvpUser();

      // Derive the session path the same way the API does.
      const sessionPath = getSessionPath(platform, username);

      const existing = await prisma.socialAccount.findUnique({
        where: {
          userId_platform_username: {
            userId: MVP_USER_ID,
            platform,
            username,
          },
        },
      });
      if (existing) {
        throw new Error(
          `An account for @${username} on ${platform} already exists (id ${existing.id})`
        );
      }

      const account = await prisma.socialAccount.create({
        data: {
          userId: MVP_USER_ID,
          platform,
          username,
          sessionPath,
          credentials,
          // Bluesky is usable immediately if an app password was provided;
          // otherwise it (like browser platforms) needs connecting first.
          status:
            platform === "bluesky" && !credentials ? "needs_manual_login" : "active",
        },
      });

      printResult(account, () => {
        console.log(chalk.green(`✔ Created account @${username} on ${platform}`));
        console.log(`  id:          ${account.id}`);
        console.log(`  sessionPath: ${account.sessionPath}`);
        console.log(
          chalk.gray(
            `\n  Next: run \`autopost accounts login ${account.id}\` to sign in.`
          )
        );
      });
    })
  );
}

// ── accounts login ────────────────────────────────────────────────────────────

function registerLogin(accounts: Command): void {
  withJson(
    accounts
      .command("login")
      .description(
        "Open a visible Chrome window to the platform login page for manual sign-in"
      )
      .argument("<idOrUsername>", "Account id or username")
  ).action(
    wrap(async (idOrUsername: string) => {
      const account = await resolveAccount(idOrUsername);

      const loginUrl = PLATFORM_LOGIN_URLS[account.platform];
      if (!loginUrl) {
        throw new Error(`Unsupported platform: ${account.platform}`);
      }

      await ensureSessionDir(account.sessionPath);

      // Open a real-Chrome persistent context via the shared automation helper.
      const context = await openAccountBrowser(account.sessionPath);
      const page = await getActivePage(context);
      await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

      // Mark the account as awaiting manual login while the window is open.
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: { status: "needs_manual_login" },
      });

      info(
        chalk.bold(`\nA Chrome window has opened at ${loginUrl}`) +
          `\n  Account: @${account.username} (${account.platform})` +
          "\n  1. Log in manually and complete any 2FA." +
          "\n  2. When you're done, CLOSE the browser window." +
          "\n  The session is saved automatically and the account is marked active.\n" +
          chalk.gray("\nWaiting for you to close the browser…")
      );

      // Keep the process alive until the user closes the browser window.
      await new Promise<void>((resolve) => {
        context.on("close", () => resolve());
      });

      await prisma.socialAccount
        .update({
          where: { id: account.id },
          data: { status: "active" },
        })
        .catch(() => {});

      printResult(
        {
          id: account.id,
          platform: account.platform,
          username: account.username,
          status: "active",
          message: "Browser closed; session saved.",
        },
        () => {
          console.log(chalk.green("\n✔ Browser closed. Session saved; account marked active."));
        }
      );
    })
  );
}

// ── accounts check ────────────────────────────────────────────────────────────

/** True if `url` looks like a login/auth page for `platform`. */
function isLoginPage(url: string, platform: string): boolean {
  const lower = url.toLowerCase();
  switch (platform) {
    case "instagram":
      return lower.includes("/accounts/login") || lower.includes("/login");
    case "tiktok":
      return lower.includes("/login") || lower.includes("passport.tiktok");
    case "twitter":
      return lower.includes("/i/flow/login") || lower.includes("/login");
    case "linkedin":
      return lower.includes("/login") || lower.includes("/uas/login");
    case "reddit":
      return lower.includes("/login") || lower.includes("/account/login");
    case "youtube":
      return lower.includes("accounts.google.com") || lower.includes("/signin");
    default:
      return true;
  }
}

function registerCheck(accounts: Command): void {
  withJson(
    accounts
      .command("check")
      .description("Headless check of whether the saved session is still logged in")
      .argument("<idOrUsername>", "Account id or username")
  ).action(
    wrap(async (idOrUsername: string) => {
      const account = await resolveAccount(idOrUsername);

      const checkUrl = PLATFORM_CHECK_URLS[account.platform];
      if (!checkUrl) {
        throw new Error(`Unsupported platform: ${account.platform}`);
      }

      await ensureSessionDir(account.sessionPath);

      const spinner = isJsonMode()
        ? null
        : ora({ text: "Checking session…", stream: process.stderr }).start();

      let browser;
      try {
        browser = await chromium.launchPersistentContext(account.sessionPath, {
          headless: true,
        });
      } catch {
        browser = await chromium.launchPersistentContext(account.sessionPath, {
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
      }

      let loggedIn = false;
      try {
        const pages = browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();
        await page.goto(checkUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        await page.waitForTimeout(2_000);
        loggedIn = !isLoginPage(page.url(), account.platform);
      } finally {
        await browser.close();
      }

      await prisma.socialAccount.update({
        where: { id: account.id },
        data: { status: loggedIn ? "active" : "needs_manual_login" },
      });

      spinner?.stop();

      printResult(
        {
          id: account.id,
          platform: account.platform,
          username: account.username,
          loggedIn,
          status: loggedIn ? "active" : "needs_manual_login",
        },
        () => {
          console.log(
            loggedIn
              ? chalk.green(`✔ @${account.username} is logged in.`)
              : chalk.yellow(
                  `✖ @${account.username} is NOT logged in — run \`autopost accounts login ${account.id}\`.`
                )
          );
        }
      );
    })
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerAccounts(program: Command): void {
  const accounts = program
    .command("accounts")
    .description("Manage social accounts");

  registerList(accounts);
  registerAdd(accounts);
  registerLogin(accounts);
  registerCheck(accounts);
}
