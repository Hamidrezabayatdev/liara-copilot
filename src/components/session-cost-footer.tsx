"use client";

import * as React from "react";
import { PiggyBankIcon, SparklesIcon, TrendingDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatCompact, formatInt, formatToman } from "@/components/format";
import { shortModel } from "@/components/cost-badge";
import { Mono } from "@/components/ui/ltr";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ModelUsageBreakdown = {
  model: string;
  /** Number of messages routed to this model. */
  calls: number;
  /** Real Toman spent on this model. */
  toman: number;
};

export type SessionCostFooterProps = {
  /** Messages answered in this session. */
  messages: number;
  /** Real Toman spent, summed from each response's `total_cost_toman`. */
  totalToman: number;
  /**
   * What the same session would have cost with every request sent to the most
   * expensive model — the honest counterfactual for the saving claim.
   */
  baselineToman: number;
  baselineModel?: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  /** Prompt tokens served from cache; drives the caching call-out. */
  cachedTokens?: number;
  toolCalls: number;
  /** Per-model split, rendered as a stacked share bar. */
  breakdown?: ModelUsageBreakdown[];
  loading?: boolean;
  className?: string;
};

const MODEL_BAR_COLORS = [
  "var(--chart-cpu)",
  "var(--chart-memory)",
  "var(--chart-network)",
  "var(--warning)",
];

/**
 * Session-level cost dashboard (spec §17). The hero number is the saving
 * against an "always use the strongest model" baseline — the product claim this
 * whole routing architecture exists to make.
 */
