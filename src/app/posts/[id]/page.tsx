export const dynamic = "force-dynamic";

/**
 * Post detail page — /posts/[id]
 *
 * Server component that fetches a single post with its assets and publish
 * attempt log, then renders the full detail view.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { ChevronRight, Film, ImageOff, Images } from "lucide-react";
import { prisma } from "@/lib/db";
import { AttemptLog } from "@/components/posts/AttemptLog";
import { RetryButton } from "./RetryButton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, getStatusColor } from "@/lib/utils";
import type { Post, PostAsset, PublishAttempt } from "@/lib/types";

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getPost(id: string): Promise<Post | null> {
  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      assets: { orderBy: { order: "asc" } },
      attempts: { orderBy: { createdAt: "desc" } },
      account: true,
    },
  });
  if (!post) return null;
  return post as unknown as Post;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function PlatformDot({ platform }: { platform: string }) {
  const cls =
    platform === "instagram"
      ? "bg-gradient-to-tr from-pink-500 via-rose-500 to-orange-400"
      : platform === "tiktok"
        ? "bg-zinc-900"
        : "bg-muted-foreground";
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", cls)}
      aria-hidden="true"
    />
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-4 py-2.5">
      <dt className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function AssetGrid({ assets }: { assets: PostAsset[] }) {
  if (assets.length === 0) {
    return (
      <EmptyState
        icon={ImageOff}
        title="No assets attached"
        description="This post doesn't have any media attached to it."
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {assets.map((asset, idx) => {
        const src = asset.processedPath ?? asset.filePath;
        const isVideo = asset.type === "video";

        return (
          <div
            key={asset.id}
            className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-surface"
          >
            {isVideo ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2 text-muted-foreground">
                <Film className="h-7 w-7" />
                <span className="w-full truncate text-center text-xs">
                  {asset.mimeType ?? "video"}
                </span>
                {asset.durationSecs != null && (
                  <span className="text-xs text-muted-foreground/70">
                    {Math.round(asset.durationSecs)}s
                  </span>
                )}
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/assets/${encodeURIComponent(src)}`}
                alt={`Asset ${idx + 1}`}
                className="h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-white/80">
                {asset.type}
              </span>
              {asset.sizeBytes != null && (
                <span className="text-[10px] text-white/70">
                  {(asset.sizeBytes / 1024).toFixed(0)} KB
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold text-foreground", valueClass)}>
        {value}
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PostDetailPage({ params }: PageProps) {
  const { id } = await params;
  const post = await getPost(id);

  if (!post) notFound();

  const createdAt = new Date(post.createdAt);
  const updatedAt = new Date(post.updatedAt);
  const scheduledAt = post.scheduledAt ? new Date(post.scheduledAt) : null;

  const attempts = (post.attempts ?? []) as PublishAttempt[];
  const successCount = attempts.filter(
    (a) => a.status === "success" || a.status === "posted_unknown"
  ).length;
  const failedCount = attempts.filter((a) =>
    (a.status as string).startsWith("failed")
  ).length;

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
        aria-label="Breadcrumb"
      >
        <Link href="/dashboard" className="transition-colors hover:text-foreground">
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-border-strong" />
        <Link href="/posts" className="transition-colors hover:text-foreground">
          Posts
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-border-strong" />
        <span className="font-medium text-foreground">Detail</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <PlatformDot platform={post.platform} />
            <h1 className="text-2xl font-semibold tracking-tight">Post Detail</h1>
            <Badge status={post.status} />
          </div>
          <p className="font-mono text-xs text-muted-foreground">{post.id}</p>
        </div>
        {post.status === "failed" && <RetryButton postId={post.id} />}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left / main column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Post info */}
          <Card>
            <CardHeader>
              <CardTitle>Post Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="divide-y divide-border">
                <DetailRow label="Platform">
                  <span className="inline-flex items-center gap-2 capitalize">
                    <PlatformDot platform={post.platform} />
                    {post.platform}
                  </span>
                </DetailRow>
                <DetailRow label="Type">
                  <span className="capitalize">{post.type}</span>
                </DetailRow>
                <DetailRow label="Status">
                  <Badge status={post.status} />
                </DetailRow>
                {scheduledAt && (
                  <DetailRow label="Scheduled">
                    {format(scheduledAt, "PPpp")}
                    <span className="ml-1 text-muted-foreground">
                      ({formatDistanceToNow(scheduledAt, { addSuffix: true })})
                    </span>
                  </DetailRow>
                )}
                <DetailRow label="Created">{format(createdAt, "PPpp")}</DetailRow>
                <DetailRow label="Updated">{format(updatedAt, "PPpp")}</DetailRow>
                {post.errorMessage && (
                  <DetailRow label="Error">
                    <span className="text-rose-600">{post.errorMessage}</span>
                  </DetailRow>
                )}
                {post.bullJobId && (
                  <DetailRow label="Job ID">
                    <span className="font-mono text-xs text-muted-foreground">
                      {post.bullJobId}
                    </span>
                  </DetailRow>
                )}
              </dl>

              <Separator />

              {/* Caption */}
              <div className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Caption
                </h3>
                <div className="rounded-lg border border-border bg-surface px-4 py-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {post.caption || (
                      <span className="text-muted-foreground">No caption.</span>
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Assets */}
          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0">
              <Images className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Assets</CardTitle>
              <Badge variant="secondary" className="ml-auto">
                {post.assets.length}
              </Badge>
            </CardHeader>
            <CardContent>
              <AssetGrid assets={post.assets} />
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <aside className="space-y-6">
          {/* Account info */}
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent>
              {post.account ? (
                <dl className="divide-y divide-border">
                  <DetailRow label="Username">
                    <span className="font-medium">@{post.account.username}</span>
                  </DetailRow>
                  <DetailRow label="Platform">
                    <span className="inline-flex items-center gap-2 capitalize">
                      <PlatformDot platform={post.account.platform} />
                      {post.account.platform}
                    </span>
                  </DetailRow>
                  <DetailRow label="Status">
                    <Badge status={post.account.status} />
                  </DetailRow>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">Account not found.</p>
              )}
            </CardContent>
          </Card>

          {/* Attempts summary */}
          <Card>
            <CardHeader>
              <CardTitle>Attempts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <SummaryRow label="Total attempts" value={attempts.length} />
              <Separator />
              <SummaryRow
                label="Successful"
                value={successCount}
                valueClass={getStatusColor("posted").text}
              />
              <SummaryRow
                label="Failed"
                value={failedCount}
                valueClass={getStatusColor("failed").text}
              />
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* Publish history timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Publish History</CardTitle>
        </CardHeader>
        <CardContent>
          <AttemptLog attempts={attempts} />
        </CardContent>
      </Card>
    </div>
  );
}
