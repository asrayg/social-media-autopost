"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface AutoRefreshProps {
  /** Refresh interval in milliseconds. Default: 30000 (30s). */
  intervalMs?: number;
}

/**
 * Transparent client component that calls router.refresh() on an interval.
 * Drop it anywhere inside a server component tree to enable periodic
 * re-fetching of server-side data without a full page reload.
 */
export function AutoRefresh({ intervalMs = 30_000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
