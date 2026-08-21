"use client";

import * as React from "react";
import { GlobeIcon, LockIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatInt } from "@/components/format";
import type { DnsRecord, DnsRecordType } from "@/components/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Mono } from "@/components/ui/ltr";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const TYPE_VARIANT: Record<
  DnsRecordType,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  A: "default",
  AAAA: "default",
  CNAME: "info",
  TXT: "muted",
  MX: "warning",
  NS: "secondary",
  SRV: "secondary",
};

export type DnsRecordsTableProps = {
  records: DnsRecord[];
  /** Zone the records belong to, e.g. `digishop.ir`. */
  zone?: string;
  loading?: boolean;
  error?: string | null;
  /** Highlights record ids the agent considers the cause of a problem. */
  highlightIds?: string[];
  className?: string;
};

/**
 * DNS zone records. Every value is Latin and is bidi-isolated — an IP or a
 * CNAME target inside an RTL table cell otherwise renders with its segments
 * reversed, which is the classic RTL DNS-table bug.
 */
function DnsRecordsTable({
  records,
  zone,
  loading = false,
  error = null,
  highlightIds,
  className,
}: DnsRecordsTableProps) {
  const highlighted = React.useMemo(
    () => new Set(highlightIds ?? []),
    [highlightIds],
  );

  return (
    <Card data-slot="dns-records-table" className={cn("gap-0", className)}>
      <div className="border-border/70 flex items-center gap-2 border-b px-4 py-2.5">
        <GlobeIcon className="text-muted-foreground size-3.5" />
        <span className="text-[0.8125rem] font-semibold tracking-tight">
          رکوردهای DNS
        </span>
        {zone ? <Mono className="text-muted-foreground">{zone}</Mono> : null}
        <span className="flex-1" />
        <span className="text-muted-foreground text-[0.625rem]">
          <span dir="ltr" className="ltr-embed tabular-nums">
            {formatInt(records.length)}
          </span>{" "}
          رکورد
        </span>
      </div>

      {error ? (
        <p className="text-destructive px-4 py-6 text-center text-xs leading-5">
          خواندن zone ناموفق بود: {error}
        </p>
      ) : loading ? (
        <div className="space-y-2.5 px-4 py-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-12 rounded-full" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      ) : records.length === 0 ? (
        <p className="text-muted-foreground px-4 py-8 text-center text-xs leading-5">
          این zone هیچ رکوردی ندارد. برای اتصال دامنه ابتدا یک رکورد{" "}
          <Mono>A</Mono> یا <Mono>CNAME</Mono> بسازید.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-20">type</TableHead>
              <TableHead className="w-32">name</TableHead>
              <TableHead>value</TableHead>
              <TableHead className="w-20">TTL</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r) => (
              <TableRow
                key={r.id}
                data-highlighted={highlighted.has(r.id) || undefined}
                className={cn(
                  highlighted.has(r.id) &&
                    "bg-warning/8 hover:bg-warning/12 border-warning/25",
                )}
              >
                <TableCell>
                  <Badge variant={TYPE_VARIANT[r.type]} size="sm">
                    <span dir="ltr" className="ltr-embed font-mono">
                      {r.type}
                    </span>
                  </Badge>
                </TableCell>
                <TableCell>
                  <Mono className="text-[0.75rem] font-medium">{r.name}</Mono>
                </TableCell>
                <TableCell className="min-w-0">
                  <div className="flex flex-col gap-0.5">
                    {r.values.map((v, i) => (
                      <span key={i} className="flex items-center gap-1.5">
                        {typeof r.priority === "number" && r.type === "MX" ? (
                          <span
                            dir="ltr"
                            className="ltr-embed text-muted-foreground font-mono text-[0.6875rem] tabular-nums"
                          >
                            {r.priority}
                          </span>
                        ) : null}
                        <Mono className="text-foreground/90 min-w-0 truncate text-[0.75rem]">
                          {v}
                        </Mono>
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    dir="ltr"
                    className="ltr-embed text-muted-foreground font-mono text-[0.75rem] tabular-nums"
                  >
                    {formatInt(r.ttl)}
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <div className="flex items-center justify-end gap-0.5">
                    {r.managed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground/70 inline-flex p-1">
                            <LockIcon className="size-3" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          این رکورد را لیارا مدیریت می‌کند.
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                    <CopyButton value={r.values.join(" ")} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export { DnsRecordsTable };
