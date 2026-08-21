"use client";

import * as React from "react";
import {
  ActivityIcon,
  ArrowLeftIcon,
  CircleDotIcon,
  CrosshairIcon,
  LifeBuoyIcon,
  StethoscopeIcon,
  WrenchIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Evidence, Provenance } from "@/components/types";
import { ProvenanceBadge } from "@/components/source-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export type DiagnosticSeverity = "critical" | "degraded" | "healthy";

export type DiagnosticRecommendation = {
  /** One-line Persian summary of the fix. */
  title: string;
  /** Optional detail: what exactly will change. */
  detail?: string;
  /** Concrete ordered steps, technical terms in Latin. */
  steps?: string[];
  /** Label for the primary action button. */
  actionLabel?: string;
};

export type DiagnosticResultProps = {
  /** What the user sees going wrong. */
  symptom: string;
  /** The single cause the agent concluded. This is the payoff line. */
  rootCause: string;
  /** Ordered observations that support the conclusion. */
  evidence: Evidence[];
  recommendation: DiagnosticRecommendation;
  /** 0–1. Rendered as a segmented meter plus a Persian label. */
  confidence: number;
  severity?: DiagnosticSeverity;
  /** Resource under diagnosis. */
  appName?: string;
  /** Jump to a citation rendered elsewhere in the message. */
  onOpenSource?: (sourceId: string) => void;
  /** Runs the recommended fix. Goes through a `ConfirmationDialog` first. */
  onApplyFix?: () => void;
  /** Hands the case to human support with a prepared summary. */
  onEscalate?: () => void;
  loading?: boolean;
  error?: string | null;
  className?: string;
};

const SEVERITY_META: Record<
  DiagnosticSeverity,
  { label: string; tone: string }
> = {
  critical: {
    label: "سرویس در دسترس نیست",
    tone: "text-destructive border-destructive/35",
  },
  degraded: {
    label: "کارکرد ناقص",
    tone: "text-warning border-warning/35",
  },
  healthy: {
    label: "بدون اختلال",
    tone: "text-success border-success/35",
  },
};

function confidenceLabel(c: number): { text: string; tone: string; filled: number } {
  const filled = Math.max(1, Math.min(5, Math.round(c * 5)));
  if (c >= 0.8)
    return { text: "اطمینان بالا", tone: "text-success bg-success", filled };
  if (c >= 0.55)
    return { text: "اطمینان متوسط", tone: "text-warning bg-warning", filled };
  return { text: "اطمینان پایین", tone: "text-destructive bg-destructive", filled };
}

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const { text, tone, filled } = confidenceLabel(confidence);
  const [textTone, barTone] = tone.split(" ");
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-0.5" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              "h-3 w-1 rounded-full transition-colors",
              i < filled ? barTone : "bg-border",
            )}
          />
        ))}
      </span>
      <span className={cn("text-[0.6875rem] font-semibold", textTone)}>{text}</span>
      <span
        dir="ltr"
        className="ltr-embed text-muted-foreground text-[0.625rem] tabular-nums"
      >
        {Math.round(confidence * 100)}%
      </span>
    </div>
  );
}

/**
 * The troubleshooting verdict (spec §11 + §18): one symptom, one root cause,
 * the evidence chain that got there, the fix, and how sure the agent is.
 *
 * Evidence rows carry their own provenance badge, so a reader can tell an
 * observed fact from an inference without leaving the card.
 */
