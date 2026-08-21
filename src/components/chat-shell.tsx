"use client";

import * as React from "react";
import Image from "next/image";
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
  ArrowDownIcon,
  BookOpenTextIcon,
  BoxesIcon,
  ChevronDownIcon,
  CircleXIcon,
  DatabaseIcon,
  Globe2Icon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";

import { ApplicationCard } from "@/components/application-card";
import { AccountConnection } from "@/components/account-connection";
import { AskUserPrompt, type AskUserOption } from "@/components/ask-user-prompt";
import { BeforeAfterDiff } from "@/components/before-after-diff";
import { ChatComposer } from "@/components/chat-composer";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { DatabaseCard } from "@/components/database-card";
import { DeploymentCard } from "@/components/deployment-card";
import {
  DiagnosticResult,
  type DiagnosticRecommendation,
  type DiagnosticSeverity,
} from "@/components/diagnostic-result";
import { DnsRecordsTable } from "@/components/dns-records-table";
import { EnvEditor } from "@/components/env-editor";
import { LogViewer } from "@/components/log-viewer";
import { MessageBubble } from "@/components/message-bubble";
import { MetricsPanel } from "@/components/metrics-panel";
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
  DatabaseEngine,
  Deployment,
  DeploymentState,
  DiffRow,
  DnsRecord,
  DnsRecordType,
  Evidence,
  EnvVar,
  LiaraApp,
  LiaraDatabase,
  LogLine,
  LogSeverity,
  MetricSeries,
  ModelUsageItem,
  Source,
  UsageMeta,
} from "@/components/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";

const transport = new DefaultChatTransport({ api: "/api/chat" });

const HERO_PROMPTS = [
  "چرا digishop-api خطای ۵۰۲ می‌دهد؟",
  "وضعیت برنامه‌ها و دیتابیس‌های من چطور است؟",
  "برای deploy امن Next.js چه تنظیماتی لازم است؟",
] as const;

