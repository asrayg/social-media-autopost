"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, format } from "date-fns";
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ImageIcon,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import type { Post } from "@/lib/types";
import { cn, truncate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// ── Platform accent dot ───────────────────────────────────────────────────────

function PlatformDot({ platform }: { platform: string }) {
  const dot =
    platform === "instagram"
      ? "bg-gradient-to-br from-pink-500 to-orange-400"
      : platform === "tiktok"
      ? "bg-zinc-900"
      : "bg-zinc-400";
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", dot)}
      aria-hidden="true"
    />
  );
}

// ── Type badge ────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="capitalize">
      {type}
    </Badge>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatScheduledTime(isoString: string): string {
  const date = new Date(isoString);
  const distance = formatDistanceToNow(date, { addSuffix: true });
  const absolute = format(date, "MMM d, yyyy 'at' h:mm a");
  return `${absolute} · ${distance}`;
}

// ── PostCard ──────────────────────────────────────────────────────────────────

export interface PostCardProps {
  post: Post;
  /** Called after a successful action so the parent can refresh its list. */
  onMutate?: () => void;
}

export function PostCard({ post, onMutate }: PostCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    setBusy("retry");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Retry failed");
      }
      onMutate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (!confirm("Cancel and delete this scheduled post?")) return;
    setBusy("cancel");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Cancel failed");
      }
      onMutate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusy(null);
    }
  }

  function handleView() {
    router.push(`/posts/${post.id}`);
  }

  const firstAsset = post.assets?.[0];
  const hasThumb =
    firstAsset?.type === "image" &&
    (firstAsset.processedPath ?? firstAsset.filePath);

  return (
    <Card className="group flex flex-col overflow-hidden p-0">
      {/* Media thumbnail area */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface">
        {hasThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/assets/${encodeURIComponent(firstAsset!.processedPath ?? firstAsset!.filePath)}`}
            alt="Post thumbnail"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
            <ImageIcon className="h-8 w-8" strokeWidth={1.25} />
          </div>
        )}

        {/* Status badge overlay */}
        <div className="absolute left-3 top-3">
          <Badge status={post.status} className="shadow-soft backdrop-blur">
            {post.status}
          </Badge>
        </div>
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Header: platform + account + type */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <PlatformDot platform={post.platform} />
            <span className="truncate text-sm font-medium text-foreground">
              @{post.account?.username ?? "unknown"}
            </span>
          </div>
          <TypeBadge type={post.type} />
        </div>

        {/* Caption */}
        <p className="line-clamp-2 flex-1 text-sm leading-relaxed text-muted-foreground">
          {truncate(post.caption, 120)}
        </p>

        {/* Time / status detail */}
        {post.scheduledAt && post.status === "scheduled" && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            <span className="truncate">{formatScheduledTime(post.scheduledAt)}</span>
          </p>
        )}
        {post.status === "posted" && post.updatedAt && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <span className="truncate">
              Posted {formatDistanceToNow(new Date(post.updatedAt), { addSuffix: true })}
            </span>
          </p>
        )}
        {post.status === "failed" && post.errorMessage && (
          <p
            className="truncate rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-700"
            title={post.errorMessage}
          >
            {post.errorMessage}
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-700">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="mt-auto flex items-center gap-2 pt-1">
          {post.status === "failed" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={busy !== null}
              className="flex-1"
            >
              {busy === "retry" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RotateCcw />
              )}
              {busy === "retry" ? "Retrying" : "Retry"}
            </Button>
          )}
          {post.status === "scheduled" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={busy !== null}
              className="flex-1 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
            >
              {busy === "cancel" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <X />
              )}
              {busy === "cancel" ? "Cancelling" : "Cancel"}
            </Button>
          )}
          <Button
            variant="subtle"
            size="sm"
            onClick={handleView}
            disabled={busy !== null}
            className="flex-1"
          >
            View
            <ArrowUpRight />
          </Button>
        </div>
      </div>
    </Card>
  );
}
