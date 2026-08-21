import * as React from "react";

import { cn } from "@/lib/utils";
import type { AppStatus, DeploymentState } from "@/components/types";

const APP_STATUS_STYLES: Record<
  AppStatus,
  { ring: string; dot: string; text: string; pulse: boolean }
> = {
  ACTIVE: {
    ring: "border-success/35 bg-success/12",
    dot: "bg-success",
    text: "text-success",
    pulse: false,
  },
  BUILDING: {
    ring: "border-warning/40 bg-warning/12",
    dot: "bg-warning",
    text: "text-warning",
    pulse: true,
  },
  STOPPED: {
    ring: "border-border bg-muted",
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    pulse: false,
  },
  UNHEALTHY: {
    ring: "border-destructive/40 bg-destructive/12",
    dot: "bg-destructive",
    text: "text-destructive",
    pulse: true,
  },
};

const DEPLOY_STATE_STYLES: Record<
  DeploymentState,
  { ring: string; dot: string; text: string; pulse: boolean }
> = {
  SUCCESS: APP_STATUS_STYLES.ACTIVE,
  BUILDING: APP_STATUS_STYLES.BUILDING,
  DEPLOYING: {
    ring: "border-info/40 bg-info/12",
    dot: "bg-info",
    text: "text-info",
    pulse: true,
  },
  FAILED: APP_STATUS_STYLES.UNHEALTHY,
  CANCELLED: APP_STATUS_STYLES.STOPPED,
};

export type StatusPillProps = React.ComponentProps<"span"> & {
  status: AppStatus;
  /** Persian helper text appended after the Latin status word. */
  hint?: string;
};

/**
 * Semantic status pill. The status word itself stays Latin because it is the
 * literal value Liara's API returns; any explanation is Persian.
 */
function StatusPill({ status, hint, className, ...props }: StatusPillProps) {
  const s = APP_STATUS_STYLES[status];
  return (
    <span
      data-slot="status-pill"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold leading-4",
        s.ring,
        s.text,
        className,
      )}
      {...props}
    >
      <span className="relative flex size-1.5">
        {s.pulse ? (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-70",
              s.dot,
            )}
          />
        ) : null}
        <span className={cn("relative inline-flex size-1.5 rounded-full", s.dot)} />
      </span>
      <span dir="ltr" className="ltr-embed tracking-wide">
        {status}
      </span>
      {hint ? <span className="font-normal opacity-80">· {hint}</span> : null}
    </span>
  );
}

export type DeploymentStatePillProps = React.ComponentProps<"span"> & {
  state: DeploymentState;
};

function DeploymentStatePill({
  state,
  className,
  ...props
}: DeploymentStatePillProps) {
  const s = DEPLOY_STATE_STYLES[state];
  return (
    <span
      data-slot="deployment-state-pill"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold leading-4",
        s.ring,
        s.text,
        className,
      )}
      {...props}
    >
      <span className="relative flex size-1.5">
        {s.pulse ? (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-70",
              s.dot,
            )}
          />
        ) : null}
        <span className={cn("relative inline-flex size-1.5 rounded-full", s.dot)} />
      </span>
      <span dir="ltr" className="ltr-embed tracking-wide">
        {state}
      </span>
    </span>
  );
}

export { StatusPill, DeploymentStatePill };
