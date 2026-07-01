/**
 * Time utility helpers used by the scheduler and UI.
 */

/**
 * Returns the number of milliseconds from now until `scheduledAt`.
 * Returns 0 (or a small positive number) if the date is in the past,
 * so BullMQ jobs are enqueued immediately rather than with a negative delay.
 */
export function toScheduleDelay(scheduledAt: Date): number {
  const ms = scheduledAt.getTime() - Date.now();
  return Math.max(0, ms);
}

/**
 * Formats a Date into a human-readable string such as
 * "Jun 30, 2026, 3:45 PM".
 */
export function formatScheduledAt(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Returns true if the given date is strictly before the current moment.
 */
export function isInPast(date: Date): boolean {
  return date.getTime() < Date.now();
}

/**
 * Returns a new Date that is `mins` minutes after `date`.
 * Does not mutate the original Date object.
 */
export function addMinutes(date: Date, mins: number): Date {
  return new Date(date.getTime() + mins * 60_000);
}
