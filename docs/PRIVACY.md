# Privacy Policy — AutoPost

_Last updated: 2026-07-01_

AutoPost is an open-source, self-hostable application. This policy explains how the
Software handles data. Because AutoPost is self-hosted, the person or organization
that runs it ("the Operator") is the data controller for any data it processes.

## 1. What data is processed
- **Social account connections.** When you connect a TikTok or Instagram account,
  the Software stores authentication tokens and/or browser session data locally on
  the Operator's own machine/server so it can publish on your behalf.
- **Content you create.** Captions, media files, schedules, and post status are
  stored in the Operator's own database.
- **Publishing logs.** The Software records the outcome of publish attempts
  (success/failure, timestamps, error messages, and optional screenshots) locally
  for debugging.

## 2. Where data is stored
All data is stored locally in the Operator's own environment (database, filesystem,
and browser session directories). The AutoPost authors do not receive, collect, or
have access to any of this data.

## 3. Third parties
The Software sends content to the platforms you explicitly connect (e.g. TikTok,
Instagram) in order to publish it, using those platforms' official APIs or web
interfaces. Their handling of that data is governed by their own privacy policies.
AutoPost does not sell or share your data with any other third party.

## 4. TikTok data
When you connect a TikTok account via the TikTok Content Posting API, the Software
stores the OAuth access/refresh tokens locally and uses them only to publish the
posts you create. Tokens can be revoked at any time from your TikTok account
settings, which immediately disables publishing.

## 5. Retention & deletion
Data persists until the Operator deletes it (e.g. removing an account disconnects
and deletes its stored tokens/session). Uninstalling the Software and deleting its
data directories removes all stored data.

## 6. Security
Secrets (tokens, session data, environment variables) are kept out of version
control and stored locally. Operators are responsible for securing their own host.

## 7. Contact
Questions: open an issue at https://github.com/asrayg/social-media-autopost
