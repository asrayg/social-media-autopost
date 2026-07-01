/**
 * Public surface of the official TikTok Content Posting API integration.
 *
 * Usage (see src/automation/tiktok.ts for the carousel routing):
 *   import { getValidAccessToken, publishPhotoCarousel } from "@/integrations/tiktok";
 */

export * from "./types";
export {
  TIKTOK_AUTHORIZE_URL,
  TIKTOK_TOKEN_URL,
  TIKTOK_SCOPES,
  buildAuthorizeUrl,
  isTokenExpired,
  expiryFromSeconds,
  requireTikTokConfig,
  resolveRedirectUri,
  exchangeCodeForToken,
  refreshAccessToken,
  persistTokens,
  getValidAccessToken,
} from "./oauth";
export {
  PHOTO_INIT_URL,
  VIDEO_INIT_URL,
  STATUS_FETCH_URL,
  publishPhotoCarousel,
  publishVideo,
  fetchPublishStatus,
  pollUntilDone,
} from "./contentPosting";
