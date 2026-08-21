import assert from "node:assert/strict";
import test from "node:test";

const guard = (await import(
  new URL("request-guard.ts", import.meta.url).href
)) as typeof import("./request-guard");

test("accepts exact-origin requests and rejects sibling or cross-site origins", () => {
  const same = new Request("https://copilot.example/api/chat", {
    headers: { origin: "https://copilot.example", "sec-fetch-site": "same-origin" },
  });
  const sibling = new Request("https://copilot.example/api/chat", {
    headers: { origin: "https://other.example", "sec-fetch-site": "same-site" },
  });
  const crossSite = new Request("https://copilot.example/api/chat", {
    headers: { origin: "https://copilot.example", "sec-fetch-site": "cross-site" },
  });

  assert.equal(guard.isSameOriginRequest(same), true);
  assert.equal(guard.isSameOriginRequest(sibling), false);
  assert.equal(guard.isSameOriginRequest(crossSite), false);
});

test("rate limits a client within a fixed window", () => {
  const request = new Request("https://copilot.example/api/chat", {
    headers: { "x-forwarded-for": "192.0.2.10" },
  });
  const namespace = `test-${crypto.randomUUID()}`;

  assert.deepEqual(guard.takeRateLimit(request, namespace, 2, 60_000), {
    allowed: true,
  });
  assert.deepEqual(guard.takeRateLimit(request, namespace, 2, 60_000), {
    allowed: true,
  });
  assert.equal(guard.takeRateLimit(request, namespace, 2, 60_000).allowed, false);
});

test("client concurrency keys are stable without exposing the address", () => {
  const first = new Request("https://copilot.example/api/chat", {
    headers: { "x-forwarded-for": "192.0.2.10, 10.0.0.1" },
  });
  const same = new Request("https://copilot.example/api/chat", {
    headers: { "x-real-ip": "192.0.2.10" },
  });
  const key = guard.clientFingerprint(first);
  assert.equal(key, guard.clientFingerprint(same));
  assert.equal(key.includes("192.0.2.10"), false);
});

test("a concurrency slot remains blocked until released", () => {
  const key = `test-${crypto.randomUUID()}`;
  const release = guard.takeConcurrencySlot(key, 1);
  assert.equal(typeof release, "function");
  assert.equal(guard.takeConcurrencySlot(key, 1), null);
  release?.();
  assert.equal(typeof guard.takeConcurrencySlot(key, 1), "function");
});

test("request deadline preserves parent cancellation", () => {
  const parent = new AbortController();
  const combined = guard.withRequestDeadline(parent.signal, 60_000);
  assert.equal(combined.aborted, false);
  parent.abort(new Error("client disconnected"));
  assert.equal(combined.aborted, true);
  assert.throws(() => guard.withRequestDeadline(new AbortController().signal, 0));
});
