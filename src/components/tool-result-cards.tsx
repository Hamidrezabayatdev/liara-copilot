import {
  ActivityIcon,
  BoxesIcon,
  DatabaseIcon,
  ServerIcon,
} from "lucide-react";

import { formatDecimal, formatInt, formatToman } from "@/components/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Ltr, Mono } from "@/components/ui/ltr";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimeAgo } from "@/components/ui/time-ago";

export type AppEventSummary = {
  id: string;
  type: string;
  message?: string;
  createdAt?: string;
};

export type RecentAppEventsCardProps = {
  appName: string;
  events: readonly AppEventSummary[];
  className?: string;
};

export type BucketSummary = {
  id?: string;
  name: string;
  permission?: string;
  plan?: string;
  createdAt?: string;
};

export type ObjectStorageBucketsCardProps = {
  buckets: readonly BucketSummary[];
  className?: string;
};

export type LivePlanSummary = {
  planID: string;
  available: boolean;
  region: string;
  pricePerHour: number;
  pricePerMonth?: number;
  ramGB?: number;
  cpuCores?: number;
  diskGB?: number;
  isG2: boolean;
};

export type LivePlanCatalogCardProps = {
  kind: "projects" | "databases";
  plans: readonly LivePlanSummary[];
  className?: string;
};

function hasValidTimestamp(value: string | undefined): value is string {
  return Boolean(value && Number.isFinite(new Date(value).getTime()));
}

function ResultCount({ count, label }: { count: number; label: string }) {
  return (
    <Badge variant="outline" size="sm">
      <Ltr className="tabular-nums">{formatInt(count)}</Ltr>
      {label}
    </Badge>
  );
}

