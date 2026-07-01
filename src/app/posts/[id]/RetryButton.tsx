"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RetryButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Retry failed");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button onClick={handleRetry} disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="animate-spin" />
            Retrying…
          </>
        ) : (
          <>
            <RotateCcw />
            Retry Post
          </>
        )}
      </Button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
