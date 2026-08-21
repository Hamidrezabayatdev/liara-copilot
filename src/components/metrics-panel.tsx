"use client";

import * as React from "react";
import { ActivityIcon, CpuIcon, MemoryStickIcon, NetworkIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDecimal } from "@/components/format";
import type { MetricSeries } from "@/components/types";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SERIES_META = {
  cpu: { icon: CpuIcon, color: "var(--chart-cpu)", label: "CPU" },
  memory: { icon: MemoryStickIcon, color: "var(--chart-memory)", label: "memory" },
  network: { icon: NetworkIcon, color: "var(--chart-network)", label: "network" },
} as const;

const VIEW_W = 100;
const VIEW_H = 34;

type Segment = Array<{ x: number; y: number }>;

/** Splits a series into contiguous runs, so gaps in collection stay gaps. */
function buildSegments(points: Array<number | null>, max: number): Segment[] {
  const segments: Segment[] = [];
  let current: Segment = [];
  const denom = Math.max(points.length - 1, 1);
  points.forEach((p, i) => {
    if (p === null || !Number.isFinite(p)) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    const x = (i / denom) * VIEW_W;
    const y = VIEW_H - (Math.min(p, max) / max) * VIEW_H;
    current.push({ x, y });
  });
  if (current.length) segments.push(current);
  return segments;
}

function toPath(seg: Segment): string {
  if (seg.length === 1) {
    // A lone sample still deserves a visible mark.
    return `M ${seg[0].x - 0.4} ${seg[0].y} L ${seg[0].x + 0.4} ${seg[0].y}`;
  }
  return seg
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
}

export type SparklineProps = {
  points: Array<number | null>;
  max: number;
  color: string;
  /** Unique id suffix for the gradient defs. */
  gradientId: string;
  className?: string;
  /** Draw the filled area under the line. */
  fill?: boolean;
};

