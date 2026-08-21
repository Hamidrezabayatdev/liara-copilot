import assert from "node:assert/strict";
import test from "node:test";

const logDownload = (await import(
  new URL("log-download.ts", import.meta.url).href
)) as typeof import("./log-download");

const { createLogFilename, serializeLogLines } = logDownload;

test("serializeLogLines preserves full timestamps, sources, messages, and UTF-8 text", () => {
  assert.equal(
    serializeLogLines([
      {
        id: "1",
        timestamp: "2026-08-21T09:30:45.000Z",
        severity: "ERROR",
        source: "web-1",
        message: "اتصال به پایگاه‌داده ناموفق بود",
      },
      {
        id: "2",
        timestamp: "2026-08-21T09:31:00.000Z",
        severity: "INFO",
        message: "server listening on :3000",
      },
    ]),
    "2026-08-21T09:30:45.000Z ERROR [web-1] اتصال به پایگاه‌داده ناموفق بود\n" +
      "2026-08-21T09:31:00.000Z INFO server listening on :3000\n",
  );
});

test("createLogFilename uses a filesystem-safe app name and deterministic timestamp", () => {
  assert.equal(
    createLogFilename(" shop / api ", new Date("2026-08-21T09:30:45.123Z")),
    "shop-api-logs-2026-08-21T09-30-45-123Z.log",
  );
  assert.equal(
    createLogFilename(undefined, new Date("2026-08-21T09:30:45.123Z")),
    "liara-app-logs-2026-08-21T09-30-45-123Z.log",
  );
});
