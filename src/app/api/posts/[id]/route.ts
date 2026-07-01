/**
 * GET    /api/posts/[id]  — Fetch a single post with its assets and publish attempts.
 * DELETE /api/posts/[id]  — Cancel the queued BullMQ job (if any) and delete the post.
 *
 * NOTE: Auth is intentionally skipped for MVP.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { removeJob } from "@/lib/queue";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ── GET /api/posts/[id] ───────────────────────────────────────────────────────

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        assets: { orderBy: { order: "asc" } },
        attempts: { orderBy: { createdAt: "desc" } },
        account: true,
      },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json(post);
  } catch (err) {
    console.error("[GET /api/posts/[id]]", err);
    return NextResponse.json({ error: "Failed to fetch post" }, { status: 500 });
  }
}

// ── DELETE /api/posts/[id] ────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const post = await prisma.post.findUnique({
      where: { id },
      select: { id: true, status: true, bullJobId: true },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Guard: do not allow deletion of a post that is actively being published
    if (post.status === "processing") {
      return NextResponse.json(
        { error: "Cannot delete a post that is currently being published" },
        { status: 409 }
      );
    }

    // Cancel the BullMQ job if one exists
    if (post.bullJobId) {
      try {
        await removeJob(post.bullJobId);
      } catch (queueErr) {
        // Log but proceed — the post record should still be deleted
        console.warn("[DELETE /api/posts/[id]] Failed to remove queue job", queueErr);
      }
    }

    // Cascade deletes PostAsset and PublishAttempt rows (defined in schema)
    await prisma.post.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/posts/[id]]", err);
    return NextResponse.json({ error: "Failed to delete post" }, { status: 500 });
  }
}
