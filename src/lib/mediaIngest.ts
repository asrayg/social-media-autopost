/**
 * Media ingestion from public URLs.
 *
 * Lets callers supply a public media URL (a direct image/video link, or a
 * public Google Drive share link) instead of uploading a local file. The bytes
 * are downloaded into `UPLOAD_DIR` under a uuid filename, mirroring what
 * /api/upload produces for a local upload.
 *
 * Uses only Node built-ins (global `fetch`, `fs`) — no extra dependencies.
 */

import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { env } from "@/lib/env";

// ── Types ───────────────────────────────────────────────────────────────────

export interface IngestedAsset {
  /** Absolute path of the downloaded file on disk. */
  filePath: string;
  /** Original / inferred filename (with extension). */
  filename: string;
  /** Size in bytes. */
  size: number;
  /** Content-Type of the downloaded media. */
  mimeType: string;
  /** Media kind. */
  type: "image" | "video";
  /** Position within a batch (0-based). */
  order: number;
}

// ── Limits & MIME maps ──────────────────────────────────────────────────────

/** 650 MB — matches the largest platform video limit (Instagram). */
const MAX_MEDIA_SIZE_BYTES = 650 * 1024 * 1024;

/** Map a MIME type to a file extension. */
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/tiff": ".tiff",
  "image/avif": ".avif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-msvideo": ".avi",
  "video/x-matroska": ".mkv",
};

/** Extensions we recognise as video (used when Content-Type is unhelpful). */
const VIDEO_EXTS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".avi",
  ".mkv",
  ".m4v",
  ".mpeg",
  ".mpg",
]);

// ── Google Drive URL normalization ──────────────────────────────────────────

/**
 * Convert a Google Drive share link into a direct-download URL.
 *
 * Handles the common share shapes:
 *   - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 *   - https://drive.google.com/open?id=FILE_ID
 *   - https://drive.google.com/uc?export=download&id=FILE_ID
 *
 * @returns a normalized `https://drive.google.com/uc?export=download&id=FILE_ID`
 *          URL, or `null` when the input is not a Google Drive URL (the caller
 *          then treats it as a plain direct URL).
 */
export function normalizeGoogleDriveUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const isDriveHost =
    host === "drive.google.com" ||
    host === "drive.usercontent.google.com" ||
    host === "docs.google.com";
  if (!isDriveHost) {
    return null;
  }

  const fileId = extractDriveFileId(parsed);
  if (!fileId) {
    return null;
  }

  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/** Pull the Drive file id out of the various URL shapes. */
function extractDriveFileId(parsed: URL): string | null {
  // /file/d/FILE_ID/view  or  /file/d/FILE_ID
  const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
  if (fileMatch?.[1]) {
    return fileMatch[1];
  }

  // /document/d/FILE_ID, /presentation/d/FILE_ID, etc. (docs.google.com)
  const docMatch = parsed.pathname.match(/\/d\/([^/]+)/);
  if (docMatch?.[1]) {
    return docMatch[1];
  }

  // ?id=FILE_ID  (open?id=…, uc?id=…, download?id=…)
  const idParam = parsed.searchParams.get("id");
  if (idParam) {
    return idParam;
  }

  return null;
}

// ── Ingestion ───────────────────────────────────────────────────────────────

/**
 * Download a single public URL into UPLOAD_DIR and return its metadata.
 *
 * @param url    A direct media URL or a public Google Drive share link.
 * @param index  Position within a batch (used as the returned `order`).
 */
