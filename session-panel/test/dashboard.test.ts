import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { formatDuration, formatNumber, sessionStats } from "../dashboard.ts";

const entry = (value: unknown) => ({ id: "id", parentId: null, timestamp: "2026-01-01", ...value as object }) as SessionEntry;
const message = (value: object) => entry({ type: "message", message: value });
const usage = { input: 10, output: 3, cacheRead: 4, cacheWrite: 5, cost: { total: 0.25 } };

test("empty stats have no invented messages, calls, requests or durations", () => {
  assert.deepEqual(sessionStats([]), {
    turns: 0, messages: [], tools: [], durations: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 0 },
  });
});

test("counts user turns separately from assistant responses and non-message entries", () => {
  const entries = [
    message({ role: "user", content: "hello" }),
    message({ role: "assistant", content: [] }),
    message({ role: "assistant", content: [], stopReason: "error" }),
    message({ role: "bashExecution" }),
    message({ role: "custom" }),
    entry({ type: "model_change" }),
  ];
  assert.equal(sessionStats(entries).turns, 1);
  assert.deepEqual(sessionStats(entries).messages, [
    { role: "user", count: 1 }, { role: "assistant", count: 2 },
    { role: "bashExecution", count: 1 }, { role: "custom", count: 1 },
  ]);
});

test("counts direct and nested calls once and attaches result errors by call ID", () => {
  const entries = [
    message({ role: "assistant", content: [
      { type: "toolCall", id: "a", name: "codemode" },
      { type: "toolCall", id: "b", name: "read" },
      { type: "toolCall", id: "pending", name: "read" },
    ] }),
    message({ role: "toolResult", toolCallId: "a", toolName: "codemode", nestedCalls: { calls: [
      { id: "a/1", name: "read", status: "ok" },
      { id: "a/2", name: "write", status: "error" },
      { id: "a/3", name: "read", status: "unfinished" },
    ] } }),
    message({ role: "toolResult", toolCallId: "b", toolName: "read", isError: true }),
    message({ role: "toolResult", toolCallId: "b", toolName: "read", isError: true }),
    message({ role: "toolResult", toolCallId: "a/2", toolName: "write", isError: true }),
    message({ role: "toolResult", toolCallId: "orphan", toolName: "edit", isError: true }),
  ];
  assert.deepEqual(sessionStats(entries).tools, [
    { name: "read", count: 4, errors: 1 },
    { name: "codemode", count: 1, errors: 0 },
    { name: "edit", count: 1, errors: 1 },
    { name: "write", count: 1, errors: 1 },
  ]);
  assert.deepEqual(sessionStats([...entries].reverse()).tools.sort((a, b) => a.name.localeCompare(b.name)),
    sessionStats(entries).tools.sort((a, b) => a.name.localeCompare(b.name)));
});

test("totals all recorded usage sources without summing nested usage again", () => {
  const entries = [
    message({ role: "assistant", usage }),
    message({ role: "toolResult", toolName: "codemode", usage, nestedCalls: { calls: [
      { id: "nested", name: "read", status: "ok", usage },
    ] }, details: { usage } }),
    entry({ type: "usage", usage }),
    entry({ type: "compaction", usage }),
    entry({ type: "branch_summary", usage }),
    message({ role: "user", usage }),
  ];
  assert.deepEqual(sessionStats(entries).usage, {
    input: 50, output: 15, cacheRead: 20, cacheWrite: 25, cost: 1.25, requests: 5,
  });
});

test("ignores invalid optional fields and never produces non-finite totals", () => {
  const entries = [
    message({ role: "assistant", content: null, durationMs: NaN, usage: {
      input: "12", output: Infinity, cacheRead: -5, cacheWrite: null, cost: { total: NaN },
    } }),
    message({ role: "assistant", content: [null, { type: "text" }], durationMs: -1, usage: null }),
    message({ role: "assistant", durationMs: "1000", usage: "invalid" }),
    message({ role: "toolResult", nestedCalls: { calls: null } }),
    message({ role: "toolResult", nestedCalls: { calls: [null, {}, { name: "read", status: "ok" }] } }),
    entry({ type: "compaction", usage: { input: 2, cost: null } }),
  ];
  const stats = sessionStats(entries);
  assert.deepEqual(stats.durations, []);
  assert.deepEqual(stats.usage, { input: 2, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 2 });
  assert.deepEqual(stats.tools, [{ name: "read", count: 1, errors: 0 }]);
});

test("keeps the last ten valid assistant durations labelled by assistant response", () => {
  const entries = Array.from({ length: 13 }, (_, i) => message({ role: "assistant", durationMs: i * 100 }));
  entries.splice(3, 0, message({ role: "toolResult", durationMs: 99_000 }));
  entries.push(message({ role: "assistant", durationMs: undefined }));
  const before = structuredClone(entries);
  assert.deepEqual(sessionStats(entries).durations, Array.from({ length: 10 }, (_, i) => ({
    label: `#${i + 4}`, value: (i + 3) * 100, suffix: formatDuration((i + 3) * 100),
  })));
  assert.deepEqual(sessionStats([message({ role: "assistant", durationMs: 0 })]).durations,
    [{ label: "#1", value: 0, suffix: "0 ms" }]);
  assert.deepEqual(entries, before);
});

test("formats grouped numbers and duration units deterministically", () => {
  assert.equal(formatNumber(12345.678), "12,345.68");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatDuration(999), "999 ms");
  assert.equal(formatDuration(1234), "1.23 s");
  assert.equal(formatDuration(60_000), "1m 0s");
  assert.equal(formatDuration(125_000), "2m 5s");
  for (const value of [NaN, Infinity, -1]) {
    assert.equal(formatNumber(value), "unknown");
    assert.equal(formatDuration(value), "unknown");
  }
});
