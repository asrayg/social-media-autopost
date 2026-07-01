/**
 * GET  /api/accounts  — List all social accounts.
 * POST /api/accounts  — Create a new social account record with a session path.
 *
 * NOTE: Auth is intentionally skipped for MVP.
 */

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { prisma } from "@/lib/db";
import { CreateAccountSchema } from "@/lib/validations";
import { env } from "@/lib/env";

// ── MVP placeholder — replace with session.user.id from NextAuth ──────────────
const MVP_USER_ID = process.env.MVP_USER_ID ?? "cldefaultuser000";

// ── GET /api/accounts ─────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  try {
    const accounts = await prisma.socialAccount.findMany({
      where: { userId: MVP_USER_ID },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(accounts);
  } catch (err) {
    console.error("[GET /api/accounts]", err);
    return NextResponse.json({ error: "Failed to list accounts" }, { status: 500 });
  }
}

// ── POST /api/accounts ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parseResult = CreateAccountSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error:
            parseResult.error.errors
              .map((e) => `${e.path.join(".")}: ${e.message}`)
              .join("; ") || "Validation failed",
        },
        { status: 422 }
      );
    }

    const { platform, username, sessionPath } = parseResult.data;

    // Derive session path from SESSIONS_DIR if none provided
    const resolvedSessionPath =
      sessionPath ?? path.join(env.SESSIONS_DIR, platform, username);

    // Check for duplicate (same user + platform + username)
    const existing = await prisma.socialAccount.findUnique({
      where: {
        userId_platform_username: {
          userId: MVP_USER_ID,
          platform,
          username,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        {
          error: `An account for @${username} on ${platform} already exists`,
        },
        { status: 409 }
      );
    }

    const account = await prisma.socialAccount.create({
      data: {
        userId: MVP_USER_ID,
        platform,
        username,
        sessionPath: resolvedSessionPath,
        status: "active",
      },
    });

    return NextResponse.json(account, { status: 201 });
  } catch (err) {
    console.error("[POST /api/accounts]", err);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
