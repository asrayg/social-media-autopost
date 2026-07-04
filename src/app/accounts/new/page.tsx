"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
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
  ArrowLeft,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Info,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster, toast } from "@/components/ui/toast";
import type { Platform } from "@/lib/platforms";

// ── Platform option ───────────────────────────────────────────────────────────

interface PlatformOption {
  id: Platform;
  label: string;
  icon: React.ReactNode;
  dot: string;
}

const PLATFORMS: PlatformOption[] = [
  {
    id: "instagram",
    label: "Instagram",
    icon: <Instagram className="h-4 w-4" />,
    dot: "bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600",
  },
  {
    id: "tiktok",
    label: "TikTok",
    icon: <Music2 className="h-4 w-4" />,
    dot: "bg-zinc-900",
  },
  {
    id: "twitter",
    label: "Twitter/X",
    icon: <Twitter className="h-4 w-4" />,
    dot: "bg-sky-500",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: <Linkedin className="h-4 w-4" />,
    dot: "bg-blue-700",
  },
  {
    id: "reddit",
    label: "Reddit",
    icon: <MessageCircle className="h-4 w-4" />,
    dot: "bg-orange-600",
  },
  {
    id: "youtube",
    label: "YouTube",
    icon: <Youtube className="h-4 w-4" />,
    dot: "bg-red-600",
  },
  {
    id: "bluesky",
    label: "Bluesky",
    icon: <Cloud className="h-4 w-4" />,
    dot: "bg-sky-400",
  },
  {
    id: "threads",
    label: "Threads",
    icon: <AtSign className="h-4 w-4" />,
    dot: "bg-zinc-900",
  },
  {
    id: "pinterest",
    label: "Pinterest",
    icon: <Pin className="h-4 w-4" />,
    dot: "bg-red-600",
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: <Facebook className="h-4 w-4" />,
    dot: "bg-blue-600",
  },
];

