/**
 * Settings / System — server component.
 *
 * A read-only-ish overview of the running system: service connectivity,
 * configured storage directories, connected accounts, environment, and an
 * about blurb. Everything is checked server-side and wrapped in try/catch so
 * the page still renders (showing "Unreachable" badges) when services are down.
 */

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import {
  Database,
  Server,
  HardDrive,
  Users,
  Settings2,
  Info,
  ArrowUpRight,
  ShieldOff,
  BookOpen,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { getRedisConnection } from "@/lib/redis";
import { env } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Settings",
  description: "System status, storage, and environment configuration.",
};

// ── MVP user placeholder ───────────────────────────────────────────────────────
const MVP_USER_ID = process.env.MVP_USER_ID ?? "cldefaultuser000";

// ── Service checks ──────────────────────────────────────────────────────────────

/** Race a promise against a timeout so an unreachable service can't hang render. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out")), ms)
    ),
  ]);
}

async function checkPostgres(): Promise<boolean> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 3_000);
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    const connection = getRedisConnection();
    const pong = await withTimeout(connection.ping(), 3_000);
    return pong === "PONG";
  } catch {
    return false;
  }
}

async function getAccountCount(): Promise<number | null> {
  try {
    return await withTimeout(
      prisma.socialAccount.count({ where: { userId: MVP_USER_ID } }),
      3_000
    );
  } catch {
    return null;
  }
}

/** Read an env getter defensively — a missing var throws, so fall back to null. */
function safeEnv(read: () => string): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function StatusBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge variant="active" showDot>
      Connected
    </Badge>
  ) : (
    <Badge variant="failed" showDot>
      Unreachable
    </Badge>
  );
}

function ServiceRow({
  icon: Icon,
  name,
  detail,
  ok,
}: {
  icon: typeof Database;
  name: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-6 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <StatusBadge ok={ok} />
    </div>
  );
}

function DirRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1 px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {value ? (
        <code className="max-w-full truncate rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-muted-foreground">
          {value}
        </code>
      ) : (
        <Badge variant="draft">Not set</Badge>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {value ? (
        <code className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-muted-foreground">
          {value}
        </code>
      ) : (
        <Badge variant="draft">Not set</Badge>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default async function SettingsPage() {
  const [postgresOk, redisOk, accountCount] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    getAccountCount(),
  ]);

  const uploadDir = safeEnv(() => env.UPLOAD_DIR);
  const processedDir = safeEnv(() => env.PROCESSED_DIR);
  const sessionsDir = safeEnv(() => env.SESSIONS_DIR);
  const logsDir = safeEnv(() => env.LOGS_DIR);
  const nodeEnv = safeEnv(() => env.NODE_ENV);
  const port = safeEnv(() => env.PORT);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary shadow-soft">
          <Settings2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            System status, storage, and environment configuration.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Services */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Services</CardTitle>
            <CardDescription>
              Live connectivity to the backing datastores, checked just now.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border border-t border-border">
              <ServiceRow
                icon={Database}
                name="PostgreSQL"
                detail="Primary database — posts, accounts, and users."
                ok={postgresOk}
              />
              <ServiceRow
                icon={Server}
                name="Redis"
                detail="BullMQ queue backend for scheduled publishing."
                ok={redisOk}
              />
            </div>
          </CardContent>
        </Card>

        {/* Storage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              Storage
            </CardTitle>
            <CardDescription>
              Filesystem directories used for media and sessions.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border border-t border-border">
              <DirRow label="Uploads" value={uploadDir} />
              <DirRow label="Processed" value={processedDir} />
              <DirRow label="Sessions" value={sessionsDir} />
              <DirRow label="Logs" value={logsDir} />
            </div>
          </CardContent>
        </Card>

        {/* Connected accounts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Connected accounts
            </CardTitle>
            <CardDescription>
              Social accounts available for scheduling.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums text-foreground">
                {accountCount ?? "—"}
              </span>
              <span className="text-sm text-muted-foreground">
                {accountCount === null
                  ? "unavailable"
                  : accountCount === 1
                    ? "account"
                    : "accounts"}
              </span>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/accounts">
                Manage accounts
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Environment */}
        <Card>
          <CardHeader>
            <CardTitle>Environment</CardTitle>
            <CardDescription>Runtime configuration.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border border-t border-border">
              <InfoRow label="NODE_ENV" value={nodeEnv} />
              <InfoRow label="PORT" value={port} />
            </div>
            <div className="p-6 pt-4">
              <div className="flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50/70 p-3.5">
                <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs leading-relaxed text-amber-800">
                  This is an MVP tool with{" "}
                  <span className="font-medium">no authentication</span>. All
                  data belongs to a single default user. Do not expose it to the
                  public internet.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              About
            </CardTitle>
            <CardDescription>AutoPost</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">AutoPost</span>{" "}
              schedules and publishes posts to Instagram and TikTok using browser
              automation, with scheduled jobs orchestrated through a BullMQ queue
              backed by Redis.
            </p>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <code className="font-mono text-xs text-muted-foreground">
                  docs/CLI.md
                </code>
                <span className="text-xs text-muted-foreground">
                  — command-line reference
                </span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/posts">Posts</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/accounts">Accounts</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
