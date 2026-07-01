"use client";

import { useState } from "react";
import {
  Instagram,
  Music2,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api, SocialAccount } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function PlatformDot({ platform }: { platform: string }) {
  const base =
    "flex items-center justify-center h-10 w-10 rounded-full text-white shadow-soft";
  if (platform === "instagram") {
    return (
      <div
        className={cn(
          base,
          "bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600"
        )}
      >
        <Instagram className="h-5 w-5" />
      </div>
    );
  }
  if (platform === "tiktok") {
    return (
      <div className={cn(base, "bg-zinc-900")}>
        <Music2 className="h-5 w-5" />
      </div>
    );
  }
  return (
    <div className={cn(base, "bg-zinc-400")}>
      <span className="text-sm font-semibold uppercase">{platform[0]}</span>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AccountCardProps {
  account: SocialAccount;
  onDeleted?: (id: string) => void;
  onStatusChange?: (id: string, status: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AccountCard({ account, onDeleted, onStatusChange }: AccountCardProps) {
  const [browserLoading, setBrowserLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [sessionResult, setSessionResult] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpenBrowser = async () => {
    setBrowserLoading(true);
    setError(null);
    try {
      await api.accounts.openBrowser(account.id);
      toast.success("Login browser opened", {
        description: `Log in to @${account.username} in the browser window.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open browser";
      setError(message);
      toast.error(message);
    } finally {
      setBrowserLoading(false);
    }
  };

  const handleCheckSession = async () => {
    setSessionLoading(true);
    setError(null);
    setSessionResult(null);
    try {
      const { loggedIn } = await api.accounts.checkSession(account.id);
      setSessionResult(loggedIn);
      onStatusChange?.(account.id, loggedIn ? "active" : "needs_manual_login");
      if (loggedIn) {
        toast.success("Session is valid", {
          description: `@${account.username} is still logged in.`,
        });
      } else {
        toast.warning("Session expired", {
          description: `@${account.username} needs to log in again.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to check session";
      setError(message);
      toast.error(message);
    } finally {
      setSessionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove @${account.username} from ${account.platform}?`)) return;
    setDeleteLoading(true);
    setError(null);
    try {
      await api.accounts.delete(account.id);
      onDeleted?.(account.id);
      toast.success("Account removed", {
        description: `@${account.username} was disconnected.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete account";
      setError(message);
      toast.error(message);
      setDeleteLoading(false);
    }
  };

  return (
    <Card className="flex flex-col p-5 animate-fade-in">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <PlatformDot platform={account.platform} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              @{account.username}
            </p>
            <p className="text-xs capitalize text-muted-foreground">
              {account.platform}
            </p>
          </div>
        </div>
        <Badge status={account.status} className="flex-shrink-0" />
      </div>

      {/* Meta */}
      <p className="mt-4 text-xs text-muted-foreground">
        Added {formatDate(account.createdAt)}
      </p>

      {/* Session check feedback */}
      {sessionResult !== null && (
        <div
          className={cn(
            "mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium",
            sessionResult
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700"
          )}
        >
          {sessionResult ? (
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          )}
          {sessionResult
            ? "Session is valid — still logged in."
            : "Session expired — please log in again."}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Actions */}
      <Separator className="my-4" />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleOpenBrowser}
          disabled={browserLoading}
        >
          {browserLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <ExternalLink />
          )}
          {browserLoading ? "Opening…" : "Open Login Browser"}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleCheckSession}
          disabled={sessionLoading}
        >
          {sessionLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {sessionLoading ? "Checking…" : "Check Session"}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleDelete}
          disabled={deleteLoading}
          className="ml-auto text-rose-600 hover:bg-rose-50 hover:text-rose-700"
        >
          {deleteLoading ? <Loader2 className="animate-spin" /> : <Trash2 />}
          {deleteLoading ? "Removing…" : "Remove"}
        </Button>
      </div>
    </Card>
  );
}
