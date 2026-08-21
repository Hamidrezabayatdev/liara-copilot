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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>نوع و شناسه</TableHead>
              <TableHead>شرح</TableHead>
              <TableHead>زمان</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-muted-foreground py-6 text-center text-xs"
                >
                  API در این بررسی رویدادی برنگرداند.
                </TableCell>
              </TableRow>
            ) : (
              events.map((event, index) => (
                <TableRow key={`${event.id}-${index}`}>
                  <TableCell>
                    <div className="flex min-w-36 flex-col items-start gap-1">
                      <Badge variant="secondary" size="sm" dir="ltr">
                        {event.type}
                      </Badge>
                      <Mono
                        title={event.id}
                        className="text-muted-foreground max-w-40 truncate text-[0.625rem]"
                      >
                        {event.id}
                      </Mono>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-56 max-w-lg text-xs leading-5">
                    <span dir="auto">
                      {event.message || "توضیحی برای این رویداد ثبت نشده است."}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {hasValidTimestamp(event.createdAt) ? (
                      <TimeAgo value={event.createdAt} />
                    ) : (
                      "زمان نامشخص"
                    )}
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>نام</TableHead>
              <TableHead>دسترسی</TableHead>
              <TableHead>plan</TableHead>
              <TableHead>ساخته‌شده</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buckets.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-muted-foreground py-6 text-center text-xs"
                >
                  API در این بررسی باکتی برنگرداند.
                </TableCell>
              </TableRow>
            ) : (
              buckets.map((bucket, index) => (
                <TableRow key={bucket.id ?? `${bucket.name}-${index}`}>
                  <TableCell>
                    <Mono className="font-medium">{bucket.name}</Mono>
                  </TableCell>
                  <TableCell>
                    {bucket.permission ? (
                      <Badge variant="outline" size="sm" dir="ltr">
                        {bucket.permission}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">نامشخص</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {bucket.plan ? (
                      <Mono>{bucket.plan}</Mono>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {hasValidTimestamp(bucket.createdAt) ? (
                      <TimeAgo value={bucket.createdAt} />
                    ) : (
                      "زمان نامشخص"
                    )}
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
