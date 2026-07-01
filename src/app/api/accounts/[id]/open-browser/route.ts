/**
 * POST /api/accounts/[id]/open-browser
 *
 * Opens a visible (non-headless) Playwright browser window directed to the
 * platform's login page so the user can log in manually.
 *
 * The browser is opened in a persistent context so the session is saved to the
 * account's sessionPath directory. The route returns immediately after the
 * browser opens — it does NOT wait for the user to complete login.
 *
 * The frontend should poll /api/accounts/[id]/check-session after the user
 * closes the browser to verify whether login succeeded.
 *
 * NOTE: Auth is intentionally skipped for MVP.
 */

import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import { prisma } from "@/lib/db";
import { PLATFORM_LOGIN_URLS, ensureSessionDir } from "../_browser-utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const account = await prisma.socialAccount.findUnique({
      where: { id },
      select: { id: true, platform: true, username: true, sessionPath: true },
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

    // Use the real installed Chrome so TikTok/Instagram don't flag automation.
    // Falls back to Playwright's Chromium if Chrome isn't installed.
    let browser;
    try {
      browser = await chromium.launchPersistentContext(account.sessionPath, {
        headless: false,
        channel: "chrome", // use real Chrome — bypasses bot detection
        args: [
          "--disable-blink-features=AutomationControlled",
          "--window-size=1280,900",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
        viewport: { width: 1280, height: 900 },
      });
    } catch {
      // Chrome not found — fall back to bundled Chromium (needs sandbox flags)
      browser = await chromium.launchPersistentContext(account.sessionPath, {
        headless: false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1280,900",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
        viewport: { width: 1280, height: 900 },
      });
    }

    // Navigate the first (default) page to the login URL
    const pages = browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

    // Update account status to indicate manual login is in progress
    await prisma.socialAccount.update({
      where: { id },
      data: { status: "needs_manual_login" },
    });

    // Detach — do NOT await browser.close(). The user interacts with the window
    // independently. The process will keep the browser open until it is closed
    // by the OS or the user. This is intentional for the manual login flow.
    // Attach a close listener to update status when the browser context is closed.
    // BrowserContext fires "close" (not "disconnected" — that's a Browser event).
    browser.on("close", async () => {
      try {
        await prisma.socialAccount.update({
          where: { id },
          data: { status: "active" },
        });
      } catch {
        // Best-effort — the server may have restarted
      }
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/accounts/[id]/open-browser]", err);
    return NextResponse.json(
      { error: "Failed to open browser" },
      { status: 500 }
    );
  }
}
