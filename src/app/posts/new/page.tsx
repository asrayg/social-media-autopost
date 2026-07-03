"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Instagram,
  Linkedin,
  Music2,
  Twitter,
  Youtube,
  MessageCircle,
  Loader2,
  AlertCircle,
  Calendar,
  Clock,
  FileText,
  ImageIcon,
  Film,
  LayoutGrid,
  Info,
} from "lucide-react";
import { api, SocialAccount } from "@/lib/api";
import { MediaUploader, UploadedFile } from "@/components/posts/MediaUploader";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Toaster, toast } from "@/components/ui/toast";
import {
  PLATFORMS,
  PLATFORM_POST_TYPES,
  defaultPostTypeForPlatform,
  getPlatformPostTypeConfig,
  postTypesForPlatform,
  type Platform,
  type PostType,
} from "@/lib/platforms";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
  platform: Platform;
  accountId: string;
  postType: PostType;
  files: UploadedFile[];
  caption: string;
  scheduleMode: "now" | "later";
  scheduledAt: string; // ISO-8601 local datetime string for the input
}

const STEP_LABELS = [
  "Platform & Account",
  "Media Upload",
  "Caption & Schedule",
  "Review",
];

const CAPTION_LIMIT = 2200;

// ── Post types per platform ───────────────────────────────────────────────────

function postTypeIcon(postType: PostType): React.ReactNode {
  if (postType === "image") return <ImageIcon className="w-4 h-4" />;
  if (postType === "carousel") return <LayoutGrid className="w-4 h-4" />;
  if (postType === "text") return <FileText className="w-4 h-4" />;
  return <Film className="w-4 h-4" />;
}

function allowsVideo(platform: Platform, postType: PostType): boolean {
  return getPlatformPostTypeConfig(platform, postType)?.allowedAssetTypes.includes("video") ?? false;
}

function allowsMultiple(platform: Platform, postType: PostType): boolean {
  return (getPlatformPostTypeConfig(platform, postType)?.maxAssets ?? 0) > 1;
}

function maxFiles(platform: Platform, postType: PostType): number {
  return getPlatformPostTypeConfig(platform, postType)?.maxAssets ?? 0;
}

function requiresMedia(platform: Platform, postType: PostType): boolean {
  return (getPlatformPostTypeConfig(platform, postType)?.minAssets ?? 0) > 0;
}

// ── Local datetime helpers ────────────────────────────────────────────────────

