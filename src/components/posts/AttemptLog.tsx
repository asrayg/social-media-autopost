import { format } from "date-fns";
import { Camera, History } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, getStatusColor } from "@/lib/utils";
import type { PublishAttempt, AttemptStatus } from "@/lib/types";

// ── Status meta ───────────────────────────────────────────────────────────────
// Map raw attempt statuses onto the calm token palette (emerald / amber / rose).

type Tone = "posted" | "processing" | "failed";

const ATTEMPT_META: Record<AttemptStatus, { label: string; tone: Tone }> = {
  success: { label: "Success", tone: "posted" },
  posted_unknown: { label: "Posted (unverified)", tone: "posted" },
  failed_login: { label: "Login failed", tone: "failed" },
  failed_upload: { label: "Upload failed", tone: "processing" },
  failed_caption: { label: "Caption failed", tone: "processing" },
  failed_submit: { label: "Submit failed", tone: "failed" },
};

function getMeta(status: AttemptStatus): { label: string; tone: Tone } {
  return ATTEMPT_META[status] ?? { label: status, tone: "failed" };
}

// ── AttemptRow ────────────────────────────────────────────────────────────────

function AttemptRow({
  attempt,
  isLast,
}: {
  attempt: PublishAttempt;
  isLast: boolean;
}) {
  const meta = getMeta(attempt.status);
  const token = getStatusColor(meta.tone);

  return (
    <li className="relative flex gap-4">
      {/* Timeline rail */}
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-background",
            token.dot
          )}
          aria-hidden="true"
        />
        {!isLast && (
          <span className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pb-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
              token.badge
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", token.dot)}
              aria-hidden="true"
            />
            {meta.label}
          </span>
          <span className="text-xs capitalize text-muted-foreground">
            {attempt.platform}
          </span>
          <time
            className="ml-auto text-xs text-muted-foreground"
            dateTime={attempt.createdAt}
            title={format(new Date(attempt.createdAt), "PPpp")}
          >
            {format(new Date(attempt.createdAt), "MMM d, yyyy 'at' h:mm:ss a")}
          </time>
        </div>

        {attempt.error && (
          <p className="mt-2 break-words rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {attempt.error}
          </p>
        )}

        {attempt.screenshotPath && (
          <a
            href={`/api/assets/${encodeURIComponent(attempt.screenshotPath)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            <Camera className="h-3.5 w-3.5" />
            View screenshot
          </a>
        )}

        {attempt.logs && (
          <details className="group mt-2">
            <summary className="cursor-pointer select-none text-xs text-muted-foreground transition-colors hover:text-foreground">
              Debug logs
            </summary>
            <pre className="mt-1.5 max-h-40 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground">
              {attempt.logs}
            </pre>
          </details>
        )}
      </div>
    </li>
  );
}

// ── AttemptLog ────────────────────────────────────────────────────────────────

export interface AttemptLogProps {
  attempts: PublishAttempt[];
}

export function AttemptLog({ attempts }: AttemptLogProps) {
  if (attempts.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No publish attempts yet"
        description="Attempts will appear here once this post is processed."
      />
    );
  }

  // Show most-recent first
  const sorted = [...attempts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <ol className="m-0 list-none p-0" role="list">
      {sorted.map((attempt, idx) => (
        <AttemptRow
          key={attempt.id}
          attempt={attempt}
          isLast={idx === sorted.length - 1}
        />
      ))}
    </ol>
  );
}
