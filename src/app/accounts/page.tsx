"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Loader2, ServerCrash, Users } from "lucide-react";
import { api, SocialAccount } from "@/lib/api";
import { AccountCard } from "@/components/accounts/AccountCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Toaster } from "@/components/ui/toast";
import { pluralize } from "@/lib/utils";

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.accounts.list();
      setAccounts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleDeleted = useCallback((id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleStatusChange = useCallback((id: string, status: string) => {
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status } : a))
    );
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Connected Accounts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage the social accounts used for automated posting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={fetchAccounts}
            disabled={loading}
            aria-label="Refresh accounts"
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Refresh
          </Button>
          <Button asChild>
            <Link href="/accounts/new">
              <Plus />
              Add Account
            </Link>
          </Button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-5 shadow-soft"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="mt-4 h-3 w-28" />
              <Skeleton className="mt-6 h-8 w-full" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <EmptyState
          icon={ServerCrash}
          title="Couldn't load accounts"
          description={error}
          action={
            <Button variant="outline" onClick={fetchAccounts}>
              <RefreshCw />
              Try again
            </Button>
          }
        />
      )}

      {/* Empty state */}
      {!loading && !error && accounts.length === 0 && (
        <EmptyState
          icon={Users}
          title="No accounts yet"
          description="Add a social account to start scheduling automated posts."
          action={
            <Button asChild>
              <Link href="/accounts/new">
                <Plus />
                Add your first account
              </Link>
            </Button>
          }
        />
      )}

      {/* Account grid */}
      {!loading && !error && accounts.length > 0 && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {accounts.length} {pluralize(accounts.length, "account")}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onDeleted={handleDeleted}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        </div>
      )}

      <Toaster />
    </div>
  );
}
