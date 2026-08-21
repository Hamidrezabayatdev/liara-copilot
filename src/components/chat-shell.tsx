"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import {
  CheckCircle2Icon,
  CircleXIcon,
  CloudCogIcon,
  LoaderCircleIcon,
  SearchCheckIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";

import { ApplicationCard } from "@/components/application-card";
import { AccountConnection } from "@/components/account-connection";
import { AgentChecklist } from "@/components/agent-checklist";
import { AskUserPrompt, type AskUserOption } from "@/components/ask-user-prompt";
import { BeforeAfterDiff } from "@/components/before-after-diff";
import { ChatComposer } from "@/components/chat-composer";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { DeploymentCard } from "@/components/deployment-card";
import { DnsRecordsTable } from "@/components/dns-records-table";
import { EnvEditor } from "@/components/env-editor";
import { LogViewer } from "@/components/log-viewer";
import { MessageBubble } from "@/components/message-bubble";
import { MetricsPanel } from "@/components/metrics-panel";
import {
  SessionCostFooter,
  type ModelUsageBreakdown,
} from "@/components/session-cost-footer";
import { SourceCard } from "@/components/source-card";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  LivePlanCatalogCard,
  ObjectStorageBucketsCard,
  RecentAppEventsCard,
  type AppEventSummary,
  type BucketSummary,
  type LivePlanSummary,
} from "@/components/tool-result-cards";
import type {
  AppPlatform,
  AppStatus,
  ChecklistStep,
  Deployment,
  DeploymentState,
  DiffRow,
  DnsRecord,
  DnsRecordType,
  EnvVar,
  LiaraApp,
  LogLine,
  LogSeverity,
  MetricSeries,
  Source,
  UsageMeta,
} from "@/components/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  clearChatHistory,
  getChatHistorySnapshot,
  getServerChatHistorySnapshot,
  loadChatHistory,
  scheduleChatHistorySave,
  subscribeToChatHistory,
} from "@/lib/chat-history";
import { subscribeToAccountChanges } from "@/lib/account-events";

const transport = new DefaultChatTransport({ api: "/api/chat" });

const HERO_PROMPTS = [
  {
    id: "diagnose",
    label: "چرا digishop-api خطای ۵۰۲ می‌دهد؟",
    icon: SearchCheckIcon,
  },
  {
    id: "about",
    label: "لیارا چیست و چه سرویس‌هایی دارد؟",
    icon: CloudCogIcon,
  },
] as const;

const TOOL_LABELS: Record<string, string> = {
  searchDocs: "جست‌وجوی مستندات لیارا",
  listApps: "دریافت اپلیکیشن‌ها",
  getApp: "بررسی اپلیکیشن",
  getAppLogs: "بررسی لاگ‌ها",
  getAppEvents: "بررسی رویدادها",
  getAppReleases: "بررسی نسخه‌ها",
  getAppMetrics: "بررسی متریک‌ها",
  listEnvVars: "بررسی متغیرهای محیطی",
  listDatabases: "دریافت دیتابیس‌ها",
  getDatabase: "بررسی دیتابیس",
  listBuckets: "دریافت باکت‌ها",
  listDnsRecords: "بررسی رکوردهای DNS",
  getPlans: "دریافت پلن‌های زنده",
  setEnvVars: "تغییر متغیرهای محیطی",
  restartApp: "ری‌استارت اپلیکیشن",
  scaleApp: "تغییر تعداد نمونه‌ها",
  resizeApp: "تغییر پلن اپلیکیشن",
  rollbackRelease: "بازگردانی نسخه",
  createDnsRecord: "ساخت رکورد DNS",
  askUser: "دریافت تصمیم شما",
};

type UnknownRecord = Record<string, unknown>;

type LooseToolPart = {
  type: string;
  toolName?: string;
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-error"
    | "output-denied";
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: {
    id: string;
    approved?: boolean;
    isAutomatic?: boolean;
  };
};

type PendingApproval = {
  id: string;
  toolName: string;
  input: unknown;
};

