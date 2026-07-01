/**
 * Analytics — server component.
 *
 * Aggregates Post / PublishAttempt data with Prisma and renders headline
 * stats plus a set of recharts visualizations (posts per day, and breakdowns
 * by platform, status, and post type). All chart aggregates are computed here
 * and passed as plain serializable props to the client Charts components.
 */

export const dynamic = "force-dynamic";

import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Percent,
} from "lucide-react";
import { eachDayOfInterval, format, isSameDay, startOfDay, subDays } from "date-fns";
import { prisma } from "@/lib/db";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  PostsPerDayChart,
  PlatformDonut,
  HorizontalBreakdown,
  type DayDatum,
  type SliceDatum,
} from "@/components/analytics/Charts";

// ── MVP user placeholder ────────────────────────────────────────────────────
const MVP_USER_ID = process.env.MVP_USER_ID ?? "cldefaultuser000";

// ── Color tokens (mirror src/lib/utils status dots + platform brand) ────────
const PLATFORM_META: Record<string, { name: string; color: string }> = {
  instagram: { name: "Instagram", color: "#ec4899" },
  tiktok: { name: "TikTok", color: "#18181b" },
};

const STATUS_META: Record<string, { name: string; color: string }> = {
  posted: { name: "Posted", color: "#10b981" }, // emerald-500
  scheduled: { name: "Scheduled", color: "#3b82f6" }, // blue-500
  processing: { name: "Processing", color: "#f59e0b" }, // amber-500
  failed: { name: "Failed", color: "#f43f5e" }, // rose-500
  draft: { name: "Draft", color: "#a1a1aa" }, // zinc-400
};

const TYPE_META: Record<string, { name: string; color: string }> = {
  image: { name: "Image", color: "#4f46e5" }, // indigo (chart-1)
  carousel: { name: "Carousel", color: "#10b981" }, // emerald (chart-2)
  reel: { name: "Reel", color: "#3b82f6" }, // blue (chart-3)
  video: { name: "Video", color: "#f59e0b" }, // amber (chart-4)
};

const STATUS_ORDER = ["posted", "scheduled", "processing", "failed", "draft"];
const TYPE_ORDER = ["image", "carousel", "reel", "video"];

// ── Data fetching + aggregation ─────────────────────────────────────────────
async function getAnalyticsData() {
  const posts = await prisma.post.findMany({
    where: { userId: MVP_USER_ID },
    select: { platform: true, type: true, status: true, createdAt: true },
  });

  const total = posts.length;
  const posted = posts.filter((p) => p.status === "posted").length;
  const failed = posts.filter((p) => p.status === "failed").length;
  const successDenom = posted + failed;
  const successRate = successDenom ? Math.round((posted / successDenom) * 100) : 0;

  // Posts created per day over the last 14 days (inclusive of today).
  const today = startOfDay(new Date());
  const days = eachDayOfInterval({ start: subDays(today, 13), end: today });
  const perDay: DayDatum[] = days.map((d) => ({
    date: format(d, "yyyy-MM-dd"),
    label: format(d, "MMM d"),
    count: posts.filter((p) => isSameDay(new Date(p.createdAt), d)).length,
  }));

  const countBy = (key: "platform" | "type" | "status") =>
    posts.reduce<Record<string, number>>((acc, p) => {
      acc[p[key]] = (acc[p[key]] ?? 0) + 1;
      return acc;
    }, {});

  const platformCounts = countBy("platform");
  const byPlatform: SliceDatum[] = Object.keys(platformCounts)
    .map((key) => ({
      key,
      name: PLATFORM_META[key]?.name ?? key,
      color: PLATFORM_META[key]?.color ?? "#a1a1aa",
      value: platformCounts[key],
    }))
    .sort((a, b) => b.value - a.value);

  const statusCounts = countBy("status");
  const byStatus: SliceDatum[] = STATUS_ORDER.filter((k) => statusCounts[k]).map(
    (key) => ({
      key,
      name: STATUS_META[key].name,
      color: STATUS_META[key].color,
      value: statusCounts[key],
    })
  );

  const typeCounts = countBy("type");
  const byType: SliceDatum[] = TYPE_ORDER.filter((k) => typeCounts[k]).map((key) => ({
    key,
    name: TYPE_META[key].name,
    color: TYPE_META[key].color,
    value: typeCounts[key],
  }));

  return {
    stats: { total, posted, failed, successRate },
    perDay,
    byPlatform,
    byStatus,
    byType,
  };
}

// ── Page ────────────────────────────────────────────────────────────────────
export default async function AnalyticsPage() {
  let data: Awaited<ReturnType<typeof getAnalyticsData>> | null = null;
  let dbError: string | null = null;

  try {
    data = await getAnalyticsData();
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
        </div>
      </div>
    );
  }

  const { stats, perDay, byPlatform, byStatus, byType } = data;
  const hasData = stats.total > 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Analytics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Publishing trends and breakdowns across your posts.
        </p>
      </div>

      {/* Headline stats */}
      <section aria-label="Headline statistics">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Total posts" value={stats.total} icon={Layers} />
          <Stat label="Posted" value={stats.posted} icon={CheckCircle2} />
          <Stat label="Failed" value={stats.failed} icon={AlertTriangle} />
          <Stat
            label="Success rate"
            value={`${stats.successRate}%`}
            icon={Percent}
            hint="Posted vs. posted + failed"
          />
        </div>
      </section>

      {!hasData ? (
        <EmptyState
          icon={BarChart3}
          title="No analytics yet"
          description="Create and publish some posts to see trends and breakdowns here."
        />
      ) : (
        <>
          {/* Posts per day */}
          <section aria-label="Posts created per day">
            <Card>
              <CardHeader>
                <CardTitle>Posts created</CardTitle>
                <CardDescription>Last 14 days</CardDescription>
              </CardHeader>
              <CardContent>
                <PostsPerDayChart data={perDay} />
              </CardContent>
            </Card>
          </section>

          {/* Breakdowns grid */}
          <section aria-label="Breakdowns" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By platform</CardTitle>
                <CardDescription>Distribution across connected platforms</CardDescription>
              </CardHeader>
              <CardContent>
                {byPlatform.length === 0 ? (
                  <EmptyState icon={BarChart3} title="No platform data" className="py-10" />
                ) : (
                  <PlatformDonut data={byPlatform} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>By status</CardTitle>
                <CardDescription>Where posts currently sit</CardDescription>
              </CardHeader>
              <CardContent>
                {byStatus.length === 0 ? (
                  <EmptyState icon={BarChart3} title="No status data" className="py-10" />
                ) : (
                  <HorizontalBreakdown data={byStatus} />
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>By post type</CardTitle>
                <CardDescription>Image, carousel, reel, and video</CardDescription>
              </CardHeader>
              <CardContent>
                {byType.length === 0 ? (
                  <EmptyState icon={BarChart3} title="No type data" className="py-10" />
                ) : (
                  <HorizontalBreakdown data={byType} />
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
