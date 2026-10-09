import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { historyRows, inspect, plainText, sessionFiles, usageRows } from "../data.ts";

const usage = { input: 10, output: 3, cacheRead: 4, cacheWrite: 5, totalTokens: 22, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.2 } };
const entry = (value: unknown) => ({ id: "id", parentId: null, timestamp: "2026-01-01", ...value as object }) as SessionEntry;
const call = (id: string, name: string, path: string) => ({ type: "toolCall", id, name, arguments: { path } });

test("file tracking requires successful results and includes nested calls and summaries", () => {
  const entries = [
    entry({ type: "message", message: { role: "assistant", content: [call("a", "write", "a.ts"), call("b", "edit", "bad.ts"), call("c", "read", "read.ts")] } }),
    entry({ type: "message", message: { role: "toolResult", toolCallId: "a", isError: false } }),
    entry({ type: "message", message: { role: "toolResult", toolCallId: "b", isError: true } }),
    entry({ type: "message", message: { role: "toolResult", toolCallId: "c", isError: false, nestedCalls: { calls: [
      { name: "edit", status: "ok", arguments: { path: "a.ts" } },
      { name: "write", status: "ok", arguments: { path: "nested.ts" } },
      { name: "write", status: "error", arguments: { path: "bad2.ts" } },
      { name: "write", status: "ok" },
    ] } } }),
    entry({ type: "compaction", details: { modifiedFiles: ["summary.ts", null, ""] } }),
    entry({ type: "branch_summary", details: { modifiedFiles: ["summary.ts"] } }),
  ];
  assert.deepEqual(sessionFiles(entries, "/repo").map((row) => row.path), ["/repo/a.ts", "/repo/nested.ts", "/repo/summary.ts"]);
  assert.match(sessionFiles(entries, "/repo")[0].detail!, /nested edit/);
  assert.equal(sessionFiles(entries.slice(0, 1), "/repo").length, 0);
});

test("usage includes assistants, nested tool totals, summaries and standalone usage", () => {
  const rows = usageRows([
    entry({ type: "message", message: { role: "assistant", provider: "p", model: "m", usage } }),
    entry({ type: "message", message: { role: "assistant", provider: "p", model: "m", usage } }),
    entry({ type: "message", message: { role: "toolResult", toolName: "codemode", usage } }),
    entry({ type: "usage", kind: "cache_warm", provider: "p", model: "m", usage }),
    entry({ type: "compaction", usage }),
    entry({ type: "branch_summary", usage }),
  ]);
  assert.equal(rows.length, 6);
  assert.match(rows[0].label, /44 tokens, \$0.4000/);
  assert.match(rows[5].label, /132 tokens, \$1.2000/);
  assert.equal(JSON.parse(rows[0].detail!).cacheRead, 8);
});

test("redacts credential configuration recursively without hiding token counts", () => {
  const value = JSON.parse(inspect({ apiKey: "secret", nested: { password: "secret", clientSecret: "secret", headers: { Authorization: "secret" }, env: { TOKEN: "secret" }, accessToken: "secret" }, totalTokens: 50 }));
  assert.equal(value.apiKey, "[redacted]");
  assert.equal(value.nested.clientSecret, "[redacted]");
  assert.equal(value.nested.headers, "[redacted]");
  assert.equal(value.nested.env, "[redacted]");
  assert.equal(value.totalTokens, 50);
});

test("removes terminal controls and renders history newest first", () => {
  assert.equal(plainText("\x1b[31mhello\x1b[0m\x1b]52;c;evil\x07\r\x00\nworld"), "hello\nworld");
  const rows = historyRows([
    entry({ type: "message", message: { role: "user", content: "first\x1b[31m" } }),
    entry({ type: "message", message: { role: "toolResult", toolName: "edit", isError: true, content: [] } }),
  ]);
  assert.match(rows[0].label, /edit \[error\]/);
  assert.ok(!rows[1].label.includes("\x1b"));
});

test("normalizes tool paths including home, at prefixes, Unicode spaces and file URLs", () => {
  const paths = ["@~/a.ts", "a\u00a0b.ts", pathToFileURL("/tmp/file name.ts").href, "file://invalid-host/no", "file:///tmp/%00"];
  const entries = [entry({ type: "compaction", details: { modifiedFiles: paths } })];
  const files = sessionFiles(entries, "/repo").map((row) => row.path);
  assert.ok(files.includes(`${homedir()}/a.ts`));
  assert.ok(files.includes("/repo/a b.ts"));
  assert.ok(files.includes("/tmp/file name.ts"));
  assert.equal(files.length, 3);
});

test("history kinds and failures come from entry metadata, not message text", () => {
  const rows = historyRows([
    entry({ type: "message", message: { role: "user", content: "[error] toolResult assistant" } }),
    entry({ type: "message", message: { role: "assistant", content: [], stopReason: "stop" } }),
    entry({ type: "message", message: { role: "toolResult", toolName: "read", content: [], isError: true } }),
    entry({ type: "message", message: { role: "assistant", content: [], stopReason: "error" } }),
    entry({ type: "message", message: { role: "bashExecution", command: "false", exitCode: 1, cancelled: false } }),
    entry({ type: "compaction", summary: "summary" }),
  ]).reverse();
  assert.deepEqual(rows.map((row) => row.kind), ["user", "assistant", "toolResult", "assistant", "bashExecution", "compaction"]);
  assert.deepEqual(rows.map((row) => row.error), [false, false, true, true, true, false]);
});
