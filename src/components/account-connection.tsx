"use client";

import * as React from "react";
import {
  CloudIcon,
  LinkIcon,
  LoaderCircleIcon,
  LogOutIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { broadcastAccountChange } from "@/lib/account-events";

type AccountStatus = {
  connected: boolean;
  source: "cookie" | "environment" | null;
  teamId: string | null;
  canConnect: boolean;
  sharedTokenAllowed: boolean;
};

const EMPTY_STATUS: AccountStatus = {
  connected: false,
  source: null,
  teamId: null,
  canConnect: true,
  sharedTokenAllowed: false,
};

function accountError(status: number): string {
  if (status === 400) return "توکن یا شناسهٔ تیم معتبر نیست.";
  if (status === 401) return "لیارا این توکن را نپذیرفت. یک API key معتبر وارد کنید.";
  if (status === 403) return "این توکن به تیم انتخاب‌شده دسترسی ندارد.";
  if (status === 413) return "اطلاعات ارسالی بیش از اندازه بزرگ است.";
  if (status === 502) return "اعتبارسنجی با لیارا موقتاً در دسترس نیست؛ دوباره تلاش کنید.";
  if (status === 503)
    return "اتصال حساب روی سرور آماده نیست؛ TOKEN_COOKIE_SECRET باید تنظیم شود.";
  return "اتصال حساب کامل نشد. دوباره تلاش کنید.";
}

type AccountConnectionProps = {
  disabled?: boolean;
  onConnectionChange?: () => void | Promise<void>;
};

function AccountConnection({
  disabled = false,
  onConnectionChange,
}: AccountConnectionProps) {
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState<AccountStatus>(EMPTY_STATUS);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [token, setToken] = React.useState("");
  const [teamId, setTeamId] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/account", { method: "GET", cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("account status unavailable");
        return response.json() as Promise<AccountStatus>;
      })
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setError("وضعیت اتصال حساب دریافت نشد.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const changeOpen = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    setError(null);
    if (!next) {
      setToken("");
      setTeamId("");
    }
  };

  const connect = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          ...(teamId.trim() ? { teamId: teamId.trim() } : {}),
        }),
      });
      if (!response.ok) {
        setError(accountError(response.status));
        return;
      }
      const next = (await response.json()) as Pick<
        AccountStatus,
        "connected" | "source" | "teamId"
      >;
      setStatus((current) => ({ ...current, ...next }));
      setToken("");
      setTeamId("");
      await onConnectionChange?.();
      broadcastAccountChange();
      setOpen(false);
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      if (!response.ok) {
        setError(accountError(response.status));
        return;
      }
      const next = (await response.json()) as Pick<
        AccountStatus,
        "connected" | "source" | "teamId"
      >;
      setStatus((current) => ({ ...current, ...next }));
      await onConnectionChange?.();
      broadcastAccountChange();
      setOpen(false);
    } catch {
      setError("قطع اتصال کامل نشد.");
    } finally {
      setBusy(false);
    }
  };

  const label = loading
    ? "بررسی حساب"
    : status.connected
      ? status.source === "environment"
        ? "حساب دمو"
        : "حساب متصل"
      : "اتصال حساب";

  return (
    <>
      <Button
        type="button"
        variant={status.connected ? "outline" : "default"}
        size="sm"
        disabled={disabled}
        onClick={() => changeOpen(true)}
        aria-label={label}
      >
        {loading ? (
          <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
        ) : status.connected ? (
          <ShieldCheckIcon data-icon="inline-start" />
        ) : (
          <LinkIcon data-icon="inline-start" />
        )}
        <span className="hidden sm:inline">{label}</span>
      </Button>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CloudIcon className="text-primary size-4" />
              اتصال حساب لیارا
            </DialogTitle>
            <DialogDescription>
              برای مشاهدهٔ منابع واقعی خودتان، یک API key لیارا وارد کنید. توکن
              در مرورگر قابل خواندن نیست و سرور آن را داخل cookie رمزنگاری می‌کند.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 px-5 py-5">
            {error && status.connected ? (
              <Alert variant="destructive">
                <AlertTitle>عملیات حساب کامل نشد</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {status.connected ? (
              <Alert variant="success">
                <ShieldCheckIcon />
                <AlertTitle>
                  {status.source === "environment"
                    ? "حساب محیط توسعه فعال است"
                    : "حساب شما متصل است"}
                </AlertTitle>
                <AlertDescription>
                  {status.teamId ? (
                    <span>
                      شناسهٔ تیم: <span dir="ltr">{status.teamId}</span>
                    </span>
                  ) : (
                    "درخواست‌ها با حساب فعال لیارا اجرا می‌شوند."
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            {!status.connected ? (
              <form id="liara-account-form" onSubmit={connect}>
                <FieldGroup>
                  <Field data-invalid={Boolean(error)}>
                    <FieldLabel htmlFor="liara-api-token">Liara API key</FieldLabel>
                    <Input
                      id="liara-api-token"
                      type="password"
                      dir="ltr"
                      autoComplete="off"
                      spellCheck={false}
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      disabled={busy || !status.canConnect}
                      aria-invalid={Boolean(error)}
                      placeholder="توکن فقط همین‌جا وارد می‌شود"
                    />
                    <FieldDescription>
                      از Console لیارا، بخش API، یک کلید بسازید. مقدار آن هیچ‌وقت
                      دوباره در این صفحه نمایش داده نمی‌شود.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="liara-team-id">
                      Team ID <Badge variant="secondary">اختیاری</Badge>
                    </FieldLabel>
                    <Input
                      id="liara-team-id"
                      dir="ltr"
                      autoComplete="off"
                      spellCheck={false}
                      value={teamId}
                      onChange={(event) => setTeamId(event.target.value)}
                      disabled={busy || !status.canConnect}
                      placeholder="برای حساب‌های تیمی"
                    />
                    {error ? <FieldError>{error}</FieldError> : null}
                  </Field>
                </FieldGroup>
              </form>
            ) : null}

            {!status.canConnect && !status.connected ? (
              <Alert variant="warning">
                <AlertTitle>اتصال حساب روی سرور غیرفعال است</AlertTitle>
                <AlertDescription>
                  مدیر سرویس باید TOKEN_COOKIE_SECRET را با حداقل ۳۲ کاراکتر تنظیم
                  کند.
                </AlertDescription>
              </Alert>
            ) : null}

            {status.source === "environment" ? (
              <p className="text-muted-foreground text-xs leading-5">
                این اتصال از متغیرهای محیطی سرور آمده است و از این پنجره قطع
                نمی‌شود. در production، استفاده از توکن مشترک به‌صورت پیش‌فرض
                غیرفعال است.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => changeOpen(false)}
              disabled={busy}
            >
              بستن
            </Button>
            {status.source === "cookie" ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void disconnect()}
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
                ) : (
                  <LogOutIcon data-icon="inline-start" />
                )}
                قطع اتصال
              </Button>
            ) : !status.connected ? (
              <Button
                type="submit"
                form="liara-account-form"
                disabled={busy || !token.trim() || !status.canConnect}
              >
                {busy ? (
                  <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
                ) : (
                  <LinkIcon data-icon="inline-start" />
                )}
                اتصال امن
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { AccountConnection };
