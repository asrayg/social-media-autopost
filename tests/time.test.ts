import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toScheduleDelay,
  formatScheduledAt,
  isInPast,
  addMinutes,
} from "@/lib/time";

afterEach(() => {
  vi.useRealTimers();
});

describe("toScheduleDelay", () => {
  it("returns a positive delay for a future date", () => {
    const now = new Date("2026-06-30T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const future = new Date(now.getTime() + 5 * 60_000); // +5 min
    expect(toScheduleDelay(future)).toBe(5 * 60_000);
  });

  it("returns 0 for a past date (never negative)", () => {
    const now = new Date("2026-06-30T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const past = new Date(now.getTime() - 60_000); // -1 min
    expect(toScheduleDelay(past)).toBe(0);
  });

  it("returns 0 for the current instant", () => {
    const now = new Date("2026-06-30T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(toScheduleDelay(new Date(now.getTime()))).toBe(0);
  });
});

describe("formatScheduledAt", () => {
  it("formats a date into a human-readable en-US string", () => {
    // Use an explicit local-time date to avoid timezone flakiness on the parts we assert.
    const date = new Date(2026, 5, 30, 15, 45); // Jun 30 2026, 3:45 PM local
    const formatted = formatScheduledAt(date);

    expect(formatted).toContain("Jun");
    expect(formatted).toContain("30");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("3:45");
    expect(formatted).toContain("PM");
  });

  it("uses 2-digit minutes", () => {
    const date = new Date(2026, 0, 1, 9, 5); // Jan 1 2026, 9:05 AM
    const formatted = formatScheduledAt(date);
    expect(formatted).toContain("9:05");
    expect(formatted).toContain("AM");
  });
});

describe("isInPast", () => {
  it("returns true for a date strictly before now", () => {
    const now = new Date("2026-06-30T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(isInPast(new Date(now.getTime() - 1))).toBe(true);
  });

  it("returns false for a future date", () => {
    const now = new Date("2026-06-30T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(isInPast(new Date(now.getTime() + 60_000))).toBe(false);
  });

  it("returns false for the exact current instant", () => {
    const now = new Date("2026-06-30T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(isInPast(new Date(now.getTime()))).toBe(false);
  });
});

describe("addMinutes", () => {
  it("adds positive minutes", () => {
    const base = new Date("2026-06-30T12:00:00.000Z");
    const result = addMinutes(base, 30);
    expect(result.toISOString()).toBe("2026-06-30T12:30:00.000Z");
  });

  it("subtracts with negative minutes", () => {
    const base = new Date("2026-06-30T12:00:00.000Z");
    const result = addMinutes(base, -15);
    expect(result.toISOString()).toBe("2026-06-30T11:45:00.000Z");
  });

  it("does not mutate the original date", () => {
    const base = new Date("2026-06-30T12:00:00.000Z");
    const original = base.getTime();
    addMinutes(base, 60);
    expect(base.getTime()).toBe(original);
  });

  it("handles zero minutes", () => {
    const base = new Date("2026-06-30T12:00:00.000Z");
    expect(addMinutes(base, 0).getTime()).toBe(base.getTime());
  });

  it("rolls over across hour boundaries", () => {
    const base = new Date("2026-06-30T12:45:00.000Z");
    expect(addMinutes(base, 30).toISOString()).toBe("2026-06-30T13:15:00.000Z");
  });
});
