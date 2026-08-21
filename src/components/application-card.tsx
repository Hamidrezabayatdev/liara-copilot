"use client";

import * as React from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ContainerIcon,
  CpuIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LayersIcon,
  MemoryStickIcon,
  ScrollTextIcon,
  ServerIcon,
  TriangleIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDecimal, formatInt } from "@/components/format";
import type { AppPlatform, LiaraApp } from "@/components/types";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Mono, MonoChip } from "@/components/ui/ltr";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/ui/time-ago";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const PLATFORM_ICON: Partial<Record<AppPlatform, LucideIcon>> = {
  node: ServerIcon,
  next: TriangleIcon,
  react: LayersIcon,
  static: GlobeIcon,
  docker: ContainerIcon,
  postgres: DatabaseIcon,
  mysql: DatabaseIcon,
  mongodb: DatabaseIcon,
  redis: DatabaseIcon,
};

const PLATFORM_LABEL: Partial<Record<AppPlatform, string>> = {
  node: "Node.js",
  next: "Next.js",
  react: "React",
  static: "Static",
  docker: "Docker",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  redis: "Redis",
  laravel: "Laravel",
  django: "Django",
  flask: "Flask",
  php: "PHP",
};

export type ApplicationCardProps = {
  app: LiaraApp;
  /** Fires when the card body is activated; makes the whole card clickable. */
  onSelect?: (app: LiaraApp) => void;
  /** Shows a «logs» quick action. */
  onViewLogs?: (app: LiaraApp) => void;
  /** Shows a «releases» quick action. */
  onViewDeployments?: (app: LiaraApp) => void;
  /** Highlights the card as the resource currently under discussion. */
  active?: boolean;
  /** Hides the metrics strip for compact lists. */
  compact?: boolean;
  className?: string;
};

function MetricStat({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "default" | "warning" | "destructive";
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          tone === "default" && "text-muted-foreground/70",
          tone === "warning" && "text-warning",
          tone === "destructive" && "text-destructive",
        )}
      />
      <span className="text-muted-foreground text-[0.6875rem]">{label}</span>
      <span
        dir="ltr"
        className={cn(
          "ltr-embed text-[0.6875rem] font-semibold tabular-nums",
          tone === "default" && "text-foreground/90",
          tone === "warning" && "text-warning",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Loading placeholder with the same footprint as a populated card. */
function ApplicationCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("gap-0", className)}>
      <div className="flex items-center gap-3 px-4 pt-4">
        <Skeleton className="size-9 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2.5 w-20" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 px-4 py-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-16" />
      </div>
    </Card>
  );
}

/**
 * A single Liara resource rendered from an inspect-tool result.
 * Status colour is semantic: green = serving, grey = intentionally stopped,
 * amber = mid-build, red = up but failing requests.
 */