function loginHost(platform: Platform): string {
  const hosts: Record<Platform, string> = {
    instagram: "instagram.com",
    tiktok: "tiktok.com",
    twitter: "x.com",
    linkedin: "linkedin.com",
    reddit: "reddit.com",
    youtube: "youtube.com",
    bluesky: "bsky.app",
    threads: "threads.net",
    pinterest: "pinterest.com",
    facebook: "facebook.com",
  };
  return hosts[platform];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewAccountPage() {
  const router = useRouter();

  const [platform, setPlatform] = useState<Platform>("instagram");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [androidSerial, setAndroidSerial] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectedPlatform = PLATFORMS.find((p) => p.id === platform)!;
  // Bluesky uses the AT Protocol API (handle + app password) — no browser login.
  const isBluesky = platform === "bluesky";
  // Instagram Stories and TikTok carousels are posted via an Android emulator;
  // an optional serial lets same-platform accounts target different emulators.
  const supportsEmulator = platform === "instagram" || platform === "tiktok";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    if (isBluesky && !appPassword.trim()) {
      setError("An app password is required for Bluesky.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const handle = username.trim().replace(/^@/, "");
      const serial = supportsEmulator ? androidSerial.trim() : "";

      if (isBluesky) {
        await api.accounts.create({
          platform,
          username: handle,
          credentials: {
            identifier: handle,
            appPassword: appPassword.trim(),
            ...(serial ? { androidSerial: serial } : {}),
          },
        });
        toast.success("Bluesky account connected");
        setDone(true);
        return;
      }

      const account = await api.accounts.create({
        platform,
        username: handle,
        ...(serial ? { credentials: { androidSerial: serial } } : {}),
      });

      // Browser platforms: immediately open the browser so the user can log in.
      try {
        await api.accounts.openBrowser(account.id);
      } catch {
        // Non-fatal — user can open browser manually from accounts page
      }

      toast.success("Account created", {
        description: `A login browser opened for @${handle}.`,
      });
      setDone(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create account";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md py-6">
        <Card className="animate-fade-in">
          <CardContent className="space-y-5 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                {isBluesky ? "Bluesky connected" : "Account created"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {isBluesky ? (
                  <>
                    <strong className="text-foreground">{username}</strong> is
                    connected via the Bluesky API and ready to post.
                  </>
                ) : (
                  <>
                    A browser window has opened for{" "}
                    <strong className="text-foreground">@{username}</strong> on{" "}
                    <strong className="capitalize text-foreground">{platform}</strong>.
                    Log in manually in that window, then close it when done.
                  </>
                )}
              </p>
            </div>

            {/* Instructions callout (browser platforms only) */}
            {!isBluesky && (
              <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50 p-4 text-left">
                <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                  <Info className="h-4 w-4 flex-shrink-0" />
                  Login instructions
                </div>
                <ol className="list-inside list-decimal space-y-1 text-xs text-blue-700/90">
                  <li>The browser window should be open on your screen.</li>
                  <li>Navigate to {loginHost(platform)} if not already there.</li>
                  <li>Log in with your credentials.</li>
                  <li>Complete any 2FA or CAPTCHA challenges.</li>
                  <li>Once you are logged in and see your feed, close the browser window.</li>
                </ol>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <Button asChild>
                <Link href="/accounts">Go to Accounts</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/accounts/new">Add another account</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Toaster />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg py-6">
      {/* Back link */}
      <Link
        href="/accounts"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Accounts
      </Link>

      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="text-xl">Add Account</CardTitle>
          <CardDescription>
            Connect a social media account. A browser window will open so you can
            log in manually.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Platform selector */}
            <div className="space-y-2">
              <Label htmlFor="platform" required>
                Platform
              </Label>
              <Select
                value={platform}
                onValueChange={(v) => setPlatform(v as Platform)}
              >
                <SelectTrigger id="platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-block h-2.5 w-2.5 rounded-full",
                            p.dot
                          )}
                        />
                        {p.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Username / handle */}
            <div className="space-y-2">
              <Label htmlFor="username" required>
                {isBluesky ? "Handle" : "Username"}
              </Label>
              <div className="relative">
                {!isBluesky && (
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                    @
                  </span>
                )}
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={isBluesky ? "yourname.bsky.social" : "yourhandle"}
                  autoComplete="off"
                  spellCheck={false}
                  required
                  className={isBluesky ? undefined : "pl-7"}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {isBluesky
                  ? "Your full Bluesky handle, e.g. yourname.bsky.social."
                  : `The @ handle used on ${selectedPlatform.label}.`}
              </p>
            </div>

            {/* Bluesky app password */}
            {isBluesky && (
              <div className="space-y-2">
                <Label htmlFor="appPassword" required>
                  App password
                </Label>
                <Input
                  id="appPassword"
                  type="password"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  placeholder="xxxx-xxxx-xxxx-xxxx"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Create one at Bluesky → Settings → App Passwords (not your main
                  password). Stored locally and used only to publish.
                </p>
              </div>
            )}

            {/* Android emulator serial (Instagram Stories / TikTok carousels) */}
            {supportsEmulator && (
              <div className="space-y-2">
                <Label htmlFor="androidSerial">Android emulator serial (optional)</Label>
                <Input
                  id="androidSerial"
                  value={androidSerial}
                  onChange={(e) => setAndroidSerial(e.target.value)}
                  placeholder="emulator-5554"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  {selectedPlatform.label} Stories/carousels post through a
                  logged-in Android emulator. Set a serial (from{" "}
                  <code>adb devices</code>) to run this account on a specific
                  emulator — needed only when several accounts on the same
                  platform each use their own emulator. Leave blank to use the
                  default.
                </p>
              </div>
            )}

            {/* Info callout */}
            <div className="flex gap-3 rounded-lg border border-border bg-surface p-4">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">What happens next</p>
                <p>
                  {isBluesky
                    ? "Bluesky connects instantly via its API — no browser login. Your handle and app password are saved for automated posts."
                    : `After you submit, a browser window will open. Log in with your ${selectedPlatform.label} credentials, then close the window. Your session will be saved for future automated posts.`}
                </p>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                {error}
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              size="lg"
              disabled={submitting || !username.trim() || (isBluesky && !appPassword.trim())}
              className="w-full"
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" />
                  {isBluesky ? "Connecting…" : "Creating account…"}
                </>
              ) : (
                <>
                  <ExternalLink />
                  {isBluesky ? "Connect Bluesky" : "Create Account & Open Browser"}
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Toaster />
    </div>
  );
}
