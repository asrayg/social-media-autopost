"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import type { Post, PostStatus, PostsApiResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PostCard } from "./PostCard";

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS: Array<{ label: string; value: PostStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Posted", value: "posted" },
  { label: "Failed", value: "failed" },
  { label: "Drafts", value: "draft" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface FetchState {
  posts: Post[];
  total: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
}

// ── PostsList ─────────────────────────────────────────────────────────────────

interface PostsListProps {
  /** Items per page (default 12). */
  pageSize?: number;
}

export function PostsList({ pageSize = 12 }: PostsListProps) {
  const [activeTab, setActiveTab] = useState<PostStatus | "all">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [state, setState] = useState<FetchState>({
    posts: [],
    total: 0,
    totalPages: 0,
    loading: true,
    error: null,
  });

  const fetchPosts = useCallback(
    async (tab: PostStatus | "all", page: number) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(pageSize),
        });
        if (tab !== "all") params.set("status", tab);

        const res = await fetch(`/api/posts?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `Request failed (${res.status})`
          );
        }
        const data: PostsApiResponse = await res.json();
        setState({
          posts: data.data,
          total: data.total,
          totalPages: data.totalPages,
          loading: false,
          error: null,
        });
      } catch (err) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load posts",
        }));
      }
    },
    [pageSize]
  );

  useEffect(() => {
    setCurrentPage(1);
    fetchPosts(activeTab, 1);
  }, [activeTab, fetchPosts]);

  useEffect(() => {
    fetchPosts(activeTab, currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  function handleTabChange(tab: PostStatus | "all") {
    setActiveTab(tab);
    // currentPage reset handled by the tab effect above
  }

  function handleMutate() {
    fetchPosts(activeTab, currentPage);
  }

  // ── Count badge (active tab only) ─────────────────────────────────────────────
  function tabBadge(tab: PostStatus | "all"): string | null {
    if (tab !== activeTab) return null;
    if (state.loading) return null;
    return String(state.total);
  }

  const emptyLabel =
    activeTab === "all"
      ? ""
      : activeTab === "draft"
      ? "draft "
      : `${activeTab} `;

  return (
    <div className="flex flex-col gap-6">
      {/* Filter tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => handleTabChange(v as PostStatus | "all")}
      >
        <TabsList>
          {TABS.map((tab) => {
            const badge = tabBadge(tab.value);
            return (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
                {badge != null && (
                  <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary">
                    {badge}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Error state */}
      {state.error && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{state.error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchPosts(activeTab, currentPage)}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Loading skeleton */}
      {state.loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-xl border border-border bg-card shadow-soft"
            >
              <Skeleton className="aspect-[16/10] w-full rounded-none" />
              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-12" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-8 flex-1" />
                  <Skeleton className="h-8 flex-1" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!state.loading && !state.error && state.posts.length === 0 && (
        <EmptyState
          icon={Inbox}
          title={`No ${emptyLabel}posts yet`}
          description="Posts you schedule or publish will show up here."
        />
      )}

      {/* Grid */}
      {!state.loading && state.posts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {state.posts.map((post) => (
            <PostCard key={post.id} post={post} onMutate={handleMutate} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!state.loading && state.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {state.totalPages} &middot; {state.total} total
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronLeft />
              Previous
            </Button>
            {/* Page numbers (show up to 5 around current) */}
            {Array.from({ length: state.totalPages }, (_, i) => i + 1)
              .filter(
                (p) =>
                  p === 1 ||
                  p === state.totalPages ||
                  Math.abs(p - currentPage) <= 2
              )
              .reduce<Array<number | "ellipsis">>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                  acc.push("ellipsis");
                }
                acc.push(p);
                return acc;
              }, [])
              .map((item, idx) =>
                item === "ellipsis" ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-1.5 text-sm text-muted-foreground"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setCurrentPage(item)}
                    className={cn(
                      "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors",
                      item === currentPage
                        ? "bg-primary text-primary-foreground shadow-soft"
                        : "text-muted-foreground hover:bg-surface hover:text-foreground"
                    )}
                  >
                    {item}
                  </button>
                )
              )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((p) => Math.min(state.totalPages, p + 1))
              }
              disabled={currentPage >= state.totalPages}
            >
              Next
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
