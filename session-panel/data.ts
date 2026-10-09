import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Card } from "./dashboard.ts";

export interface PanelRow {
  label: string;
  detail?: string;
  path?: string;
  diff?: boolean;
  kind?: string;
  error?: boolean;
  cards?: Card[];
}

export interface PanelTab {
  name: string;
  rows: PanelRow[];
  summary?: string[];
  context?: { percent: number | null; tokens: number | null; limit: number };
  cards?: Card[];
}

export function plainText(value: string): string {
  return value.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

export function inspect(value: unknown): string {
  const json = JSON.stringify(value, (key, item) => {
    if (/(?:password|secret|credential|api[_-]?key|(?:access|refresh|auth|bearer)[_-]?token)|^(?:authorization|headers|env|token)$/i.test(key)) {
      return "[redacted]";
    }
    return item;
  }, 2);
  return plainText(json ?? String(value));
}

export function sessionFiles(entries: SessionEntry[], cwd: string): PanelRow[] {
  const files = new Map<string, Set<string>>();
  const calls = new Map<string, { name: string; arguments: unknown }>();
  function add(path: unknown, source: string) {
    if (typeof path !== "string" || !path || path.includes("\0")) return;
    let normalized = (path.startsWith("@") ? path.slice(1) : path).replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
    if (normalized === "~") normalized = homedir();
    else if (normalized.startsWith("~/")) normalized = resolve(homedir(), normalized.slice(2));
    else if (normalized.startsWith("file://")) {
      try {
        normalized = fileURLToPath(normalized);
      } catch {
        return;
      }
    }
    if (!normalized || normalized.includes("\0")) return;
    const absolute = resolve(cwd, normalized);
    const sources = files.get(absolute) ?? new Set<string>();
    sources.add(source);
    files.set(absolute, sources);
  }
  function changed(name: string, args: unknown, source: string) {
    if (name !== "edit" && name !== "write") return;
    if (args && typeof args === "object" && "path" in args) add(args.path, source);
  }
  for (const entry of entries) {
    if (entry.type === "message") {
      const message = entry.message;
      if (message.role === "assistant") {
        for (const block of message.content) {
          if (block.type === "toolCall") calls.set(block.id, { name: block.name, arguments: block.arguments });
        }
      } else if (message.role === "toolResult") {
        const call = calls.get(message.toolCallId);
        if (call && !message.isError) changed(call.name, call.arguments, call.name);
        for (const nested of message.nestedCalls?.calls ?? []) {
          if (nested.status === "ok") changed(nested.name, nested.arguments, `nested ${nested.name}`);
        }
      }
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      const details = entry.details;
      if (details && typeof details === "object" && "modifiedFiles" in details && Array.isArray(details.modifiedFiles)) {
        for (const path of details.modifiedFiles) add(path, entry.type);
      }
    }
  }
  return [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, sources]) => ({
    label: path,
    path,
    diff: true,
    detail: `Reported modified: ${[...sources].join(", ")}\n${path}\n\nThis is tool history, not proof of a current filesystem change. Shell and external changes may be absent.`,
  }));
}

export function usageRows(entries: SessionEntry[]): PanelRow[] {
  const groups = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number; count: number }>();
  for (const entry of entries) {
    let usage;
    let group;
    if (entry.type === "message" && entry.message.role === "assistant") {
      usage = entry.message.usage;
      group = `${entry.message.provider}/${entry.message.model}`;
    } else if (entry.type === "message" && entry.message.role === "toolResult") {
      usage = entry.message.usage;
      group = `Tool usage: ${entry.message.toolName} (model attribution unavailable)`;
    } else if (entry.type === "usage") {
      usage = entry.usage;
      group = `${entry.provider}/${entry.model} (${entry.kind})`;
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      usage = entry.usage;
      group = `${entry.type} (model attribution unavailable)`;
    }
    if (!usage || !group) continue;
    const total = groups.get(group) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, count: 0 };
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) total[key] += usage[key] ?? 0;
    total.cost += usage.cost?.total ?? 0;
    total.count++;
    groups.set(group, total);
  }
  const rows = [...groups].map(([group, total]) => ({
    label: `${group}: ${total.totalTokens} tokens, $${total.cost.toFixed(4)}`,
    detail: inspect(total),
  }));
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, count: 0 };
  for (const group of groups.values()) {
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += group[key];
  }
  rows.push({ label: `Total recorded: ${total.totalTokens} tokens, $${total.cost.toFixed(4)}`, detail: inspect(total) });
  return rows;
}

export function historyRows(entries: SessionEntry[]): PanelRow[] {
  return entries.map((entry) => {
    let label: string = entry.type;
    if (entry.type === "message") {
      const message = entry.message;
      label = message.role;
      if (message.role === "toolResult") label += ` ${message.toolName}${message.isError ? " [error]" : ""}`;
      if ("content" in message) {
        const text = typeof message.content === "string" ? message.content : message.content.map((block) => {
          if (block.type === "text") return block.text;
          if (block.type === "thinking") return "[thinking]";
          if (block.type === "toolCall") return `[${block.name}]`;
          return `[${block.type}]`;
        }).join(" ");
        label += `: ${plainText(text).replace(/\s+/g, " ").slice(0, 180)}`;
      }
    }
    const kind = entry.type === "message" ? entry.message.role : entry.type;
    const error = entry.type === "message" && ((entry.message.role === "toolResult" && entry.message.isError)
      || (entry.message.role === "assistant" && ["error", "aborted"].includes(entry.message.stopReason))
      || (entry.message.role === "bashExecution" && (entry.message.cancelled || (entry.message.exitCode !== undefined && entry.message.exitCode !== 0))));
    return { label: `${entry.timestamp} ${entry.id} ${label}`, detail: inspect(entry), kind, error };
  }).reverse();
}
