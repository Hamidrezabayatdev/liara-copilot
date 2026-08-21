import type { LogLine } from "@/components/types";

/** Serialize the exact rows visible in the log viewer into a portable UTF-8 log. */
export function serializeLogLines(lines: readonly LogLine[]): string {
  if (lines.length === 0) return "";

  return `${lines
    .map((line) => {
      const source = line.source ? ` [${line.source}]` : "";
      return `${line.timestamp} ${line.severity}${source} ${line.message}`;
    })
    .join("\n")}\n`;
}

/** Keep browser-generated download names safe across macOS, Windows and Linux. */
export function createLogFilename(
  appName?: string,
  now: Date = new Date(),
): string {
  const safeAppName =
    appName
      ?.trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "liara-app";
  const timestamp = now.toISOString().replace(/[:.]/g, "-");

  return `${safeAppName}-logs-${timestamp}.log`;
}