export async function ingestUrl(
  url: string,
  index = 0
): Promise<IngestedAsset> {
  if (!url || typeof url !== "string" || url.trim().length === 0) {
    throw new Error("A non-empty media URL is required.");
  }

  const trimmed = url.trim();
  const driveUrl = normalizeGoogleDriveUrl(trimmed);
  const isDrive = driveUrl !== null;
  const fetchUrl = driveUrl ?? trimmed;

  const { response, dispositionName } = await fetchMediaResponse(
    fetchUrl,
    isDrive
  );

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  // Reject HTML — usually a private/blocked Drive file or an error page.
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    throw new Error(
      "URL did not return a media file (got text/html). Make sure the Google " +
        "Drive link is shared publicly ('Anyone with the link')."
    );
  }

  // Read the bytes. `arrayBuffer()` follows the (already-followed) redirects.
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length === 0) {
    throw new Error(`Downloaded file is empty (from ${trimmed}).`);
  }
  if (buffer.length > MAX_MEDIA_SIZE_BYTES) {
    throw new Error(
      `Media too large: ${(buffer.length / 1024 / 1024).toFixed(1)} MB. ` +
        `Maximum allowed: ${MAX_MEDIA_SIZE_BYTES / 1024 / 1024} MB.`
    );
  }

  // Guard against HTML that slipped past the Content-Type check.
  if (looksLikeHtml(buffer)) {
    throw new Error(
      "URL did not return a media file (got an HTML page). Make sure the " +
        "Google Drive link is shared publicly ('Anyone with the link')."
    );
  }

  // Resolve a filename (prefer Content-Disposition, then URL path).
  const urlName = safeBasenameFromUrl(fetchUrl);
  const originalName = dispositionName || urlName || "download";

  // Resolve extension: Content-Type first, then any filename we found.
  const extFromMime = contentType ? MIME_TO_EXT[contentType] : undefined;
  const extFromName = path.extname(originalName).toLowerCase();
  const ext = extFromMime ?? (extFromName || "");

  // Determine media kind: video if the Content-Type is video/* or the resolved
  // extension is a known video type; otherwise default to image.
  const isVideo =
    contentType.startsWith("video/") ||
    VIDEO_EXTS.has(ext) ||
    VIDEO_EXTS.has(extFromName);
  const type: "image" | "video" = isVideo ? "video" : "image";

  const mimeType =
    contentType ||
    (type === "video" ? "video/mp4" : "image/jpeg");

  // Write to UPLOAD_DIR under a uuid filename.
  const uploadDir = env.UPLOAD_DIR;
  await fs.mkdir(uploadDir, { recursive: true });
  const storedName = `${uuidv4()}${ext}`;
  const filePath = path.join(uploadDir, storedName);
  await fs.writeFile(filePath, buffer);

  // Best-effort validation (non-fatal).
  await bestEffortValidate(filePath, type);

  return {
    filePath,
    filename: originalName,
    size: buffer.length,
    mimeType,
    type,
    order: index,
  };
}

/**
 * Ingest a batch of URLs, preserving order. Runs sequentially so downloads
 * don't contend for bandwidth and errors surface with a clear index.
 */