/** Dependency-free sparkline. Scales non-uniformly; strokes stay 1.5px. */
function Sparkline({
  points,
  max,
  color,
  gradientId,
  className,
  fill = true,
}: SparklineProps) {
  const segments = React.useMemo(() => buildSegments(points, max), [points, max]);
  const last = segments.at(-1)?.at(-1);
  const lastIsFinal =
    points.length > 0 && points[points.length - 1] !== null && Boolean(last);

  return (
    <span dir="ltr" className={cn("relative block", className)}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="block h-9 w-full"
        role="img"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1="0"
            x2={VIEW_W}
            y1={VIEW_H * g}
            y2={VIEW_H * g}
            stroke="currentColor"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
            className="text-border"
            opacity="0.55"
          />
        ))}

        {fill
          ? segments.map((seg, i) =>
              seg.length > 1 ? (
                <path
                  key={`f${i}`}
                  d={`${toPath(seg)} L ${seg.at(-1)!.x.toFixed(2)} ${VIEW_H} L ${seg[0].x.toFixed(2)} ${VIEW_H} Z`}
                  fill={`url(#${gradientId})`}
                  stroke="none"
                />
              ) : null,
            )
          : null}

        {segments.map((seg, i) => (
          <path
            key={`l${i}`}
            d={toPath(seg)}
            fill="none"
            stroke={color}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            strokeDasharray={1}
            className="animate-trace"
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </svg>

      {/* The viewBox is stretched non-uniformly, so an SVG <circle> would render
          as a flat ellipse. The head marker is an HTML dot placed in percent. */}
      {lastIsFinal && last ? (
        <span
          aria-hidden
          className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${last.x}%`,
            top: `${(last.y / VIEW_H) * 100}%`,
            background: color,
            boxShadow: "0 0 0 2px var(--card)",
          }}
        />
      ) : null}
    </span>
  );
}

export type MetricsPanelProps = {
  series: MetricSeries[];
  /** App the metrics belong to. */
  appName?: string;
  /** Persian label for the sampled window, e.g. «۳۰ دقیقهٔ اخیر». */
  rangeLabel?: string;
  loading?: boolean;
  error?: string | null;
  className?: string;
};

function summarise(points: Array<number | null>) {
  const values = points.filter(
    (p): p is number => p !== null && Number.isFinite(p),
  );
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: sum / values.length,
    coverage: values.length / points.length,
  };
}

/**
 * CPU / memory / network sparklines drawn as inline SVG (no chart library in
 * this project on purpose). Sparse series render with visible gaps rather than
 * being interpolated into a lie.
 */
function MetricsPanel({
  series,
  appName,
  rangeLabel = "۳۰ دقیقهٔ اخیر",
  loading = false,
  error = null,
  className,
}: MetricsPanelProps) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");

  return (
    <Card data-slot="metrics-panel" className={cn("gap-0", className)}>
      <div className="border-border/70 flex items-center gap-2 border-b px-4 py-2.5">
        <ActivityIcon className="text-muted-foreground size-3.5" />
        <span className="text-[0.8125rem] font-semibold tracking-tight">
          متریک منابع
        </span>
        {appName ? (
          <span
            dir="ltr"
            className="ltr-embed text-muted-foreground font-mono text-[0.6875rem]"
          >
            {appName}
          </span>
        ) : null}
        <span className="flex-1" />
        <span className="text-muted-foreground text-[0.625rem]">{rangeLabel}</span>
      </div>

      {error ? (
        <p className="text-destructive px-4 py-6 text-center text-xs leading-5">
          دریافت متریک ناموفق بود: {error}
        </p>
      ) : loading ? (
        <div className="divide-border/60 divide-y">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="w-24 space-y-2">
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-9 flex-1" />
            </div>
          ))}
        </div>
      ) : series.length === 0 ? (
        <p className="text-muted-foreground px-4 py-8 text-center text-xs leading-5">
          هنوز متریکی برای این resource جمع‌آوری نشده است.
        </p>
      ) : (
        <div className="divide-border/60 divide-y">
          {series.map((s) => {
            const meta = SERIES_META[s.key];
            const Icon = meta.icon;
            const stats = summarise(s.points);
            const max = s.max ?? Math.max(1, (stats?.max ?? 1) * 1.25);
            const current =
              s.current ??
              [...s.points].reverse().find((p): p is number => p !== null);

            return (
              <div
                key={s.key}
                className="flex items-center gap-4 px-4 py-3"
                style={{ color: meta.color }}
              >
                <div className="w-24 shrink-0">
                  <div className="text-muted-foreground flex items-center gap-1.5 text-[0.6875rem]">
                    <Icon className="size-3.5" style={{ color: meta.color }} />
                    <span dir="ltr" className="ltr-embed">
                      {s.label}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-1">
                    <span
                      dir="ltr"
                      className="ltr-embed text-foreground font-mono text-base leading-6 font-semibold tabular-nums"
                    >
                      {typeof current === "number" ? formatDecimal(current, 1) : "—"}
                    </span>
                    <span
                      dir="ltr"
                      className="ltr-embed text-muted-foreground text-[0.625rem]"
                    >
                      {s.unit}
                    </span>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  {stats ? (
                    <Sparkline
                      points={s.points}
                      max={max}
                      color={meta.color}
                      gradientId={`spark-${uid}-${s.key}`}
                    />
                  ) : (
                    <div className="border-border/70 text-muted-foreground flex h-9 items-center justify-center rounded-md border border-dashed text-[0.625rem]">
                      داده‌ای در این بازه ثبت نشده است
                    </div>
                  )}
                </div>

                <dl className="text-muted-foreground hidden w-28 shrink-0 gap-x-2 text-[0.625rem] sm:grid sm:grid-cols-[auto_1fr]">
                  <dt>avg</dt>
                  <dd
                    dir="ltr"
                    className="ltr-embed text-foreground/80 text-end font-mono tabular-nums"
                  >
                    {stats ? formatDecimal(stats.avg, 1) : "—"}
                  </dd>
                  <dt>peak</dt>
                  <dd
                    dir="ltr"
                    className="ltr-embed text-foreground/80 text-end font-mono tabular-nums"
                  >
                    {stats ? formatDecimal(stats.max, 1) : "—"}
                  </dd>
                  {stats && stats.coverage < 1 ? (
                    <>
                      <dt className="text-warning">پوشش</dt>
                      <dd
                        dir="ltr"
                        className="ltr-embed text-warning text-end font-mono tabular-nums"
                      >
                        {formatDecimal(stats.coverage * 100, 0)}٪
                      </dd>
                    </>
                  ) : null}
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export { MetricsPanel, Sparkline };
