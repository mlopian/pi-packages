import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Card } from "./dashboard.ts";
import { inspect, plainText } from "./data.ts";
import { historyStyle } from "./presentation.ts";

export function valueCard(title: string, value: unknown, tone: Card["tone"] = "accent"): Card {
  const safe = value === undefined ? null : JSON.parse(inspect(value));
  const fields: NonNullable<Card["fields"]> = [];
  let omitted = false;
  function visit(item: unknown, label: string, depth: number) {
    if (fields.length >= 60) { omitted = true; return; }
    if (item && typeof item === "object" && depth < 4) {
      const entries = Object.entries(item);
      if (!entries.length) fields.push({ label: label || "Value", value: Array.isArray(item) ? "Empty list" : "No fields", tone: "muted" });
      for (const [key, nested] of entries) visit(nested, label ? `${label}.${key}` : key, depth + 1);
    } else {
      const value = item === null ? "None" : typeof item === "object" ? `${Object.keys(item).length} nested fields (see Raw)` : String(item);
      fields.push({ label: label || "Value", value: plainText(value), tone: typeof item === "boolean" ? item ? "success" : "muted" : typeof item === "number" ? "accent" : "text" });
    }
  }
  visit(safe, "", 0);
  return { title, tone, fields, ...(omitted ? { text: "More fields available in Raw." } : {}) };
}

export function readableCards(label: string, detail?: string): Card[] {
  if (!detail) return [{ title: label, tone: "accent", text: label }];
  try {
    return [valueCard(label, JSON.parse(detail))];
  } catch {
    return [{ title: label, tone: "accent", text: plainText(detail) }];
  }
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => typeof block?.text === "string" ? block.text : block?.type === "image" ? "[Image]" : "").join("\n");
}

function inputCard(name: string, input: unknown): Card {
  const args = JSON.parse(inspect(input ?? {}));
  return name === "bash" && typeof args?.command === "string"
    ? { title: "Input", tone: "warning", text: args.command, language: "bash" }
    : valueCard("Input", args, "warning");
}

export function historyCards(entries: readonly SessionEntry[]): Card[][] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return entries.map((entry) => {
    let input: unknown;
    if (entry.type === "message" && entry.message.role === "toolResult") {
      const result = entry.message;
      const visited = new Set<string>([entry.id]);
      let parent = byId.get(entry.parentId ?? "");
      while (parent && !visited.has(parent.id)) {
        visited.add(parent.id);
        if (parent.type === "message" && parent.message.role === "assistant" && Array.isArray(parent.message.content)) {
          const call = parent.message.content.find((block) => block?.type === "toolCall" && block.id === result.toolCallId && block.name === result.toolName);
          if (call?.type === "toolCall") { input = call.arguments ?? {}; break; }
        }
        parent = byId.get(parent.parentId ?? "");
      }
    }
    return entryCards(entry, input);
  }).reverse();
}

export function entryCards(entry: SessionEntry, toolInput?: unknown): Card[] {
  const kind = entry.type === "message" ? entry.message.role : entry.type;
  const style = historyStyle(kind);
  const fields: NonNullable<Card["fields"]> = [
    { label: "Time", value: entry.timestamp, tone: "muted" },
    { label: "Entry", value: entry.id, tone: "accent" },
  ];
  const header: Card = { title: `[${style.label}]`, tone: style.tone, fields };
  const cards: Card[] = [header];
  if (entry.type !== "message") {
    if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.summary) cards.push({ title: "Summary", tone: "warning", text: entry.summary });
    else cards.push(valueCard("Event", entry, style.tone));
    return cards;
  }
  const message = entry.message;
  if (message.role === "assistant") {
    const failed = message.stopReason === "error" || message.stopReason === "aborted";
    header.tone = failed ? "error" : "success";
    header.title = failed ? "[ERROR]" : "[ASSISTANT]";
    fields.push(
      { label: "Model", value: `${message.provider ?? "unknown"}/${message.model ?? "unknown"}`, tone: "accent" },
      { label: "Status", value: message.stopReason ?? "unknown", tone: failed ? "error" : "success" },
    );
    if (message.durationMs !== undefined) fields.push({ label: "Duration", value: `${(message.durationMs / 1000).toFixed(1)}s` });
    if (message.errorMessage) cards.push({ title: "Error", tone: "error", text: message.errorMessage });
    if (typeof message.content === "string") cards.push({ title: "Response", tone: "success", text: message.content });
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (!block) continue;
      if (block.type === "text") cards.push({ title: "Response", tone: "success", text: block.text });
      else if (block.type === "thinking") cards.push({ title: "Thinking", tone: "muted", text: block.thinking });
      else if (block.type === "toolCall") {
        cards.push({ title: `Tool call: ${block.name}`, tone: "warning", fields: [{ label: "Call ID", value: block.id }] });
        cards.push(inputCard(block.name, block.arguments));
      }
    }
  } else if (message.role === "toolResult") {
    header.tone = message.isError ? "error" : "warning";
    header.title = message.isError ? "[ERROR]" : "[TOOL]";
    fields.push({ label: "Tool", value: message.toolName, tone: "accent" }, { label: "Status", value: message.isError ? "Failed" : "OK", tone: message.isError ? "error" : "success" });
    cards.push(toolInput === undefined
      ? { title: "Input", tone: "muted", text: "Original tool input is unavailable in this history branch." }
      : inputCard(message.toolName, toolInput));
    cards.push(...readableCards("Result", contentText(message.content)).map<Card>((card) => ({ ...card, tone: message.isError ? "error" : "success" })));
    if (message.nestedCalls?.calls?.length) cards.push(valueCard("Nested calls", message.nestedCalls, "warning"));
  } else if (message.role === "bashExecution") {
    const failed = message.cancelled || (message.exitCode !== undefined && message.exitCode !== 0);
    header.tone = failed ? "error" : "warning";
    header.title = failed ? "[ERROR]" : "[SHELL]";
    fields.push({ label: "Status", value: message.cancelled ? "Cancelled" : `Exit ${message.exitCode ?? "unknown"}`, tone: failed ? "error" : "success" });
    cards.push({ title: "Input", tone: "warning", text: message.command, language: "bash" }, { title: "Result", tone: failed ? "error" : "success", text: message.output });
  } else if ("content" in message) {
    const text = contentText(message.content);
    cards.push({ title: "Content", tone: style.tone, text });
    if (message.role === "system" && message.sections) cards.push(valueCard("Prompt sections", message.sections, "muted"));
  } else cards.push(valueCard("Details", message));
  return cards;
}
