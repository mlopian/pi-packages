import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { entryCards, historyCards, readableCards, valueCard } from "../readable.ts";

const entry = (message: unknown) => ({ type: "message", id: "entry", parentId: null, timestamp: "2026-01-01", message }) as SessionEntry;

test("formats nested data as fields and redacts credentials without a JSON dump", () => {
  const card = valueCard("Settings", { model: { name: "model", thinking: "high" }, headers: { Authorization: "private" }, enabled: true, count: 42 });
  assert.equal(card.fields?.find((field) => field.label === "model.name")?.value, "model");
  assert.equal(card.fields?.find((field) => field.label === "headers")?.value, "[redacted]");
  assert.equal(card.fields?.find((field) => field.label === "count")?.tone, "accent");
  assert.ok(!JSON.stringify(card).includes("private"));
  assert.equal(valueCard("Empty", undefined).fields?.[0].value, "None");
});

test("bounds field lists with a visible Raw notice and preserves plain text", () => {
  const card = valueCard("Large", Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, index])));
  assert.equal(card.fields?.length, 60);
  assert.match(card.text!, /Raw/);
  assert.equal(readableCards("Prompt", "hello\nworld")[0].text, "hello\nworld");
  assert.equal(readableCards("Data", '{"name":"test"}')[0].fields?.[0].value, "test");
});

test("assistant tool calls have readable input, response and thinking sections", () => {
  const cards = entryCards(entry({ role: "assistant", provider: "p", model: "m", stopReason: "toolUse", content: [
    { type: "text", text: "Running checks" }, { type: "thinking", thinking: "Think" },
    { type: "toolCall", id: "call", name: "bash", arguments: { command: "echo hello" } },
    { type: "toolCall", id: "write", name: "write", arguments: { path: "file.ts", content: "test" } },
  ] }));
  assert.ok(cards.some((card) => card.title === "Response" && card.text === "Running checks"));
  assert.ok(cards.some((card) => card.title === "Thinking" && card.text === "Think"));
  assert.ok(cards.some((card) => card.title === "Input" && card.language === "bash" && card.text === "echo hello"));
  assert.ok(cards.some((card) => card.title === "Input" && card.fields?.some((field) => field.label === "path" && field.value === "file.ts")));
});

test("tool and shell failures expose status and result cards", () => {
  const cards = entryCards(entry({ role: "toolResult", toolName: "read", isError: true, content: [{ type: "text", text: '{"error":"failed"}' }] }));
  assert.equal(cards[0].tone, "error");
  assert.ok(cards.some((card) => card.title === "Result" && card.fields?.[0].value === "failed"));
  const shell = entryCards(entry({ role: "bashExecution", command: "false", output: "failed", exitCode: 1, cancelled: false }));
  assert.equal(shell[0].tone, "error");
  assert.equal(shell.find((card) => card.title === "Input")?.language, "bash");
});

test("preserves assistant error reasons and tolerates old or incomplete content records", () => {
  const failed = entryCards(entry({ role: "assistant", stopReason: "error", errorMessage: "Rate limit reached", content: null }));
  assert.equal(failed[0].title, "[ERROR]");
  assert.equal(failed.find((card) => card.title === "Error")?.text, "Rate limit reached");
  const legacy = entryCards(entry({ role: "assistant", content: "Old response" }));
  assert.equal(legacy.find((card) => card.title === "Response")?.text, "Old response");
  const partial = entryCards(entry({ role: "toolResult", toolName: "read", content: "Old output", nestedCalls: {} }));
  assert.equal(partial.find((card) => card.title === "Result")?.text, "Old output");
});

test("tool results show the matching command before output even when calls finish out of order", () => {
  const entries = [
    { ...entry({ role: "assistant", content: [
      { type: "toolCall", id: "first", name: "bash", arguments: { command: "echo first" } },
      { type: "toolCall", id: "second", name: "bash", arguments: { command: "echo second" } },
    ] }), id: "a", parentId: null },
    { ...entry({ role: "toolResult", toolCallId: "second", toolName: "bash", isError: true, content: [{ type: "text", text: "second output" }] }), id: "r2", parentId: "a" },
    { ...entry({ role: "toolResult", toolCallId: "first", toolName: "bash", content: [{ type: "text", text: "first output" }] }), id: "r1", parentId: "r2" },
  ];
  const cards = historyCards(entries);
  assert.equal(cards[0][1].title, "Input");
  assert.equal(cards[0][1].text, "echo first");
  assert.equal(cards[0][1].language, "bash");
  assert.equal(cards[0][2].text, "first output");
  assert.equal(cards[1][1].text, "echo second");
  assert.equal(cards[1][2].tone, "error");
});

test("tool inputs are resolved from ancestors, not a different branch with the same call ID", () => {
  const entries = [
    { ...entry({ role: "assistant", content: [{ type: "toolCall", id: "shared", name: "bash", arguments: { command: "echo original" } }] }), id: "a", parentId: null },
    { ...entry({ role: "assistant", content: [{ type: "toolCall", id: "shared", name: "bash", arguments: { command: "echo other-branch" } }] }), id: "b", parentId: "a" },
    { ...entry({ role: "toolResult", toolCallId: "shared", toolName: "bash", content: [] }), id: "r", parentId: "a" },
  ];
  assert.equal(historyCards(entries)[0][1].text, "echo original");
});

test("orphaned, mismatched and cyclic tool results show unavailable input without guessing", () => {
  const source = { ...entry({ role: "assistant", content: [{ type: "toolCall", id: "shared", name: "bash", arguments: { command: "private command" } }] }), id: "a", parentId: null };
  for (const [toolCallId, toolName, parentId] of [["missing", "bash", "a"], ["shared", "read", "a"], ["shared", "bash", "r"]]) {
    const result = { ...entry({ role: "toolResult", toolCallId, toolName, content: [] }), id: "r", parentId };
    const cards = historyCards([source, result])[0];
    assert.match(cards[1].text!, /unavailable/);
    assert.ok(!JSON.stringify(cards).includes("private command"));
  }
});