function localNowPlus15(): string {
  const d = new Date(Date.now() + 15 * 60 * 1000);
  // Format: YYYY-MM-DDTHH:MM (no seconds, for datetime-local input)
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(local: string): string {
  return new Date(local).toISOString();
}

function formatLocalDisplay(local: string): string {
  if (!local) return "";
  return new Date(local).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({
  current,
  labels,
}: {
  current: number;
  labels: string[];
}) {
  return (
    <ol className="flex items-center">
      {labels.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={label}
            className={cn("flex items-center", i < labels.length - 1 && "flex-1")}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200",
                  done && "bg-primary text-primary-foreground",
                  active && "border-2 border-primary bg-background text-primary",
                  !done && !active && "border border-border bg-background text-muted-foreground"
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "hidden text-sm font-medium transition-colors sm:block",
                  active
                    ? "text-foreground"
                    : done
                    ? "text-foreground/80"
                    : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div
                className={cn(
                  "mx-3 h-px flex-1 transition-colors duration-200",
                  done ? "bg-primary" : "bg-border"
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Radio-card primitive ───────────────────────────────────────────────────────

function radioCardClasses(selected: boolean): string {
  return cn(
    "relative flex cursor-pointer rounded-xl border bg-background p-4 text-left transition-[border-color,box-shadow,background-color] duration-150",
    selected
      ? "border-primary bg-primary/[0.04] shadow-soft ring-1 ring-primary/40"
      : "border-border hover:border-border-strong hover:bg-surface"
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewPostPage() {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMode, setSubmitMode] = useState<"draft" | "schedule" | null>(null);
  const [createdPostId, setCreatedPostId] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    platform: "instagram",
    accountId: "",
    postType: "image",
    files: [],
    caption: "",
    scheduleMode: "now",
    scheduledAt: localNowPlus15(),
  });

  // ── Load accounts ────────────────────────────────────────────────────────

  useEffect(() => {
    api.accounts
      .list()
      .then((data) => {
        setAccounts(data);
        // Pre-select first account for the current platform
        const first = data.find((a) => a.platform === form.platform);
        if (first) setForm((f) => ({ ...f, accountId: first.id }));
      })
      .catch((err) =>
        setAccountsError(err instanceof Error ? err.message : "Failed to load accounts")
      )
      .finally(() => setAccountsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────

  const filteredAccounts = accounts.filter((a) => a.platform === form.platform);
  const selectedAccount = accounts.find((a) => a.id === form.accountId);
  const postTypeOptions = postTypesForPlatform(form.platform);
  const selectedPostTypeConfig = getPlatformPostTypeConfig(form.platform, form.postType);
  const doneFiles = form.files.filter((f) => f.status === "done");
  const allFilesUploaded =
    form.files.length > 0 && form.files.every((f) => f.status === "done");
  const hasError = form.files.some((f) => f.status === "error");

  // ── Handlers ─────────────────────────────────────────────────────────────

  const setPlatform = (p: Platform) => {
    const firstAccount = accounts.find((a) => a.platform === p);
    const pt = defaultPostTypeForPlatform(p);
    setForm((f) => ({
      ...f,
      platform: p,
      accountId: firstAccount?.id ?? "",
      postType: pt,
      files: [],
    }));
  };

  const handleFilesChange = useCallback((files: UploadedFile[]) => {
    setForm((f) => ({ ...f, files }));
  }, []);

  // ── Validation per step ──────────────────────────────────────────────────

  function canAdvance(): boolean {
    switch (step) {
      case 0:
        return !!form.accountId;
      case 1:
        return requiresMedia(form.platform, form.postType)
          ? allFilesUploaded && !hasError
          : !hasError;
      case 2:
        return (
          form.caption.trim().length > 0 &&
          form.caption.length <= CAPTION_LIMIT &&
          (form.scheduleMode === "now" || !!form.scheduledAt)
        );
      default:
        return true;
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = async (mode: "draft" | "schedule") => {
    setSubmitting(true);
    setSubmitMode(mode);
    setSubmitError(null);

    try {
      // "now" mode → pass current time so API queues it immediately (0ms delay)
      // "later" mode → pass the chosen future time
      // "draft" mode → null, no job queued
      const scheduledAt =
        mode === "draft"
          ? null
          : form.scheduleMode === "later" && form.scheduledAt
          ? toIso(form.scheduledAt)
          : new Date().toISOString();

      const assetPaths = doneFiles
        .filter((f) => f.uploadResult)
        .map((f, idx) => ({
          filePath: f.uploadResult!.filePath,
          filename: f.uploadResult!.filename,
          size: f.uploadResult!.size,
          mimeType: f.mimeType,
          type: f.kind,
          order: idx,
        }));

      const post = await api.posts.create({
        socialAccountId: form.accountId,
        platform: form.platform,
        type: form.postType,
        caption: form.caption,
        scheduledAt,
        assetPaths,
      });

      setCreatedPostId(post.id);
      toast.success(
        mode === "draft"
          ? "Draft saved"
          : form.scheduleMode === "later"
          ? "Post scheduled"
          : "Post queued for publishing"
      );
      setStep(4); // "done" pseudo-step
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submission failed";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
      setSubmitMode(null);
    }
  };

  // ── Render step content ───────────────────────────────────────────────────

  function renderStep() {
    // Done / confirmation
    if (step === 4) {
      return (
        <div className="flex flex-col items-center gap-5 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/60">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">
              {form.scheduleMode === "later" ? "Post scheduled" : "Post queued"}
            </h2>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Your post has been{" "}
              {form.scheduleMode === "later"
                ? `scheduled for ${formatLocalDisplay(form.scheduledAt)}`
                : "queued and will publish shortly"}
              .
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 pt-1 sm:w-auto sm:flex-row">
            <Button asChild>
              <Link href="/posts">View all posts</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStep(0);
                setCreatedPostId(null);
                setForm({
                  platform: "instagram",
                  accountId: accounts.find((a) => a.platform === "instagram")?.id ?? "",
                  postType: defaultPostTypeForPlatform("instagram"),
                  files: [],
                  caption: "",
                  scheduleMode: "now",
                  scheduledAt: localNowPlus15(),
                });
              }}
            >
              Create another post
            </Button>
          </div>
        </div>
      );
    }

    // Step 0: Platform + Account
    if (step === 0) {
      return (
        <div className="space-y-8">
          {/* Platform radio cards */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">Platform</legend>
            <div className="grid grid-cols-2 gap-3">
              {PLATFORMS.map((p) => {
                const selected = form.platform === p;
                return (
                  <label key={p} className={radioCardClasses(selected)}>
                    <input
                      type="radio"
                      name="platform"
                      value={p}
                      checked={selected}
                      onChange={() => setPlatform(p)}
                      className="sr-only"
                    />
                    <span className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface text-foreground">
                        <PlatformIcon platform={p} className="h-5 w-5" />
                      </span>
                      <span className="flex flex-col">
                        <span className="flex items-center gap-1.5 text-sm font-medium capitalize text-foreground">
                          <PlatformDot platform={p} />
                          {p}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {platformSummary(p)}
                        </span>
                      </span>
                    </span>
                    {selected && (
                      <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* Account picker */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">Account</legend>
            {accountsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading accounts…
              </div>
            ) : accountsError ? (
              <p className="flex items-center gap-1.5 text-sm text-rose-600">
                <AlertCircle className="h-4 w-4" />
                {accountsError}
              </p>
            ) : filteredAccounts.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  No {form.platform} accounts connected.{" "}
                  <Link href="/accounts/new" className="font-medium text-primary underline underline-offset-2">
                    Add one
                  </Link>
                </span>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredAccounts.map((a) => {
                  const selected = form.accountId === a.id;
                  return (
                    <label key={a.id} className={radioCardClasses(selected)}>
                      <input
                        type="radio"
                        name="account"
                        value={a.id}
                        checked={selected}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, accountId: e.target.value }))
                        }
                        className="sr-only"
                      />
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar
                          size="md"
                          fallback={a.username.slice(0, 2)}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium text-foreground">
                            @{a.username}
                          </span>
                          {a.status !== "active" ? (
                            <Badge status={a.status} showDot className="mt-1 w-fit" />
                          ) : (
                            <Badge status="active" showDot className="mt-1 w-fit" />
                          )}
                        </span>
                      </span>
                      {selected && (
                        <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          {/* Post type selector */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">Post type</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {postTypeOptions.map((postType) => {
                const opt = PLATFORM_POST_TYPES[form.platform][postType]!;
                const selected = form.postType === postType;
                return (
                  <label
                    key={postType}
                    className={cn(radioCardClasses(selected), "flex-col gap-2")}
                  >
                    <input
                      type="radio"
                      name="postType"
                      value={postType}
                      checked={selected}
                      onChange={() =>
                        setForm((f) => ({ ...f, postType, files: [] }))
                      }
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-lg",
                        selected ? "bg-primary/10 text-primary" : "bg-surface text-muted-foreground"
                      )}
                    >
                      {postTypeIcon(postType)}
                    </span>
                    <span className="text-sm font-medium text-foreground">{opt.label}</span>
                    <span className="text-xs leading-tight text-muted-foreground">
                      {opt.description}
                    </span>
                    {selected && (
                      <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />
                    )}
                  </label>
                );
              })}
            </div>
            {form.platform === "tiktok" && form.postType === "carousel" && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Real TikTok photo carousels post via the official TikTok Content
                Posting API — connect the account&rsquo;s API access first (see
                docs/TIKTOK_API.md).
              </p>
            )}
            {["twitter", "linkedin", "reddit", "youtube"].includes(form.platform) && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Local validation and queueing are enabled. Live publishing for this platform still needs an API or browser automation module.
              </p>
            )}
          </fieldset>
        </div>
      );
    }

    // Step 1: Media Upload
    if (step === 1) {
      return (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-foreground">Upload media</h2>
              <p className="text-xs text-muted-foreground">
                {allowsVideo(form.platform, form.postType)
                  ? "JPG, PNG, WEBP, MP4, MOV, AVI"
                  : "JPG, PNG, WEBP"}
              </p>
            </div>
            <Badge variant="secondary">
              {selectedPostTypeConfig?.maxAssets === 0
                ? "No media"
                : selectedPostTypeConfig && selectedPostTypeConfig.maxAssets > 1
                ? `Up to ${selectedPostTypeConfig.maxAssets} files`
                : "1 file"}
            </Badge>
          </div>

          {selectedPostTypeConfig?.maxAssets === 0 ? (
            <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
              This post type does not use media.
            </div>
          ) : (
            <MediaUploader
              maxFiles={maxFiles(form.platform, form.postType)}
              allowVideo={allowsVideo(form.platform, form.postType)}
              allowMultiple={allowsMultiple(form.platform, form.postType)}
              onFilesChange={handleFilesChange}
            />
          )}

          {form.files.length > 0 && !allFilesUploaded && !hasError && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Uploading {form.files.filter((f) => f.status !== "done").length} file(s)…
            </p>
          )}

          {hasError && (
            <p className="flex items-center gap-1.5 text-xs text-rose-600">
              <AlertCircle className="h-3.5 w-3.5" />
              Some files failed to upload. Remove them and try again.
            </p>
          )}
        </div>
      );
    }

    // Step 2: Caption + Schedule
    if (step === 2) {
      const charCount = form.caption.length;
      const overLimit = charCount > CAPTION_LIMIT;

      return (
        <div className="space-y-8">
          {/* Caption */}
          <div className="space-y-2">
            <Label htmlFor="caption" required>
              Caption
            </Label>
            <Textarea
              id="caption"
              rows={6}
              value={form.caption}
              onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))}
              placeholder={`Write your ${form.platform === "instagram" ? "Instagram" : "TikTok"} caption…`}
              showCount
              maxCount={CAPTION_LIMIT}
            />
          </div>

          {/* Schedule toggle */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">When to post</legend>
            <div className="grid grid-cols-2 gap-3">
              {(["now", "later"] as const).map((mode) => {
                const selected = form.scheduleMode === mode;
                return (
                  <label key={mode} className={radioCardClasses(selected)}>
                    <input
                      type="radio"
                      name="scheduleMode"
                      value={mode}
                      checked={selected}
                      onChange={() => setForm((f) => ({ ...f, scheduleMode: mode }))}
                      className="sr-only"
                    />
                    <span className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-lg",
                          selected ? "bg-primary/10 text-primary" : "bg-surface text-muted-foreground"
                        )}
                      >
                        {mode === "now" ? (
                          <Clock className="h-4 w-4" />
                        ) : (
                          <Calendar className="h-4 w-4" />
                        )}
                      </span>
                      <span className="flex flex-col">
                        <span className="text-sm font-medium text-foreground">
                          {mode === "now" ? "Post now" : "Schedule"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {mode === "now" ? "Publish immediately" : "Pick a date & time"}
                        </span>
                      </span>
                    </span>
                    {selected && (
                      <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* Date-time picker */}
          {form.scheduleMode === "later" && (
            <div className="space-y-2">
              <Label htmlFor="scheduledAt">Scheduled date &amp; time</Label>
              <input
                id="scheduledAt"
                type="datetime-local"
                value={form.scheduledAt}
                min={localNowPlus15()}
                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-soft transition-[border-color,box-shadow] duration-150 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
          )}

          {/* Preview card */}
          {(form.caption || doneFiles.length > 0) && (
            <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Preview
              </p>
              {doneFiles.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {doneFiles.map((f) => (
                    <div
                      key={f.id}
                      className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-background"
                    >
                      {f.kind === "video" ? (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <Film className="h-6 w-6" />
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.previewUrl} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                  ))}
                </div>
              )}
              {form.caption && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground line-clamp-5">
                  {form.caption}
                </p>
              )}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {form.scheduleMode === "later" && form.scheduledAt ? (
                  <>
                    <Calendar className="h-3.5 w-3.5" />
                    Scheduled for {formatLocalDisplay(form.scheduledAt)}
                  </>
                ) : (
                  <>
                    <Clock className="h-3.5 w-3.5" />
                    Post immediately
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      );
    }

    // Step 3: Review + Submit
    if (step === 3) {
      return (
        <div className="space-y-6">
          <h2 className="text-sm font-medium text-foreground">Review your post</h2>

          {/* Summary */}
          <dl className="overflow-hidden rounded-xl border border-border text-sm">
            <SummaryRow
              label="Platform"
              value={
                <span className="flex items-center gap-1.5 capitalize">
                  <PlatformDot platform={form.platform} />
                  {form.platform}
                </span>
              }
            />
            <SummaryRow
              label="Account"
              value={selectedAccount ? `@${selectedAccount.username}` : "—"}
            />
            <SummaryRow
              label="Post type"
              value={<span className="capitalize">{form.postType}</span>}
            />
            <SummaryRow
              label="Media"
              value={
                doneFiles.length > 0
                  ? `${doneFiles.length} file${doneFiles.length !== 1 ? "s" : ""}`
                  : "None"
              }
            />
            <SummaryRow
              label="Caption"
              value={
                form.caption ? (
                  <span className="line-clamp-2">{form.caption}</span>
                ) : (
                  <span className="italic text-muted-foreground">Empty</span>
                )
              }
            />
            <SummaryRow
              label="Schedule"
              value={
                form.scheduleMode === "now" ? (
                  <Badge status="processing" showDot>
                    Post immediately
                  </Badge>
                ) : form.scheduledAt ? (
                  <Badge status="scheduled" showDot>
                    {formatLocalDisplay(form.scheduledAt)}
                  </Badge>
                ) : (
                  "—"
                )
              }
            />
          </dl>

          {/* Thumbnails */}
          {doneFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {doneFiles.map((f) => (
                <div
                  key={f.id}
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-surface"
                >
                  {f.kind === "video" ? (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <Film className="h-5 w-5" />
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.previewUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {submitError && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {submitError}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-3 pt-1 sm:flex-row">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => handleSubmit("draft")}
              disabled={submitting}
            >
              {submitting && submitMode === "draft" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FileText />
              )}
              Save draft
            </Button>
            <Button
              className="flex-1"
              onClick={() => handleSubmit("schedule")}
              disabled={submitting}
            >
              {submitting && submitMode === "schedule" ? (
                <Loader2 className="animate-spin" />
              ) : form.scheduleMode === "now" ? (
                <Clock />
              ) : (
                <Calendar />
              )}
              {submitting && submitMode === "schedule"
                ? "Submitting…"
                : form.scheduleMode === "now"
                ? "Post now"
                : "Schedule post"}
            </Button>
          </div>
        </div>
      );
    }

    return null;
  }

  const isDone = step === 4;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-6">
      <Toaster />

      {/* Back link */}
      <Link
        href="/posts"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Posts
      </Link>

      {/* Heading */}
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Create post</h1>
        {!isDone && (
          <p className="text-sm text-muted-foreground">
            Step {step + 1} of {STEP_LABELS.length} — {STEP_LABELS[step]}
          </p>
        )}
      </div>

      {/* Progress */}
      {!isDone && (
        <div className="mb-6">
          <StepIndicator current={step} labels={STEP_LABELS} />
        </div>
      )}

      <Card className="animate-fade-in overflow-hidden">
        {/* Step content */}
        <div className="p-6 sm:p-8">{renderStep()}</div>

        {/* Navigation footer */}
        {!isDone && step < 3 && (
          <div className="flex items-center justify-between border-t border-border bg-surface/60 px-6 py-4">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              <ArrowLeft />
              Back
            </Button>
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance()}>
              {step === 2 ? "Review" : "Continue"}
              <ArrowRight />
            </Button>
          </div>
        )}

        {/* Review page back button */}
        {!isDone && step === 3 && (
          <div className="border-t border-border bg-surface/60 px-6 py-4">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ArrowLeft />
              Back
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── SummaryRow helper ─────────────────────────────────────────────────────────

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 border-b border-border bg-card px-4 py-3 last:border-b-0">
      <dt className="w-24 flex-shrink-0 pt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="flex-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}

// ── Platform accent dot ─────────────────────────────────────────────────────────

function PlatformDot({ platform }: { platform: Platform }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        platformDotClass(platform)
      )}
      aria-hidden="true"
    />
  );
}

function PlatformIcon({
  platform,
  className,
}: {
  platform: Platform;
  className?: string;
}) {
  if (platform === "instagram") return <Instagram className={className} />;
  if (platform === "tiktok") return <Music2 className={className} />;
  if (platform === "twitter") return <Twitter className={className} />;
  if (platform === "linkedin") return <Linkedin className={className} />;
  if (platform === "youtube") return <Youtube className={className} />;
  return <MessageCircle className={className} />;
}

function platformDotClass(platform: Platform): string {
  const classes: Record<Platform, string> = {
    instagram: "bg-gradient-to-tr from-pink-500 to-orange-400",
    tiktok: "bg-zinc-900",
    twitter: "bg-sky-500",
    linkedin: "bg-blue-700",
    reddit: "bg-orange-600",
    youtube: "bg-red-600",
  };
  return classes[platform];
}

function platformSummary(platform: Platform): string {
  const summaries: Record<Platform, string> = {
    instagram: "Photos, carousels & reels",
    tiktok: "Videos & photo carousels",
    twitter: "Text, images & video",
    linkedin: "Text, images & video",
    reddit: "Text, images & video",
    youtube: "Videos & shorts",
  };
  return summaries[platform];
}
