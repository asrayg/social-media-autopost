/**
 * TikTok Content Posting API (Direct Post) — photo carousels and videos.
 *
 * All HTTP goes through the global `fetch`. Endpoints:
 *   PHOTO init : POST /v2/post/publish/content/init/
 *   VIDEO init : POST /v2/post/publish/video/init/
 *   Status     : POST /v2/post/publish/status/fetch/
 *   (FILE_UPLOAD binaries are PUT to the upload_url(s) returned by init.)
 *
 * Two media sources are supported per TikTok's spec:
 *   - PULL_FROM_URL — TikTok downloads the media from public URLs you provide.
 *                     Requires the URL's domain to be verified in the developer
 *                     console. This is the officially documented, most reliable
 *                     path for PHOTO carousels.
 *   - FILE_UPLOAD   — you upload the raw bytes to URLs returned by init. Used
 *                     here for local asset files that have no public URL yet.
 *
 * Because our assets are local files, FILE_UPLOAD is the DEFAULT when only
 * `filePaths` are provided; PULL_FROM_URL is used when public `imageUrls` are
 * available (ties into the URL-ingestion feature). See docs/TIKTOK_API.md.
 *
 * TikTok tweaks field names over time; keep this module the single place to
 * adjust request/response shapes.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  InitResponse,
  PhotoInitRequest,
  PostInfo,
  PublishPhotoInput,
  PublishResult,
  PublishVideoInput,
  StatusFetchResponse,
  VideoInitRequest,
} from "./types";

// ── Endpoints ───────────────────────────────────────────────────────────────

const API_BASE = "https://open.tiktokapis.com/v2";
export const PHOTO_INIT_URL = `${API_BASE}/post/publish/content/init/`;
export const VIDEO_INIT_URL = `${API_BASE}/post/publish/video/init/`;
export const STATUS_FETCH_URL = `${API_BASE}/post/publish/status/fetch/`;

// ── Defaults / tuning ───────────────────────────────────────────────────────

const DEFAULT_PRIVACY = "SELF_ONLY" as const; // safest default; unaudited apps
// can only post as SELF_ONLY until approved for public posting.
const STATUS_POLL_INTERVAL_MS = 3_000;
const STATUS_POLL_TIMEOUT_MS = 5 * 60_000;
/** Chunk size for FILE_UPLOAD PUTs (10 MB — within TikTok's 5–64 MB range). */
const UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024;

// ── Low-level request helper ────────────────────────────────────────────────

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json; charset=UTF-8",
  };
}

async function postJson<T>(
  url: string,
  accessToken: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string; log_id?: string };
  };

  const errCode = json?.error?.code;
  if (!res.ok || (errCode && errCode !== "ok")) {
    throw new Error(
      `TikTok API ${url} failed (${res.status}): ` +
        `${errCode ?? "http_error"} — ${json?.error?.message ?? res.statusText} ` +
        `(log_id: ${json?.error?.log_id ?? "n/a"})`,
    );
  }
  return json as T;
}

function buildPostInfo(
  caption: string,
  overrides: Partial<PostInfo>,
): PostInfo {
  return {
    // TikTok caption/description is `title` for PHOTO and `title` too for the
    // combined content endpoint; we send both `title` and `description` where
    // supported so the caption is populated regardless of media_type.
    title: overrides.title ?? caption.slice(0, 90),
    description: caption,
    privacy_level: overrides.privacy_level ?? DEFAULT_PRIVACY,
    disable_comment: overrides.disable_comment ?? false,
    disable_duet: overrides.disable_duet ?? false,
    disable_stitch: overrides.disable_stitch ?? false,
    auto_add_music: overrides.auto_add_music,
    brand_content_toggle: overrides.brand_content_toggle,
    brand_organic_toggle: overrides.brand_organic_toggle,
  };
}

// ── FILE_UPLOAD binary transfer ─────────────────────────────────────────────

/**
 * Upload a whole local file to a TikTok-provided `upload_url` via a single
 * ranged PUT (files here — images — are well under the chunk limit). For very
 * large videos, split into `UPLOAD_CHUNK_SIZE` chunks with Content-Range.
 */
async function putFileToUploadUrl(
  uploadUrl: string,
  filePath: string,
  mimeType: string,
): Promise<void> {
  const data = await readFile(filePath);
  const total = data.byteLength;
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(total),
      "Content-Range": `bytes 0-${total - 1}/${total}`,
    },
    body: data,
  });
  if (!res.ok) {
    throw new Error(
      `TikTok FILE_UPLOAD PUT failed (${res.status}) for ${path.basename(
        filePath,
      )}: ${res.statusText}`,
    );
  }
}

function guessImageMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  return "image/jpeg";
}

// ── Init: PHOTO ─────────────────────────────────────────────────────────────

async function initPhotoPost(
  input: PublishPhotoInput,
): Promise<InitResponse["data"]> {
  const usePull = !!input.imageUrls && input.imageUrls.length > 0;
  const post_info = buildPostInfo(input.caption, {
    title: input.title,
    privacy_level: input.privacyLevel,
    disable_comment: input.disableComment,
    auto_add_music: input.autoAddMusic ?? true,
  });

  let request: PhotoInitRequest;
  if (usePull) {
    request = {
      post_info,
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: input.coverIndex ?? 0,
        photo_images: input.imageUrls!,
      },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    };
  } else {
    const count = input.filePaths?.length ?? 0;
    if (count === 0) {
      throw new Error(
        "publishPhotoCarousel requires either imageUrls (PULL_FROM_URL) or " +
          "filePaths (FILE_UPLOAD).",
      );
    }
    request = {
      post_info,
      source_info: {
        source: "FILE_UPLOAD",
        photo_cover_index: input.coverIndex ?? 0,
        photo_image_count: count,
      },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    };
  }

  const res = await postJson<InitResponse>(
    PHOTO_INIT_URL,
    input.accessToken,
    request,
  );
  return res.data;
}

