"use client";

import * as React from "react";
import { CheckIcon, MinusIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDuration } from "@/components/format";
import type { ChecklistStep, StepState } from "@/components/types";
import { Mono } from "@/components/ui/ltr";
import { Skeleton } from "@/components/ui/skeleton";

export type AgentChecklistProps = {
  /** Ordered plan steps. Order is the execution order. */
  steps: ChecklistStep[];
  /** Header title. Defaults to «برنامهٔ اجرا». */
  title?: string;
  /** Short Persian summary of what the agent understood. */
  intent?: string;
  /** Renders skeleton rows while the first plan chunk is still streaming. */
  loading?: boolean;
  /** Tool-layer failure; replaces the body with a readable message. */
  error?: string | null;
  /** Collapses `done` steps down to one line each. */
  dense?: boolean;
  className?: string;
};

const STATE_LABEL: Record<StepState, string> = {
  done: "انجام شد",
  running: "در حال انجام",
  pending: "در انتظار",
  failed: "ناموفق",
  skipped: "رد شد",
};

function StepMarker({ state }: { state: StepState }) {
  const base =
    "relative z-10 grid size-[22px] shrink-0 place-items-center rounded-full border transition-colors";
  if (state === "done") {
    return (
      <span
        className={cn(base, "border-success/45 bg-success/15 text-success")}
        aria-hidden
      >
        <CheckIcon className="size-3 stroke-[3]" />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span
        className={cn(
          base,
          "border-destructive/50 bg-destructive/15 text-destructive",
        )}
        aria-hidden
      >
        <XIcon className="size-3 stroke-[3]" />
      </span>
    );
  }
  if (state === "skipped") {
    return (
      <span
        className={cn(base, "border-border bg-muted text-muted-foreground")}
        aria-hidden
      >
        <MinusIcon className="size-3 stroke-[3]" />
      </span>
    );
  }
  if (state === "running") {
    return (
      <span
        className={cn(
          base,
          "animate-step-pulse border-primary/60 bg-primary/15 text-primary",
        )}
        aria-hidden
      >
        <span className="size-2 rounded-full bg-primary" />
        <svg
          className="absolute inset-0 size-full animate-spin [animation-duration:1.6s]"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            cx="12"
            cy="12"
            r="10.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="18 48"
            opacity="0.9"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className={cn(base, "border-dashed border-border bg-background")}
      aria-hidden
    >
      <span className="size-1.5 rounded-full bg-muted-foreground/45" />
    </span>
  );
}

/**
 * The agent's live plan trace (spec §12): what it understood, what it is doing
 * now, and what is next. Steps stream in and mutate state in place.
 */
function AgentChecklist({
  steps,
  title = "برنامهٔ اجرا",
  intent,
  loading = false,
  error = null,
  dense = false,
  className,
}: AgentChecklistProps) {
  const completed = steps.filter(
    (s) => s.state === "done" || s.state === "skipped",
  ).length;
  const failed = steps.some((s) => s.state === "failed");
  const running = steps.some((s) => s.state === "running");
  const total = steps.length;
  const progress = total === 0 ? 0 : (completed / total) * 100;

  return (
    <section
      data-slot="agent-checklist"
      aria-busy={running || loading}
      className={cn(
        "bg-card/70 rounded-lg border border-border/80 backdrop-blur-sm",
        className,
      )}
    >
      <header className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[0.8125rem] font-semibold tracking-tight">
              {title}
            </h3>
            {running ? (
              <span className="text-primary inline-flex items-center gap-1 text-[0.6875rem] font-medium">
                <span className="bg-primary size-1.5 animate-pulse rounded-full" />
                در حال اجرا
              </span>
            ) : null}
            {failed ? (
              <span className="text-destructive text-[0.6875rem] font-medium">
                یک مرحله ناموفق بود
              </span>
            ) : null}
          </div>
          {intent ? (
            <p className="text-muted-foreground mt-1 text-xs leading-5">{intent}</p>
          ) : null}
        </div>
        <div className="text-muted-foreground shrink-0 pt-0.5 text-[0.6875rem] font-medium tabular-nums">
          <span dir="ltr" className="ltr-embed">
            {completed}/{total}
          </span>
        </div>
      </header>

      <div className="bg-border/60 mx-4 h-0.5 overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            failed ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${progress}%` }}
        />
      </div>

      {error ? (
        <p className="text-destructive px-4 py-4 text-xs leading-5">
          اجرای برنامه متوقف شد: {error}
        </p>
      ) : loading && total === 0 ? (
        <div className="space-y-3 px-4 py-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-[22px] rounded-full" />
              <Skeleton className="h-3 flex-1" style={{ maxWidth: `${70 - i * 12}%` }} />
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <p className="text-muted-foreground px-4 py-4 text-xs">
          برای این درخواست برنامه‌ای لازم نبود — پاسخ مستقیم داده شد.
        </p>
      ) : (
        <ol className="px-4 pt-3 pb-1.5">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            const isActive = step.state === "running";
            return (
              <li
                key={step.id}
                className="animate-rise flex gap-3"
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              >
                <div className="flex flex-col items-center">
                  <StepMarker state={step.state} />
                  {!isLast ? (
                    <span
                      className={cn(
                        "my-1 w-px flex-1 rounded-full",
                        step.state === "done" ? "bg-success/35" : "bg-border",
                      )}
                    />
                  ) : null}
                </div>
                <div className={cn("min-w-0 flex-1", isLast ? "pb-3" : "pb-3.5")}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        "text-[0.8125rem] leading-[22px]",
                        isActive && "text-foreground font-medium",
                        step.state === "pending" && "text-muted-foreground",
                        step.state === "skipped" &&
                          "text-muted-foreground line-through decoration-muted-foreground/50",
                        step.state === "failed" && "text-destructive font-medium",
                      )}
                    >
                      {step.label}
                    </span>
                    {step.tool ? (
                      <Mono className="text-muted-foreground/80 bg-muted/60 rounded-sm px-1.5 py-px text-[0.625rem]">
                        {step.tool}
                      </Mono>
                    ) : null}
                    {typeof step.durationMs === "number" &&
                    step.state !== "pending" ? (
                      <span
                        dir="ltr"
                        className="ltr-embed text-muted-foreground/70 text-[0.625rem] tabular-nums"
                      >
                        {formatDuration(step.durationMs)}
                      </span>
                    ) : null}
                    <span className="sr-only">{STATE_LABEL[step.state]}</span>
                  </div>
                  {step.detail && !(dense && step.state === "done") ? (
                    <p
                      className={cn(
                        "mt-0.5 text-xs leading-5",
                        step.state === "failed"
                          ? "text-destructive/90"
                          : "text-muted-foreground",
                      )}
                    >
                      {step.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export { AgentChecklist };