type ApprovalCopy = {
  action: string;
  target: string;
  targetKind: string;
  description: string;
  diff?: DiffRow[];
  reversible: boolean;
  reversibilityNote: string;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringField(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toolName(part: LooseToolPart): string {
  return part.type === "dynamic-tool"
    ? (part.toolName ?? "")
    : part.type.startsWith("tool-")
      ? part.type.slice(5)
      : "";
}

function unwrapResult(output: unknown): unknown {
  if (isRecord(output) && output.ok === true && "data" in output) {
    return output.data;
  }
  return output;
}

function failedResult(output: unknown): boolean {
  return isRecord(output) && output.ok === false;
}

function valueAt(payload: unknown, keys: string[]): unknown {
  if (!isRecord(payload)) return undefined;
  for (const key of keys) {
    if (key in payload) return payload[key];
  }
  return undefined;
}

function arrayAt(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const value = valueAt(payload, keys);
  return Array.isArray(value) ? value : [];
}

function safeLogText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer •••")
    .replace(
      /\b(password|passwd|token|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      "$1=•••",
    )
    .replace(
      /\b((?:postgres|mysql|mongodb|redis|amqp|rediss)(?:\+srv)?:\/\/[^:\s]+:)[^@\s]+(@)/gi,
      "$1•••$2",
    );
}

const APP_PLATFORMS = new Set<AppPlatform>([
  "node",
  "next",
  "static",
  "react",
  "laravel",
  "django",
  "flask",
  "php",
  "docker",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
]);

const APP_STATUSES = new Set<AppStatus>([
  "ACTIVE",
  "STOPPED",
  "BUILDING",
  "UNHEALTHY",
]);

function isApp(value: unknown): value is LiaraApp {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    APP_PLATFORMS.has(value.platform as AppPlatform) &&
    APP_STATUSES.has(value.status as AppStatus) &&
    typeof value.planId === "string" &&
    isFiniteNumber(value.scale) &&
    typeof value.region === "string" &&
    typeof value.createdAt === "string"
  );
}

const DEPLOYMENT_STATES = new Set<DeploymentState>([
  "SUCCESS",
  "BUILDING",
  "DEPLOYING",
  "FAILED",
  "CANCELLED",
]);

function isDeployment(value: unknown): value is Deployment {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.appName === "string" &&
    DEPLOYMENT_STATES.has(value.state as DeploymentState) &&
    ["cli", "git", "console", "api"].includes(String(value.source)) &&
    typeof value.createdAt === "string"
  );
}

const LOG_SEVERITIES = new Set<LogSeverity>([
  "ERROR",
  "WARN",
  "INFO",
  "DEBUG",
]);

function isLogLine(value: unknown): value is LogLine {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.timestamp === "string" &&
    LOG_SEVERITIES.has(value.severity as LogSeverity) &&
    typeof value.message === "string"
  );
}

const DNS_TYPES = new Set<DnsRecordType>([
  "A",
  "AAAA",
  "CNAME",
  "ALIAS",
  "TXT",
  "SPF",
  "MX",
  "NS",
  "SRV",
  "PTR",
  "CAA",
]);

function isDnsRecord(value: unknown): value is DnsRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    DNS_TYPES.has(value.type as DnsRecordType) &&
    typeof value.name === "string" &&
    Array.isArray(value.values) &&
    value.values.every((item) => typeof item === "string") &&
    isFiniteNumber(value.ttl)
  );
}

function isSource(value: unknown): value is Source {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    ["docs", "account", "inference"].includes(String(value.kind)) &&
    typeof value.title === "string" &&
    typeof value.snippet === "string" &&
    (value.url === undefined || typeof value.url === "string") &&
    (value.origin === undefined || typeof value.origin === "string")
  );
}

function isEnvVar(value: unknown): value is EnvVar {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.value === "string" &&
    (value.secret === undefined || typeof value.secret === "boolean")
  );
}

const DIFF_KINDS = new Set<DiffRow["kind"]>([
  "added",
  "removed",
  "unchanged",
  "changed",
]);

function isDiffRow(value: unknown): value is DiffRow {
  return (
    isRecord(value) &&
    DIFF_KINDS.has(value.kind as DiffRow["kind"]) &&
    typeof value.label === "string" &&
    (value.before === undefined || typeof value.before === "string") &&
    (value.after === undefined || typeof value.after === "string")
  );
}

function isAppEvent(value: unknown): value is AppEventSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.createdAt === undefined || typeof value.createdAt === "string")
  );
}

function isBucket(value: unknown): value is BucketSummary {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.id === undefined || typeof value.id === "string") &&
    (value.permission === undefined || typeof value.permission === "string") &&
    (value.plan === undefined || typeof value.plan === "string") &&
    (value.createdAt === undefined || typeof value.createdAt === "string")
  );
}

function isLivePlan(value: unknown): value is LivePlanSummary {
  return (
    isRecord(value) &&
    typeof value.planID === "string" &&
    typeof value.available === "boolean" &&
    typeof value.region === "string" &&
    isFiniteNumber(value.pricePerHour) &&
    typeof value.isG2 === "boolean" &&
    (value.pricePerMonth === undefined || isFiniteNumber(value.pricePerMonth)) &&
    (value.ramGB === undefined || isFiniteNumber(value.ramGB)) &&
    (value.cpuCores === undefined || isFiniteNumber(value.cpuCores)) &&
    (value.diskGB === undefined || isFiniteNumber(value.diskGB))
  );
}

function metricSeries(value: unknown): MetricSeries[] {
  if (!isRecord(value)) return [];
  const series: MetricSeries[] = [];
  if (isFiniteNumber(value.cpuPercent)) {
    series.push({
      key: "cpu",
      label: "CPU",
      points: [value.cpuPercent],
      current: value.cpuPercent,
      max: 100,
      unit: "%",
    });
  }
  if (isFiniteNumber(value.memoryPercent)) {
    series.push({
      key: "memory",
      label: "memory",
      points: [value.memoryPercent],
      current: value.memoryPercent,
      max: 100,
      unit: "%",
    });
  }
  return series;
}

