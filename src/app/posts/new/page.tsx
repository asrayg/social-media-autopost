"use client";

import { useCallback, useEffect, useState } from "react";
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
  Facebook,
  Cloud,
  AtSign,
  Pin,
  MessageCircle,
  Loader2,
  AlertCircle,
  Calendar,
  Clock,
  FileText,
  ImageIcon,
  Film,
  LayoutGrid,
  CircleDashed,
  Info,
  XCircle,
  Users,
} from "lucide-react";
import { api, SocialAccount, BatchCreateResult } from "@/lib/api";
import { MediaUploader, UploadedFile } from "@/components/posts/MediaUploader";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Toaster, toast } from "@/components/ui/toast";
import {
  PLATFORMS,
  resolvePostTypeForPlatform,
  type Platform,
  type PostType,
  type PostOptions,
} from "@/lib/platforms";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
  selectedAccountIds: string[];
  files: UploadedFile[];
  caption: string;
  scheduleMode: "now" | "later";
  scheduledAt: string; // ISO-8601 local datetime string for the input
  // Per-platform options (Reddit subreddit, YouTube visibility, Pinterest board).
  subreddit: string;
  visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  board: string;
}

const STEP_LABELS = ["Accounts", "Media", "Caption & Schedule", "Review"];

const CAPTION_LIMIT = 2200;

/** Media is shared across every selected platform, so allow the most generous cap. */
const SHARED_MAX_FILES = 35;

function initialForm(): FormState {
  return {
    selectedAccountIds: [],
    files: [],
    caption: "",
    scheduleMode: "now",
    scheduledAt: localNowPlus15(),
    subreddit: "",
    visibility: "PRIVATE",
    board: "",
  };
}

// ── Post-type icon ──────────────────────────────────────────────────────────────

