# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in AutoPost, please report it
**privately**. Do not open a public GitHub issue for security problems.

Email: **asraygopa@gmail.com** with the subject line `AutoPost security`.

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (proof of concept if possible).
- The affected version, commit, or file(s).

You will receive an acknowledgement as soon as reasonably possible. Please give
maintainers a reasonable window to investigate and release a fix before any
public disclosure.

## Supported versions

This is a self-hosted, community project under active development. Security
fixes are applied to the latest `main` branch. There is no long-term support
guarantee for older versions.

## Handling secrets and sensitive data

AutoPost stores sensitive data on the machine you run it on. Keep the following
in mind:

- **Never commit secrets.** `.env` and all `.env.*.local` files are listed in
  [`.gitignore`](.gitignore) and must never be committed. They contain your
  database URL, Redis URL, `NEXTAUTH_SECRET`, and TikTok API credentials.
- **Never commit browser sessions.** The `sessions/` directory holds persistent
  Chromium profiles including live authentication cookies for your Instagram and
  TikTok accounts. It is gitignored. Anyone with these files can impersonate
  your logged-in accounts. Treat them like passwords.
- **Never commit media, logs, or processed files.** `uploads/`, `processed/`,
  and `logs/` are gitignored. Failure screenshots and logs under `logs/` may
  contain your real feed, direct messages, or other private content. Do not
  publish them.
- **Rotate credentials** (`NEXTAUTH_SECRET`, database/Redis passwords, TikTok
  API keys) if you suspect they were exposed.

If you accidentally commit any of the above, rotate the affected credentials
immediately and rewrite history before pushing to a public remote.
