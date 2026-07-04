/**
 * POST /api/posts/batch — cross-post one piece of content to multiple accounts.
 *
 * Creates one Post per selected account, auto-resolving the post type per
 * platform from the shared media (text / image / carousel / reel / video / …).
 * Accounts whose platform can't accept the content are skipped with a reason.
 *
 * NOTE: Auth is intentionally skipped for MVP.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addPostJob } from "@/lib/queue";
import { BatchCreatePostSchema } from "@/lib/validations";
import { resolvePostTypeForPlatform, type Platform } from "@/lib/platforms";

const MVP_USER_ID = process.env.MVP_USER_ID ?? "cldefaultuser000";

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = BatchCreatePostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.errors
              .map((e) => `${e.path.join(".")}: ${e.message}`)
              .join("; ") || "Validation failed",
        },
        { status: 422 }
      );
    }

    const { socialAccountIds, caption, scheduledAt, assetPaths, options } = parsed.data;

    const accounts = await prisma.socialAccount.findMany({
      where: { id: { in: socialAccountIds }, userId: MVP_USER_ID },
    });

    const scheduledAtDate = scheduledAt ? new Date(scheduledAt) : null;
    const status = scheduledAtDate ? "scheduled" : "draft";
    const mediaKinds = assetPaths.map((a) => ({ type: a.type }));

    const created: unknown[] = [];
    const skipped: { accountId: string; platform?: string; reason: string }[] = [];

    for (const accountId of socialAccountIds) {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) {
        skipped.push({ accountId, reason: "account not found" });
        continue;
      }

      const type = resolvePostTypeForPlatform(account.platform as Platform, mediaKinds);
      if (!type) {
        skipped.push({
          accountId,
          platform: account.platform,
          reason: `${account.platform} can't accept this content (${
            mediaKinds.length === 0 ? "text only" : `${mediaKinds.length} media`
          })`,
        });
        continue;
      }

      const post = await prisma.post.create({
        data: {
          userId: MVP_USER_ID,
          socialAccountId: account.id,
          platform: account.platform,
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
        include: { assets: { orderBy: { order: "asc" } }, account: true },
      });

      if (status === "scheduled") {
        try {
          const job = await addPostJob(post.id, scheduledAtDate);
          await prisma.post.update({
            where: { id: post.id },
            data: { bullJobId: job.id ?? null },
          });
        } catch (queueErr) {
          console.error("[POST /api/posts/batch] enqueue failed", queueErr);
        }
      }

      created.push(post);
    }

    return NextResponse.json({ created, skipped }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/posts/batch]", err);
    return NextResponse.json({ error: "Failed to create posts" }, { status: 500 });
  }
}
