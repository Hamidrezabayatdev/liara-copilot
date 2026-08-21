import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-[0.6875rem] font-semibold leading-4 whitespace-nowrap transition-colors [&>svg]:size-3 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "border-primary/20 bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        success: "border-transparent bg-success/14 text-success",
        warning: "border-transparent bg-warning/16 text-warning",
        destructive: "border-transparent bg-destructive/14 text-destructive",
        info: "border-transparent bg-info/14 text-info",
        muted: "border-transparent bg-muted text-muted-foreground",
        solid: "border-transparent bg-primary text-primary-foreground",
      },
      size: {
        default: "",
        sm: "px-1.5 py-0 text-[0.625rem]",
        lg: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean };

function Badge({ className, variant, size, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
