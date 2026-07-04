/**
 * Lightweight notification helper.
 *
 * When an account is logged out (status → needs_manual_login), we POST a message
 * to an optional webhook so the operator is alerted immediately — before a
 * scheduled post fails. The webhook is compatible with Discord and Slack
 * incoming webhooks (we send both `content` and `text`), and any generic
 * endpoint that accepts JSON.
 *
 * Configure with NOTIFY_WEBHOOK_URL in .env. If unset, we just log a warning.
 */

interface NotifiableAccount {
  id: string;
  platform: string;
  username: string;
}

export async function notifyAccountLoggedOut(account: NotifiableAccount): Promise<void> {
  const base = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
  const message =
    `⚠️ AutoPost: your **${account.platform}** account @${account.username} was logged out ` +
    `and needs re-login. Reconnect it here: ${base}/accounts`;

  console.warn(`[notify] ${message}`);

  const url = process.env.NOTIFY_WEBHOOK_URL?.trim();
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `content` → Discord, `text` → Slack; extra keys are ignored elsewhere.
      body: JSON.stringify({ content: message, text: message }),
    });
  } catch (err) {
    console.error("[notify] webhook failed:", err instanceof Error ? err.message : err);
  }
}
