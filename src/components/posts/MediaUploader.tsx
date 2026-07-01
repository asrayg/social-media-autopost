"use client";

import React, { useCallback, useRef, useState } from "react";
import { Upload, X, GripVertical, Film, AlertCircle, CheckCircle2, Loader2, Link as LinkIcon, Info } from "lucide-react";
import { api, UploadResult } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UploadedFile {
  id: string;
  /** Present for drag-and-drop / browse uploads; undefined for URL ingests. */
  file?: File;
  /** Where the asset came from. */
  source: "upload" | "url";
  /** Object URL (uploads) or served asset URL (URL ingests) for the thumbnail. */
  previewUrl: string;
  /** Canonical metadata — populated identically for uploads and URL ingests. */
  filename: string;
  mimeType: string;
  size: number;
  kind: "image" | "video";
  uploadResult?: UploadResult;
  progress: number; // 0-100
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

/** Per-asset shape returned by POST /api/ingest-url (mirrors /api/upload). */
interface IngestAsset {
  filePath: string;
  filename: string;
  size: number;
  mimeType: string;
  type: "image" | "video";
  order: number;
}

interface MediaUploaderProps {
  maxFiles?: number;
  allowVideo?: boolean;
  allowMultiple?: boolean;
  onFilesChange?: (files: UploadedFile[]) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/x-msvideo"];

function isValidType(file: File, allowVideo: boolean): boolean {
  if (IMAGE_TYPES.includes(file.type)) return true;
  if (allowVideo && VIDEO_TYPES.includes(file.type)) return true;
  return false;
}

function isVideo(file: File): boolean {
  return VIDEO_TYPES.includes(file.type);
}

/** Build a URL the UI can render for a server-side file path (see /api/assets). */
function assetPreviewUrl(filePath: string): string {
  return `/api/assets/${encodeURIComponent(filePath)}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let idCounter = 0;
function nextId(): string {
  return `upload-${Date.now()}-${++idCounter}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MediaUploader({
  maxFiles = 10,
  allowVideo = true,
  allowMultiple = true,
  onFilesChange,
}: MediaUploaderProps) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [urlValue, setUrlValue] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ── Upload logic ─────────────────────────────────────────────────────────

  const uploadFile = useCallback(
    async (entry: UploadedFile, setFilesState: React.Dispatch<React.SetStateAction<UploadedFile[]>>) => {
      // Only drag-drop / browse entries carry a File to POST; URL ingests skip this.
      if (!entry.file) return;
      const file = entry.file;

      setFilesState((prev) =>
        prev.map((f) => (f.id === entry.id ? { ...f, status: "uploading", progress: 10 } : f))
      );

      try {
        // Simulate progress while uploading (real XHR progress would need custom fetch)
        const progressInterval = setInterval(() => {
          setFilesState((prev) =>
            prev.map((f) =>
              f.id === entry.id && f.progress < 85
                ? { ...f, progress: f.progress + Math.random() * 15 }
                : f
            )
          );
        }, 300);

        const result = await api.upload.file(file);

        clearInterval(progressInterval);

        setFilesState((prev) => {
          const updated = prev.map((f) =>
            f.id === entry.id
              ? { ...f, uploadResult: result, status: "done" as const, progress: 100 }
              : f
          );
          onFilesChange?.(updated);
          return updated;
        });
      } catch (err) {
        setFilesState((prev) => {
          const updated = prev.map((f) =>
            f.id === entry.id
              ? {
                  ...f,
                  status: "error" as const,
                  progress: 0,
                  error: err instanceof Error ? err.message : "Upload failed",
                }
              : f
          );
          onFilesChange?.(updated);
          return updated;
        });
      }
    },
    [onFilesChange]
  );

  const addFiles = useCallback(
    (incoming: File[]) => {
      const valid = incoming.filter((f) => isValidType(f, allowVideo));
      const remaining = maxFiles - files.length;
      const toAdd = valid.slice(0, remaining);

      if (toAdd.length === 0) return;

      const newEntries: UploadedFile[] = toAdd.map((f) => ({
        id: nextId(),
        file: f,
        source: "upload",
        previewUrl: URL.createObjectURL(f),
        filename: f.name,
        mimeType: f.type,
        size: f.size,
        kind: isVideo(f) ? "video" : "image",
        progress: 0,
        status: "pending",
      }));

      setFiles((prev) => {
        const updated = [...prev, ...newEntries];
        return updated;
      });

      // Start uploading each new entry
      newEntries.forEach((entry) => uploadFile(entry, setFiles));
    },
    [files.length, maxFiles, allowVideo, uploadFile]
  );

  // ── Add from URL (public link → /api/ingest-url) ──────────────────────────

  const ingestUrls = useCallback(async () => {
    setUrlError(null);

    // Support multiple URLs separated by commas, newlines, or whitespace.
    const urls = urlValue
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter(Boolean);

    if (urls.length === 0) {
      setUrlError("Paste at least one URL.");
      return;
    }

    const remaining = maxFiles - files.length;
    if (remaining <= 0) {
      setUrlError(`Maximum ${maxFiles} file${maxFiles !== 1 ? "s" : ""} reached.`);
      return;
    }

    setIngesting(true);
    try {
      const res = await fetch("/api/ingest-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urls.slice(0, remaining) }),
      });

      if (!res.ok) {
        let message = `Import failed with status ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          // ignore JSON parse error
        }
        throw new Error(message);
      }

      const data = (await res.json()) as { assets?: IngestAsset[] };
      const assets = Array.isArray(data.assets) ? data.assets : [];

      // Enforce the same media-type rule as drag-and-drop uploads.
      const accepted = assets.filter((a) => allowVideo || a.type !== "video");
      const skippedForType = assets.length - accepted.length;

      const newEntries: UploadedFile[] = accepted.slice(0, remaining).map((a) => ({
        id: nextId(),
        source: "url" as const,
        previewUrl: assetPreviewUrl(a.filePath),
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        kind: a.type,
        // Reuse the exact shape uploaded files carry so the submit path is identical.
        uploadResult: {
          filePath: a.filePath,
          filename: a.filename,
          size: a.size,
          type: a.type,
        },
        progress: 100,
        status: "done" as const,
      }));

      if (newEntries.length === 0) {
        setUrlError(
          skippedForType > 0
            ? "Videos aren't allowed for this post type."
            : "No media could be imported from that link."
        );
        return;
      }

      setFiles((prev) => {
        const updated = [...prev, ...newEntries];
        onFilesChange?.(updated);
        return updated;
      });
      setUrlValue("");

      if (skippedForType > 0) {
        setUrlError("Some videos were skipped — not allowed for this post type.");
      }
      toast.success(
        `Added ${newEntries.length} item${newEntries.length !== 1 ? "s" : ""} from URL`
      );
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setIngesting(false);
    }
  }, [urlValue, maxFiles, files.length, allowVideo, onFilesChange]);

  // ── Drag-drop handlers ────────────────────────────────────────────────────

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      addFiles(dropped);
    },
    [addFiles]
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files ?? []);
      addFiles(selected);
      e.target.value = "";
    },
    [addFiles]
  );

  // ── Reorder (carousel drag) ───────────────────────────────────────────────

  const onItemDragStart = useCallback((index: number) => {
    dragItem.current = index;
  }, []);

  const onItemDragEnter = useCallback((index: number) => {
    dragOverItem.current = index;
    setDragOverIndex(index);
  }, []);

  const onItemDragEnd = useCallback(() => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) {
      dragItem.current = null;
      dragOverItem.current = null;
      setDragOverIndex(null);
      return;
    }

    setFiles((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(dragItem.current!, 1);
      copy.splice(dragOverItem.current!, 0, moved);
      onFilesChange?.(copy);
      return copy;
    });

    dragItem.current = null;
    dragOverItem.current = null;
    setDragOverIndex(null);
  }, [onFilesChange]);

  // ── Remove file ───────────────────────────────────────────────────────────

  const removeFile = useCallback(
    (id: string) => {
      setFiles((prev) => {
        const target = prev.find((f) => f.id === id);
        // Only object URLs (drag-drop uploads) need revoking; URL ingests use a server path.
        if (target?.source === "upload") URL.revokeObjectURL(target.previewUrl);
        const updated = prev.filter((f) => f.id !== id);
        onFilesChange?.(updated);
        return updated;
      });
    },
    [onFilesChange]
  );

  // ── Accepted types string ─────────────────────────────────────────────────

  const acceptStr = [
    "image/jpeg",
    "image/png",
    "image/webp",
    ...(allowVideo ? ["video/mp4", "video/quicktime", "video/x-msvideo"] : []),
  ].join(",");

  const canAddMore = files.length < maxFiles;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      {canAddMore && (
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "group relative flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 cursor-pointer select-none",
            "transition-[background-color,border-color] duration-150",
            isDragging
              ? "border-primary bg-primary/[0.04] ring-2 ring-ring/30"
              : "border-border-strong bg-surface/60 hover:border-primary/50 hover:bg-surface-hover"
          )}
        >
          <div
            className={cn(
              "flex items-center justify-center h-11 w-11 rounded-full transition-colors",
              isDragging ? "bg-primary/10 text-primary" : "bg-background text-muted-foreground shadow-soft group-hover:text-primary"
            )}
          >
            <Upload className="h-5 w-5" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              {isDragging ? (
                "Drop to upload"
              ) : (
                <>
                  Drag &amp; drop or{" "}
                  <span className="text-primary">browse files</span>
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {allowVideo ? "JPG, PNG, WEBP, MP4, MOV, AVI" : "JPG, PNG, WEBP"}
              {" · "}up to {maxFiles} file{maxFiles !== 1 ? "s" : ""}
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptStr}
            multiple={allowMultiple}
            onChange={onInputChange}
            className="sr-only"
          />
        </div>
      )}

      {/* Add from URL */}
      {canAddMore && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium text-muted-foreground">or add from a URL</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="flex items-start gap-2">
            <Input
              type="url"
              value={urlValue}
              onChange={(e) => {
                setUrlValue(e.target.value);
                if (urlError) setUrlError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  ingestUrls();
                }
              }}
              placeholder="Paste a public Google Drive or direct media URL"
              error={urlError ?? undefined}
              disabled={ingesting}
            />
            <Button
              type="button"
              variant="outline"
              onClick={ingestUrls}
              disabled={ingesting || urlValue.trim().length === 0}
            >
              {ingesting ? <Loader2 className="animate-spin" /> : <LinkIcon />}
              Add
            </Button>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Google Drive links must be shared as &ldquo;Anyone with the link&rdquo;. Separate
            multiple links with commas or new lines.
          </p>
        </div>
      )}

      {/* Thumbnail grid */}
      {files.length > 0 && (
        <>
          {allowMultiple && files.length > 1 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <GripVertical className="h-3.5 w-3.5" />
              Drag to reorder — the first item is your cover.
            </p>
          )}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {files.map((f, idx) => (
              <li
                key={f.id}
                draggable={allowMultiple}
                onDragStart={() => onItemDragStart(idx)}
                onDragEnter={() => onItemDragEnter(idx)}
                onDragEnd={onItemDragEnd}
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-lg border border-border bg-surface shadow-soft transition-shadow",
                  allowMultiple && "cursor-grab active:cursor-grabbing",
                  dragOverIndex === idx && "ring-2 ring-ring shadow-card"
                )}
              >
                {/* Thumbnail */}
                {f.kind === "video" ? (
                  <div className="flex h-full w-full items-center justify-center bg-surface-hover text-muted-foreground">
                    <Film className="h-7 w-7" />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.previewUrl}
                    alt={f.filename}
                    className="h-full w-full object-cover"
                  />
                )}

                {/* Order badge */}
                {allowMultiple && (
                  <span className="absolute left-1.5 top-1.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md bg-foreground/70 px-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                    {idx + 1}
                  </span>
                )}

                {/* Remove */}
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-foreground/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Remove ${f.filename}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>

                {/* Uploading overlay */}
                {f.status === "uploading" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-[1px]">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <div className="h-1 w-3/4 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${Math.min(f.progress, 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                      {Math.round(f.progress)}%
                    </span>
                  </div>
                )}

                {/* Error overlay */}
                {f.status === "error" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-rose-50/90 px-2 text-center">
                    <AlertCircle className="h-4 w-4 text-rose-600" />
                    <span className="text-[11px] font-medium leading-tight text-rose-700">
                      {f.error ?? "Upload failed"}
                    </span>
                  </div>
                )}

                {/* Meta footer */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-foreground/70 to-transparent px-2 pb-1.5 pt-4">
                  <span className="truncate text-[11px] font-medium text-white/90">
                    {formatSize(f.size)}
                  </span>
                  {f.status === "done" && (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {files.length >= maxFiles && (
        <p className="text-center text-xs text-muted-foreground">
          Maximum {maxFiles} file{maxFiles !== 1 ? "s" : ""} reached.
        </p>
      )}
    </div>
  );
}
