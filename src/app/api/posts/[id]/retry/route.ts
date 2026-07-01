/**
 * POST /api/posts/[id]/retry — Re-queue a failed post for publishing.
 *
 * Only posts with status "failed" can be retried. The post status is reset to
 * "scheduled" and a new BullMQ job is enqueued for immediate processing.
 *
 * NOTE: Auth is intentionally skipped for MVP.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addPostJob } from "@/lib/queue";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const post = await prisma.post.findUnique({
      where: { id },
      select: { id: true, status: true, scheduledAt: true },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.status !== "failed") {
      return NextResponse.json(
        {
          error: `Only failed posts can be retried. Current status: "${post.status}"`,
        },
        { status: 409 }
      );
    }

    // Reset error state and bump status back to "scheduled"
    const updated = await prisma.post.update({
      where: { id },
      data: {
        status: "scheduled",
        errorMessage: null,
        bullJobId: null,
      },
      include: {
        assets: { orderBy: { order: "asc" } },
        attempts: { orderBy: { createdAt: "desc" } },
        account: true,
      },
    });

    // Enqueue a new job — process immediately (no delay) regardless of original
    // scheduledAt because a retry should run as soon as possible.
    try {
      const job = await addPostJob(post.id, null);
      await prisma.post.update({
        where: { id },
        data: { bullJobId: job.id ?? null },
      });
    } catch (queueErr) {
      console.error("[POST /api/posts/[id]/retry] Failed to enqueue retry job", queueErr);
      // Revert status so the user can try again
      await prisma.post.update({
        where: { id },
        data: { status: "failed" },
      });
      return NextResponse.json(
        { error: "Post status reset but failed to enqueue job. Check Redis connection." },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[POST /api/posts/[id]/retry]", err);
    return NextResponse.json({ error: "Failed to retry post" }, { status: 500 });
  }
}
