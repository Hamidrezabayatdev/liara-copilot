"use client";

import * as React from "react";
import {
  GitBranchIcon,
  GitCommitHorizontalIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  TerminalIcon,
  UserRoundIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateTimeFa, formatDuration } from "@/components/format";
import type { Deployment } from "@/components/types";
import { DeploymentStatePill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Mono } from "@/components/ui/ltr";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/ui/time-ago";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const SOURCE_LABEL: Record<Deployment["source"], string> = {
  cli: "Liara CLI",
  git: "Git push",
  console: "Console",
  api: "API",
};

export type DeploymentCardProps = {
  deployment: Deployment;
  /**
   * Shows the rollback affordance. The callback only *requests* a rollback —
   * the confirmation gate is a separate `ConfirmationDialog`.
   */
  onRollback?: (deployment: Deployment) => void;
  /** Shows a «logs» action for this release's build output. */
  onViewLogs?: (deployment: Deployment) => void;
  /** Disables the rollback button (e.g. while a write is already in flight). */
  busy?: boolean;
  className?: string;
};

function DeploymentCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("gap-0", className)}>
      <div className="flex items-center gap-3 px-4 py-4">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-3 w-28" />
        <span className="flex-1" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="space-y-2 px-4 pb-4">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </Card>
  );
}

/** One release, as returned by the deployments inspect tool. */
function DeploymentCard({
  deployment: d,
  onRollback,
  onViewLogs,
  busy = false,
  className,
}: DeploymentCardProps) {
  const failed = d.state === "FAILED";
  const inFlight = d.state === "BUILDING" || d.state === "DEPLOYING";

  return (
    <Card
      data-slot="deployment-card"
      className={cn(
        "gap-0 overflow-hidden",
        d.isCurrent && "border-primary/45 ring-primary/12 ring-1",
        failed && "border-destructive/35",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3.5">
        <DeploymentStatePill state={d.state} />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground inline-flex cursor-default items-center gap-1 text-[0.6875rem]">
              release
              <Mono className="text-foreground/85 font-medium">{d.id}</Mono>
            </span>
          </TooltipTrigger>
          <TooltipContent>شناسهٔ release برای rollback و پیگیری</TooltipContent>
        </Tooltip>
        {d.isCurrent ? (
          <span className="text-primary bg-primary/10 rounded-full px-2 py-0.5 text-[0.625rem] font-semibold">
            در حال سرویس‌دهی
          </span>
        ) : null}
        <span className="flex-1" />
        <span className="text-muted-foreground text-[0.6875rem]">
          <TimeAgo value={d.createdAt} />
        </span>
      </div>

      <div className="px-4 pt-3">
        {d.commitMessage ? (
          <p className="text-[0.8125rem] leading-6 font-medium">
            {d.commitMessage}
          </p>
        ) : (
          <p className="text-muted-foreground text-[0.8125rem] leading-6">
            بدون commit message — deploy از {SOURCE_LABEL[d.source]}
          </p>
        )}

        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.6875rem]">
          {d.commitSha ? (
            <span className="inline-flex items-center gap-1.5">
              <GitCommitHorizontalIcon className="size-3.5 opacity-70" />
              <Mono className="text-foreground/80">{d.commitSha.slice(0, 8)}</Mono>
            </span>
          ) : null}
          {d.branch ? (
            <span className="inline-flex items-center gap-1.5">
              <GitBranchIcon className="size-3.5 opacity-70" />
              <Mono className="text-foreground/80">{d.branch}</Mono>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <TerminalIcon className="size-3.5 opacity-70" />
            <span dir="ltr" className="ltr-embed">
              {SOURCE_LABEL[d.source]}
            </span>
          </span>
          {d.triggeredBy ? (
            <span className="inline-flex items-center gap-1.5">
              <UserRoundIcon className="size-3.5 opacity-70" />
              <span>{d.triggeredBy}</span>
            </span>
          ) : null}
        </div>

        <dl className="border-border/60 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-[0.6875rem] sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">شروع</dt>
            <dd className="text-foreground/85 mt-0.5">
              {formatDateTimeFa(d.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">پایان</dt>
            <dd className="text-foreground/85 mt-0.5">
              {d.finishedAt ? (
                formatDateTimeFa(d.finishedAt)
              ) : inFlight ? (
                <span className="text-info">در جریان…</span>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">مدت</dt>
            <dd className="mt-0.5">
              <span
                dir="ltr"
                className="ltr-embed text-foreground/85 font-mono tabular-nums"
              >
                {typeof d.durationMs === "number"
                  ? formatDuration(d.durationMs)
                  : "—"}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      {failed && d.failureReason ? (
        <p className="border-destructive/20 bg-destructive/8 text-destructive mx-4 mt-3 rounded-md border px-2.5 py-2 text-xs leading-5">
          {d.failureReason}
        </p>
      ) : null}

      {onRollback || onViewLogs ? (
        <div className="border-border/70 bg-muted/25 mt-3.5 flex items-center gap-2 border-t px-3 py-2">
          {onViewLogs ? (
            <Button variant="ghost" size="xs" onClick={() => onViewLogs(d)}>
              <ScrollTextIcon />
              build logs
            </Button>
          ) : null}
          <span className="flex-1" />
          {onRollback ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy || d.isCurrent || inFlight}
                  onClick={() => onRollback(d)}
                >
                  <RotateCcwIcon />
                  rollback به این release
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {d.isCurrent
                  ? "این release همین حالا فعال است."
                  : "پیش از اجرا، تغییرات را تأیید می‌کنید."}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export { DeploymentCard, DeploymentCardSkeleton };
