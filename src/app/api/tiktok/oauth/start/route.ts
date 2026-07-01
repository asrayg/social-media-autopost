/**
 * GET /api/tiktok/oauth/start?accountId=<id>
 *
 * Begins the TikTok Content Posting API OAuth flow for a SocialAccount.
 * Builds the v2 authorize URL and 302-redirects the browser to TikTok.
 *
 * A signed `state` (accountId + random nonce) is stored in an httpOnly cookie
 * and echoed to TikTok so the callback can verify it (CSRF protection) and know
 * which account to attach the tokens to.
 */

import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  buildAuthorizeUrl,
  requireTikTokConfig,
  TIKTOK_SCOPES,
} from "@/integrations/tiktok";

export const dynamic = "force-dynamic";

export const TIKTOK_OAUTH_STATE_COOKIE = "tiktok_oauth_state";

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json(
      { error: "Missing required query parameter: accountId" },
      { status: 400 },
    );
  }

  // Validate that the account exists and is a TikTok account.
  const account = await prisma.socialAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) {
    return NextResponse.json(
      { error: `SocialAccount ${accountId} not found` },
      { status: 404 },
    );
  }
  if (account.platform !== "tiktok") {
    return NextResponse.json(
      { error: `Account ${accountId} is not a TikTok account` },
      { status: 400 },
    );
  }

  let cfg;
  try {
    cfg = requireTikTokConfig();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TikTok not configured" },
      { status: 500 },
    );
  }

  // state = "<accountId>:<nonce>" — echoed to TikTok and verified in callback.
  const nonce = randomBytes(16).toString("hex");
  const state = `${accountId}:${nonce}`;

  const authorizeUrl = buildAuthorizeUrl({
    clientKey: cfg.clientKey,
    redirectUri: cfg.redirectUri,
    scopes: TIKTOK_SCOPES,
    state,
  });

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(TIKTOK_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });
  return res;
}