function SessionCostFooter({
  messages,
  totalToman,
  baselineToman,
  baselineModel = "anthropic/claude-opus-5",
  totalPromptTokens,
  totalCompletionTokens,
  cachedTokens = 0,
  toolCalls,
  breakdown = [],
  loading = false,
  className,
}: SessionCostFooterProps) {
  if (loading) {
    return (
      <div
        className={cn(
          "bg-card rounded-lg border border-border/80 px-4 py-4",
          className,
        )}
      >
        <div className="flex items-center gap-6">
          <Skeleton className="h-12 w-28" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      </div>
    );
  }

  const savedToman = Math.max(0, baselineToman - totalToman);
  const savedPercent = baselineToman > 0 ? (savedToman / baselineToman) * 100 : 0;
  const actualShare =
    baselineToman > 0 ? Math.max(2, (totalToman / baselineToman) * 100) : 100;
  const breakdownTotal = breakdown.reduce((a, b) => a + b.toman, 0);

  return (
    <section
      data-slot="session-cost-footer"
      className={cn(
        "bg-card relative overflow-hidden rounded-lg border border-border/80 shadow-sm",
        className,
      )}
    >
      <span
        aria-hidden
        className="from-success/60 absolute inset-x-0 top-0 h-px bg-gradient-to-l to-transparent"
      />

      <div className="flex flex-col gap-5 px-4 py-4 lg:flex-row lg:items-stretch">
        {/* Hero: the saving */}
        <div className="lg:w-56 lg:shrink-0">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[0.6875rem] font-medium">
            <PiggyBankIcon className="text-success size-3.5" />
            صرفه‌جویی این نشست
          </span>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              dir="ltr"
              className="ltr-embed text-success font-mono text-4xl leading-none font-bold tracking-tight tabular-nums"
            >
              {Math.round(savedPercent)}
            </span>
            <span className="text-success text-xl leading-none font-bold">٪</span>
            <TrendingDownIcon className="text-success/70 ms-1 size-4" />
          </div>
          <p className="text-muted-foreground mt-2 text-[0.6875rem] leading-5">
            <span dir="ltr" className="ltr-embed text-foreground font-mono font-semibold tabular-nums">
              {formatToman(savedToman)}
            </span>{" "}
            تومان کمتر از حالتی که همهٔ درخواست‌ها به{" "}
            <Mono className="text-foreground/80">{shortModel(baselineModel)}</Mono>{" "}
            می‌رفت.
          </p>
        </div>

        {/* Comparison bars */}
        <div className="border-border/60 min-w-0 flex-1 lg:border-s lg:ps-5">
          <div className="space-y-2.5">
            <div>
              <div className="mb-1 flex items-baseline gap-2 text-[0.6875rem]">
                <span className="text-foreground font-medium">
                  هزینهٔ واقعی این نشست
                </span>
                <span className="flex-1" />
                <span
                  dir="ltr"
                  className="ltr-embed text-foreground font-mono font-semibold tabular-nums"
                >
                  {formatToman(totalToman)}
                </span>
                <span className="text-muted-foreground">تومان</span>
              </div>
              <div className="bg-muted h-2.5 overflow-hidden rounded-full">
                <div
                  className="bg-success h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.min(actualShare, 100)}%` }}
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-baseline gap-2 text-[0.6875rem]">
                <span className="text-muted-foreground">
                  اگر همیشه <Mono>{shortModel(baselineModel)}</Mono> استفاده می‌شد
                </span>
                <span className="flex-1" />
                <span
                  dir="ltr"
                  className="ltr-embed text-muted-foreground font-mono tabular-nums"
                >
                  {formatToman(baselineToman)}
                </span>
                <span className="text-muted-foreground">تومان</span>
              </div>
              <div className="bg-muted h-2.5 overflow-hidden rounded-full">
                <div className="bg-muted-foreground/35 h-full w-full rounded-full" />
              </div>
            </div>
          </div>

          {breakdown.length > 0 ? (
            <div className="mt-3.5">
              <span className="text-muted-foreground text-[0.625rem]">
                توزیع مدل‌ها
              </span>
              <div className="bg-muted mt-1 flex h-2 overflow-hidden rounded-full">
                {breakdown.map((b, i) => (
                  <Tooltip key={b.model}>
                    <TooltipTrigger asChild>
                      <span
                        className="h-full first:rounded-e-full last:rounded-s-full"
                        style={{
                          width: `${breakdownTotal > 0 ? (b.toman / breakdownTotal) * 100 : 0}%`,
                          background:
                            MODEL_BAR_COLORS[i % MODEL_BAR_COLORS.length],
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <Mono>{b.model}</Mono> — {formatInt(b.calls)} پیام،{" "}
                      <span dir="ltr" className="ltr-embed tabular-nums">
                        {formatToman(b.toman)}
                      </span>{" "}
                      تومان
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {breakdown.map((b, i) => (
                  <li
                    key={b.model}
                    className="text-muted-foreground flex items-center gap-1.5 text-[0.625rem]"
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{
                        background: MODEL_BAR_COLORS[i % MODEL_BAR_COLORS.length],
                      }}
                    />
                    <Mono>{shortModel(b.model)}</Mono>
                    <span dir="ltr" className="ltr-embed tabular-nums">
                      ×{formatInt(b.calls)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Supporting stats */}
        <dl className="border-border/60 grid grid-cols-2 gap-x-4 gap-y-2.5 lg:w-40 lg:shrink-0 lg:grid-cols-1 lg:border-s lg:ps-5">
          {[
            { label: "پیام", value: formatInt(messages) },
            { label: "tool call", value: formatInt(toolCalls) },
            {
              label: "توکن ورودی",
              value: formatCompact(totalPromptTokens),
            },
            {
              label: "توکن خروجی",
              value: formatCompact(totalCompletionTokens),
            },
          ].map((s) => (
            <div key={s.label} className="flex items-baseline gap-2">
              <dt className="text-muted-foreground text-[0.625rem]">{s.label}</dt>
              <span className="flex-1" />
              <dd
                dir="ltr"
                className="ltr-embed text-foreground font-mono text-[0.8125rem] font-semibold tabular-nums"
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {cachedTokens > 0 ? (
        <p className="border-border/70 bg-muted/25 text-muted-foreground flex items-center gap-1.5 border-t px-4 py-2 text-[0.625rem] leading-5">
          <SparklesIcon className="text-success size-3 shrink-0" />
          <span>
            بخشی از این صرفه‌جویی از prompt caching است:{" "}
            <span
              dir="ltr"
              className="ltr-embed text-foreground font-mono font-semibold tabular-nums"
            >
              {formatCompact(cachedTokens)}
            </span>{" "}
            توکن ورودی از cache خوانده شد.
          </span>
        </p>
      ) : null}
    </section>
  );
}

export { SessionCostFooter };