export async function ingestUrls(urls: string[]): Promise<IngestedAsset[]> {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("`urls` must be a non-empty array of strings.");
  }

  const assets: IngestedAsset[] = [];
  for (let i = 0; i < urls.length; i++) {
    assets.push(await ingestUrl(urls[i], i));
  }
  return assets;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Fetch a media URL, transparently handling Google Drive's large-file
 * virus-scan interstitial (an HTML confirmation page for files big enough that
 * Drive can't scan them).
 */
async function fetchMediaResponse(
  fetchUrl: string,
  isDrive: boolean
): Promise<{ response: Response; dispositionName: string | null }> {
  let response: Response;
  try {
    response = await fetch(fetchUrl, {
      redirect: "follow",
      headers: {
        // A UA header makes Drive less likely to serve an odd response.
        "user-agent":
          "Mozilla/5.0 (compatible; social-media-autopost/1.0; +https://localhost)",
      },
    });
  } catch (err) {
    throw new Error(
      `Failed to fetch media URL "${fetchUrl}": ${(err as Error).message}`
    );
  }

  if (response.status === 404 || response.status === 410) {
    throw new Error(
      `Media not found (HTTP ${response.status}) at "${fetchUrl}". ` +
        (isDrive
          ? "Check that the Google Drive file exists and is shared publicly."
          : "Check the URL.")
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Access denied (HTTP ${response.status}) for "${fetchUrl}". ` +
        (isDrive
          ? "The Google Drive file is private. Share it as 'Anyone with the link'."
          : "The resource requires authentication.")
    );
  }
  if (!response.ok) {
    throw new Error(
      `Failed to download media (HTTP ${response.status}) from "${fetchUrl}".`
    );
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  // Only Drive serves the virus-scan interstitial; for other hosts an HTML
  // body is simply an error and is handled by the caller.
  const isHtml =
    contentType === "text/html" || contentType === "application/xhtml+xml";
  if (!isDrive || !isHtml) {
    return { response, dispositionName: dispositionFilename(response) };
  }

  // ── Drive interstitial: parse the confirmation page and re-request. ────────
  const html = await response.text();
  const cookie = collectDownloadWarningCookie(response);
  const confirmUrl = buildDriveConfirmUrl(html, fetchUrl);

  if (!confirmUrl) {
    // No confirm token/form → the page is a real block (private / not found).
    throw new Error(
      "URL did not return a media file (got text/html). Make sure the Google " +
        "Drive link is shared publicly ('Anyone with the link')."
    );
  }

  let confirmed: Response;
  try {
    confirmed = await fetch(confirmUrl, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; social-media-autopost/1.0; +https://localhost)",
        ...(cookie ? { cookie } : {}),
      },
    });
  } catch (err) {
    throw new Error(
      `Failed to fetch Google Drive download after confirmation: ${
        (err as Error).message
      }`
    );
  }

  if (!confirmed.ok) {
    throw new Error(
      `Failed to download Google Drive file (HTTP ${confirmed.status}) after ` +
        "virus-scan confirmation."
    );
  }

  return { response: confirmed, dispositionName: dispositionFilename(confirmed) };
}

/**
 * Build the confirmed-download URL from Drive's interstitial HTML.
 *
 * Newer Drive serves a `<form ... action="https://drive.usercontent.google.com/download">`
 * with hidden inputs (id, export, confirm, uuid, at). Older Drive embeds a
 * `confirm=TOKEN` query param in a download link. We support both, plus a
 * fallback that reconstructs the usercontent URL from the file id + token.
 */
function buildDriveConfirmUrl(html: string, originalUrl: string): string | null {
  // 1) Form-based interstitial.
  const formMatch = html.match(
    /<form[^>]*\baction="([^"]*drive\.usercontent\.google\.com\/download[^"]*)"[^>]*>([\s\S]*?)<\/form>/i
  );
  if (formMatch) {
    const action = decodeHtml(formMatch[1]);
    const formBody = formMatch[2];
    const params = new URLSearchParams();
    const inputRe = /<input[^>]*\bname="([^"]+)"[^>]*\bvalue="([^"]*)"[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = inputRe.exec(formBody)) !== null) {
      params.set(m[1], decodeHtml(m[2]));
    }
    const query = params.toString();
    const sep = action.includes("?") ? "&" : "?";
    return query ? `${action}${sep}${query}` : action;
  }

  // 2) A confirm token somewhere in the page.
  const confirmMatch =
    html.match(/confirm=([0-9A-Za-z_\-]+)/) ??
    html.match(/["']?confirm["']?\s*[:=]\s*["']([0-9A-Za-z_\-]+)["']/);
  const idMatch =
    html.match(/name="id"\s+value="([^"]+)"/i) ??
    html.match(/[?&]id=([0-9A-Za-z_\-]+)/);
  const fileId = idMatch?.[1] ?? driveIdFromUrl(originalUrl);

  if (confirmMatch && fileId) {
    return (
      "https://drive.usercontent.google.com/download?" +
      `id=${encodeURIComponent(fileId)}&export=download&confirm=${encodeURIComponent(
        confirmMatch[1]
      )}`
    );
  }

  return null;
}

/** Extract the id from an already-normalized Drive URL. */
function driveIdFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("id");
  } catch {
    return null;
  }
}

/**
 * Collect Drive's `download_warning...` cookie (older interstitial flow) so it
 * can be echoed back on the confirmed request.
 */
function collectDownloadWarningCookie(response: Response): string | null {
  // Node's fetch exposes getSetCookie() for multiple Set-Cookie headers.
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const raw =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (() => {
          const single = response.headers.get("set-cookie");
          return single ? [single] : [];
        })();

  const pairs: string[] = [];
  for (const line of raw) {
    const first = line.split(";")[0]?.trim();
    if (first && /^download_warning/i.test(first)) {
      pairs.push(first);
    }
  }
  return pairs.length > 0 ? pairs.join("; ") : null;
}

/** Parse a filename out of a Content-Disposition header, if present. */
function dispositionFilename(response: Response): string | null {
  const cd = response.headers.get("content-disposition");
  if (!cd) return null;

  // filename*=UTF-8''name.ext  (RFC 5987)
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star?.[1]) {
    try {
      return path.basename(decodeURIComponent(star[1].replace(/^"|"$/g, "")));
    } catch {
      /* fall through */
    }
  }

  const plain = cd.match(/filename="?([^";]+)"?/i);
  if (plain?.[1]) {
    return path.basename(plain[1]);
  }
  return null;
}

/** Derive a sane filename from a URL path. */
function safeBasenameFromUrl(url: string): string | null {
  try {
    const p = new URL(url).pathname;
    const base = path.basename(p);
    if (!base || base === "/" || base === "download" || base === "uc") {
      return null;
    }
    return decodeURIComponent(base);
  } catch {
    return null;
  }
}

/** Cheap sniff for an HTML document in the first bytes of the buffer. */
function looksLikeHtml(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<head") ||
    head.startsWith("<!doctype")
  );
}

/** Minimal HTML entity decoding for attribute values. */
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, "/");
}

/**
 * Best-effort media validation using the existing processImage/processVideo
 * validators. Import failures or validation errors are logged, not thrown —
 * the ingested file is kept and later processing may still succeed.
 */
async function bestEffortValidate(
  filePath: string,
  type: "image" | "video"
): Promise<void> {
  try {
    if (type === "image") {
      const { validateImageFile } = await import("@/media/processImage");
      const result = await validateImageFile(filePath);
      if (!result.valid) {
        console.warn(
          `[mediaIngest] image validation warning for ${filePath}: ${result.error}`
        );
      }
    } else {
      const { validateVideoFile } = await import("@/media/processVideo");
      // "instagram" has the most permissive size limit (650MB) among platforms.
      const result = await validateVideoFile(filePath, "instagram");
      if (!result.valid) {
        console.warn(
          `[mediaIngest] video validation warning for ${filePath}: ${result.error}`
        );
      }
    }
  } catch (err) {
    console.warn(
      `[mediaIngest] validator unavailable for ${filePath}: ${
        (err as Error).message
      }`
    );
  }
}