function RecentAppEventsCard({
  appName,
  events,
  className,
}: RecentAppEventsCardProps) {
  return (
    <Card
      data-slot="recent-app-events-card"
      dir="rtl"
      className={cn("gap-0 overflow-hidden", className)}
    >
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <ActivityIcon className="text-muted-foreground size-4" />
            رویدادهای اخیر
          </CardTitle>
          <CardDescription>
            آخرین رویدادهای ثبت‌شده برای <Mono>{appName}</Mono>
          </CardDescription>
        </div>
        <CardAction>
          <ResultCount count={events.length} label="رویداد" />
        </CardAction>
      </CardHeader>

      <CardContent className="pt-3">
        {events.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-7 text-center text-xs text-muted-foreground">
            API در این بررسی رویدادی برنگرداند.
          </p>
        ) : (
          <ol className="flex flex-col gap-0">
            {events.map((event, index) => (
              <li key={`${event.id}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
                {index < events.length - 1 ? (
                  <span className="absolute start-[0.4375rem] top-5 h-[calc(100%-0.5rem)] w-px bg-border" />
                ) : null}
                <span className="relative mt-1.5 size-3.5 shrink-0 rounded-full border-[3px] border-card bg-primary shadow-[0_0_0_1px_var(--border)]" />
                <div className="min-w-0 flex-1 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 transition-colors hover:border-primary/25 hover:bg-primary/[0.035]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" size="sm" dir="ltr">{event.type}</Badge>
                    <Mono title={event.id} className="max-w-44 truncate text-[0.625rem] text-muted-foreground">{event.id}</Mono>
                    <span className="flex-1" />
                    <span className="text-[0.625rem] text-muted-foreground">
                      {hasValidTimestamp(event.createdAt) ? <TimeAgo value={event.createdAt} /> : "زمان نامشخص"}
                    </span>
                  </div>
                  <p dir="auto" className="mt-1.5 text-xs leading-6 text-foreground/85">
                    {event.message || "توضیحی برای این رویداد ثبت نشده است."}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ObjectStorageBucketsCard({
  buckets,
  className,
}: ObjectStorageBucketsCardProps) {
  return (
    <Card
      data-slot="object-storage-buckets-card"
      dir="rtl"
      className={cn("gap-0 overflow-hidden", className)}
    >
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <BoxesIcon className="text-muted-foreground size-4" />
            باکت‌های Object Storage
          </CardTitle>
          <CardDescription>
            نام، سطح دسترسی و plan؛ بدون نمایش access key
          </CardDescription>
        </div>
        <CardAction>
          <ResultCount count={buckets.length} label="باکت" />
        </CardAction>
      </CardHeader>

      <CardContent className="pt-3">
        {buckets.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-7 text-center text-xs text-muted-foreground">
            API در این بررسی باکتی برنگرداند.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {buckets.map((bucket, index) => (
              <article
                key={bucket.id ?? `${bucket.name}-${index}`}
                className="group rounded-2xl border border-border/65 bg-muted/15 p-3.5 transition-[border-color,background-color,transform] duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/[0.035]"
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/8 text-primary">
                    <BoxesIcon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Mono className="block truncate text-[0.8125rem] font-semibold">{bucket.name}</Mono>
                    <p className="mt-0.5 text-[0.625rem] text-muted-foreground">فضای ذخیره‌سازی S3-compatible</p>
                  </div>
                  <Badge variant={bucket.permission === "private" ? "success" : "warning"} size="sm" dir="ltr">
                    {bucket.permission ?? "unknown"}
                  </Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border/50 pt-3 text-[0.6875rem]">
                  <div>
                    <dt className="text-muted-foreground">plan</dt>
                    <dd className="mt-0.5">{bucket.plan ? <Mono>{bucket.plan}</Mono> : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ساخته‌شده</dt>
                    <dd className="mt-0.5 text-foreground/85">
                      {hasValidTimestamp(bucket.createdAt) ? <TimeAgo value={bucket.createdAt} /> : "نامشخص"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlanResources({ plan }: { plan: LivePlanSummary }) {
  const resources = [
    plan.ramGB === undefined ? null : `${formatDecimal(plan.ramGB)} GB RAM`,
    plan.cpuCores === undefined ? null : `${formatDecimal(plan.cpuCores)} vCPU`,
    plan.diskGB === undefined ? null : `${formatDecimal(plan.diskGB)} GB disk`,
  ].filter((value): value is string => value !== null);

  if (resources.length === 0) {
    return <span className="text-muted-foreground text-xs">جزئیات نامشخص</span>;
  }

  return (
    <div className="flex min-w-44 flex-wrap gap-x-2 gap-y-1">
      {resources.map((resource) => (
        <Ltr key={resource} className="text-xs tabular-nums">
          {resource}
        </Ltr>
      ))}
    </div>
  );
}

function LivePlanCatalogCard({
  kind,
  plans,
  className,
}: LivePlanCatalogCardProps) {
  const Icon = kind === "databases" ? DatabaseIcon : ServerIcon;
  const title = kind === "databases" ? "پلن‌های دیتابیس" : "پلن‌های اپلیکیشن";

  return (
    <Card
      data-slot="live-plan-catalog-card"
      dir="rtl"
      className={cn("gap-0 overflow-hidden", className)}
    >
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Icon className="text-muted-foreground size-4" />
            {title}
          </CardTitle>
          <CardDescription>
            کاتالوگ زندهٔ حساب؛ قیمت‌ها مستقیماً از Liara خوانده شده‌اند.
          </CardDescription>
        </div>
        <CardAction>
          <ResultCount count={plans.length} label="plan" />
        </CardAction>
      </CardHeader>

      <CardContent className="pt-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>plan</TableHead>
              <TableHead>منابع</TableHead>
              <TableHead>region</TableHead>
              <TableHead>هزینه</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-muted-foreground py-6 text-center text-xs"
                >
                  کاتالوگ زنده برای این فیلتر planی برنگرداند.
                </TableCell>
              </TableRow>
            ) : (
              plans.map((plan) => (
                <TableRow key={plan.planID}>
                  <TableCell>
                    <div className="flex min-w-32 flex-col items-start gap-1.5">
                      <Mono className="font-medium">{plan.planID}</Mono>
                      <div className="flex flex-wrap gap-1">
                        <Badge
                          variant={plan.available ? "success" : "muted"}
                          size="sm"
                        >
                          {plan.available ? "قابل سفارش" : "غیرفعال در کاتالوگ"}
                        </Badge>
                        {plan.isG2 ? (
                          <Badge variant="info" size="sm" dir="ltr">
                            G2
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <PlanResources plan={plan} />
                  </TableCell>
                  <TableCell>
                    <Mono>{plan.region}</Mono>
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-32 flex-col items-start gap-0.5 text-xs">
                      <Ltr className="font-medium tabular-nums">
                        {formatToman(plan.pricePerHour)} Toman/h
                      </Ltr>
                      {plan.pricePerMonth === undefined ? null : (
                        <Ltr className="text-muted-foreground tabular-nums">
                          {formatToman(plan.pricePerMonth)} Toman/month
                        </Ltr>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export {
  LivePlanCatalogCard,
  ObjectStorageBucketsCard,
  RecentAppEventsCard,
};
