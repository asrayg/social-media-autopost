/**
 * GET /api/tiktok/oauth/callback?code=...&state=...
 *
 * TikTok redirects here after the user authorizes. We:
 *   1. Verify `state` against the httpOnly cookie set in /start (CSRF).
 *   2. Exchange the `code` for access/refresh tokens.
 *   3. Persist the tokens onto the SocialAccount encoded in `state`.
 *   4. Redirect the operator back to the accounts screen with a status flag.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  persistTokens,
} from "@/integrations/tiktok";
import { TIKTOK_OAUTH_STATE_COOKIE } from "../constants";

export const dynamic = "force-dynamic";

function redirectWith(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/accounts", req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete(TIKTOK_OAUTH_STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const error = searchParams.get("error");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (error) {
    return redirectWith(req, {
      tiktok_oauth: "error",
      reason: searchParams.get("error_description") ?? error,
    });
  }
  if (!code || !state) {
    return redirectWith(req, {
      tiktok_oauth: "error",
      reason: "Missing code or state in TikTok callback",
    });
  }

  // CSRF: compare returned state to the cookie we set in /start.
  const cookieState = req.cookies.get(TIKTOK_OAUTH_STATE_COOKIE)?.value;
  if (!cookieState || cookieState !== state) {
    return redirectWith(req, {
      tiktok_oauth: "error",
      reason: "OAuth state mismatch — possible CSRF or expired session",
    });
  }

  const accountId = state.split(":")[0];
  if (!accountId) {
    return redirectWith(req, {
      tiktok_oauth: "error",
      reason: "Malformed OAuth state",
    });
  }

  try {
    const token = await exchangeCodeForToken(code);
    await persistTokens(accountId, token);
  } catch (err) {
    return redirectWith(req, {
      tiktok_oauth: "error",
      reason: err instanceof Error ? err.message : "Token exchange failed",
    });
  }

  return redirectWith(req, {
    tiktok_oauth: "connected",
    accountId,
  });
}