function messageUsage(metadata: unknown): {
  usage?: UsageMeta;
  baselineToman?: number;
} {
  if (!isRecord(metadata)) return {};
  const raw = metadata.usage;
  const baselineToman = isFiniteNumber(metadata.baselineToman)
    ? metadata.baselineToman
    : undefined;
  if (!isRecord(raw)) return { baselineToman };

  const model = stringField(raw, "model");
  const promptTokens = isFiniteNumber(raw.promptTokens)
    ? raw.promptTokens
    : raw.inputTokens;
  const completionTokens = isFiniteNumber(raw.completionTokens)
    ? raw.completionTokens
    : raw.outputTokens;
  const escalation = isFiniteNumber(raw.escalation) ? raw.escalation : raw.level;

  if (
    !model ||
    !isFiniteNumber(promptTokens) ||
    !isFiniteNumber(completionTokens) ||
    !isFiniteNumber(raw.toman) ||
    !isFiniteNumber(raw.toolCalls) ||
    !isFiniteNumber(raw.latencyMs) ||
    ![1, 2, 3].includes(Number(escalation))
  ) {
    return { baselineToman };
  }

  return {
    baselineToman,
    usage: {
      model,
      promptTokens,
      completionTokens,
      cachedTokens: isFiniteNumber(raw.cachedTokens) ? raw.cachedTokens : undefined,
      reasoningTokens: isFiniteNumber(raw.reasoningTokens)
        ? raw.reasoningTokens
        : undefined,
      toman: raw.toman,
      toolCalls: raw.toolCalls,
      latencyMs: raw.latencyMs,
      escalation: Number(escalation) as 1 | 2 | 3,
      routingReason:
        stringField(raw, "routingReason") ?? stringField(raw, "why"),
    },
  };
}

type SessionTotals = {
  messages: number;
  totalToman: number;
  baselineToman: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  cachedTokens: number;
  toolCalls: number;
  breakdown: ModelUsageBreakdown[];
};

function sessionTotals(messages: UIMessage[]): SessionTotals {
  const totals: Omit<SessionTotals, "breakdown"> = {
    messages: 0,
    totalToman: 0,
    baselineToman: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    cachedTokens: 0,
    toolCalls: 0,
  };
  const byModel = new Map<string, ModelUsageBreakdown>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const metadata = messageUsage(message.metadata);
    if (!metadata.usage) continue;

    const usage = metadata.usage;
    totals.messages += 1;
    totals.totalToman += usage.toman;
    totals.baselineToman += metadata.baselineToman ?? usage.toman;
    totals.totalPromptTokens += usage.promptTokens;
    totals.totalCompletionTokens += usage.completionTokens;
    totals.cachedTokens += usage.cachedTokens ?? 0;
    totals.toolCalls += usage.toolCalls;

    const current = byModel.get(usage.model);
    byModel.set(usage.model, {
      model: usage.model,
      calls: (current?.calls ?? 0) + 1,
      toman: (current?.toman ?? 0) + usage.toman,
    });
  }

  return { ...totals, breakdown: [...byModel.values()] };
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

function askInput(input: unknown): {
  question: string;
  reason?: string;
  options: AskUserOption[];
  allowFreeText: boolean;
} | null {
  if (!isRecord(input)) return null;
  const question = stringField(input, "question");
  if (!question || !Array.isArray(input.options)) return null;

  const options = input.options
    .slice(0, 4)
    .map((value, index): AskUserOption | null => {
      if (!isRecord(value)) return null;
      const label = stringField(value, "label");
      if (!label) return null;
      return {
        id: stringField(value, "id") ?? String(index + 1),
        label,
        detail: stringField(value, "detail"),
        target: stringField(value, "target"),
        recommended: value.recommended === true,
      };
    })
    .filter((value): value is AskUserOption => value !== null);

  if (options.length < 2) return null;
  return {
    question,
    reason: stringField(input, "reason"),
    options,
    allowFreeText: input.allowFreeText === true,
  };
}

