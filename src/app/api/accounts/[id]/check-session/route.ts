/**
 * POST /api/accounts/[id]/check-session
 *
 * Opens a headless Playwright browser using the account's saved session,
 * navigates to the platform home/feed page, checks whether the user is still
 * logged in, then immediately closes the browser.
 *
 * Returns: { loggedIn: boolean }
 *
 * NOTE: Auth is intentionally skipped for MVP.
 */

import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import { prisma } from "@/lib/db";
import { PLATFORM_LOGIN_URLS, PLATFORM_CHECK_URLS, ensureSessionDir } from "../_browser-utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const account = await prisma.socialAccount.findUnique({
      where: { id },
      select: { id: true, platform: true, sessionPath: true },
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const loginUrl = PLATFORM_LOGIN_URLS[account.platform];
    if (!loginUrl) {
      return NextResponse.json(
        { error: `Unsupported platform: ${account.platform}` },
        { status: 400 }
      );
    }

    await ensureSessionDir(account.sessionPath);

    // Headless — just checking, not interacting. Try without no-sandbox first
    // because Reddit treats that launch flag as a network-security block.
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

      // Navigate to the "check" URL (the platform home / feed, not the login page)
      const checkUrl = PLATFORM_CHECK_URLS[account.platform];
      await page.goto(checkUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });

      // Wait briefly for any client-side redirect to settle
      await page.waitForTimeout(2_000);

      const finalUrl = page.url();

      // If we ended up on a login page, the session is invalid / expired.
      // Each platform has a recognisable login URL pattern.
      loggedIn = !isLoginPage(finalUrl, account.platform);
    } finally {
      await browser.close();
    }

    // Keep DB status in sync
    await prisma.socialAccount.update({
      where: { id },
      data: { status: loggedIn ? "active" : "needs_manual_login" },
    });

    return NextResponse.json({ loggedIn });
  } catch (err) {
    console.error("[POST /api/accounts/[id]/check-session]", err);
    return NextResponse.json(
      { error: "Failed to check session" },
      { status: 500 }
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the given URL looks like a login / auth page for the platform.
 */
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
      // Conservative default — assume not logged in if platform unknown
      return true;
  }
}
