"use client";

import * as React from "react";
import { MoonStarIcon, SunIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";

const STORAGE_KEY = "liara-copilot-theme";

export type ThemeToggleProps = Omit<ButtonProps, "onClick" | "children"> & {
  /** Show the Persian label next to the icon. */
  withLabel?: boolean;
  onThemeChange?: (theme: "dark" | "light") => void;
};

function applyTheme(theme: "dark" | "light") {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode / blocked storage: the in-page toggle still works */
  }
}

/**
 * Theme switch.
 *
 * The document class is set by the inline bootstrap script in the layout before
 * first paint; this component only reads the class that is already there, so
 * there is no flash and no hydration mismatch (the first client render matches
 * the server's `dark` default, then `useEffect` syncs to the real value).
 */
function ThemeToggle({
  withLabel = false,
  onThemeChange,
  className,
  variant = "ghost",
  size,
  ...props
}: ThemeToggleProps) {
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");

  React.useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
    onThemeChange?.(next);
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size ?? (withLabel ? "sm" : "icon-sm")}
      onClick={toggle}
      aria-label={theme === "dark" ? "حالت روشن" : "حالت تیره"}
      className={cn("text-muted-foreground hover:text-foreground", className)}
      {...props}
    >
      {theme === "dark" ? <SunIcon /> : <MoonStarIcon />}
      {withLabel ? (
        <span>{theme === "dark" ? "حالت روشن" : "حالت تیره"}</span>
      ) : null}
    </Button>
  );
}

export { ThemeToggle, STORAGE_KEY as THEME_STORAGE_KEY };
