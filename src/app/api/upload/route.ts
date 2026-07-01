/**
 * POST /api/upload
 *
 * Handles multipart file uploads using the native Next.js App Router FormData
 * API (no multer required). Saves the file to the UPLOAD_DIR directory and
 * returns metadata the caller can attach to a post via /api/posts.
 *
 * Request:  multipart/form-data with a single field named "file"
 * Response: { filePath, filename, size, type }
 *
 * NOTE: Auth is intentionally skipped for MVP.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { env } from "@/lib/env";

// ── Allowed MIME types ────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
]);

/** 500 MB limit */
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

// ── POST /api/upload ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Next.js App Router parses multipart natively — no multer needed
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Failed to parse multipart form data" },
        { status: 400 }
      );
    }

    const fileEntry = formData.get("file");

    if (!fileEntry || typeof fileEntry === "string") {
      return NextResponse.json(
        { error: 'No file provided. Include a "file" field in the form data.' },
        { status: 400 }
      );
    }

    const file = fileEntry as File;

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${file.type}. Allowed types: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
        },
        { status: 415 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum allowed: ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
        },
        { status: 413 }
      );
    }

    // Build a unique filename to avoid collisions
    const ext = path.extname(file.name) || mimeToExt(file.type);
    const uniqueFilename = `${uuidv4()}${ext}`;

    // Ensure the upload directory exists
    const uploadDir = env.UPLOAD_DIR;
    await fs.mkdir(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, uniqueFilename);

    // Write the file to disk
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    return NextResponse.json(
      {
        filePath,
        filename: file.name,
        size: file.size,
        type: file.type,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/upload]", err);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive a file extension from a MIME type as a fallback when the original
 * filename has no extension.
 */
function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-msvideo": ".avi",
  };
  return map[mimeType] ?? "";
}
