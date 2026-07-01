import { describe, it, expect } from "vitest";
import {
  buildAuthorizeUrl,
  isTokenExpired,
  expiryFromSeconds,
  TIKTOK_AUTHORIZE_URL,
  TIKTOK_SCOPES,
} from "@/integrations/tiktok/oauth";

describe("buildAuthorizeUrl", () => {
  const url = buildAuthorizeUrl({
    clientKey: "test_key",
    redirectUri: "http://localhost:3000/api/tiktok/oauth/callback",
    scopes: TIKTOK_SCOPES,
    state: "acct123:nonce",
  });
  const parsed = new URL(url);

  it("targets the TikTok v2 authorize endpoint", () => {
    expect(url.startsWith(TIKTOK_AUTHORIZE_URL)).toBe(true);
  });

  it("sets the required query params", () => {
    expect(parsed.searchParams.get("client_key")).toBe("test_key");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("state")).toBe("acct123:nonce");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/tiktok/oauth/callback",
    );
  });

  it("joins scopes with commas per TikTok's spec", () => {
    expect(parsed.searchParams.get("scope")).toBe(
      "user.info.basic,video.publish,video.upload",
    );
  });

  it("includes PKCE params only when a code challenge is supplied", () => {
    expect(parsed.searchParams.get("code_challenge")).toBeNull();
    const withPkce = new URL(
      buildAuthorizeUrl({
        clientKey: "k",
        redirectUri: "http://x/cb",
        scopes: ["user.info.basic"],
        state: "s",
        codeChallenge: "abc",
      }),
    );
    expect(withPkce.searchParams.get("code_challenge")).toBe("abc");
    expect(withPkce.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("isTokenExpired", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("treats null/undefined expiry as expired", () => {
    expect(isTokenExpired(null, now)).toBe(true);
    expect(isTokenExpired(undefined, now)).toBe(true);
  });

  it("returns false for a token comfortably in the future", () => {
    const future = new Date(now.getTime() + 60 * 60 * 1000); // +1h
    expect(isTokenExpired(future, now)).toBe(false);
  });

  it("returns true for a token already past expiry", () => {
    const past = new Date(now.getTime() - 1000);
    expect(isTokenExpired(past, now)).toBe(true);
  });

  it("refreshes early via the skew window", () => {
    // 30s in the future but with default 60s skew → considered expired.
    const soon = new Date(now.getTime() + 30_000);
    expect(isTokenExpired(soon, now)).toBe(true);
    // With a smaller skew it is still valid.
    expect(isTokenExpired(soon, now, 5_000)).toBe(false);
  });
});

describe("expiryFromSeconds", () => {
  it("adds the given seconds to `now`", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(expiryFromSeconds(86_400, now).toISOString()).toBe(
      "2026-01-02T00:00:00.000Z",
    );
  });
});
