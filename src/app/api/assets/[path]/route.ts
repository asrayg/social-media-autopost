/**
 * GET /api/assets/[path]
 *
 * Serves a local media file (uploaded or processed) so the UI can render
 * thumbnails/previews. `path` is the URL-encoded absolute file path.
 *
 * SECURITY: only files inside UPLOAD_DIR or PROCESSED_DIR are served, to prevent
 * path-traversal reads of arbitrary files on disk.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { env } from "@/lib/env";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

interface RouteContext {
  params: Promise<{ path: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { path: encoded } = await context.params;
    const filePath = path.resolve(decodeURIComponent(encoded));

    // Confine reads to the upload/processed directories.
    const allowedRoots = [env.UPLOAD_DIR, env.PROCESSED_DIR].map((r) =>
      path.resolve(r)
    );
    const isAllowed = allowedRoots.some(
      (root) => filePath === root || filePath.startsWith(root + path.sep)
    );
    if (!isAllowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