function ApplicationCard({
  app,
  onSelect,
  onViewLogs,
  onViewDeployments,
  active = false,
  compact = false,
  className,
}: ApplicationCardProps) {
  const Icon = PLATFORM_ICON[app.platform] ?? ServerIcon;
  const platformLabel = PLATFORM_LABEL[app.platform] ?? app.platform;
  const interactive = Boolean(onSelect);
  const m = app.metrics;
  const stopped = app.status === "STOPPED" || app.scale === 0;

  const body = (
    <>
      <div className="flex items-start gap-3 px-4 pt-4">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-md border",
            stopped
              ? "border-border bg-muted text-muted-foreground"
              : app.status === "UNHEALTHY"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-primary/25 bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Mono className="text-sm font-semibold tracking-tight">{app.name}</Mono>
            {app.version ? (
              <MonoChip className="shrink-0">{app.version}</MonoChip>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[0.6875rem]">
            <span dir="ltr" className="ltr-embed">
              {platformLabel}
            </span>
            <span className="opacity-40">·</span>
            {app.lastDeployedAt ? (
              <span className="inline-flex items-center gap-1">
                آخرین deploy
                <TimeAgo value={app.lastDeployedAt} />
              </span>
            ) : app.isDeployed === true ? (
              <span>deploy شده</span>
            ) : app.isDeployed === false ? (
              <span>هنوز deploy نشده</span>
            ) : (
              <span>زمان deploy نامشخص</span>
            )}
          </p>
        </div>

        <StatusPill status={app.status} className="mt-0.5 shrink-0" />
      </div>

      {app.note ? (
        <p
          className={cn(
            "mx-4 mt-3 flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs leading-5",
            app.status === "UNHEALTHY"
              ? "border-destructive/25 bg-destructive/8 text-destructive"
              : "border-border bg-muted/50 text-muted-foreground",
          )}
        >
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{app.note}</span>
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 py-3.5 text-xs sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-muted-foreground text-[0.6875rem]">پلن</dt>
          <dd className="mt-0.5">
            <Mono className="font-medium">{app.planId}</Mono>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-[0.6875rem]">تعداد نمونه‌ها</dt>
          <dd className="mt-0.5">
            <span
              dir="ltr"
              className={cn(
                "ltr-embed font-mono text-[0.8125rem] font-medium tabular-nums",
                app.scale === 0 && "text-muted-foreground",
              )}
            >
              {app.scale}
            </span>
            <span className="text-muted-foreground ms-1 text-[0.6875rem]">
              {app.scale === 0 ? "instance (متوقف)" : "instance"}
            </span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-[0.6875rem]">ناحیه</dt>
          <dd className="mt-0.5">
            <Mono className="font-medium">{app.region}</Mono>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-[0.6875rem]">شبکهٔ خصوصی</dt>
          <dd className="mt-0.5">
            {app.network ? (
              <Mono className="font-medium">{app.network}</Mono>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </dd>
        </div>
      </dl>

      {app.planSummary ? (
        <p className="text-muted-foreground border-border/60 mx-4 border-t pt-2.5 pb-1 text-[0.6875rem]">
          <span dir="ltr" className="ltr-embed">
            {app.planSummary}
          </span>
        </p>
      ) : null}

      {!compact && m ? (
        <div className="border-border/60 mx-4 mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 pb-4">
          {typeof m.cpuPercent === "number" ? (
            <MetricStat
              icon={CpuIcon}
              label="CPU"
              value={`${formatDecimal(m.cpuPercent, 1)}٪`}
              tone={m.cpuPercent > 85 ? "destructive" : "default"}
            />
          ) : null}
          {typeof m.memoryPercent === "number" ? (
            <MetricStat
              icon={MemoryStickIcon}
              label="memory"
              value={`${formatDecimal(m.memoryPercent, 1)}٪`}
              tone={m.memoryPercent > 85 ? "warning" : "default"}
            />
          ) : null}
          {typeof m.requestsPerMinute === "number" ? (
            <MetricStat
              icon={ActivityIcon}
              label="req/min"
              value={formatInt(m.requestsPerMinute)}
            />
          ) : null}
          {typeof m.errorRatePercent === "number" ? (
            <MetricStat
              icon={AlertTriangleIcon}
              label="5xx"
              value={`${formatDecimal(m.errorRatePercent, 1)}٪`}
              tone={
                m.errorRatePercent > 20
                  ? "destructive"
                  : m.errorRatePercent > 1
                    ? "warning"
                    : "default"
              }
            />
          ) : null}
          {!Object.values(m).some((v) => typeof v === "number") ? (
            <span className="text-muted-foreground text-[0.6875rem]">
              متریکی برای این resource ثبت نشده است.
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return (
    <Card
      data-slot="application-card"
      data-active={active || undefined}
      className={cn(
        "gap-0 overflow-hidden border-primary/15 bg-card/72 transition-[border-color,box-shadow,transform] duration-300",
        interactive &&
          "hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-lg focus-within:border-primary/45",
        active && "border-primary/60 ring-primary/20 ring-2",
        className,
      )}
    >
      {interactive ? (
        <button
          type="button"
          onClick={() => onSelect?.(app)}
          className="text-start outline-none"
          aria-label={`جزئیات ${app.name}`}
        >
          {body}
        </button>
      ) : (
        body
      )}

      {onViewLogs || onViewDeployments || app.subdomain ? (
        <div className="border-border/70 bg-muted/25 flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
          {app.subdomain ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={`https://${app.subdomain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary hover:bg-primary/10 inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[0.6875rem] font-medium transition-colors"
                >
                  <ExternalLinkIcon className="size-3.5" />
                  <Mono>{app.subdomain}</Mono>
                </a>
              </TooltipTrigger>
              <TooltipContent>باز کردن subdomain در تب جدید</TooltipContent>
            </Tooltip>
          ) : null}
          <span className="flex-1" />
          {onViewLogs ? (
            <Button variant="ghost" size="xs" onClick={() => onViewLogs(app)}>
              <ScrollTextIcon />
              لاگ‌ها
            </Button>
          ) : null}
          {onViewDeployments ? (
            <Button variant="ghost" size="xs" onClick={() => onViewDeployments(app)}>
              <LayersIcon />
              نسخه‌ها
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export { ApplicationCard, ApplicationCardSkeleton };
