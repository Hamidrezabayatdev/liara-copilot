import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative grid w-full items-start gap-x-3 gap-y-1 overflow-hidden rounded-lg border px-4 py-3.5 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground border-border",
        info: "bg-info/8 text-foreground border-info/30 [&>svg]:text-info",
        success:
          "bg-success/8 text-foreground border-success/30 [&>svg]:text-success",
        warning:
          "bg-warning/10 text-foreground border-warning/35 [&>svg]:text-warning",
        destructive:
          "bg-destructive/8 text-foreground border-destructive/30 [&>svg]:text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type AlertProps = React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants>;

function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 min-h-4 font-semibold tracking-tight text-[0.8125rem]",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground col-start-2 grid justify-items-start gap-1 text-xs leading-5 [&_p]:leading-5",
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
