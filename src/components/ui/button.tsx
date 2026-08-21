import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-45 active:translate-y-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 motion-safe:hover:-translate-y-0.5",
  {
    variants: {
      variant: {
        default:
          "bg-[image:var(--brand-gradient)] text-primary-foreground shadow-[0_10px_28px_-14px_color-mix(in_oklab,var(--brand-cyan)_70%,transparent)] hover:brightness-105 hover:shadow-[0_14px_34px_-14px_color-mix(in_oklab,var(--brand-cyan)_85%,transparent)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 focus-visible:ring-destructive/40",
        outline:
          "border border-border/80 bg-elevated/65 shadow-xs backdrop-blur-xl hover:border-primary/35 hover:bg-accent/65 hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent/75 hover:text-accent-foreground",
        subtle:
          "bg-muted/60 text-foreground hover:bg-muted border border-transparent hover:border-border",
        link: "text-primary underline-offset-4 hover:underline",
        success:
          "bg-success text-success-foreground shadow-sm hover:bg-success/90 focus-visible:ring-success/40",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-sm gap-1.5 px-3 has-[>svg]:px-2.5 text-[0.8125rem]",
        xs: "h-7 rounded-sm gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 rounded-xl px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8 rounded-sm",
        "icon-xs": "size-7 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
