"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  CoinsIcon,
  DatabaseZapIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatDuration,
  formatInt,
  formatToman,
} from "@/components/format";
import type { UsageMeta } from "@/components/types";
import { Mono } from "@/components/ui/ltr";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

const ESCALATION: Record<
  1 | 2 | 3,
  { label: string; explain: string; tone: string; bar: string }
> = {
  1: {
    label: "سطح ۱",
    explain: "پاسخ مستقیم — بدون tool، با مدل ارزان و سریع.",
    tone: "text-success",
    bar: "bg-success",
  },
  2: {
    label: "سطح ۲",
    explain: "بازیابی از مستندات و بررسی وضعیت حساب، همچنان با مدل سریع.",
    tone: "text-info",
    bar: "bg-info",
  },
  3: {
    label: "سطح ۳",
    explain: "عیب‌یابی چندمرحله‌ای — ارتقا به مدل استدلالی گران‌تر.",
    tone: "text-warning",
    bar: "bg-warning",
  },
};

function shortModel(model: string): string {
  if (model.endsWith("deepseek/deepseek-v4-flash")) {
    return "DeepSeek V4 Flash";
  }
  if (model.endsWith("openai/gpt-5.6-luna-pro")) return "GPT-5.6 Luna Pro";
  // Keep previously saved conversations readable after the production switch.
  if (model.endsWith("openai/gpt-5.6-luna")) return "GPT-5.6 Luna";
  if (model.endsWith("google/gemini-3.7-flash")) return "Gemini 3.7 Flash";
  if (model.endsWith("anthropic/claude-opus-5")) return "Claude Opus 5";
  const slash = model.lastIndexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

export type CostBadgeProps = {
  usage: UsageMeta;
  /**
   * Baseline model the session compares against, e.g. `anthropic/claude-opus-5`.
   * Shown inside the popover as the avoided alternative.
   */
  baselineModel?: string;
  /** Estimated Toman this message would have cost on the baseline model. */
  baselineToman?: number;
  className?: string;
};

/**
 * Per-message accounting strip (spec §17). Compact inline by default; the
 * popover answers the one question a cost-optimising product must answer out
 * loud: why this route and not the expensive one.
 *
 * Both Toman cost and reasoning-token count come straight from Liara AI's
 * `usage` block — nothing here is estimated.
 */
function CostBadge({
  usage,
  baselineModel = "anthropic/claude-opus-5",
  baselineToman,
  className,
}: CostBadgeProps) {
  const esc = ESCALATION[usage.escalation];
  const saved =
    usage.costComplete !== false &&
    typeof baselineToman === "number" &&
    baselineToman > usage.toman
      ? baselineToman - usage.toman
      : undefined;

  return (
    <Popover>
      <PopoverTrigger
        data-slot="cost-badge"
        className={cn(
          "text-muted-foreground hover:text-foreground hover:border-border focus-visible:ring-ring/40 group inline-flex max-w-full flex-nowrap items-center gap-x-2 rounded-md border border-transparent px-2 py-1 text-[0.6875rem] transition-colors outline-none focus-visible:ring-[3px]",
          "hover:bg-muted/50 data-[state=open]:bg-muted/60 data-[state=open]:border-border",
          className,
        )}
        aria-label="جزئیات هزینه و مسیر پاسخ"
      >
        <span className="flex items-center gap-1" aria-hidden>
          {[1, 2, 3].map((lvl) => (
            <span
              key={lvl}
              className={cn(
                "w-1 rounded-full",
                lvl === 1 ? "h-1.5" : lvl === 2 ? "h-2" : "h-2.5",
                lvl <= usage.escalation ? esc.bar : "bg-border",
              )}
            />
          ))}
        </span>
        <span className={cn("font-semibold", esc.tone)}>{esc.label}</span>
        <Separator orientation="vertical" className="h-3" />
        <Mono className="text-[0.6875rem]">{shortModel(usage.model)}</Mono>
        <span
          className="inline-flex items-center gap-1 whitespace-nowrap"
          title={
            usage.costComplete === false
              ? "کمینهٔ هزینهٔ ثبت‌شده برای این پیام"
              : "هزینهٔ واقعی این پیام"
          }
        >
          <CoinsIcon className="size-3 opacity-60" />
          <span dir="ltr" className="ltr-embed font-mono tabular-nums">
            {usage.costComplete === false ? "≥" : ""}
            {formatToman(usage.toman)}
          </span>
          <span>تومان</span>
        </span>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-88">
        <div className="border-border/70 flex items-center gap-2 border-b px-3.5 py-2.5">
          <span className="text-[0.8125rem] font-semibold tracking-tight">
            چرا این مسیر؟
          </span>
          <span className="flex-1" />
          <span
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[0.625rem] font-semibold",
              esc.tone,
              "border-border bg-muted",
            )}
          >
            {esc.label}
          </span>
        </div>

        <div className="space-y-2.5 px-3.5 py-3">
          <p className="text-muted-foreground text-xs leading-6">
            {usage.routingReason ?? esc.explain}
          </p>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[0.6875rem]">
            <dt className="text-muted-foreground">model</dt>
            <dd className="text-end">
              <Mono className="font-medium">{usage.model}</Mono>
            </dd>

            <dt className="text-muted-foreground">توکن ورودی</dt>
            <dd
              dir="ltr"
              className="ltr-embed w-full text-end font-mono tabular-nums"
            >
              {formatInt(usage.promptTokens)}
              {usage.cachedTokens ? (
                <span className="text-success"> ({formatInt(usage.cachedTokens)} cached)</span>
              ) : null}
            </dd>

            <dt className="text-muted-foreground">توکن خروجی</dt>
            <dd
              dir="ltr"
              className="ltr-embed w-full text-end font-mono tabular-nums"
            >
              {formatInt(usage.completionTokens)}
              {usage.reasoningTokens ? (
                <span className="text-warning">
                  {" "}
                  ({formatInt(usage.reasoningTokens)} reasoning)
                </span>
              ) : null}
            </dd>

            <dt className="text-muted-foreground">tool call</dt>
            <dd
              dir="ltr"
              className="ltr-embed w-full text-end font-mono tabular-nums"
            >
              {formatInt(usage.toolCalls)}
            </dd>

            <dt className="text-muted-foreground">زمان پاسخ</dt>
            <dd
              dir="ltr"
              className="ltr-embed w-full text-end font-mono tabular-nums"
            >
              {formatDuration(usage.latencyMs)}
            </dd>
          </dl>

          {usage.cachedTokens ? (
            <p className="text-success border-success/25 bg-success/8 flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[0.625rem] leading-5">
              <DatabaseZapIcon className="mt-0.5 size-3 shrink-0" />
              <span>
                prompt caching فعال بود:{" "}
                <span dir="ltr" className="ltr-embed font-mono tabular-nums">
                  {formatInt(usage.cachedTokens)}
                </span>{" "}
                توکن از cache خوانده شد و با نرخ بسیار کمتری محاسبه شد.
              </span>
            </p>
          ) : null}

          {usage.costComplete === false ? (
            <p className="border-warning/25 bg-warning/8 text-warning flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[0.625rem] leading-5">
              <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
              یک provider هزینهٔ تومان را برنگرداند؛ این عدد فقط جمع هزینه‌های ثبت‌شده است.
            </p>
          ) : null}

          <div className="border-border/70 flex items-end justify-between gap-3 rounded-md border p-2.5">
            <div>
              <span className="text-muted-foreground block text-[0.625rem]">
                {usage.costComplete === false
                  ? "هزینهٔ ثبت‌شدهٔ این پیام"
                  : "هزینهٔ این پیام"}
              </span>
              <span className="flex items-baseline gap-1">
                <span
                  dir="ltr"
                  className="ltr-embed font-mono text-base leading-6 font-bold tabular-nums"
                >
                  {formatToman(usage.toman)}
                </span>
                <span className="text-muted-foreground text-[0.625rem]">تومان</span>
              </span>
            </div>
            {typeof baselineToman === "number" ? (
              <div className="text-end">
                <span className="text-muted-foreground block text-[0.625rem]">
                  با <Mono>{shortModel(baselineModel)}</Mono>
                </span>
                <span className="flex items-baseline justify-end gap-1">
                  <span
                    dir="ltr"
                    className="ltr-embed text-muted-foreground font-mono text-[0.8125rem] tabular-nums line-through"
                  >
                    {formatToman(baselineToman)}
                  </span>
                  {saved ? (
                    <span className="text-success text-[0.625rem] font-semibold">
                      −
                      <span dir="ltr" className="ltr-embed tabular-nums">
                        {formatToman(saved)}
                      </span>
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { CostBadge, ESCALATION, shortModel };
