import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { snapshot } from "../snapshot.ts";

function fixtures() {
  const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0.1 } };
  const branch = [{ type: "message", id: "a", timestamp: "now", message: { role: "assistant", provider: "p", model: "m", usage, content: [] } }] as unknown as SessionEntry[];
  const all = [...branch, { ...branch[0], id: "b" }];
  const pi = {
    getActiveTools: () => ["read"],
    getAllTools: () => [{ name: "read" }, { name: "write" }],
    getThinkingLevel: () => "high",
    getMcpServers: () => [{ name: "example", config: { headers: { Authorization: "secret" } } }],
    getSettings: () => ({ externalEditor: "nvim", httpProxy: "http://localhost" }),
    getCommands: () => [{ name: "session-panel", source: "extension" }],
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: "/repo", mode: "tui", model: { id: "m", provider: "p" }, scopedModels: [],
    ui: { theme: { name: "dark", appearance: "dark" } },
    isIdle: () => true, isProjectTrusted: () => true, hasPendingMessages: () => false,
    getSystemPrompt: () => "prompt", getContextUsage: () => ({ tokens: null, contextWindow: 100, percent: null }),
    getSystemPromptOptions: () => ({ cwd: "/repo", skills: [{ name: "skill", filePath: "/skill.md" }], contextFiles: [{ path: "/AGENTS.md", content: "rules" }] }),
    sessionManager: {
      getEntries: () => all, getBranch: () => branch, getSessionName: () => "test", getHeader: () => ({ parentSession: "/parent.jsonl" }),
      getSessionId: () => "session", getSessionFile: () => undefined, getCwd: () => "/repo", getSessionDir: () => "/sessions",
      getLeafId: () => "a", getLeafEntry: () => branch[0], getTree: () => [], buildSessionProjection: () => ({ messages: ["active only"] }),
    },
  } as unknown as ExtensionCommandContext;
  return { pi, ctx };
}

test("provides eight tabs with safe configuration, file actions and unknown context usage", () => {
  const { pi, ctx } = fixtures();
  const tabs = snapshot(pi, ctx, { lines: ["Branch: main", "", "Status:", "M a.ts"], files: [{ path: "/repo/a.ts", label: "M a.ts" }] }, false);
  assert.equal(tabs.length, 8);
  assert.equal(tabs[0].context?.percent, null);
  assert.equal(tabs[1].context?.limit, 100);
  assert.ok(tabs[0].summary?.includes("1 Git changes"));
  assert.match(tabs[1].rows[2].label, /unknown \/ 100/);
  assert.equal(tabs[2].rows.find((row) => row.label === "Skill: skill")?.path, "/skill.md");
  assert.equal(tabs[5].rows.find((row) => row.path)?.path, "/repo/a.ts");
  assert.equal(tabs[5].rows.find((row) => row.path)?.diff, true);
  assert.equal(tabs[5].rows.filter((row) => row.label === "M a.ts").length, 1);
  assert.ok(tabs[5].rows.every((row) => row.label.trim()));
  assert.equal(tabs[6].rows[0].label, "[active] read");
  assert.ok(!tabs[6].rows[2].detail!.includes('"secret"'));
});

test("whole-session scope changes history and usage but not active model projection", () => {
  const { pi, ctx } = fixtures();
  const git = { lines: [], files: [] };
  const branch = snapshot(pi, ctx, git, false);
  const all = snapshot(pi, ctx, git, true);
  assert.equal(branch[3].rows.length, 1);
  assert.equal(all[3].rows.length, 2);
  assert.match(branch[1].rows[5].label, /2 tokens/);
  assert.match(all[1].rows[5].label, /4 tokens/);
  assert.equal(branch[2].rows[2].detail, all[2].rows[2].detail);
});

test("dashboard cards summarize usage, user turns and durations while history separates tool input and result", () => {
  const { pi, ctx } = fixtures();
  const entries = [
    { type: "message", id: "u", parentId: null, timestamp: "now", message: { role: "user", content: "Read a file" } },
    { type: "message", id: "a", parentId: "u", timestamp: "now", message: { role: "assistant", provider: "p", model: "m", stopReason: "toolUse", durationMs: 2345,
      usage: { input: 100, output: 20, cacheRead: 800, cacheWrite: 100, cost: { total: 0.25 } },
      content: [{ type: "toolCall", id: "call", name: "read", arguments: { path: "file.ts" } }] } },
    { type: "message", id: "r", parentId: "a", timestamp: "now", message: { role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "contents" }], isError: false } },
  ] as unknown as SessionEntry[];
  ctx.sessionManager.getBranch = () => entries;
  const tabs = snapshot(pi, ctx, { lines: ["Branch: main"], files: [] }, false);
  assert.equal(tabs[0].cards?.[0].fields?.find((field) => field.label === "Branch")?.value, "main");
  const usage = tabs[1].cards?.find((card) => card.title === "Recorded usage");
  assert.equal(usage?.fields?.find((field) => field.label === "User turns")?.value, "1");
  assert.equal(usage?.fields?.find((field) => field.label === "Cost")?.value, "$0.2500");
  assert.equal(usage?.meter?.percent, 80);
  assert.deepEqual(tabs[1].cards?.find((card) => card.title.startsWith("Response durations"))?.bars,
    [{ label: "#1", value: 2345, suffix: "2.35 s" }]);
  assert.equal(tabs[6].cards?.[0].bars?.[0].value, 1);
  assert.equal(tabs[3].rows[0].cards?.find((card) => card.title === "Input")?.fields?.[0].value, "file.ts");
  assert.equal(tabs[3].rows[0].cards?.find((card) => card.title === "Result")?.text, "contents");
  assert.equal(tabs[3].rows[1].cards?.find((card) => card.title === "Input")?.fields?.[0].value, "file.ts");
  assert.ok(tabs[3].rows[1].detail?.includes('"toolCall"'));
});

test("unknown context stays unknown rather than inventing a zero window", () => {
  const { pi, ctx } = fixtures();
  ctx.getContextUsage = () => undefined;
  const tabs = snapshot(pi, ctx, { lines: [], files: [] }, false);
  assert.equal(tabs[0].cards?.find((card) => card.title === "Context")?.fields?.[0].value, "Unknown / Unknown");
  assert.equal(tabs[0].cards?.find((card) => card.title === "Context")?.meter?.percent, null);
});