function approvalCopy(name: string, input: unknown): ApprovalCopy {
  const data = isRecord(input) ? input : {};
  const appName = stringField(data, "appName") ?? "منبع انتخاب‌شده";

  if (name === "setEnvVars") {
    const changes = Array.isArray(data.changes) ? data.changes : [];
    const diff = changes
      .map((value): DiffRow | null => {
        if (!isRecord(value)) return null;
        const key = stringField(value, "key");
        if (!key) return null;
        return {
          kind: value.expectedCurrentValue == null ? "added" : "changed",
          label: key,
          before: "مقدار قبلی پنهان است",
          after: "مقدار جدید پنهان است",
        };
      })
      .filter((value): value is DiffRow => value !== null);
    return {
      action: "تغییر متغیرهای محیطی",
      target: appName,
      targetKind: "اپلیکیشن",
      description:
        "فقط کلیدهای نمایش‌داده‌شده با حالت merge تغییر می‌کنند. مقدارها برای جلوگیری از افشای اطلاعات نمایش داده نمی‌شوند.",
      diff,
      reversible: true,
      reversibilityNote: "با تنظیم دوبارهٔ مقدارهای قبلی می‌توان تغییر را برگرداند.",
    };
  }

  if (name === "scaleApp") {
    return {
      action: "تغییر تعداد نمونه‌های اپلیکیشن",
      target: appName,
      targetKind: "اپلیکیشن",
      description: "تعداد instanceهای در حال سرویس‌دهی تغییر می‌کند.",
      diff: [
        {
          kind: "changed",
          label: "scale",
          before: isFiniteNumber(data.expectedCurrentScale)
            ? String(data.expectedCurrentScale)
            : "وضعیت فعلی",
          after: isFiniteNumber(data.scale) ? String(data.scale) : "مقدار جدید",
        },
      ],
      reversible: true,
      reversibilityNote: "با بازگرداندن scale قبلی قابل برگشت است.",
    };
  }

  if (name === "resizeApp") {
    return {
      action: "تغییر پلن اپلیکیشن",
      target: appName,
      targetKind: "اپلیکیشن",
      description: "منابع محاسباتی اپلیکیشن به پلن انتخاب‌شده تغییر می‌کند.",
      diff: [
        {
          kind: "changed",
          label: "plan",
          before: stringField(data, "expectedCurrentPlanId") ?? "پلن فعلی",
          after: stringField(data, "planId") ?? "پلن جدید",
        },
      ],
      reversible: true,
      reversibilityNote: "در صورت موجود بودن پلن قبلی می‌توان دوباره به آن resize کرد.",
    };
  }

  if (name === "rollbackRelease") {
    return {
      action: "بازگردانی نسخهٔ قبلی",
      target: appName,
      targetKind: "اپلیکیشن",
      description: "نسخهٔ انتخاب‌شده دوباره deploy و جایگزین نسخهٔ فعال می‌شود.",
      diff: [
        {
          kind: "changed",
          label: "release",
          before: stringField(data, "expectedCurrentReleaseId") ?? "نسخهٔ فعال",
          after: stringField(data, "releaseId") ?? "نسخهٔ انتخاب‌شده",
        },
      ],
      reversible: true,
      reversibilityNote: "با deploy دوبارهٔ نسخهٔ فعلی قابل برگشت است.",
    };
  }

  if (name === "createDnsRecord") {
    const record = isRecord(data.record) ? data.record : {};
    const recordName = stringField(record, "name") ?? "رکورد جدید";
    const recordType = stringField(record, "type");
    return {
      action: "ساخت رکورد DNS",
      target: stringField(data, "zone") ?? "zone انتخاب‌شده",
      targetKind: "zone",
      description: `${recordType ? `${recordType} ` : ""}${recordName} ساخته می‌شود؛ مقدار رکورد در این پنجره نمایش داده نمی‌شود.`,
      reversible: true,
      reversibilityNote:
        "برای برگشت باید رکورد را دستی در کنسول لیارا حذف کنید؛ این دستیار عمداً ابزار حذف DNS ندارد.",
    };
  }

  if (name === "restartApp") {
    return {
      action: "ری‌استارت اپلیکیشن",
      target: appName,
      targetKind: "اپلیکیشن",
      description: "پردازه‌های اپلیکیشن یک‌بار از نو راه‌اندازی می‌شوند.",
      reversible: true,
      reversibilityNote: "این عملیات تنظیمات یا داده‌ای را حذف نمی‌کند.",
    };
  }

  return {
    action: "اجرای عملیات زیرساختی",
    target: "منبع انتخاب‌شده",
    targetKind: "resource",
    description: "این عملیات فقط پس از تأیید صریح شما اجرا می‌شود.",
    reversible: false,
    reversibilityNote: "روش برگشت معتبری برای این عملیات ناشناخته است.",
  };
}

function ToolStatus({
  name,
  state,
}: {
  name: string;
  state: "loading" | "waiting" | "success" | "denied" | "error";
}) {
  const label = TOOL_LABELS[name] ?? "ابزار زیرساخت";
  const meta = {
    loading: {
      icon: LoaderCircleIcon,
      variant: "info" as const,
      text: "در حال اجرا…",
    },
    waiting: {
      icon: ShieldCheckIcon,
      variant: "warning" as const,
      text: "منتظر تأیید شماست.",
    },
    success: {
      icon: CheckCircle2Icon,
      variant: "success" as const,
      text: "با موفقیت انجام شد.",
    },
    denied: {
      icon: CircleXIcon,
      variant: "warning" as const,
      text: "این عملیات اجرا نشد.",
    },
    error: {
      icon: CircleXIcon,
      variant: "destructive" as const,
      text: "اجرای ابزار ناموفق بود؛ جزئیات حساس نمایش داده نمی‌شود.",
    },
  }[state];
  const Icon = meta.icon;

  return (
    <Alert variant={meta.variant}>
      <Icon className={state === "loading" ? "animate-spin" : undefined} />
      <AlertTitle>{label}</AlertTitle>
      <AlertDescription>{meta.text}</AlertDescription>
    </Alert>
  );
}