function postTypeIcon(postType: PostType): React.ReactNode {
  if (postType === "image") return <ImageIcon className="w-4 h-4" />;
  if (postType === "carousel") return <LayoutGrid className="w-4 h-4" />;
  if (postType === "text") return <FileText className="w-4 h-4" />;
  if (postType === "story") return <CircleDashed className="w-4 h-4" />;
  return <Film className="w-4 h-4" />;
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

function StepIndicator({ current, labels }: { current: number; labels: string[] }) {
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

// ── Radio/toggle-card primitive ─────────────────────────────────────────────────

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
  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchCreateResult | null>(null);
  // Bump to force-remount the MediaUploader (e.g. after "Create another post").
  const [uploaderKey, setUploaderKey] = useState(0);
  // "Post as Story" — forces type=story on story-capable platforms (Instagram,
  // Facebook), which post via the Android emulator. Auto-resolves elsewhere.
  const [postAsStory, setPostAsStory] = useState(false);

  const [form, setForm] = useState<FormState>(initialForm);

  // ── Load accounts ────────────────────────────────────────────────────────

  useEffect(() => {
    api.accounts
      .list()
      .then(setAccounts)
      .catch((err) =>
        setAccountsError(err instanceof Error ? err.message : "Failed to load accounts")
      )
      .finally(() => setAccountsLoading(false));
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────

  const selectedAccounts = accounts.filter((a) =>
    form.selectedAccountIds.includes(a.id)
  );
  const selectedPlatforms = new Set(
    selectedAccounts.map((a) => a.platform as Platform)
  );
  const hasReddit = selectedPlatforms.has("reddit");
  const hasYoutube = selectedPlatforms.has("youtube");
  const hasPinterest = selectedPlatforms.has("pinterest");

  const doneFiles = form.files.filter((f) => f.status === "done" && f.uploadResult);
  const allFilesUploaded =
    form.files.length === 0 || form.files.every((f) => f.status === "done");
  const hasFileError = form.files.some((f) => f.status === "error");

  // Media kinds shared across every platform — drives per-account resolution.
  const mediaKinds = doneFiles.map((f) => ({ type: f.kind }));

  // A story needs exactly one photo/video. Offer the toggle only when the media
  // qualifies and at least one selected account is on a story-capable platform.
  const storyCapable = selectedAccounts.some(
    (a) => a.platform === "instagram" || a.platform === "facebook"
  );
  const storyEligible = storyCapable && mediaKinds.length === 1;
  const preferType: PostType | undefined =
    postAsStory && storyEligible ? "story" : undefined;

  // Per-selected-account resolution: which post type each account will use, or null.
  const resolutions = selectedAccounts.map((a) => ({
    account: a,
    type: resolvePostTypeForPlatform(a.platform as Platform, mediaKinds, preferType),
  }));

  // Accounts grouped by platform (only platforms that actually have accounts).
  const groups = PLATFORMS.map((platform) => ({
    platform,
    accts: accounts.filter((a) => a.platform === platform),
  })).filter((g) => g.accts.length > 0);

  const allIds = accounts.map((a) => a.id);
  const allSelected =
    allIds.length > 0 && allIds.every((id) => form.selectedAccountIds.includes(id));

  // ── Selection handlers ───────────────────────────────────────────────────

  const toggleAccount = (id: string) =>
    setForm((f) => ({
      ...f,
      selectedAccountIds: f.selectedAccountIds.includes(id)
        ? f.selectedAccountIds.filter((x) => x !== id)
        : [...f.selectedAccountIds, id],
    }));

  const toggleAll = () =>
    setForm((f) => ({ ...f, selectedAccountIds: allSelected ? [] : allIds }));

  const togglePlatform = (platform: Platform) => {
    const ids = accounts.filter((a) => a.platform === platform).map((a) => a.id);
    setForm((f) => {
      const allOn = ids.every((id) => f.selectedAccountIds.includes(id));
      return {
        ...f,
        selectedAccountIds: allOn
          ? f.selectedAccountIds.filter((id) => !ids.includes(id))
          : Array.from(new Set([...f.selectedAccountIds, ...ids])),
      };
    });
  };

  const handleFilesChange = useCallback((files: UploadedFile[]) => {
    setForm((f) => ({ ...f, files }));
  }, []);

  const resetForm = () => {
    setStep(0);
    setResult(null);
    setSubmitError(null);
    setForm(initialForm());
    setUploaderKey((k) => k + 1);
  };

  // ── Validation per step ──────────────────────────────────────────────────

  function canAdvance(): boolean {
    switch (step) {
      case 0:
        return form.selectedAccountIds.length > 0;
      case 1:
        return allFilesUploaded && !hasFileError;
      case 2:
        return (
          (form.caption.trim().length > 0 || doneFiles.length > 0) &&
          form.caption.length <= CAPTION_LIMIT &&
          (form.scheduleMode === "now" || !!form.scheduledAt)
        );
      default:
        return true;
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      const scheduledAt =
        form.scheduleMode === "later" && form.scheduledAt
          ? toIso(form.scheduledAt)
          : null;

      const assetPaths = doneFiles.map((f, idx) => ({
        filePath: f.uploadResult!.filePath,
        filename: f.uploadResult!.filename,
        size: f.uploadResult!.size,
        mimeType: f.mimeType,
        type: f.kind,
        order: idx,
      }));

      // Only send options relevant to the platforms actually selected.
      const options: PostOptions = {};
      if (hasReddit && form.subreddit.trim()) options.subreddit = form.subreddit.trim();
      if (hasYoutube) options.visibility = form.visibility;
      if (hasPinterest && form.board.trim()) options.board = form.board.trim();

      const res = await api.posts.createBatch({
        socialAccountIds: form.selectedAccountIds,
        caption: form.caption,
        scheduledAt,
        assetPaths,
        ...(Object.keys(options).length > 0 ? { options } : {}),
        ...(preferType ? { preferType } : {}),
      });

      setResult(res);
      const createdCount = res.created.length;
      const skippedCount = res.skipped.length;
      if (createdCount === 0) {
        toast.error("No posts were created — all accounts were skipped");
      } else {
        toast.success(
          `${createdCount} post${createdCount !== 1 ? "s" : ""} created${
            skippedCount > 0 ? ` · ${skippedCount} skipped` : ""
          }`
        );
      }
      setStep(4); // "done" pseudo-step
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submission failed";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render step content ───────────────────────────────────────────────────

  function renderStep() {
    // ── Done / confirmation ──────────────────────────────────────────────
    if (step === 4 && result) {
      const created = result.created;
      const skipped = result.skipped;
      const accountLabel = (id: string) => {
        const a = accounts.find((acc) => acc.id === id);
        return a ? `@${a.username}` : id;
      };

      return (
        <div className="space-y-6 py-2">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/60">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold tracking-tight">
                {created.length > 0
                  ? form.scheduleMode === "later"
                    ? "Posts scheduled"
                    : "Posts created"
                  : "Nothing to post"}
              </h2>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                {created.length} post{created.length !== 1 ? "s" : ""} created
                {skipped.length > 0
                  ? ` · ${skipped.length} skipped`
                  : ""}
                {form.scheduleMode === "later" && created.length > 0
                  ? ` — scheduled for ${formatLocalDisplay(form.scheduledAt)}`
                  : ""}
                .
              </p>
            </div>
          </div>

          {/* Created list */}
          {created.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Created
              </p>
              <ul className="overflow-hidden rounded-xl border border-border">
                {created.map((post) => (
                  <li
                    key={post.id}
                    className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5 text-sm last:border-b-0"
                  >
                    <PlatformDot platform={post.platform as Platform} />
                    <span className="truncate font-medium capitalize text-foreground">
                      {post.account ? `@${post.account.username}` : post.platform}
                    </span>
                    <Badge variant="secondary" className="ml-auto capitalize">
                      <span className="mr-1 inline-flex">
                        {postTypeIcon(post.type as PostType)}
                      </span>
                      {post.type}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Skipped list */}
          {skipped.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Skipped
              </p>
              <ul className="overflow-hidden rounded-xl border border-amber-100">
                {skipped.map((s) => (
                  <li
                    key={s.accountId}
                    className="flex items-start gap-2.5 border-b border-amber-100 bg-amber-50/60 px-4 py-2.5 text-sm last:border-b-0"
                  >
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0">
                      <span className="font-medium text-amber-800">
                        {accountLabel(s.accountId)}
                        {s.platform ? ` · ${s.platform}` : ""}
                      </span>
                      <p className="text-amber-700">{s.reason}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex w-full flex-col gap-3 pt-1 sm:flex-row sm:justify-center">
            <Button asChild>
              <Link href="/posts">View all posts</Link>
            </Button>
            <Button variant="outline" onClick={resetForm}>
              Create another post
            </Button>
          </div>
        </div>
      );
    }

    // ── Step 0: Accounts (multi-select) ──────────────────────────────────
    if (step === 0) {
      return (
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-foreground">
                Select accounts to cross-post to
              </h2>
              <p className="text-xs text-muted-foreground">
                Pick one or many across any platforms. We&rsquo;ll fan out one
                submission to all of them.
              </p>
            </div>
            {accounts.length > 0 && (
              <Button variant="outline" size="sm" onClick={toggleAll}>
                <Users className="h-3.5 w-3.5" />
                {allSelected ? "Clear all" : "Select all"}
              </Button>
            )}
          </div>

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
          ) : accounts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                No accounts connected.{" "}
                <Link
                  href="/accounts/new"
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Add one
                </Link>
              </span>
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((group) => {
                const groupIds = group.accts.map((a) => a.id);
                const groupAllOn = groupIds.every((id) =>
                  form.selectedAccountIds.includes(id)
                );
                return (
                  <fieldset key={group.platform} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <legend className="flex items-center gap-2 text-sm font-medium capitalize text-foreground">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface text-foreground">
                          <PlatformIcon platform={group.platform} className="h-3.5 w-3.5" />
                        </span>
                        {group.platform}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({group.accts.length})
                        </span>
                      </legend>
                      <button
                        type="button"
                        onClick={() => togglePlatform(group.platform)}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {groupAllOn ? "Deselect all" : "Select all"}
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {group.accts.map((a) => {
                        const selected = form.selectedAccountIds.includes(a.id);
                        return (
                          <label key={a.id} className={radioCardClasses(selected)}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleAccount(a.id)}
                              className="sr-only"
                            />
                            <span className="flex min-w-0 items-center gap-3">
                              <Avatar size="md" fallback={a.username.slice(0, 2)} />
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate text-sm font-medium text-foreground">
                                  @{a.username}
                                </span>
                                <Badge status={a.status} showDot className="mt-1 w-fit" />
                              </span>
                            </span>
                            <span
                              className={cn(
                                "absolute right-3 top-3 flex h-4 w-4 items-center justify-center rounded",
                                selected
                                  ? "bg-primary text-primary-foreground"
                                  : "border border-border"
                              )}
                            >
                              {selected && <Check className="h-3 w-3" />}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          )}

          {form.selectedAccountIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {form.selectedAccountIds.length} account
              {form.selectedAccountIds.length !== 1 ? "s" : ""} selected across{" "}
              {selectedPlatforms.size} platform
              {selectedPlatforms.size !== 1 ? "s" : ""}.
            </p>
          )}
        </div>
      );
    }

    // ── Step 1: Media (shared) ───────────────────────────────────────────
    if (step === 1) {
      return (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-foreground">Upload media</h2>
              <p className="text-xs text-muted-foreground">
                Shared across all selected accounts. Optional — leave empty for a
                text-only post. JPG, PNG, WEBP, MP4, MOV, AVI.
              </p>
            </div>
            <Badge variant="secondary">Optional</Badge>
          </div>

          <MediaUploader
            key={uploaderKey}
            maxFiles={SHARED_MAX_FILES}
            allowVideo
            allowMultiple
            onFilesChange={handleFilesChange}
          />

          {form.files.length > 0 && !allFilesUploaded && !hasFileError && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Uploading {form.files.filter((f) => f.status !== "done").length} file(s)…
            </p>
          )}

          {hasFileError && (
            <p className="flex items-center gap-1.5 text-xs text-rose-600">
              <AlertCircle className="h-3.5 w-3.5" />
              Some files failed to upload. Remove them and try again.
            </p>
          )}

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Each platform picks the best post type for this media automatically.
            Accounts that can&rsquo;t accept it are flagged in the review step.
          </p>
        </div>
      );
    }

    // ── Step 2: Caption, schedule & options ──────────────────────────────
    if (step === 2) {
      return (
        <div className="space-y-8">
          {/* Caption */}
          <div className="space-y-2">
            <Label htmlFor="caption" required={doneFiles.length === 0}>
              Caption
            </Label>
            <Textarea
              id="caption"
              rows={6}
              value={form.caption}
              onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))}
              placeholder="Write a caption to share across your selected accounts…"
              showCount
              maxCount={CAPTION_LIMIT}
            />
            {doneFiles.length === 0 && form.caption.trim().length === 0 && (
              <p className="text-xs text-muted-foreground">
                A caption is required when there&rsquo;s no media.
              </p>
            )}
          </div>

          {/* Post as Story (Instagram / Facebook, single photo or video) */}
          {storyEligible && (
            <label className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={postAsStory}
                onChange={(e) => setPostAsStory(e.target.checked)}
              />
              <span className="text-sm">
                <span className="font-medium text-foreground">Post as Story</span>
                <span className="block text-xs text-muted-foreground">
                  Publishes a 24-hour Story on Instagram/Facebook (via the Android
                  emulator). Other selected platforms post normally.
                </span>
              </span>
            </label>
          )}

          {/* Platform-specific options — only shown when a relevant account is selected */}
          {(hasReddit || hasYoutube || hasPinterest) && (
            <fieldset className="space-y-4 rounded-xl border border-border bg-surface/60 p-4">
              <legend className="px-1 text-sm font-medium text-foreground">
                Platform options
              </legend>
              {hasReddit && (
                <div className="space-y-2">
                  <Label htmlFor="subreddit">Subreddit</Label>
                  <Input
                    id="subreddit"
                    value={form.subreddit}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, subreddit: e.target.value }))
                    }
                    placeholder="e.g. test"
                  />
                  <p className="text-xs text-muted-foreground">
                    Reddit community, without the &ldquo;r/&rdquo;. Leave blank to post to
                    your profile (u/you).
                  </p>
                </div>
              )}
              {hasYoutube && (
                <div className="space-y-2">
                  <Label htmlFor="visibility">Visibility</Label>
                  <select
                    id="visibility"
                    value={form.visibility}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        visibility: e.target.value as FormState["visibility"],
                      }))
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none ring-primary/40 transition focus:border-primary focus:ring-2"
                  >
                    <option value="PRIVATE">Private (only you)</option>
                    <option value="UNLISTED">Unlisted (anyone with the link)</option>
                    <option value="PUBLIC">Public</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Applies to your selected YouTube account(s).
                  </p>
                </div>
              )}
              {hasPinterest && (
                <div className="space-y-2">
                  <Label htmlFor="board">Board</Label>
                  <Input
                    id="board"
                    value={form.board}
                    onChange={(e) => setForm((f) => ({ ...f, board: e.target.value }))}
                    placeholder="Board name (blank = your first board)"
                  />
                  <p className="text-xs text-muted-foreground">
                    Pinterest board to pin to.
                  </p>
                </div>
              )}
            </fieldset>
          )}

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
                          selected
                            ? "bg-primary/10 text-primary"
                            : "bg-surface text-muted-foreground"
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
                onChange={(e) =>
                  setForm((f) => ({ ...f, scheduledAt: e.target.value }))
                }
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

    // ── Step 3: Review + Submit ──────────────────────────────────────────
    if (step === 3) {
      const willPost = resolutions.filter((r) => r.type !== null);
      const willSkip = resolutions.filter((r) => r.type === null);

      return (
        <div className="space-y-6">
          <h2 className="text-sm font-medium text-foreground">Review your cross-post</h2>

          {/* Per-account resolution */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Destinations ({resolutions.length})
            </p>
            <ul className="overflow-hidden rounded-xl border border-border">
              {resolutions.map(({ account, type }) => (
                <li
                  key={account.id}
                  className={cn(
                    "flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0",
                    type ? "bg-card" : "bg-amber-50/60"
                  )}
                >
                  <PlatformDot platform={account.platform as Platform} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-foreground">
                      @{account.username}
                    </span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {account.platform}
                    </span>
                  </span>
                  {type ? (
                    <Badge variant="secondary" className="ml-auto capitalize">
                      <span className="mr-1 inline-flex">{postTypeIcon(type)}</span>
                      will post as {type}
                    </Badge>
                  ) : (
                    <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-amber-700">
                      <XCircle className="h-3.5 w-3.5" />
                      will be skipped — {account.platform} can&rsquo;t accept this content
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {willSkip.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {willSkip.length} account{willSkip.length !== 1 ? "s" : ""} will be
                skipped. {willPost.length} will be posted.
              </p>
            )}
          </div>

          {/* Summary */}
          <dl className="overflow-hidden rounded-xl border border-border text-sm">
            <SummaryRow
              label="Media"
              value={
                doneFiles.length > 0
                  ? `${doneFiles.length} file${doneFiles.length !== 1 ? "s" : ""}`
                  : "None (text-only)"
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
            {hasReddit && (
              <SummaryRow
                label="Subreddit"
                value={
                  form.subreddit.trim() ? (
                    `r/${form.subreddit.trim()}`
                  ) : (
                    <span className="italic text-muted-foreground">Your profile</span>
                  )
                }
              />
            )}
            {hasYoutube && (
              <SummaryRow
                label="Visibility"
                value={<span className="capitalize">{form.visibility.toLowerCase()}</span>}
              />
            )}
            {hasPinterest && (
              <SummaryRow
                label="Board"
                value={
                  form.board.trim() ? (
                    form.board.trim()
                  ) : (
                    <span className="italic text-muted-foreground">First board</span>
                  )
                }
              />
            )}
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

          {/* Action button */}
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={submitting || willPost.length === 0}
          >
            {submitting ? (
              <Loader2 className="animate-spin" />
            ) : form.scheduleMode === "now" ? (
              <Clock />
            ) : (
              <Calendar />
            )}
            {submitting
              ? "Submitting…"
              : form.scheduleMode === "now"
              ? `Post now to ${willPost.length} account${willPost.length !== 1 ? "s" : ""}`
              : `Schedule for ${willPost.length} account${willPost.length !== 1 ? "s" : ""}`}
          </Button>
          {willPost.length === 0 && (
            <p className="text-center text-xs text-amber-700">
              No selected account can accept this content. Adjust your media or
              accounts.
            </p>
          )}
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

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
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
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", platformDotClass(platform))}
      aria-hidden="true"
    />
  );
}

function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  if (platform === "instagram") return <Instagram className={className} />;
  if (platform === "tiktok") return <Music2 className={className} />;
  if (platform === "twitter") return <Twitter className={className} />;
  if (platform === "linkedin") return <Linkedin className={className} />;
  if (platform === "youtube") return <Youtube className={className} />;
  if (platform === "facebook") return <Facebook className={className} />;
  if (platform === "bluesky") return <Cloud className={className} />;
  if (platform === "threads") return <AtSign className={className} />;
  if (platform === "pinterest") return <Pin className={className} />;
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
    bluesky: "bg-sky-400",
    threads: "bg-zinc-900",
    pinterest: "bg-red-600",
    facebook: "bg-blue-600",
  };
  return classes[platform];
}