// ── Public: publish a PHOTO carousel ────────────────────────────────────────

/**
 * Publish a native TikTok photo carousel (media_type PHOTO, DIRECT_POST) and
 * poll to completion. Returns the publish result or throws with TikTok's error.
 */
export async function publishPhotoCarousel(
  input: PublishPhotoInput,
): Promise<PublishResult> {
  const data = await initPhotoPost(input);
  if (!data?.publish_id) {
    throw new Error("TikTok photo init returned no publish_id");
  }

  // FILE_UPLOAD: push each local image to its returned upload URL, in order.
  const usingFileUpload = !(input.imageUrls && input.imageUrls.length > 0);
  if (usingFileUpload) {
    const urls = data.upload_urls ?? (data.upload_url ? [data.upload_url] : []);
    const files = input.filePaths ?? [];
    if (urls.length < files.length) {
      throw new Error(
        `TikTok returned ${urls.length} upload URL(s) for ${files.length} image(s). ` +
          "Adjust source_info in contentPosting.ts to match the current PHOTO " +
          "FILE_UPLOAD spec, or supply public imageUrls (PULL_FROM_URL) instead.",
      );
    }
    for (let i = 0; i < files.length; i++) {
      await putFileToUploadUrl(urls[i], files[i], guessImageMime(files[i]));
    }
  }

  return pollUntilDone(input.accessToken, data.publish_id);
}

// ── Init + publish: VIDEO (optional API path; browser path stays default) ────

async function initVideoPost(
  input: PublishVideoInput,
  fileSize?: number,
): Promise<InitResponse["data"]> {
  const post_info = buildPostInfo(input.caption, {
    title: input.title,
    privacy_level: input.privacyLevel,
    disable_comment: input.disableComment,
    disable_duet: input.disableDuet,
    disable_stitch: input.disableStitch,
  });

  let request: VideoInitRequest;
  if (input.videoUrl) {
    request = {
      post_info,
      source_info: { source: "PULL_FROM_URL", video_url: input.videoUrl },
    };
  } else {
    if (!input.filePath || fileSize == null) {
      throw new Error("publishVideo FILE_UPLOAD requires filePath + fileSize");
    }
    request = {
      post_info,
      source_info: {
        source: "FILE_UPLOAD",
        video_size: fileSize,
        chunk_size: Math.min(UPLOAD_CHUNK_SIZE, fileSize),
        total_chunk_count: Math.max(1, Math.ceil(fileSize / UPLOAD_CHUNK_SIZE)),
      },
    };
  }

  const res = await postJson<InitResponse>(
    VIDEO_INIT_URL,
    input.accessToken,
    request,
  );
  return res.data;
}

/**
 * Publish a video via the official API and poll to completion. The existing
 * browser-automation path in src/automation/tiktok.ts remains the default for
 * videos; this is provided for parity/optional use.
 */
export async function publishVideo(
  input: PublishVideoInput,
): Promise<PublishResult> {
  let fileSize: number | undefined;
  if (!input.videoUrl && input.filePath) {
    const buf = await readFile(input.filePath);
    fileSize = buf.byteLength;
  }

  const data = await initVideoPost(input, fileSize);
  if (!data?.publish_id) {
    throw new Error("TikTok video init returned no publish_id");
  }

  if (!input.videoUrl && input.filePath && data.upload_url) {
    await putFileToUploadUrl(data.upload_url, input.filePath, "video/mp4");
  }

  return pollUntilDone(input.accessToken, data.publish_id);
}

// ── Status polling ──────────────────────────────────────────────────────────

/** One-shot status fetch for a publish_id. */
export async function fetchPublishStatus(
  accessToken: string,
  publishId: string,
): Promise<StatusFetchResponse["data"]> {
  const res = await postJson<StatusFetchResponse>(
    STATUS_FETCH_URL,
    accessToken,
    { publish_id: publishId },
  );
  return res.data;
}

/**
 * Poll `status/fetch` until the post completes or fails. Throws on FAILED or on
 * timeout. Returns the final result on success.
 */
export async function pollUntilDone(
  accessToken: string,
  publishId: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<PublishResult> {
  const interval = opts?.intervalMs ?? STATUS_POLL_INTERVAL_MS;
  const deadline = Date.now() + (opts?.timeoutMs ?? STATUS_POLL_TIMEOUT_MS);

  // Terminal-success statuses. SEND_TO_USER_INBOX means it landed as a draft in
  // the user's inbox (expected for MEDIA_UPLOAD); PUBLISH_COMPLETE for DIRECT_POST.
  const successStatuses = new Set([
    "PUBLISH_COMPLETE",
    "SEND_TO_USER_INBOX",
  ]);

  while (Date.now() < deadline) {
    const data = await fetchPublishStatus(accessToken, publishId);
    const status = data.status;

    if (status === "FAILED") {
      throw new Error(
        `TikTok publish failed (publish_id ${publishId}): ` +
          `${data.fail_reason ?? "unknown reason"}`,
      );
    }
    if (successStatuses.has(status)) {
      return {
        publishId,
        status,
        postIds: data.publicaly_available_post_id,
      };
    }
    await sleep(interval);
  }

  throw new Error(
    `TikTok publish status polling timed out for publish_id ${publishId} ` +
      `after ${(STATUS_POLL_TIMEOUT_MS / 1000) | 0}s`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