function StructuredToolOutput({
  name,
  output,
  input,
}: {
  name: string;
  output: unknown;
  input: unknown;
}) {
  if (failedResult(output)) return <ToolStatus name={name} state="error" />;
  const payload = unwrapResult(output);

  if (["listApps", "getApp", "listDatabases", "getDatabase"].includes(name)) {
    const singular = valueAt(payload, ["app", "database"]);
    const rows = singular
      ? [singular]
      : arrayAt(payload, ["apps", "databases"]);
    const apps = rows.filter(isApp).slice(0, 12);
    if (apps.length > 0) {
      return (
        <div className="flex flex-col gap-2.5">
          {apps.map((app) => (
            <ApplicationCard key={app.id} app={app} compact={apps.length > 2} />
          ))}
        </div>
      );
    }
  }

  if (name === "getAppLogs") {
    const logs = arrayAt(payload, ["logs", "lines"])
      .filter(isLogLine)
      .slice(-300)
      .map((line) => ({ ...line, message: safeLogText(line.message) }));
    if (logs.length > 0 || Array.isArray(valueAt(payload, ["logs", "lines"]))) {
      const source = isRecord(payload) ? payload : {};
      const request = isRecord(input) ? input : {};
      return (
        <LogViewer
          lines={logs}
          appName={
            stringField(source, "appName") ?? stringField(request, "appName")
          }
          height={280}
        />
      );
    }
  }

  if (name === "getAppReleases") {
    const releases = arrayAt(payload, ["releases", "deployments"])
      .filter(isDeployment)
      .slice(0, 12)
      .map((release) => ({
        ...release,
        commitMessage: release.commitMessage
          ? safeLogText(release.commitMessage)
          : undefined,
        failureReason: release.failureReason
          ? safeLogText(release.failureReason)
          : undefined,
      }));
    if (releases.length > 0) {
      return (
        <div className="flex flex-col gap-2.5">
          {releases.map((release) => (
            <DeploymentCard key={release.id} deployment={release} />
          ))}
        </div>
      );
    }
  }

  if (name === "getAppEvents") {
    const request = isRecord(input) ? input : {};
    const source = isRecord(payload) ? payload : {};
    return (
      <RecentAppEventsCard
        appName={
          stringField(source, "appName") ??
          stringField(request, "appName") ??
          "app"
        }
        events={arrayAt(payload, ["events"]).filter(isAppEvent).slice(0, 100)}
      />
    );
  }

  if (name === "getAppMetrics") {
    const request = isRecord(input) ? input : {};
    const source = isRecord(payload) ? payload : {};
    return (
      <MetricsPanel
        appName={stringField(source, "appName") ?? stringField(request, "appName")}
        rangeLabel="آخرین snapshot زنده"
        series={metricSeries(source.metrics)}
      />
    );
  }

  if (name === "listEnvVars") {
    const request = isRecord(input) ? input : {};
    const source = isRecord(payload) ? payload : {};
    return (
      <EnvEditor
        appName={stringField(source, "appName") ?? stringField(request, "appName")}
        vars={arrayAt(payload, ["envs"]).filter(isEnvVar)}
        readOnly
      />
    );
  }

  if (name === "listBuckets") {
    return (
      <ObjectStorageBucketsCard
        buckets={arrayAt(payload, ["buckets"]).filter(isBucket).slice(0, 100)}
      />
    );
  }

  if (name === "getPlans") {
    const request = isRecord(input) ? input : {};
    const source = isRecord(payload) ? payload : {};
    const kind =
      stringField(source, "kind") === "databases" ||
      stringField(request, "kind") === "databases"
        ? "databases"
        : "projects";
    return (
      <LivePlanCatalogCard
        kind={kind}
        plans={arrayAt(payload, ["plans"]).filter(isLivePlan)}
      />
    );
  }

  if (name === "listDnsRecords" || name === "createDnsRecord") {
    const singular = valueAt(payload, ["record"]);
    const rows = singular ? [singular] : arrayAt(payload, ["records"]);
    const records = rows.filter(isDnsRecord).slice(0, 100);
    if (records.length > 0 || Array.isArray(valueAt(payload, ["records"]))) {
      const source = isRecord(payload) ? payload : {};
      const request = isRecord(input) ? input : {};
      return (
        <DnsRecordsTable
          records={records}
          zone={stringField(source, "zone") ?? stringField(request, "zone")}
        />
      );
    }
  }

  if (name === "searchDocs") {
    const sources = arrayAt(payload, ["sources", "hits"])
      .filter(isSource)
      .slice(0, 6);
    if (sources.length > 0) {
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {sources.map((source, index) => (
            <SourceCard key={source.id} source={source} index={index + 1} />
          ))}
        </div>
      );
    }
  }

  if (
    ["setEnvVars", "scaleApp", "resizeApp", "rollbackRelease"].includes(name)
  ) {
    const diff = arrayAt(payload, ["diff"]).filter(isDiffRow);
    if (diff.length > 0) {
      return (
        <div className="flex flex-col gap-2.5">
          <ToolStatus name={name} state="success" />
          <BeforeAfterDiff rows={diff} changesOnly maskValues />
        </div>
      );
    }
  }

  return <ToolStatus name={name} state="success" />;
}

