"use client";

/**
 * Analytics charts — client components (recharts requires the browser).
 *
 * Each chart receives plain, serializable data computed on the server and
 * renders inside a ResponsiveContainer so it fills its parent Card. Colors
 * mirror the app's design tokens: indigo primary (#4f46e5), the status tint
 * palette, and per-platform brand colors.
 */

import * as React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

// ── Shared serializable data shapes ─────────────────────────────────────────
export interface DayDatum {
  /** ISO date, e.g. "2026-06-30" */
  date: string;
  /** short label, e.g. "Jun 30" */
  label: string;
  count: number;
}

export interface SliceDatum {
  /** stable key, e.g. "instagram" | "posted" | "reel" */
  key: string;
  /** display name, e.g. "Instagram" */
  name: string;
  value: number;
  /** resolved hex color */
  color: string;
}

// ── Shared styling ──────────────────────────────────────────────────────────
const INDIGO = "#4f46e5";
const AXIS_TICK = { fontSize: 11, fill: "#a1a1aa" } as const;
const GRID_STROKE = "#e8e8ec";

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid #e8e8ec",
  boxShadow: "0 4px 16px rgba(16,24,40,.10), 0 1px 3px rgba(16,24,40,.06)",
  fontSize: 12,
  padding: "8px 12px",
} as const;

// ── Posts per day (area) ────────────────────────────────────────────────────
export function PostsPerDayChart({ data }: { data: DayDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="fillPerDay" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={INDIGO} stopOpacity={0.22} />
            <stop offset="100%" stopColor={INDIGO} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis
          dataKey="label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: GRID_STROKE }}
          interval="preserveStartEnd"
          minTickGap={16}
        />
        <YAxis
          allowDecimals={false}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ stroke: INDIGO, strokeOpacity: 0.25 }}
          labelStyle={{ color: "#18181b", fontWeight: 600, marginBottom: 2 }}
          formatter={(value) => [value, "Posts"]}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke={INDIGO}
          strokeWidth={2}
          fill="url(#fillPerDay)"
          dot={false}
          activeDot={{ r: 4, fill: INDIGO, stroke: "#fff", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Platform breakdown (donut) ──────────────────────────────────────────────
export function PlatformDonut({ data }: { data: SliceDatum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
      <ResponsiveContainer width="100%" height={200} className="max-w-[220px]">
        <PieChart>
          <defs>
            <linearGradient id="igGradient" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#f9ce34" />
              <stop offset="50%" stopColor="#ee2a7b" />
              <stop offset="100%" stopColor="#6228d7" />
            </linearGradient>
          </defs>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={54}
            outerRadius={80}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d) => (
              <Cell
                key={d.key}
                fill={d.key === "instagram" ? "url(#igGradient)" : d.color}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => [value, name as string]}
          />
        </PieChart>
      </ResponsiveContainer>
      <ul className="w-full space-y-2.5">
        {data.map((d) => {
          const pct = total ? Math.round((d.value / total) * 100) : 0;
          return (
            <li key={d.key} className="flex items-center gap-2.5 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  background:
                    d.key === "instagram"
                      ? "linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7)"
                      : d.color,
                }}
              />
              <span className="text-foreground">{d.name}</span>
              <span className="ml-auto tabular-nums font-medium text-foreground">
                {d.value}
              </span>
              <span className="w-9 text-right tabular-nums text-xs text-muted-foreground">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Horizontal bar breakdown (status / type) ────────────────────────────────
export function HorizontalBreakdown({ data }: { data: SliceDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 44)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
        barCategoryGap={12}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: GRID_STROKE }}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12, fill: "#52525b" }}
          tickLine={false}
          axisLine={false}
          width={84}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: "rgba(79,70,229,0.06)" }}
          formatter={(value) => [value, "Posts"]}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={20}>
          {data.map((d) => (
            <Cell key={d.key} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
