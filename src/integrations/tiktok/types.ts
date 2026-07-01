/**
 * TypeScript types for the official TikTok Content Posting API (v2).
 *
 * These model the JSON request/response shapes of the endpoints under
 * https://open.tiktokapis.com/v2/*. TikTok occasionally adjusts field names and
 * enum values, so every response type keeps an index signature / optional shape
 * to stay forward-compatible, and the module is written defensively.
 *
 * References:
 *   - OAuth:        https://developers.tiktok.com/doc/oauth-user-access-token-management
 *   - Content post: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 *   - Photo post:   https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
 *   - Status fetch: https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
 */

// ── OAuth ───────────────────────────────────────────────────────────────────

/** Successful token-exchange / refresh response from /v2/oauth/token/. */
export interface TikTokTokenResponse {
  access_token: string;
  /** Seconds until `access_token` expires (typically 86400 = 24h). */
  expires_in: number;
  refresh_token: string;
  /** Seconds until `refresh_token` expires (typically 365 days). */
  refresh_expires_in: number;
  /** Granted scopes, comma-separated. */
  scope: string;
  token_type: string;
  /** Stable per-user identifier for the authorized TikTok account. */
  open_id: string;
  // Error fields are present on failures instead of the above.
  error?: string;
  error_description?: string;
  log_id?: string;
}

/** Parameters used to build the authorize URL. */
export interface AuthorizeUrlParams {
  clientKey: string;
  redirectUri: string;
  /** Scopes to request (joined with commas per TikTok's spec). */
  scopes: readonly string[];
  /** CSRF state value echoed back to the callback. */
  state: string;
  /** Optional PKCE code challenge (S256). */
  codeChallenge?: string;
}

// ── Content posting: shared ─────────────────────────────────────────────────

export type PrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export type PostSource = "PULL_FROM_URL" | "FILE_UPLOAD";

export interface PostInfo {
  title?: string;
  description?: string;
  privacy_level: PrivacyLevel;
  disable_comment?: boolean;
  disable_duet?: boolean;
  disable_stitch?: boolean;
  /** PHOTO only: auto-add recommended music to the carousel. */
  auto_add_music?: boolean;
  /** VIDEO only: mark as branded content / your brand. */
  brand_content_toggle?: boolean;
  brand_organic_toggle?: boolean;
}

/** Envelope shared by every TikTok API response. */
export interface TikTokApiError {
  code: string; // "ok" on success
  message: string;
  log_id: string;
}

// ── PHOTO init (/v2/post/publish/content/init/) ─────────────────────────────

export interface PhotoSourceInfoPullFromUrl {
  source: "PULL_FROM_URL";
  photo_cover_index?: number;
  /** Publicly reachable image URLs from a verified domain. */
  photo_images: string[];
}

export interface PhotoSourceInfoFileUpload {
  source: "FILE_UPLOAD";
  photo_cover_index?: number;
  /** Number of images that will be uploaded via the returned upload URLs. */
  photo_image_count?: number;
}

export type PhotoSourceInfo =
  | PhotoSourceInfoPullFromUrl
  | PhotoSourceInfoFileUpload;

export interface PhotoInitRequest {
  post_info: PostInfo;
  source_info: PhotoSourceInfo;
  post_mode: "DIRECT_POST" | "MEDIA_UPLOAD";
  media_type: "PHOTO";
}

// ── VIDEO init (/v2/post/publish/video/init/) ───────────────────────────────

export interface VideoSourceInfoPullFromUrl {
  source: "PULL_FROM_URL";
  video_url: string;
}

export interface VideoSourceInfoFileUpload {
  source: "FILE_UPLOAD";
  video_size: number;
  chunk_size: number;
  total_chunk_count: number;
}

export type VideoSourceInfo =
  | VideoSourceInfoPullFromUrl
  | VideoSourceInfoFileUpload;

export interface VideoInitRequest {
  post_info: PostInfo;
  source_info: VideoSourceInfo;
}

/** Shape returned inside `data` by the init endpoints. */
export interface InitResponseData {
  publish_id: string;
  /** Present for FILE_UPLOAD (video, or single-image cases). */
  upload_url?: string;
  /** Present for PHOTO FILE_UPLOAD — one upload URL per image, in order. */
  upload_urls?: string[];
}

export interface InitResponse {
  data: InitResponseData;
  error: TikTokApiError;
}

// ── Status fetch (/v2/post/publish/status/fetch/) ───────────────────────────

export type PublishStatus =
  | "PROCESSING_UPLOAD"
  | "PROCESSING_DOWNLOAD"
  | "SEND_TO_USER_INBOX"
  | "PUBLISH_COMPLETE"
  | "FAILED";

export interface StatusFetchData {
  status: PublishStatus | string;
  /** Present when status === "FAILED". */
  fail_reason?: string;
  /** IDs of successfully published posts, when available. */
  publicaly_available_post_id?: string[];
  uploaded_bytes?: number;
  downloaded_bytes?: number;
}

export interface StatusFetchResponse {
  data: StatusFetchData;
  error: TikTokApiError;
}

// ── High-level publish inputs ───────────────────────────────────────────────

/**
 * Input to `publishPhotoCarousel`. Provide EITHER `imageUrls` (PULL_FROM_URL,
 * the officially documented reliable path — URLs must be on a domain verified
 * in the TikTok developer console) OR `filePaths` (FILE_UPLOAD of local files).
 * When both are provided, `imageUrls` wins.
 */
export interface PublishPhotoInput {
  accessToken: string;
  caption: string;
  /** Optional short title shown above the carousel. */
  title?: string;
  imageUrls?: string[];
  filePaths?: string[];
  coverIndex?: number;
  privacyLevel?: PrivacyLevel;
  disableComment?: boolean;
  autoAddMusic?: boolean;
}

export interface PublishVideoInput {
  accessToken: string;
  caption: string;
  title?: string;
  videoUrl?: string;
  filePath?: string;
  privacyLevel?: PrivacyLevel;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
}

export interface PublishResult {
  publishId: string;
  status: PublishStatus | string;
  postIds?: string[];
}