function ToolPart({
  part,
  busy,
  onAskAnswer,
}: {
  part: LooseToolPart;
  busy: boolean;
  onAskAnswer: (
    toolCallId: string,
    output: { optionId?: string; text?: string },
  ) => void;
}) {
  const name = toolName(part);

  if (name === "askUser") {
    const prompt = askInput(part.input);
    if (!prompt) {
      return (
        <ToolStatus
          name={name}
          state={part.state === "output-error" ? "error" : "loading"}
        />
      );
    }

    if (part.state === "input-available" || part.state === "output-available") {
      const answer = isRecord(part.output) ? part.output : {};
      return (
        <AskUserPrompt
          question={prompt.question}
          reason={prompt.reason}
          options={prompt.options}
          allowFreeText={prompt.allowFreeText}
          answeredId={stringField(answer, "optionId")}
          answeredText={stringField(answer, "text")}
          disabled={busy}
          onSelect={(option) =>
            onAskAnswer(part.toolCallId, { optionId: option.id })
          }
          onSubmitFreeText={(text) => onAskAnswer(part.toolCallId, { text })}
        />
      );
    }
  }

  if (part.state === "input-streaming" || part.state === "input-available") {
    return <ToolStatus name={name} state="loading" />;
  }
  if (part.state === "approval-requested") {
    return (
      <ToolStatus
        name={name}
        state={part.approval?.isAutomatic ? "loading" : "waiting"}
      />
    );
  }
  if (part.state === "approval-responded") {
    return (
      <ToolStatus
        name={name}
        state={part.approval?.approved ? "loading" : "denied"}
      />
    );
  }
  if (part.state === "output-error") {
    return <ToolStatus name={name} state="error" />;
  }
  if (part.state === "output-denied") {
    return <ToolStatus name={name} state="denied" />;
  }
  return <StructuredToolOutput name={name} output={part.output} input={part.input} />;
}

function checklistSteps(parts: LooseToolPart[]): ChecklistStep[] {
  return parts.map((part) => {
    const name = toolName(part);
    const failed =
      part.state === "output-error" ||
      (part.state === "output-available" && failedResult(part.output));
    const skipped =
      part.state === "output-denied" ||
      (part.state === "approval-responded" && part.approval?.approved === false);
    const done = part.state === "output-available" && !failed;

    return {
      id: part.toolCallId,
      label: TOOL_LABELS[name] ?? "بررسی زیرساخت",
      tool: name || undefined,
      state: failed ? "failed" : skipped ? "skipped" : done ? "done" : "running",
      detail: failed
        ? "این مرحله کامل نشد."
        : skipped
          ? "با تصمیم شما اجرا نشد."
          : part.state === "approval-requested"
            ? "منتظر تأیید صریح شماست."
            : undefined,
    };
  });
}

function findPendingApproval(messages: UIMessage[]): PendingApproval | null {
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      const loose = part as LooseToolPart;
      if (
        loose.state === "approval-requested" &&
        loose.approval &&
        !loose.approval.isAutomatic
      ) {
        return {
          id: loose.approval.id,
          toolName: toolName(loose),
          input: loose.input,
        };
      }
    }
  }
  return null;
}

function hasPendingQuestion(messages: UIMessage[]): boolean {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return false;
  return last.parts.some((part) => {
    if (!isToolUIPart(part)) return false;
    const loose = part as LooseToolPart;
    return toolName(loose) === "askUser" && loose.state === "input-available";
  });
}

