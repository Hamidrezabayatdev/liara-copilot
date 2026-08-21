import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "Liara Copilot — دستیار هوشمند زیرساخت",
  description:
    "دستیار ایجنت‌محور لیارا: تشخیص مشکل، بررسی وضعیت واقعی حساب و انجام تغییرات با تأیید شما.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#181818" },
  ],
};

/**
 * Sets the theme class before first paint so there is no light-mode flash.
 * Kept inline and dependency-free on purpose (no next-themes in this project).
 */
const themeBootstrap = `(function(){try{var s=localStorage.getItem("liara-copilot-theme");var d=s?s==="dark":true;document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){document.documentElement.classList.add("dark");}})();`;

/**
 * Typed locally rather than with Next's generated `LayoutProps<"/">`, which only
 * exists after a build has written `.next/types` — so a clean checkout would
 * fail `tsc --noEmit` before it ever compiled.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className="dark h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="flex min-h-full flex-col">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
