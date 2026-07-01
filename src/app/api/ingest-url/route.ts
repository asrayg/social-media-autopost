/**
 * POST /api/ingest-url
 *
 * Ingests media from one or more public URLs (direct image/video links, or
 * public Google Drive share links) instead of a local file upload. Each URL is
 * downloaded into UPLOAD_DIR and returned with the same per-asset shape as
 * /api/upload (filePath, filename, size, mimeType, type) plus an `order`.
 *
 * Request:  application/json  { "urls": string[] }
 * Response: { assets: IngestedAsset[] }   (200)
 *           { error: string }             (400 / 422 / 500)
 *
 * NOTE: Auth is intentionally skipped for MVP (mirrors /api/upload).
 */

import { NextRequest, NextResponse } from "next/server";
import { ingestUrls } from "@/lib/mediaIngest";
import { ensureDirectoriesExist } from "@/lib/storage";

export async function POST(req: NextRequest) {
  // Parse JSON body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected { urls: string[] }." },
      { status: 400 }
    );
  }

  // Validate: non-empty array of strings.
  const urls = (body as { urls?: unknown })?.urls;
  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json(
      { error: "`urls` must be a non-empty array of strings." },
      { status: 400 }
    );
  }
  if (!urls.every((u) => typeof u === "string" && u.trim().length > 0)) {
    return NextResponse.json(
      { error: "Every entry in `urls` must be a non-empty string." },
      { status: 400 }
    );
  }

  try {
    // Ensure the upload directory (and siblings) exist before downloading.
    await ensureDirectoriesExist();

    const assets = await ingestUrls(urls as string[]);

    return NextResponse.json({ assets }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/ingest-url]", message);

    // Treat user-facing ingestion problems (bad URL, wrong type, private Drive
    // file, too large) as 422 Unprocessable Entity; anything unexpected as 500.
    const isUserError =
      /media file|shared publicly|not found|Access denied|private|too large|empty|Failed to fetch|Failed to download|HTTP \d/i.test(
        message
      );

    return NextResponse.json(
      { error: message },
      { status: isUserError ? 422 : 500 }
    );
  }
}