function EmptyChat({
  disabled,
  onPrompt,
}: {
  disabled: boolean;
  onPrompt: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center py-8 sm:py-12">
      <Card className="w-full max-w-2xl border-primary/20 bg-card/80">
        <CardHeader className="items-center px-5 pt-7 text-center sm:px-8 sm:pt-9">
          <span className="border-primary/25 bg-primary/10 text-primary grid size-12 place-items-center rounded-xl border">
            <SparklesIcon className="size-6" />
          </span>
          <Badge variant="default" className="mt-2">
            دستیار عامل‌محور زیرساخت
          </Badge>
          <CardTitle className="mt-2 text-xl sm:text-2xl">
            از وضعیت واقعی حساب تا اقدام امن
          </CardTitle>
          <CardDescription className="max-w-lg text-[0.8125rem] leading-6">
            سؤال فنی بپرسید؛ دستیار مستندات رسمی و منابع حساب را بررسی می‌کند و
            پیش از هر تغییر از شما تأیید می‌گیرد.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 px-5 sm:grid-cols-2 sm:px-8">
          {HERO_PROMPTS.map((prompt) => {
            const Icon = prompt.icon;
            return (
              <Button
                key={prompt.id}
                type="button"
                variant="outline"
                size="lg"
                disabled={disabled}
                onClick={() => onPrompt(prompt.label)}
                className="h-auto justify-start py-3 text-start whitespace-normal"
              >
                <Icon data-icon="inline-start" />
                {prompt.label}
              </Button>
            );
          })}
        </CardContent>
        <CardFooter className="justify-center text-center">
          <p className="text-muted-foreground text-[0.6875rem] leading-5">
            داده‌های حساس و مقادیر env در رابط نمایش داده نمی‌شوند.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

function ChatSession({ initialMessages }: { initialMessages: UIMessage[] }) {
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const [approvalBusy, setApprovalBusy] = React.useState<string | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = React.useState(false);

  const {
    messages,
    setMessages,
    sendMessage,
    stop,
    regenerate: retry,
    error,
    status,
    clearError,
    addToolOutput,
    addToolApprovalResponse,
  } = useChat({
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: (options) =>
      lastAssistantMessageIsCompleteWithApprovalResponses(options) ||
      lastAssistantMessageIsCompleteWithToolCalls(options),
  });

  const pendingApproval = React.useMemo(
    () => findPendingApproval(messages),
    [messages],
  );
  const pendingQuestion = React.useMemo(
    () => hasPendingQuestion(messages),
    [messages],
  );
  const approval = pendingApproval
    ? approvalCopy(pendingApproval.toolName, pendingApproval.input)
    : null;
  const busy = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);
  const showPendingAssistant =
    status === "submitted" && lastMessage?.role !== "assistant";
  const totals = React.useMemo(() => sessionTotals(messages), [messages]);

  React.useEffect(() => {
    scheduleChatHistorySave(messages);
  }, [messages]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: status === "streaming" ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, status]);

  const send = React.useCallback(
    (text: string) => {
      if (busy) return;
      clearError();
      void sendMessage({ text });
    },
    [busy, clearError, sendMessage],
  );

  const answerQuestion = React.useCallback(
    (toolCallId: string, output: { optionId?: string; text?: string }) => {
      addToolOutput({
        tool: "askUser",
        toolCallId,
        output,
      });
    },
    [addToolOutput],
  );

  const answerApproval = React.useCallback(
    (approved: boolean) => {
      if (!pendingApproval || approvalBusy) return;
      setApprovalBusy(pendingApproval.id);
      void Promise.resolve(
        addToolApprovalResponse({
          id: pendingApproval.id,
          approved,
          reason: approved
            ? "کاربر تغییر نمایش‌داده‌شده را تأیید کرد."
            : "کاربر اجرای تغییر را نپذیرفت.",
        }),
      ).finally(() => setApprovalBusy(null));
    },
    [addToolApprovalResponse, approvalBusy, pendingApproval],
  );

  const clearConversation = React.useCallback(() => {
    if (busy || pendingApproval) return;
    clearError();
    setMessages([]);
    setClearDialogOpen(false);
    void clearChatHistory();
  }, [busy, clearError, pendingApproval, setMessages]);

  const resetForAccountChange = React.useCallback(async () => {
    clearError();
    setMessages([]);
    await clearChatHistory();
  }, [clearError, setMessages]);

  React.useEffect(
    () => subscribeToAccountChanges(() => void resetForAccountChange()),
    [resetForAccountChange],
  );

  const statusMeta = {
    submitted: { label: "در حال شروع", variant: "info" as const },
    streaming: { label: "در حال پاسخ", variant: "info" as const },
    ready: { label: "آماده", variant: "success" as const },
    error: { label: "نیاز به تلاش مجدد", variant: "destructive" as const },
  }[status];

  return (
    <div className="flex h-dvh min-h-0 flex-1 flex-col bg-background">
      <header className="border-border/70 bg-background/90 shrink-0 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
          <span className="border-primary/25 bg-primary/10 text-primary grid size-8 place-items-center rounded-lg border">
            <SparklesIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              Liara Copilot
            </h1>
            <p className="text-muted-foreground text-[0.625rem]">
              دستیار هوشمند زیرساخت
            </p>
          </div>
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={messages.length === 0 || busy || Boolean(pendingApproval)}
            onClick={() => setClearDialogOpen(true)}
            aria-label="پاک‌کردن تاریخچهٔ گفتگو"
            className="text-muted-foreground"
          >
            <Trash2Icon data-icon="inline-start" />
            <span className="hidden sm:inline">پاک‌کردن گفتگو</span>
          </Button>
          <Badge variant={statusMeta.variant} aria-live="polite">
            {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
            {statusMeta.label}
          </Badge>
          <AccountConnection
            disabled={busy || Boolean(pendingApproval) || pendingQuestion}
            onConnectionChange={resetForAccountChange}
          />
          <ThemeToggle />
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <ScrollArea className="size-full">
          <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-5 sm:px-6 sm:py-7">
            {messages.length === 0 && !error ? (
              <EmptyChat disabled={busy} onPrompt={send} />
            ) : (
              <div
                className="flex flex-col gap-6"
                aria-live="polite"
                aria-relevant="additions text"
              >
                {messages.map((message, messageIndex) => {
                  if (message.role === "system") return null;
                  const text = messageText(message);
                  const metadata = messageUsage(message.metadata);
                  const isLast = messageIndex === messages.length - 1;
                  const toolParts = message.parts.filter(isToolUIPart);
                  const looseToolParts = toolParts as LooseToolPart[];

                  return (
                    <MessageBubble
                      key={message.id}
                      role={message.role}
                      content={text}
                      streaming={
                        message.role === "assistant" &&
                        isLast &&
                        status === "streaming"
                      }
                      usage={message.role === "assistant" ? metadata.usage : undefined}
                      baselineToman={
                        message.role === "assistant"
                          ? metadata.baselineToman
                          : undefined
                      }
                    >
                      {message.role === "assistant" && looseToolParts.length > 1 ? (
                        <AgentChecklist
                          steps={checklistSteps(looseToolParts)}
                          title="روند بررسی"
                          loading={isLast && busy}
                          dense
                        />
                      ) : null}
                      {message.role === "assistant" && toolParts.length > 0
                        ? looseToolParts.map((loose) => {
                            return (
                              <ToolPart
                                key={loose.toolCallId}
                                part={loose}
                                busy={busy}
                                onAskAnswer={answerQuestion}
                              />
                            );
                          })
                        : null}
                    </MessageBubble>
                  );
                })}

                {showPendingAssistant ? (
                  <MessageBubble role="assistant" content="" pending />
                ) : null}

                {error ? (
                  <MessageBubble
                    role="assistant"
                    content=""
                    error="ارتباط با دستیار کامل نشد. اتصال و تنظیمات سرور را بررسی کنید."
                    onRetry={() => {
                      clearError();
                      void retry();
                    }}
                  />
                ) : null}

                <div ref={endRef} className="h-px" aria-hidden />

                {totals.messages > 0 ? (
                  <SessionCostFooter
                    messages={totals.messages}
                    totalToman={totals.totalToman}
                    baselineToman={totals.baselineToman}
                    totalPromptTokens={totals.totalPromptTokens}
                    totalCompletionTokens={totals.totalCompletionTokens}
                    cachedTokens={totals.cachedTokens}
                    toolCalls={totals.toolCalls}
                    breakdown={totals.breakdown}
                  />
                ) : null}
              </div>
            )}
          </div>
        </ScrollArea>
      </main>

      <footer className="border-border/70 bg-background/95 shrink-0 border-t backdrop-blur">
        <div className="mx-auto w-full max-w-4xl px-4 py-3 sm:px-6">
          <ChatComposer
            onSend={send}
            streaming={busy}
            onStop={() => void stop()}
            disabled={Boolean(pendingApproval) || pendingQuestion}
            placeholder={
              pendingApproval || pendingQuestion
                ? "ابتدا تصمیم بالا را مشخص کنید…"
                : undefined
            }
          />
          <p className="text-muted-foreground mt-1.5 text-center text-[0.625rem] leading-5">
            پاسخ‌ها ممکن است خطا داشته باشند؛ هر تغییر زیرساختی پیش از اجرا به
            تأیید شما نیاز دارد.
          </p>
        </div>
      </footer>

      {pendingApproval && approval ? (
        <ConfirmationDialog
          open
          onOpenChange={(open) => {
            if (!open && !approvalBusy) answerApproval(false);
          }}
          action={approval.action}
          target={approval.target}
          targetKind={approval.targetKind}
          description={approval.description}
          diff={approval.diff}
          reversible={approval.reversible}
          reversibilityNote={approval.reversibilityNote}
          risk="caution"
          busy={approvalBusy === pendingApproval.id}
          onConfirm={() => answerApproval(true)}
        />
      ) : null}

      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تاریخچهٔ این گفتگو پاک شود؟</DialogTitle>
            <DialogDescription>
              همهٔ پیام‌ها و جمع هزینه‌های ذخیره‌شده در همین مرورگر حذف می‌شوند.
              این کار روی منابع حساب لیارا اثری ندارد.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearDialogOpen(false)}
            >
              انصراف
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={clearConversation}
            >
              <Trash2Icon data-icon="inline-start" />
              پاک‌کردن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChatHistoryLoading() {
  return (
    <div
      className="flex h-dvh min-h-0 flex-1 flex-col bg-background"
      aria-busy="true"
      aria-label="در حال بارگذاری تاریخچهٔ گفتگو"
    >
      <header className="border-border/70 bg-background/90 shrink-0 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
          <span className="border-primary/25 bg-primary/10 text-primary grid size-8 place-items-center rounded-lg border">
            <SparklesIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              Liara Copilot
            </h1>
            <p className="text-muted-foreground text-[0.625rem]">
              دستیار هوشمند زیرساخت
            </p>
          </div>
          <span className="flex-1" />
          <Badge variant="info">
            <LoaderCircleIcon className="animate-spin" />
            در حال بازیابی
          </Badge>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-7 sm:px-6">
        <Skeleton className="h-24 w-4/5 self-end rounded-xl" />
        <Skeleton className="h-40 w-11/12 rounded-xl" />
      </main>
    </div>
  );
}

function ChatShell() {
  const history = React.useSyncExternalStore(
    subscribeToChatHistory,
    getChatHistorySnapshot,
    getServerChatHistorySnapshot,
  );

  React.useEffect(() => {
    void loadChatHistory();
  }, []);

  if (!history.ready) return <ChatHistoryLoading />;
  return <ChatSession initialMessages={history.messages} />;
}

export { ChatShell };