function DiagnosticResult({
  symptom,
  rootCause,
  evidence,
  recommendation,
  confidence,
  severity = "critical",
  appName,
  onOpenSource,
  onApplyFix,
  onEscalate,
  loading = false,
  error = null,
  className,
}: DiagnosticResultProps) {
  const meta = SEVERITY_META[severity];

  if (loading) {
    return (
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border/70 bg-card",
          className,
        )}
      >
        <div className="flex flex-col gap-3 px-4 py-4">
          <Skeleton className="h-4 w-32 rounded-full" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-4",
          className,
        )}
      >
        <p className="text-destructive text-xs leading-6">
          تشخیص کامل نشد: {error}
        </p>
        {onEscalate ? (
          <Button variant="outline" size="xs" className="mt-3" onClick={onEscalate}>
            <LifeBuoyIcon />
            ارجاع به پشتیبانی
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <section
      data-slot="diagnostic-result"
      className={cn(
        "animate-rise overflow-hidden rounded-xl border border-border/70 bg-card",
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5 sm:pt-5">
        <span className="inline-flex items-center gap-2 text-[0.8125rem] font-semibold tracking-tight">
          <StethoscopeIcon className="size-4 text-muted-foreground" />
          نتیجهٔ عیب‌یابی
        </span>
        {appName ? (
          <span
            dir="ltr"
            className="ltr-embed text-muted-foreground font-mono text-[0.6875rem]"
          >
            {appName}
          </span>
        ) : null}
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold",
            meta.tone,
          )}
        >
          {meta.label}
        </span>
        <span className="flex-1" />
        <ConfidenceMeter confidence={confidence} />
      </header>

      <div className="flex flex-col gap-3 px-4 pt-4 sm:px-5">
        <div>
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[0.625rem] font-medium">
            <ActivityIcon className="size-3" />
            نشانه
          </span>
          <p className="text-foreground/85 mt-1 text-xs leading-6">{symptom}</p>
        </div>

        <div className="rounded-lg border border-primary/25 p-3.5">
          <span className="text-primary inline-flex items-center gap-1.5 text-[0.625rem] font-semibold">
            <CrosshairIcon className="size-3" />
            علت اصلی
          </span>
          <p className="mt-1.5 text-[0.9375rem] leading-7 font-semibold tracking-tight">
            {rootCause}
          </p>
        </div>

        {evidence.length > 0 ? (
          <div>
            <span className="text-muted-foreground text-[0.625rem] font-medium">
              شواهد
            </span>
            <ol className="mt-1.5 flex flex-col gap-1.5">
              {evidence.map((e, i) => (
                <li
                  key={e.id}
                  className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2.5 transition-colors hover:border-primary/25"
                >
                  <span
                    dir="ltr"
                    className="ltr-embed bg-background text-muted-foreground border-border mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border text-[0.5625rem] font-bold tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <p className="text-foreground/85 min-w-0 flex-1 text-xs leading-6">
                    {e.text}
                  </p>
                  {e.sourceKind ? (
                    <ProvenanceBadge
                      kind={e.sourceKind as Provenance}
                      iconOnly
                      className="mt-0.5"
                    />
                  ) : null}
                  {e.sourceId && onOpenSource ? (
                    <button
                      type="button"
                      onClick={() => onOpenSource(e.sourceId!)}
                      className="text-primary hover:bg-primary/10 focus-visible:ring-ring/40 mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-0.5 text-[0.625rem] font-medium outline-none focus-visible:ring-2"
                    >
                      منبع
                      <ArrowLeftIcon className="size-3" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-2.5 text-xs leading-6 text-muted-foreground">
            شاهد قابل استنادی جمع نشد — این نتیجه فقط یک فرضیه است و باید بررسی
            بیشتری انجام شود.
          </p>
        )}

        <div className="rounded-lg border border-success/25 p-3.5">
          <span className="text-success inline-flex items-center gap-1.5 text-[0.625rem] font-semibold">
            <WrenchIcon className="size-3" />
            اصلاح پیشنهادی
          </span>
          <p className="mt-1.5 text-[0.8125rem] leading-6 font-semibold">
            {recommendation.title}
          </p>
          {recommendation.detail ? (
            <p className="text-muted-foreground mt-1 text-xs leading-6">
              {recommendation.detail}
            </p>
          ) : null}
          {recommendation.steps && recommendation.steps.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {recommendation.steps.map((s, i) => (
                <li
                  key={i}
                  className="text-foreground/85 flex items-start gap-2 text-xs leading-6"
                >
                  <CircleDotIcon className="text-success/70 mt-1.5 size-3 shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/70 px-4 py-3 sm:px-5">
        {onEscalate ? (
          <Button variant="ghost" size="xs" onClick={onEscalate}>
            <LifeBuoyIcon />
            حل نشد؟ ارجاع به پشتیبانی
          </Button>
        ) : null}
        <span className="flex-1" />
        {onApplyFix ? (
          <Button size="sm" onClick={onApplyFix}>
            <WrenchIcon />
            {recommendation.actionLabel ?? "اجرای اصلاح"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export { DiagnosticResult, ConfidenceMeter };
