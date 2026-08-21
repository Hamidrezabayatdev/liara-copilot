"use client";

import * as React from "react";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  LifeBuoyIcon,
  SearchCheckIcon,
  ServerIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateTimeFa } from "@/components/format";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Mono } from "@/components/ui/ltr";
import { Skeleton } from "@/components/ui/skeleton";

export type SupportContextItem = {
  label: string;
  value: string;
  /** Render the value as monospace/LTR (app names, plans, ports, IDs). */
  mono?: boolean;
};

export type SupportSummaryCardProps = {
  /** One-line subject for the ticket. */
  subject: string;
  /** What the user reported. */
  symptom: string;
  /** Account facts the support engineer would otherwise have to ask for. */
  context: SupportContextItem[];
  /** Steps the agent already performed, in order. */
  attempted: string[];
  /** What those steps established. */
  findings: string[];
  /** Why the agent could not finish, in one or two sentences. */
  unresolvedReason: string;
  /** Relevant log excerpt, rendered LTR verbatim. */
  logExcerpt?: string;
  /** Reference id if a ticket already exists. */
  ticketId?: string;
  createdAt?: string;
  /** Opens the Liara console ticket form. */
  onOpenTicket?: () => void;
  onCopied?: (text: string) => void;
  loading?: boolean;
  className?: string;
};

/** Plain-text rendering for the clipboard — this is what lands in the ticket. */
function buildPlainText(p: SupportSummaryCardProps): string {
  const lines: string[] = [];
  lines.push(`موضوع: ${p.subject}`);
  if (p.ticketId) lines.push(`شناسه: ${p.ticketId}`);
  if (p.createdAt) lines.push(`زمان: ${formatDateTimeFa(p.createdAt)}`);
  lines.push("");
  lines.push("— مشکل گزارش‌شده —");
  lines.push(p.symptom);
  lines.push("");
  lines.push("— وضعیت حساب —");
  for (const c of p.context) lines.push(`${c.label}: ${c.value}`);
  lines.push("");
  lines.push("— اقدامات انجام‌شده —");
  p.attempted.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  lines.push("");
  lines.push("— یافته‌ها —");
  for (const f of p.findings) lines.push(`- ${f}`);
  lines.push("");
  lines.push("— علت ارجاع —");
  lines.push(p.unresolvedReason);
  if (p.logExcerpt) {
    lines.push("");
    lines.push("— بخشی از log —");
    lines.push(p.logExcerpt);
  }
  return lines.join("\n");
}

