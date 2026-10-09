import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Tone } from "./presentation.ts";

export interface Card {
  title: string;
  tone: Tone;
  fields?: { label: string; value: string; tone?: Tone }[];
  text?: string;
  language?: string;
  bars?: { label: string; value: number; suffix?: string }[];
  meter?: { label: string; percent: number | null; value: string };
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function formatNumber(value: number): string {
  return validNumber(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "unknown";
}

export function formatDuration(milliseconds: number): string {
  if (!validNumber(milliseconds)) return "unknown";
  if (milliseconds < 1000) return `${formatNumber(Math.round(milliseconds))} ms`;
  if (milliseconds < 60_000) return `${formatNumber(milliseconds / 1000)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${formatNumber(Math.floor(milliseconds % 60_000 / 1000))}s`;
}

export function sessionStats(entries: SessionEntry[]) {
  let turns = 0;
  const messages = new Map<string, number>();
  const calls = new Map<string, { name: string; error: boolean }>();
  const durations: { label: string; value: number; suffix: string }[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 0 };
  let anonymousCall = 0;
  let response = 0;

  function addCall(id: unknown, name: unknown, error = false) {
    const key = typeof id === "string" && id ? id : `anonymous:${anonymousCall++}`;
    const existing = calls.get(key);
    if (existing) {
      existing.error ||= error;
    } else if (typeof name === "string" && name) {
      calls.set(key, { name, error });
    }
  }

  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const message = entry.message;
    response++;
    if (validNumber(message.durationMs)) {
      durations.push({ label: `#${response}`, value: message.durationMs, suffix: formatDuration(message.durationMs) });
    }
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block?.type === "toolCall") addCall(block.id, block.name);
      }
    }
  }

  for (const entry of entries) {
    let recordedUsage;
    if (entry.type === "message") {
      const message = entry.message;
      if (typeof message.role === "string") messages.set(message.role, (messages.get(message.role) ?? 0) + 1);
      if (message.role === "user") turns++;
      if (message.role === "assistant" || message.role === "toolResult") recordedUsage = message.usage;
      if (message.role === "toolResult") {
        addCall(message.toolCallId, message.toolName, message.isError === true);
        if (Array.isArray(message.nestedCalls?.calls)) {
          for (const nested of message.nestedCalls.calls) {
            if (nested) addCall(nested.id, nested.name, nested.status === "error");
          }
        }
      }
    } else if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") {
      recordedUsage = entry.usage;
    }
    if (!recordedUsage || typeof recordedUsage !== "object") continue;
    usage.requests++;
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      if (validNumber(recordedUsage[key])) usage[key] += recordedUsage[key];
    }
    if (validNumber(recordedUsage.cost?.total)) usage.cost += recordedUsage.cost.total;
  }

  const tools = new Map<string, { name: string; count: number; errors: number }>();
  for (const call of calls.values()) {
    const tool = tools.get(call.name) ?? { name: call.name, count: 0, errors: 0 };
    tool.count++;
    if (call.error) tool.errors++;
    tools.set(call.name, tool);
  }
  return {
    turns,
    messages: [...messages].map(([role, count]) => ({ role, count })),
    tools: [...tools.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    durations: durations.slice(-10),
    usage,
  };
}
