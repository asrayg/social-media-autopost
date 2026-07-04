/**
 * Dashboard — server component.
 *
 * Shows high-level stats, upcoming scheduled posts, failed posts needing
 * attention, and connected social accounts. Auto-refreshes every 30 s via
 * the lightweight AutoRefresh client component.
 */

export const dynamic = "force-dynamic";

import Link from "next/link";
import { format, addDays, isWithinInterval, startOfDay } from "date-fns";
import {
  Plus,
  Layers,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ArrowUpRight,
  Users,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { AutoRefresh } from "@/components/layout/AutoRefresh";
import { FadeIn } from "@/components/dashboard/FadeIn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import type { Post, SocialAccount } from "@/lib/types";

// ── MVP user placeholder ───────────────────────────────────────────────────────
const MVP_USER_ID = process.env.MVP_USER_ID ?? "cldefaultuser000";

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getDashboardData() {
  const now = new Date();
  const sevenDaysLater = addDays(now, 7);

  const [allPosts, accounts] = await Promise.all([
    prisma.post.findMany({
      where: { userId: MVP_USER_ID },
      include: { assets: { orderBy: { order: "asc" }, take: 1 }, account: true },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.socialAccount.findMany({
      where: { userId: MVP_USER_ID },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const stats = {
    total: allPosts.length,
    scheduled: allPosts.filter((p) => p.status === "scheduled").length,
    posted: allPosts.filter((p) => p.status === "posted").length,
    failed: allPosts.filter((p) => p.status === "failed").length,
    draft: allPosts.filter((p) => p.status === "draft").length,
    processing: allPosts.filter((p) => p.status === "processing").length,
  };

  const upcoming = allPosts.filter(
    (p) =>
      p.status === "scheduled" &&
      p.scheduledAt &&
      isWithinInterval(new Date(p.scheduledAt), {
        start: startOfDay(now),
        end: sevenDaysLater,
      })
  );

  const failed = allPosts.filter((p) => p.status === "failed");

  return { stats, upcoming, failed, accounts };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PlatformDot({ platform }: { platform: string }) {
  const colors: Record<string, string> = {
    instagram: "bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400",
    tiktok: "bg-zinc-900",
    twitter: "bg-sky-400",
    linkedin: "bg-blue-600",
    reddit: "bg-orange-600",
    youtube: "bg-red-600",
  };
  return (
    <span
      className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${colors[platform] ?? "bg-zinc-400"}`}
      title={platform}
    />
  );
}

function SectionHeading({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {meta}
      </div>
      {action}
    </div>
  );
}

function UpcomingPostCard({ post }: { post: Post }) {
  const scheduledAt = post.scheduledAt ? new Date(post.scheduledAt) : null;

  return (
    <Link
      href={`/posts/${post.id}`}
      className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-soft transition-all hover:border-border-strong hover:shadow-card"
    >
      <PlatformDot platform={post.platform} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            @{post.account?.username ?? "unknown"}
          </p>
          {scheduledAt && (
            <span className="shrink-0 text-xs font-medium text-primary tabular-nums">
              {format(scheduledAt, "MMM d")}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{post.caption}</p>
        {scheduledAt && (
          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            {format(scheduledAt, "h:mm a")}
          </p>
        )}
      </div>
    </Link>
  );
}

function FailedPostRow({ post }: { post: Post }) {
  return (
    <Link
      href={`/posts/${post.id}`}
      className="group flex items-start gap-3 rounded-lg border border-rose-100 bg-rose-50/60 p-3.5 transition-all hover:border-rose-200 hover:bg-rose-50"
    >
      <PlatformDot platform={post.platform} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          @{post.account?.username ?? "unknown"}
        </p>
        {post.errorMessage && (
          <p className="mt-0.5 truncate text-xs text-rose-600">{post.errorMessage}</p>
        )}
      </div>
      <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-rose-600">
        Retry
        <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </span>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  let data: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  let dbError: string | null = null;

  try {
    data = await getDashboardData();
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  if (dbError || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <div className="inline-flex flex-col items-center gap-4 p-8 rounded-2xl border border-yellow-200 bg-yellow-50 max-w-lg mx-auto">
          <svg className="w-10 h-10 text-yellow-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <h2 className="text-lg font-semibold text-yellow-900">Database not connected</h2>
          <p className="text-sm text-yellow-700">
            Start PostgreSQL and Redis, then run <code className="bg-yellow-100 px-1 rounded">npx prisma migrate dev</code> to create the tables.
          </p>
          <pre className="text-xs text-left bg-white border border-yellow-200 rounded-lg p-3 w-full overflow-auto text-gray-600">
{`# 1. Start services
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password postgres
docker run -d -p 6379:6379 redis

# 2. Run migrations
npx prisma migrate dev --name init

# 3. Refresh this page`}
          </pre>
        </div>
      </div>
    );
  }

  const { stats, upcoming, failed, accounts } = data;
  const accountList = accounts as unknown as SocialAccount[];

  return (
    <>
      {/* Auto-refresh every 30 s */}
      <AutoRefresh intervalMs={30_000} />

      <div className="space-y-8">
        {/* Header */}
        <FadeIn className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Dashboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              An overview of your posts. Auto-refreshes every 30 seconds.
            </p>
          </div>
          <Button asChild>
            <Link href="/posts/new">
              <Plus className="h-4 w-4" />
              New Post
            </Link>
          </Button>
        </FadeIn>

        {/* Stats */}
        <FadeIn delay={0.05}>
          <section aria-label="Post statistics">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <Link href="/posts" className="rounded-xl">
                <Stat label="Total posts" value={stats.total} icon={Layers} />
              </Link>
              <Link href="/posts?status=scheduled" className="rounded-xl">
                <Stat label="Scheduled" value={stats.scheduled} icon={CalendarClock} />
              </Link>
              <Link href="/posts?status=posted" className="rounded-xl">
                <Stat label="Posted" value={stats.posted} icon={CheckCircle2} />
              </Link>
              <Link href="/posts?status=failed" className="rounded-xl">
                <Stat label="Failed" value={stats.failed} icon={AlertTriangle} />
              </Link>
              <Link href="/posts?status=draft" className="rounded-xl">
                <Stat label="Drafts" value={stats.draft} icon={FileText} />
              </Link>
            </div>
          </section>
        </FadeIn>

        {/* Main two-column area */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Upcoming scheduled posts (next 7 days) */}
          <FadeIn delay={0.1} className="space-y-3 lg:col-span-2">
            <section aria-label="Upcoming posts" className="space-y-3">
              <SectionHeading
                title="Upcoming this week"
                meta={
                  <Badge variant="scheduled" showDot>
                    Next 7 days
                  </Badge>
                }
                action={
                  <Link
                    href="/posts?status=scheduled"
                    className="text-xs font-medium text-primary hover:text-primary-hover"
                  >
                    View all
                  </Link>
                }
              />

              {upcoming.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title="Nothing scheduled"
                  description="No posts are scheduled for the next 7 days."
                  action={
                    <Button asChild variant="outline" size="sm">
                      <Link href="/posts/new">
                        <Plus className="h-4 w-4" />
                        Schedule a post
                      </Link>
                    </Button>
                  }
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {upcoming.map((post) => (
                    <UpcomingPostCard key={post.id} post={post as unknown as Post} />
                  ))}
                </div>
              )}
            </section>
          </FadeIn>

          {/* Right column: failed posts + accounts */}
          <FadeIn delay={0.15}>
            <aside className="space-y-6">
              {/* Failed posts */}
              <section aria-label="Failed posts" className="space-y-3">
                <SectionHeading
                  title="Needs attention"
                  meta={
                    failed.length > 0 ? (
                      <Badge variant="failed">{failed.length}</Badge>
                    ) : undefined
                  }
                />

                {failed.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="All clear"
                    description="No failed posts right now."
                    className="py-10"
                  />
                ) : (
                  <div className="space-y-2">
                    {failed.slice(0, 5).map((post) => (
                      <FailedPostRow key={post.id} post={post as unknown as Post} />
                    ))}
                    {failed.length > 5 && (
                      <Link
                        href="/posts?status=failed"
                        className="block pt-1 text-center text-xs font-medium text-rose-600 hover:text-rose-700"
                      >
                        View all {failed.length} failed posts &rarr;
                      </Link>
                    )}
                  </div>
                )}
              </section>

              {/* Connected accounts */}
              <section aria-label="Connected accounts" className="space-y-3">
                <SectionHeading
                  title="Connected accounts"
                  action={
                    <Link
                      href="/accounts"
                      className="text-xs font-medium text-primary hover:text-primary-hover"
                    >
                      Manage
                    </Link>
                  }
                />

                {accountList.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No accounts yet"
                    description="Connect a social account to start posting."
                    className="py-10"
                    action={
                      <Button asChild variant="outline" size="sm">
                        <Link href="/accounts">Connect account</Link>
                      </Button>
                    }
                  />
                ) : (
                  <Card>
                    <CardContent className="divide-y divide-border p-0">
                      {accountList.map((acc) => (
                        <div
                          key={acc.id}
                          className="flex items-center gap-3 px-4 py-3"
                        >
                          <PlatformDot platform={acc.platform} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              @{acc.username}
                            </p>
                            <p className="text-xs capitalize text-muted-foreground">
                              {acc.platform}
                            </p>
                          </div>
                          <Badge status={acc.status} />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </section>
            </aside>
          </FadeIn>
        </div>
      </div>
    </>
  );
}
