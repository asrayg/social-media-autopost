# Android Emulator Setup (TikTok carousels & Instagram Stories)

A few post types simply don't exist on the web and can't be done with browser
automation:

| Post type | Why the web can't do it |
|---|---|
| **TikTok photo carousel** | TikTok's web uploader is video-only; native carousels are a mobile-only feature. |
| **Instagram Story** | Instagram's web has no story-creation UI at all. |

AutoPost posts these by driving the **real Android apps** (TikTok Lite,
Instagram) on a local **Android emulator** via `adb`/uiautomator. You set the
emulator up once, log in by hand, and the worker reuses that session for every
future post.

Everything here works on **macOS, Linux, and Windows** — the Android SDK, the
emulator, and `adb` are all cross-platform. Only paths and the binary name
(`adb.exe` on Windows) differ, and AutoPost auto-detects those.

> Prefer not to run an emulator? Leave `TIKTOK_CAROUSEL_MODE=api` unset only if
> you have an approved TikTok Content Posting API app; otherwise carousels and
> Instagram Stories are simply skipped, and every other post type still works
> through the normal browser/API paths.

---

## 1. Install the Android SDK + emulator

The simplest route is **Android Studio** (bundles the SDK, emulator, and an AVD
manager): <https://developer.android.com/studio>. During first-run setup let it
install the "Android SDK", "Android SDK Platform", and "Android Emulator".

That gives you an SDK at:

- **macOS:** `~/Library/Android/sdk`
- **Linux:** `~/Android/Sdk`
- **Windows:** `%LOCALAPPDATA%\Android\Sdk`

Put the tools on your `PATH` (adjust for your OS):

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"        # or ~/Android/Sdk on Linux
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

AutoPost auto-resolves `adb` from `ANDROID_HOME` / `ANDROID_SDK_ROOT` / the
default SDK location, or you can point it at a specific binary with `ADB_PATH`.

## 2. Create a Play Store emulator (AVD)

You need a **Play Store** system image (so you can install TikTok/Instagram from
the Store). A plain `google_apis` image has no Play Store.

```bash
# Download a Play Store image (≈2 GB). Pick your CPU ABI:
#   Apple Silicon → arm64-v8a   |   Intel/AMD → x86_64
sdkmanager "system-images;android-35;google_apis_playstore;arm64-v8a"

# Create the AVD (a Pixel 7 profile works well)
avdmanager create avd -n AutoPost_Pixel7 \
  -k "system-images;android-35;google_apis_playstore;arm64-v8a" -d pixel_7

# Boot it
emulator -avd AutoPost_Pixel7
```

> **Disk:** a Play Store image + a booted AVD needs ~6–8 GB free.
> **Headless Linux servers:** run the emulator under a virtual display, e.g.
> `xvfb-run emulator -avd AutoPost_Pixel7 -no-window`.

## 3. Install the apps and log in (one time, by hand)

In the running emulator:

1. Open the **Play Store**, sign in with any Google account.
2. Install **TikTok** (for carousels) and/or **Instagram** (for Stories).
   - For TikTok carousels, **TikTok Lite** (`com.tiktok.lite.go`) also works and
     is lighter; the driver targets it by default (override with
     `TT_ANDROID_PKG`).
3. Open each app and **log in to your account**. Complete any 2FA/SMS prompts.

The session persists inside the AVD, so you only do this once per account.
Logins can't be automated (and doing them for you would risk the account), so
this step is always a human step.

## 4. Verify AutoPost can see the emulator

```bash
adb devices          # should list e.g. "emulator-5554   device"
```

That's it. With the emulator running and logged in, the worker posts TikTok
carousels and Instagram Stories automatically — from the web UI, the CLI, or the
API — just like any other post type.

- **TikTok carousel:** attach ≥2 images to a TikTok account; the type
  auto-resolves to `carousel`.
- **Instagram Story:** in the web UI tick **"Post as Story"** (single photo/video
  + an Instagram account selected); in the CLI pass `--type story`.

---

## Multiple accounts on the same platform

An emulator holds **one logged-in session per app**. To post to several accounts
on the *same* platform, run **one emulator per account** and tell each account
which emulator to use.

```bash
# Boot two emulators (they get distinct serials: emulator-5554, emulator-5556, …)
emulator -avd AutoPost_AcctA &
emulator -avd AutoPost_AcctB &
adb devices        # note each serial

# Tag each account with its emulator:
#   CLI
autopost accounts add --platform instagram --username acctA --android-serial emulator-5554
autopost accounts add --platform instagram --username acctB --android-serial emulator-5556
#   Web UI: the "Android emulator serial" field on Add Account
```

The driver reads `androidSerial` from the account and runs `adb -s <serial>`
against the right emulator. If you only have one emulator, leave it blank (or set
`TT_ANDROID_SERIAL` globally) and every account uses that one.

---

## Configuration reference

All optional — defaults target a 1080×2400 Pixel-7 AVD.

| Env var | Purpose |
|---|---|
| `TIKTOK_CAROUSEL_MODE` | `android` (default) drives the emulator; `api` uses the official Content Posting API. |
| `ADB_PATH` | Explicit path to the `adb` binary (else auto-resolved). |
| `TT_ANDROID_SERIAL` | Default emulator serial when an account has none. |
| `TT_ANDROID_PKG` | TikTok package (default `com.tiktok.lite.go`). |
| `IG_ANDROID_PKG` | Instagram package (default `com.instagram.android`). |
| `TT_ANDROID_PLUS` / `TT_ANDROID_EDITOR_NEXT` / `TT_ANDROID_CAPTION` / `TT_ANDROID_POST` | Screen-tap coordinates for TikTok's native editor/post pages (see below). |
| `IG_ANDROID_FIRST_RECENT` | Screen-tap coordinate for the first tile in Instagram's story picker. |

### About the screen coordinates

TikTok's and Instagram's photo editors are drawn on a native/GL surface that
uiautomator can't inspect, so a few taps use fixed screen coordinates. The
defaults are for a **1080×2400** Pixel-7 AVD. If your AVD has a different
resolution — or an app update moves a button — override the relevant `*_x,y`
env var (e.g. `TT_ANDROID_POST=794,2232`). Everything else (opening the app,
the gallery picker, selecting/verifying images) is driven by accessible
uiautomator nodes and adapts automatically.