function Section({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon: React.ElementType;
  title: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span
        className={cn(
          "text-muted-foreground inline-flex items-center gap-1.5 text-[0.625rem] font-semibold",
          tone,
        )}
      >
        <Icon className="size-3" />
        {title}
      </span>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/**
 * The escalation handoff (spec §17 level 3 → human).
 *
 * When the agent gives up, the value it can still deliver is a support ticket
 * that does not restart from zero: account facts, what was already tried, what
 * that ruled out, and the log excerpt. One button puts the whole thing on the
 * clipboard as plain text.
 */
function SupportSummaryCard(props: SupportSummaryCardProps) {
  const {
    subject,
    symptom,
    context,
    attempted,
    findings,
    unresolvedReason,
    logExcerpt,
    ticketId,
    createdAt,
    onOpenTicket,
    onCopied,
    loading = false,
    className,
  } = props;

  if (loading) {
    return (
      <div
        className={cn(
          "bg-card space-y-3 rounded-lg border border-border/80 px-4 py-4",
          className,
        )}
      >
        <Skeleton className="h-4 w-40 rounded-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const plain = buildPlainText(props);

  return (
    <section
      data-slot="support-summary-card"
      className={cn(
        "bg-card relative overflow-hidden rounded-lg border border-border/80 shadow-sm",
        className,
      )}
    >
      <span
        aria-hidden
        className="from-info/60 absolute inset-x-0 top-0 h-px bg-gradient-to-l to-transparent"
      />

      <header className="flex flex-wrap items-start gap-2 px-4 pt-3.5">
        <span className="border-info/30 bg-info/10 text-info mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border">
          <LifeBuoyIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-muted-foreground block text-[0.625rem] font-semibold">
            خلاصهٔ ارجاع به پشتیبانی
          </span>
          <h3 className="mt-0.5 text-[0.875rem] leading-6 font-semibold tracking-tight">
            {subject}
          </h3>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem]">
            {ticketId ? (
              <span className="inline-flex items-center gap-1">
                شناسه
                <Mono className="text-foreground/80">{ticketId}</Mono>
              </span>
            ) : null}
            {createdAt ? <span>{formatDateTimeFa(createdAt)}</span> : null}
          </div>
        </div>
        <CopyButton
          value={plain}
          label="کپی خلاصه"
          variant="outline"
          size="xs"
          onCopied={onCopied}
        />
      </header>

      <div className="grid gap-3.5 px-4 pt-3.5 pb-4 sm:grid-cols-2">
        <div className="space-y-3.5">
          <Section icon={TriangleAlertIcon} title="مشکل گزارش‌شده">
            <p className="text-foreground/85 text-xs leading-6">{symptom}</p>
          </Section>

          <Section icon={ServerIcon} title="وضعیت حساب">
            <dl className="border-border/60 bg-muted/25 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border px-2.5 py-2 text-[0.6875rem]">
              {context.map((c) => (
                <React.Fragment key={c.label}>
                  <dt className="text-muted-foreground">{c.label}</dt>
                  <dd className="text-end">
                    {c.mono ? (
                      <Mono className="text-foreground/90">{c.value}</Mono>
                    ) : (
                      <span className="text-foreground/90">{c.value}</span>
                    )}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          </Section>

          <Section icon={TriangleAlertIcon} title="علت ارجاع" tone="text-warning">
            <p className="border-warning/30 bg-warning/[0.07] text-foreground/90 rounded-md border px-2.5 py-2 text-xs leading-6">
              {unresolvedReason}
            </p>
          </Section>
        </div>

        <div className="space-y-3.5">
          <Section icon={CheckCircle2Icon} title="اقدامات انجام‌شده">
            <ol className="space-y-1">
              {attempted.map((a, i) => (
                <li
                  key={i}
                  className="text-foreground/85 flex items-start gap-2 text-xs leading-6"
                >
                  <span
                    dir="ltr"
                    className="ltr-embed bg-muted text-muted-foreground border-border mt-1 grid size-4 shrink-0 place-items-center rounded-full border text-[0.5625rem] font-bold tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">{a}</span>
                </li>
              ))}
            </ol>
          </Section>

          <Section icon={SearchCheckIcon} title="یافته‌ها">
            <ul className="space-y-1">
              {findings.map((f, i) => (
                <li
                  key={i}
                  className="text-foreground/85 flex items-start gap-2 text-xs leading-6"
                >
                  <span
                    aria-hidden
                    className="bg-info/70 mt-[0.8em] size-1.5 shrink-0 rounded-full"
                  />
                  <span className="min-w-0 flex-1">{f}</span>
                </li>
              ))}
            </ul>
          </Section>

          {logExcerpt ? (
            <div className="border-border/70 bg-muted/40 overflow-hidden rounded-md border">
              <div className="border-border/60 flex items-center gap-2 border-b px-2.5 py-1">
                <span
                  dir="ltr"
                  className="ltr-embed text-muted-foreground font-mono text-[0.625rem]"
                >
                  log excerpt
                </span>
                <span className="flex-1" />
                <CopyButton value={logExcerpt} className="size-6" />
              </div>
              <pre
                dir="ltr"
                className="scrollbar-slim max-h-32 overflow-auto px-2.5 py-2 text-start font-mono text-[0.6875rem] leading-5"
              >
                <code>{logExcerpt}</code>
              </pre>
            </div>
          ) : null}
        </div>
      </div>

      {onOpenTicket ? (
        <div className="border-border/70 bg-muted/25 flex items-center gap-2 border-t px-3 py-2.5">
          <p className="text-muted-foreground text-[0.625rem] leading-5">
            این خلاصه را در فرم تیکت کنسول Liara جای‌گذاری کنید تا پشتیبانی از صفر
            شروع نکند.
          </p>
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={onOpenTicket}>
            <ExternalLinkIcon />
            ثبت تیکت در کنسول
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export { SupportSummaryCard, buildPlainText };
