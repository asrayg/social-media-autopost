import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return format(d, "MMM d, yyyy 'at' h:mm a");
}

export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";

  if (isToday(d)) {
    return formatDistanceToNow(d, { addSuffix: true });
  }
  if (isYesterday(d)) {
    return `Yesterday at ${format(d, "h:mm a")}`;
  }
  return format(d, "MMM d, yyyy");
}

export type PostStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "posted"
  | "failed";

export type AccountStatus = "active" | "needs_login";

/**
 * Canonical badge variants used across the app. Raw status strings coming
 * from the API (e.g. "done", "pending", "needs_manual_login") are normalised
 * onto one of these via {@link normalizeStatus}.
 */
export type StatusVariant =
  | PostStatus
  | AccountStatus;

/** Map the various raw status strings the API emits onto a canonical variant. */
export function normalizeStatus(status: string): StatusVariant {
  switch (status) {
    case "posted":
    case "done":
    case "published":
    case "success":
      return "posted";
    case "scheduled":
    case "pending":
    case "queued":
      return "scheduled";
    case "processing":
    case "uploading":
    case "running":
      return "processing";
    case "failed":
    case "error":
      return "failed";
    case "active":
      return "active";
    case "needs_login":
    case "needs_manual_login":
    case "needs_reauth":
    case "expired":
      return "needs_login";
    case "draft":
    default:
      return "draft";
  }
}

type StatusToken = {
  /** combined badge classes: soft tint bg + saturated text */
  badge: string;
  bg: string;
  text: string;
  border: string;
  dot: string;
  label: string;
};

const STATUS_TOKENS: Record<StatusVariant, StatusToken> = {
  posted: {
    badge: "bg-emerald-50 text-emerald-700 border-emerald-100",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-100",
    dot: "bg-emerald-500",
    label: "Posted",
  },
  scheduled: {
    badge: "bg-blue-50 text-blue-700 border-blue-100",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-100",
    dot: "bg-blue-500",
    label: "Scheduled",
  },
  processing: {
    badge: "bg-amber-50 text-amber-700 border-amber-100",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-100",
    dot: "bg-amber-500",
    label: "Processing",
  },
  failed: {
    badge: "bg-rose-50 text-rose-700 border-rose-100",
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-100",
    dot: "bg-rose-500",
    label: "Failed",
  },
  draft: {
    badge: "bg-zinc-100 text-zinc-600 border-zinc-200",
    bg: "bg-zinc-100",
    text: "text-zinc-600",
    border: "border-zinc-200",
    dot: "bg-zinc-400",
    label: "Draft",
  },
  active: {
    badge: "bg-emerald-50 text-emerald-700 border-emerald-100",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-100",
    dot: "bg-emerald-500",
    label: "Active",
  },
  needs_login: {
    badge: "bg-amber-50 text-amber-700 border-amber-100",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-100",
    dot: "bg-amber-500",
    label: "Needs login",
  },
};

/** Structured color tokens for a status (bg / text / border / dot / label). */
export function getStatusColor(status: StatusVariant | string): StatusToken {
  return STATUS_TOKENS[normalizeStatus(String(status))];
}

/** Convenience: the combined soft-tint badge class string for a status. */
export function statusBadgeClasses(status: StatusVariant | string): string {
  return getStatusColor(status).badge;
}

/** Human-friendly label for a status string. */
export function statusLabel(status: StatusVariant | string): string {
  return getStatusColor(status).label;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 3)}...`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