const RESOURCE_PROMPTS = [
  { label: "برنامه‌ها", icon: BoxesIcon, prompt: "برنامه‌های حسابم را بررسی کن" },
  { label: "دیتابیس", icon: DatabaseIcon, prompt: "دیتابیس‌های حسابم را بررسی کن" },
  { label: "DNS", icon: Globe2Icon, prompt: "رکوردهای DNS حسابم را بررسی کن" },
  { label: "مستندات", icon: BookOpenTextIcon, prompt: "در مستندات لیارا جست‌وجو کن" },
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
  reportDiagnosis: "ساخت نتیجهٔ عیب‌یابی",
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

const DATABASE_ENGINES = new Set<DatabaseEngine>([
  "postgres",
  "mysql",
  "mongodb",
  "redis",
  "mariadb",
  "mssql",
  "elasticsearch",
  "rabbitmq",
  "unknown",
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

function isDatabase(value: unknown): value is LiaraDatabase {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.hostname === "string" &&
    DATABASE_ENGINES.has(value.engine as DatabaseEngine) &&
    APP_STATUSES.has(value.status as AppStatus) &&
    typeof value.planId === "string" &&
    typeof value.region === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.publicNetwork === "boolean" &&
    isFiniteNumber(value.scale)
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

type DiagnosisView = {
  symptom: string;
  rootCause: string;
  evidence: Evidence[];
  recommendation: DiagnosticRecommendation;
  confidence: number;
  severity: DiagnosticSeverity;
  appName?: string;
};

const DIAGNOSTIC_SEVERITIES = new Set<DiagnosticSeverity>([
  "critical",
  "degraded",
  "healthy",
]);

function diagnosisInput(value: unknown): DiagnosisView | null {
  if (!isRecord(value) || !isRecord(value.recommendation)) return null;
  const symptom = stringField(value, "symptom");
  const rootCause = stringField(value, "rootCause");
  const title = stringField(value.recommendation, "title");
  if (
    !symptom ||
    !rootCause ||
    !title ||
    !isFiniteNumber(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    !DIAGNOSTIC_SEVERITIES.has(value.severity as DiagnosticSeverity)
  ) {
    return null;
  }

  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .slice(0, 6)
        .map((item, index): Evidence | null => {
          if (!isRecord(item)) return null;
          const text = stringField(item, "text");
          const sourceKind = stringField(item, "sourceKind");
          if (
            !text ||
            !sourceKind ||
            !["docs", "account", "inference"].includes(sourceKind)
          ) {
            return null;
          }
          return {
            id: `diagnostic-evidence-${index}`,
            text,
            sourceKind: sourceKind as Evidence["sourceKind"],
            sourceId: stringField(item, "sourceId"),
          };
        })
        .filter((item): item is Evidence => item !== null)
    : [];
  const steps = Array.isArray(value.recommendation.steps)
    ? value.recommendation.steps
        .filter((step): step is string => typeof step === "string" && step.length > 0)
        .slice(0, 5)
    : undefined;

  return {
    symptom,
    rootCause,
    evidence,
    recommendation: {
      title,
      detail: stringField(value.recommendation, "detail"),
      steps,
      actionLabel: stringField(value.recommendation, "actionLabel"),
    },
    confidence: value.confidence,
    severity: value.severity as DiagnosticSeverity,
    appName: stringField(value, "appName"),
  };
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

  const modelBreakdown = Array.isArray(raw.modelBreakdown)
    ? raw.modelBreakdown
        .map((item): ModelUsageItem | null => {
          if (!isRecord(item)) return null;
          const itemModel = stringField(item, "model");
          if (!itemModel || !isFiniteNumber(item.calls) || !isFiniteNumber(item.toman)) {
            return null;
          }
          return { model: itemModel, calls: item.calls, toman: item.toman };
        })
        .filter((item): item is ModelUsageItem => item !== null)
    : undefined;

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
      costComplete:
        typeof raw.costComplete === "boolean" ? raw.costComplete : undefined,
      toolCalls: raw.toolCalls,
      latencyMs: raw.latencyMs,
      escalation: Number(escalation) as 1 | 2 | 3,
      routingReason:
        stringField(raw, "routingReason") ?? stringField(raw, "why"),
      modelBreakdown,
    },
  };
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
  summary,
}: {
  name: string;
  state: "loading" | "waiting" | "success" | "denied" | "error";
  summary?: string;
}) {
  const label = TOOL_LABELS[name] ?? "ابزار زیرساخت";
  const meta = {
    loading: {
      icon: LoaderCircleIcon,
      variant: "info" as const,
      title: `${label} در حال اجراست…`,
    },
    waiting: {
      icon: ShieldCheckIcon,
      variant: "warning" as const,
      title: label,
      description: "منتظر تأیید شماست.",
    },
    success: {
      icon: CheckCircle2Icon,
      variant: "success" as const,
      title: summary ?? `${label} انجام شد`,
    },
    denied: {
      icon: CircleXIcon,
      variant: "warning" as const,
      title: `${label} اجرا نشد`,
    },
    error: {
      icon: CircleXIcon,
      variant: "destructive" as const,
      title: `${label} ناموفق بود`,
      description: "جزئیات حساس نمایش داده نمی‌شود.",
    },
  }[state];
  const Icon = meta.icon;

  return (
    <Alert
      variant={meta.variant}
      role={state === "error" || state === "denied" ? "alert" : "status"}
      aria-live={state === "error" || state === "denied" ? "assertive" : "polite"}
      className={cn("animate-rise bg-card", state === "loading" && "border-primary/35")}
    >
      <Icon className={state === "loading" ? "animate-spin" : undefined} />
      <AlertTitle>{meta.title}</AlertTitle>
      {meta.description ? (
        <AlertDescription>{meta.description}</AlertDescription>
      ) : null}
      {state === "loading" ? (
        <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden" aria-hidden>
          <span className="absolute inset-y-0 end-0 w-1/2 animate-sheen bg-primary" />
        </span>
      ) : null}
    </Alert>
  );
}

function DocsEvidence({ sources }: { sources: Source[] }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border p-2">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between">
          <span className="inline-flex items-center gap-2">
            <BookOpenTextIcon data-icon="inline-start" />
            {sources.length.toLocaleString("fa-IR")} منبع رسمی پیدا شد
          </span>
          <ChevronDownIcon data-icon="inline-end" className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2 p-1 pt-2 sm:grid-cols-2">
        {sources.map((source, index) => (
          <SourceCard key={source.id} source={source} index={index + 1} compact={sources.length > 2} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function resultCount(value: unknown, keys: string[], predicate: (item: unknown) => boolean, limit: number) {
  return arrayAt(value, keys).filter(predicate).slice(0, limit).length;
}

function toolResultSummary(name: string, output: unknown): string {
  const payload = unwrapResult(output);
  const count = (value: number) => value.toLocaleString("fa-IR");

  if (name === "searchDocs") {
    return `${count(resultCount(payload, ["sources", "hits"], isSource, 6))} منبع رسمی پیدا شد`;
  }
  if (name === "listApps" || name === "getApp") {
    const singular = valueAt(payload, ["app"]);
    const total = singular && isApp(singular)
      ? 1
      : resultCount(payload, ["apps"], isApp, 12);
    return `${count(total)} برنامه پیدا شد`;
  }
  if (name === "listDatabases" || name === "getDatabase") {
    const singular = valueAt(payload, ["database"]);
    const total = singular && isDatabase(singular)
      ? 1
      : resultCount(payload, ["databases"], isDatabase, 12);
    return `${count(total)} دیتابیس پیدا شد`;
  }
  if (name === "getAppLogs") {
    return `${count(resultCount(payload, ["logs", "lines"], isLogLine, 300))} خط لاگ دریافت شد`;
  }
  if (name === "getAppEvents") {
    return `${count(resultCount(payload, ["events"], isAppEvent, 100))} رویداد پیدا شد`;
  }
  if (name === "getAppReleases") {
    return `${count(resultCount(payload, ["releases", "deployments"], isDeployment, 12))} نسخه پیدا شد`;
  }
  if (name === "getAppMetrics") {
    const source = isRecord(payload) ? payload : {};
    return `${count(metricSeries(source.metrics).length)} متریک زنده دریافت شد`;
  }
  if (name === "listEnvVars") {
    return `${count(resultCount(payload, ["envs"], isEnvVar, 100))} متغیر محیطی پیدا شد`;
  }
  if (name === "listBuckets") {
    return `${count(resultCount(payload, ["buckets"], isBucket, 100))} باکت پیدا شد`;
  }
  if (name === "getPlans") {
    return `${count(resultCount(payload, ["plans"], isLivePlan, Number.POSITIVE_INFINITY))} پلن پیدا شد`;
  }
  if (name === "listDnsRecords" || name === "createDnsRecord") {
    const singular = valueAt(payload, ["record"]);
    const total = singular && isDnsRecord(singular)
      ? 1
      : resultCount(payload, ["records"], isDnsRecord, 100);
    return `${count(total)} رکورد DNS پیدا شد`;
  }
  if (name === "reportDiagnosis") return "نتیجهٔ عیب‌یابی آماده شد";
  if (name === "restartApp") return "اپلیکیشن با موفقیت ری‌استارت شد";
  if (["setEnvVars", "scaleApp", "resizeApp", "rollbackRelease"].includes(name)) {
    return "تغییر با موفقیت انجام شد";
  }
  return `${TOOL_LABELS[name] ?? "بررسی زیرساخت"} انجام شد`;
}

function hasStructuredDetails(name: string, output: unknown): boolean {
  const payload = unwrapResult(output);

  if (name === "listApps" || name === "getApp") {
    const singular = valueAt(payload, ["app"]);
    return Boolean(singular && isApp(singular)) || resultCount(payload, ["apps"], isApp, 12) > 0;
  }
  if (name === "listDatabases" || name === "getDatabase") {
    const singular = valueAt(payload, ["database"]);
    return Boolean(singular && isDatabase(singular)) || resultCount(payload, ["databases"], isDatabase, 12) > 0;
  }
  if (name === "getAppLogs") {
    return Array.isArray(valueAt(payload, ["logs", "lines"]));
  }
  if (name === "getAppReleases") {
    return resultCount(payload, ["releases", "deployments"], isDeployment, 12) > 0;
  }
  if (["getAppEvents", "getAppMetrics", "listEnvVars", "listBuckets", "getPlans"].includes(name)) {
    return true;
  }
  if (name === "listDnsRecords" || name === "createDnsRecord") {
    const singular = valueAt(payload, ["record"]);
    return Boolean(singular && isDnsRecord(singular)) || Array.isArray(valueAt(payload, ["records"]));
  }
  return false;
}

function ToolResultDisclosure({
  summary,
  children,
}: {
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border p-2">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between">
          <span className="inline-flex min-w-0 items-center gap-2">
            <CheckCircle2Icon data-icon="inline-start" />
            <span className="truncate">{summary}</span>
          </span>
          <ChevronDownIcon
            data-icon="inline-end"
            className={cn("transition-transform", open && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function StructuredToolOutput({
  name,
  output,
  input,
  onFollowUp,
}: {
  name: string;
  output: unknown;
  input: unknown;
  onFollowUp?: (prompt: string) => void;
}) {
  if (failedResult(output)) return <ToolStatus name={name} state="error" />;
  const payload = unwrapResult(output);

  if (name === "reportDiagnosis") {
    const diagnosis = diagnosisInput(input);
    if (diagnosis) {
      const target = diagnosis.appName ? ` برنامه ${diagnosis.appName}` : "";
      return (
        <DiagnosticResult
          {...diagnosis}
          onApplyFix={
            onFollowUp && diagnosis.severity !== "healthy"
              ? () =>
                  onFollowUp(
                    `اصلاح پیشنهادی «${diagnosis.recommendation.title}» را برای${target} بررسی کن؛ وضعیت فعلی را دوباره بخوان، Before/After را نشان بده و پیش از هر تغییر برای تأیید متوقف شو.`,
                  )
              : undefined
          }
          onEscalate={
            onFollowUp
              ? () =>
                  onFollowUp(
                    `برای مشکل «${diagnosis.symptom}»${target} یک خلاصهٔ کوتاه و قابل کپی برای پشتیبانی لیارا بساز؛ اقدامات و شواهد فعلی را هم بیاور.`,
                  )
              : undefined
          }
        />
      );
    }
  }

  if (["listApps", "getApp"].includes(name)) {
    const singular = valueAt(payload, ["app"]);
    const rows = singular ? [singular] : arrayAt(payload, ["apps"]);
    const apps = rows.filter(isApp).slice(0, 12);
    if (apps.length > 0) {
      return (
        <div className="flex flex-col gap-2.5">
          {apps.map((app) => (
            <ApplicationCard
              key={app.id}
              app={app}
              compact={apps.length > 2}
              onSelect={onFollowUp ? () => onFollowUp(`وضعیت کامل برنامه ${app.name} را بررسی کن`) : undefined}
              onViewLogs={onFollowUp ? () => onFollowUp(`لاگ‌های اخیر برنامه ${app.name} را بررسی و خطاها را تحلیل کن`) : undefined}
              onViewDeployments={onFollowUp ? () => onFollowUp(`releaseهای اخیر برنامه ${app.name} را بررسی کن`) : undefined}
            />
          ))}
        </div>
      );
    }
  }

  if (["listDatabases", "getDatabase"].includes(name)) {
    const singular = valueAt(payload, ["database"]);
    const rows = singular ? [singular] : arrayAt(payload, ["databases"]);
    const databases = rows.filter(isDatabase).slice(0, 12);
    if (databases.length > 0) {
      return (
        <div className="flex flex-col gap-2.5">
          {databases.map((database) => (
            <DatabaseCard key={database.id} database={database} compact={databases.length > 2} />
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
            <DeploymentCard
              key={release.id}
              deployment={release}
              onViewLogs={onFollowUp ? () => onFollowUp(`لاگ build مربوط به release ${release.id} برنامه ${release.appName} را بررسی کن`) : undefined}
              onRollback={onFollowUp ? () => onFollowUp(`می‌خواهم برنامه ${release.appName} را به release ${release.id} برگردانم؛ ابتدا تغییر را بررسی و برای تأیید آماده کن`) : undefined}
            />
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
      return <DocsEvidence sources={sources} />;
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
  onFollowUp,
}: {
  part: LooseToolPart;
  busy: boolean;
  onAskAnswer: (
    toolCallId: string,
    output: { optionId?: string; text?: string },
  ) => void;
  onFollowUp: (prompt: string) => void;
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

  if (failedResult(part.output)) {
    return <ToolStatus name={name} state="error" />;
  }

  const summary = toolResultSummary(name, part.output);
  const payload = unwrapResult(part.output);
  const docs = name === "searchDocs"
    ? arrayAt(payload, ["sources", "hits"]).filter(isSource).slice(0, 6)
    : [];
  const changeDiff = ["setEnvVars", "scaleApp", "resizeApp", "rollbackRelease"].includes(name)
    ? arrayAt(payload, ["diff"]).filter(isDiffRow)
    : [];

  if (
    docs.length > 0 ||
    (name === "reportDiagnosis" && diagnosisInput(part.input)) ||
    changeDiff.length > 0
  ) {
    return (
      <StructuredToolOutput
        name={name}
        output={part.output}
        input={part.input}
        onFollowUp={busy ? undefined : onFollowUp}
      />
    );
  }

  if (hasStructuredDetails(name, part.output)) {
    return (
      <ToolResultDisclosure summary={summary}>
        <StructuredToolOutput
          name={name}
          output={part.output}
          input={part.input}
          onFollowUp={busy ? undefined : onFollowUp}
        />
      </ToolResultDisclosure>
    );
  }

  return <ToolStatus name={name} state="success" summary={summary} />;
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
    <div className="flex flex-1 items-start justify-center py-10 sm:items-center">
      <section className="w-full max-w-2xl" aria-labelledby="empty-chat-title">
        <div className="mb-6 text-center">
          <h2 id="empty-chat-title" className="text-xl font-semibold sm:text-2xl">
            چه چیزی را بررسی کنیم؟
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            دربارهٔ منابع حساب یا مستندات لیارا بپرسید.
          </p>
        </div>

        <div
          className="mb-4 flex flex-wrap items-center justify-center gap-2"
          aria-label="دسترسی سریع به منابع"
        >
          {RESOURCE_PROMPTS.map((resource) => {
            const Icon = resource.icon;
            return (
              <Button
                key={resource.label}
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onPrompt(resource.prompt)}
                className="rounded-lg"
              >
                <Icon data-icon="inline-start" />
                {resource.label}
              </Button>
            );
          })}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {HERO_PROMPTS.map((prompt) => (
            <Button
              key={prompt}
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => onPrompt(prompt)}
              className="h-auto min-h-12 justify-start rounded-xl px-4 py-3 text-start text-xs leading-6 whitespace-normal sm:text-sm"
            >
              {prompt}
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ChatSession({ initialMessages }: { initialMessages: UIMessage[] }) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = React.useRef(true);
  const [showLatestButton, setShowLatestButton] = React.useState(false);
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

  React.useEffect(() => {
    scheduleChatHistorySave(messages);
  }, [messages]);

  const scrollToLatest = React.useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    pinnedToBottomRef.current = true;
    setShowLatestButton(false);
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  const trackScrollPosition = React.useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const pinned = distanceFromBottom < 88;
    pinnedToBottomRef.current = pinned;
    setShowLatestButton(!pinned);
  }, []);

  React.useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    if (messages.length === 0 && !error) {
      viewport.scrollTop = 0;
      return;
    }
    if (!pinnedToBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [error, messages, status]);

  React.useEffect(() => {
    const content = contentRef.current;
    const viewport = scrollRef.current;
    if (messages.length === 0 || !content || !viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedToBottomRef.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [messages.length]);

  const send = React.useCallback(
    (text: string) => {
      if (busy) return;
      clearError();
      pinnedToBottomRef.current = true;
      setShowLatestButton(false);
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
  const StatusIcon = busy
    ? LoaderCircleIcon
    : status === "error"
      ? CircleXIcon
      : CheckCircle2Icon;

  return (
    <div className="relative flex h-svh min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border/55 bg-background">
        <div className="flex h-14 w-full items-center gap-2.5 px-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Image
              src="/liara-logo.svg"
              alt="لیارا"
              width={101}
              height={45}
              priority
              className="h-7 w-auto sm:h-8"
            />
            <span className="h-6 w-px bg-border" aria-hidden />
            <h1 className="truncate text-xs font-semibold tracking-tight sm:text-sm">
              کوپایلت لیارا
            </h1>
          </div>
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={messages.length === 0 || busy || Boolean(pendingApproval)}
            onClick={() => setClearDialogOpen(true)}
            aria-label="پاک‌کردن تاریخچهٔ گفتگو"
          >
            <Trash2Icon />
          </Button>
          <Badge variant={statusMeta.variant} role="status" aria-live="polite" aria-atomic="true">
            <StatusIcon
              data-icon="inline-start"
              className={busy ? "animate-spin" : undefined}
              aria-hidden
            />
            <span className="sr-only sm:not-sr-only">{statusMeta.label}</span>
          </Badge>
          <AccountConnection
            disabled={busy || Boolean(pendingApproval) || pendingQuestion}
            onConnectionChange={resetForAccountChange}
          />
          <ThemeToggle />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col">
          <section className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={trackScrollPosition}
              className="chat-scroll scrollbar-slim size-full overflow-y-auto"
              role="region"
              aria-label="گفتگو با کوپایلت"
            >
              <div
                ref={contentRef}
                className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-3 py-5 sm:px-6 sm:py-8 lg:px-10"
                aria-busy={busy}
              >
                {messages.length === 0 && !error ? (
                  <EmptyChat disabled={busy} onPrompt={send} />
                ) : (
                  <div className="flex flex-col gap-5">
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
                          streaming={message.role === "assistant" && isLast && status === "streaming"}
                          usage={message.role === "assistant" ? metadata.usage : undefined}
                          baselineToman={message.role === "assistant" ? metadata.baselineToman : undefined}
                        >
                          {message.role === "assistant" && toolParts.length > 0
                            ? looseToolParts.map((loose) => (
                                <ToolPart
                                  key={loose.toolCallId}
                                  part={loose}
                                  busy={busy}
                                  onAskAnswer={answerQuestion}
                                  onFollowUp={send}
                                />
                              ))
                            : null}
                        </MessageBubble>
                      );
                    })}

                    {showPendingAssistant ? <MessageBubble role="assistant" content="" pending /> : null}

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

                    <div className="h-1" aria-hidden />
                  </div>
                )}
              </div>
            </div>

            {showLatestButton ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => scrollToLatest("smooth")}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md shadow-sm"
              >
                <ArrowDownIcon data-icon="inline-start" />
                جدیدترین پاسخ
              </Button>
            ) : null}
          </section>

          <footer className="shrink-0 border-t border-border/55 bg-background">
            <div className="mx-auto w-full max-w-5xl px-3 py-3 sm:px-6 lg:px-10">
              <ChatComposer
                onSend={send}
                streaming={busy}
                onStop={() => void stop()}
                disabled={Boolean(pendingApproval) || pendingQuestion}
                placeholder={pendingApproval || pendingQuestion ? "ابتدا تصمیم بالا را مشخص کنید…" : undefined}
              />
            </div>
          </footer>
        </main>
      </div>

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
      className="relative flex h-svh min-h-0 flex-1 flex-col overflow-hidden bg-background"
      aria-busy="true"
      aria-label="در حال بارگذاری تاریخچهٔ گفتگو"
    >
      <header className="shrink-0 border-b border-border/55 bg-background">
        <div className="flex h-14 w-full items-center gap-3 px-3 sm:px-5">
          <Image src="/liara-logo.svg" alt="لیارا" width={101} height={45} priority className="h-7 w-auto sm:h-8" />
          <span className="h-6 w-px bg-border" aria-hidden />
          <h1 className="truncate text-xs font-semibold tracking-tight sm:text-sm">
            کوپایلت لیارا
          </h1>
          <span className="flex-1" />
          <Badge variant="info">
            <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
            در حال بازیابی
          </Badge>
          <ThemeToggle />
        </div>
      </header>
      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-8 sm:px-8">
        <Skeleton className="h-24 w-4/5 self-end rounded-lg" />
        <Skeleton className="h-48 w-11/12 rounded-lg" />
        <Skeleton className="h-28 w-3/4 rounded-lg" />
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
