/**
 * OAuth 2.0 (v2) for the official TikTok Content Posting API.
 *
 * Flow:
 *   1. Redirect the account owner to `buildAuthorizeUrl(...)`
 *      (https://www.tiktok.com/v2/auth/authorize/).
 *   2. TikTok redirects back to our callback with `?code=...&state=...`.
 *   3. `exchangeCodeForToken(code)` swaps the code for access/refresh tokens.
 *   4. Tokens are persisted on the SocialAccount row.
 *   5. `getValidAccessToken(account)` returns a non-expired access token,
 *      transparently refreshing (via `refreshAccessToken`) and persisting when
 *      the stored one is past (or near) its expiry.
 *
 * All HTTP uses the global `fetch` (Node 18+/Next 15) — no extra deps.
 */

import type { SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import type { AuthorizeUrlParams, TikTokTokenResponse } from "./types";

// ── Endpoints & scopes ──────────────────────────────────────────────────────

export const TIKTOK_AUTHORIZE_URL =
  "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

/**
 * Scopes required to publish content (photos + videos) via Direct Post.
 *
 *   user.info.basic — read basic profile / open_id (always required)
 *   video.publish   — publish content directly to the user's profile
 *   video.upload    — upload media to the user's TikTok inbox (draft)
 *
 * NOTE: TikTok bundles PHOTO carousel posting under the same "Content Posting
 * API" product as video. There is no separate `photo.*` scope — `video.publish`
 * covers photo Direct Post. Your app must be approved for these scopes in the
 * TikTok developer console before live posting works. See docs/TIKTOK_API.md.
 */
export const TIKTOK_SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
] as const;

/** Refresh a token this many ms BEFORE its real expiry, to avoid edge races. */
const EXPIRY_SKEW_MS = 60_000; // 1 minute

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * Build the TikTok v2 authorize URL. Pure function — safe to unit test.
 *
 * TikTok expects scopes as a single comma-separated `scope` query param.
 */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const url = new URL(TIKTOK_AUTHORIZE_URL);
  url.searchParams.set("client_key", params.clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scopes.join(","));
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  if (params.codeChallenge) {
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

/**
 * True when a token with the given expiry should be treated as expired.
 * Applies a small negative skew so we refresh slightly early. Pure function.
 *
 * A `null`/`undefined` expiry is treated as expired (force refresh).
 */
export function isTokenExpired(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
  skewMs: number = EXPIRY_SKEW_MS,
): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - skewMs <= now.getTime();
}

/** Compute an absolute expiry Date from an `expires_in` (seconds) value. */
export function expiryFromSeconds(
  expiresInSeconds: number,
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + expiresInSeconds * 1000);
}

// ── Config resolution ───────────────────────────────────────────────────────

/** Throw a clear error if TikTok API credentials are not configured. */
export function requireTikTokConfig(): {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientKey = env.TIKTOK_CLIENT_KEY;
  const clientSecret = env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error(
      "TikTok Content Posting API is not configured. Set TIKTOK_CLIENT_KEY and " +
        "TIKTOK_CLIENT_SECRET (and optionally TIKTOK_REDIRECT_URI) in your .env. " +
        "See docs/TIKTOK_API.md.",
    );
  }
  return {
    clientKey,
    clientSecret,
    redirectUri: resolveRedirectUri(),
  };
}

/** The registered OAuth redirect URI (env override, else derived from base URL). */
export function resolveRedirectUri(): string {
  if (env.TIKTOK_REDIRECT_URI) return env.TIKTOK_REDIRECT_URI;
  // Fall back to the canonical deployment URL + the callback path.
  const base = env.NEXTAUTH_URL.replace(/\/$/, "");
  return `${base}/api/tiktok/oauth/callback`;
}

// ── Token exchange / refresh ────────────────────────────────────────────────

async function postTokenForm(
  body: Record<string, string>,
): Promise<TikTokTokenResponse> {
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: new URLSearchParams(body).toString(),
  });

  const json = (await res.json().catch(() => ({}))) as TikTokTokenResponse;

  if (!res.ok || json.error) {
    throw new Error(
      `TikTok token endpoint failed (${res.status}): ` +
        `${json.error ?? "unknown_error"} — ${json.error_description ?? ""}`,
    );
  }
  if (!json.access_token) {
    throw new Error("TikTok token endpoint returned no access_token");
  }
  return json;
}

/** Exchange an authorization `code` for tokens. */
export async function exchangeCodeForToken(
  code: string,
  opts?: { redirectUri?: string; codeVerifier?: string },
): Promise<TikTokTokenResponse> {
  const cfg = requireTikTokConfig();
  const body: Record<string, string> = {
    client_key: cfg.clientKey,
    client_secret: cfg.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: opts?.redirectUri ?? cfg.redirectUri,
  };
  if (opts?.codeVerifier) body.code_verifier = opts.codeVerifier;
  return postTokenForm(body);
}

/** Obtain a fresh access token from a refresh token. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<TikTokTokenResponse> {
  const cfg = requireTikTokConfig();
  return postTokenForm({
    client_key: cfg.clientKey,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

// ── Persistence helpers ─────────────────────────────────────────────────────

/** Persist a token response onto a SocialAccount row. */
export async function persistTokens(
  accountId: string,
  token: TikTokTokenResponse,
  now: Date = new Date(),
): Promise<void> {
  await prisma.socialAccount.update({
    where: { id: accountId },
    data: {
      apiAccessToken: token.access_token,
      apiRefreshToken: token.refresh_token,
      apiTokenExpiresAt: expiryFromSeconds(token.expires_in, now),
      apiScope: token.scope,
      apiOpenId: token.open_id,
      status: "active",
    },
  });
}

/**
 * Return a valid (non-expired) access token for `account`, refreshing and
 * persisting new tokens when the stored access token is missing or expired.
 *
 * Throws an actionable error when the account has never connected to the API.
 */
export async function getValidAccessToken(
  account: Pick<
    SocialAccount,
    "id" | "apiAccessToken" | "apiRefreshToken" | "apiTokenExpiresAt"
  >,
): Promise<string> {
  if (!account.apiAccessToken && !account.apiRefreshToken) {
    throw new Error(
      "Connect this TikTok account to the Content Posting API first: visit " +
        `/api/tiktok/oauth/start?accountId=${account.id}`,
    );
  }

  if (account.apiAccessToken && !isTokenExpired(account.apiTokenExpiresAt)) {
    return account.apiAccessToken;
  }

  if (!account.apiRefreshToken) {
    throw new Error(
      "TikTok API access token is expired and no refresh token is stored. " +
        `Re-connect the account: /api/tiktok/oauth/start?accountId=${account.id}`,
    );
  }

  const refreshed = await refreshAccessToken(account.apiRefreshToken);
  await persistTokens(account.id, refreshed);
  return refreshed.access_token;
}
