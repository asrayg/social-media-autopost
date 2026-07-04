/**
 * GET  /api/posts  — List posts with optional pagination and filters.
 * POST /api/posts  — Create a new post, validate input, save to DB, schedule BullMQ job.
 *
 * NOTE: Auth is intentionally skipped for MVP. All endpoints are public.
 * Add middleware-based auth (NextAuth session check) before going to production.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addPostJob } from "@/lib/queue";
import { CreatePostSchema, ListPostsQuerySchema } from "@/lib/validations";

// ── MVP placeholder ───────────────────────────────────────────────────────────
// Replace with session.user.id from NextAuth once auth is added.
const MVP_USER_ID = process.env.MVP_USER_ID ?? "cldefaultuser000";

// ── GET /api/posts ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    const queryResult = ListPostsQuerySchema.safeParse({
      status: searchParams.get("status") ?? undefined,
      platform: searchParams.get("platform") ?? undefined,
      socialAccountId: searchParams.get("socialAccountId") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    if (!queryResult.success) {
      return NextResponse.json(
        { error: queryResult.error.errors[0]?.message ?? "Invalid query parameters" },
        { status: 400 }
      );
    }

    const { status, platform, socialAccountId, page, limit } = queryResult.data;
    const skip = (page - 1) * limit;

    const where = {
      // MVP: scope to MVP user — remove when real auth is in place
      userId: MVP_USER_ID,
      ...(status ? { status } : {}),
      ...(platform ? { platform } : {}),
      ...(socialAccountId ? { socialAccountId } : {}),
    };

    const [posts, total] = await prisma.$transaction([
      prisma.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          assets: { orderBy: { order: "asc" } },
          account: true,
        },
      }),
      prisma.post.count({ where }),
    ]);

    return NextResponse.json({
      data: posts,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("[GET /api/posts]", err);
    return NextResponse.json({ error: "Failed to list posts" }, { status: 500 });
  }
}

// ── POST /api/posts ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parseResult = CreatePostSchema.safeParse(body);
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

    const { socialAccountId, platform, type, caption, scheduledAt, assetPaths, options } =
      parseResult.data;

    // Verify the social account exists (and belongs to MVP user in production scope)
    const account = await prisma.socialAccount.findFirst({
      where: { id: socialAccountId },
    });

    if (!account) {
      return NextResponse.json(
        { error: `Social account ${socialAccountId} not found` },
        { status: 404 }
      );
    }

    if (account.platform !== platform) {
      return NextResponse.json(
        {
          error: `Account platform "${account.platform}" does not match post platform "${platform}"`,
        },
        { status: 422 }
      );
    }

    const scheduledAtDate = scheduledAt ? new Date(scheduledAt) : null;

    // Determine initial status
    const status = scheduledAtDate ? "scheduled" : "draft";

    // Create post + assets in a single transaction
    const post = await prisma.post.create({
      data: {
        userId: MVP_USER_ID,
        socialAccountId,
        platform,
        type,
        caption,
        scheduledAt: scheduledAtDate,
        status,
        options: options && Object.keys(options).length > 0 ? options : undefined,
        assets: {
          create: assetPaths.map((a) => ({
            filePath: a.filePath,
            type: a.type,
            order: a.order,
            mimeType: a.mimeType,
            sizeBytes: a.size,
          })),
        },
      },
      include: {
        assets: { orderBy: { order: "asc" } },
        account: true,
      },
    });

    // Enqueue BullMQ job for scheduled (or immediate) publishing
    if (status === "scheduled") {
      try {
        const job = await addPostJob(post.id, scheduledAtDate);
        await prisma.post.update({
          where: { id: post.id },
          data: { bullJobId: job.id ?? null },
        });
      } catch (queueErr) {
        console.error("[POST /api/posts] Failed to enqueue job", queueErr);
        // Post is saved; return 207 so the caller knows the job failed but the
        // post record exists. In production you might want a different strategy.
        return NextResponse.json(
          {
            ...post,
            _warning: "Post saved but failed to schedule job. Check Redis connection.",
          },
          { status: 207 }
        );
      }
    }

    return NextResponse.json(post, { status: 201 });
  } catch (err) {
    console.error("[POST /api/posts]", err);
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
}
