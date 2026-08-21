"use client";

import {
  DatabaseIcon,
  Globe2Icon,
  LockKeyholeIcon,
  NetworkIcon,
} from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import type { DatabaseEngine, LiaraDatabase } from "@/components/types";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Ltr, Mono, MonoChip } from "@/components/ui/ltr";
import { TimeAgo } from "@/components/ui/time-ago";
import { cn } from "@/lib/utils";

export type DatabaseCardProps = {
  database: LiaraDatabase;
  compact?: boolean;
  className?: string;
};

const ENGINE_LABEL: Record<DatabaseEngine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mongodb: "MongoDB",
  redis: "Redis",
  rabbitmq: "RabbitMQ",
  elasticsearch: "Elasticsearch",
  mssql: "Microsoft SQL Server",
  unknown: "نوع نامشخص",
};

/** A DBaaS-specific result surface: no deploy, release, or app-instance copy. */
function DatabaseCard({ database, compact = false, className }: DatabaseCardProps) {
  const engine = ENGINE_LABEL[database.engine];

  return (
    <Card
      data-slot="database-card"
      className={cn(
        "gap-0 rounded-xl border-border/75 bg-card shadow-none backdrop-blur-none transition-none",
        className,
      )}
    >
      <CardHeader className="flex-row items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-muted/40 text-muted-foreground">
          <DatabaseIcon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Mono className="truncate text-sm">{database.hostname}</Mono>
            {database.version ? <MonoChip>{database.version}</MonoChip> : null}
          </CardTitle>
          <CardDescription className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Ltr>{engine}</Ltr>
            <span aria-hidden>·</span>
            ایجاد <TimeAgo value={database.createdAt} />
          </CardDescription>
        </div>
        <CardAction>
          <StatusPill status={database.status} />
        </CardAction>
      </CardHeader>

      <CardContent className="pt-3">
        <dl className={cn("grid gap-x-4 gap-y-3", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
          <div className="min-w-0">
            <dt className="text-[0.625rem] text-muted-foreground">پلن</dt>
            <dd className="mt-1"><Mono className="font-semibold">{database.planId}</Mono></dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.625rem] text-muted-foreground">ناحیه</dt>
            <dd className="mt-1"><Mono className="font-semibold">{database.region}</Mono></dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.625rem] text-muted-foreground">شبکه</dt>
            <dd className="mt-1 inline-flex items-center gap-1.5 text-[0.75rem] font-semibold">
              <NetworkIcon className="size-3.5 text-muted-foreground" />
              {database.network ? <Mono>{database.network}</Mono> : "مستقل"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.625rem] text-muted-foreground">پورت داخلی</dt>
            <dd className="mt-1 text-[0.75rem] font-semibold">
              {database.internalPort ? <Mono>{database.internalPort}</Mono> : "خودکار"}
            </dd>
          </div>
        </dl>
        {!compact && database.planSummary ? (
          <p className="mt-3 text-[0.6875rem] text-muted-foreground">
            منابع پلن: <Ltr className="text-foreground/85">{database.planSummary}</Ltr>
          </p>
        ) : null}
      </CardContent>

      <CardFooter>
        {database.publicNetwork ? (
          <>
            <Globe2Icon className="size-3.5 text-warning" />
            <span className="text-[0.6875rem] text-muted-foreground">دسترسی از شبکهٔ عمومی فعال است.</span>
            <Badge variant="warning" size="sm" className="ms-auto">Public</Badge>
          </>
        ) : (
          <>
            <LockKeyholeIcon className="size-3.5 text-success" />
            <span className="text-[0.6875rem] text-muted-foreground">اتصال فقط از شبکهٔ خصوصی لیارا</span>
            <Badge variant="success" size="sm" className="ms-auto">Private</Badge>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

export { DatabaseCard };
