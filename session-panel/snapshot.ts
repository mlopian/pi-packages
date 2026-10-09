import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { historyRows, inspect, sessionFiles, usageRows, type PanelRow, type PanelTab } from "./data.ts";
import type { GitData } from "./git.ts";
import { formatNumber, sessionStats, type Card } from "./dashboard.ts";
import { historyCards, valueCard } from "./readable.ts";

export function snapshot(pi: ExtensionAPI, ctx: ExtensionCommandContext, git: GitData, wholeSession: boolean): PanelTab[] {
  const manager = ctx.sessionManager;
  const entries = wholeSession ? manager.getEntries() : manager.getBranch();
  const prompt = ctx.getSystemPromptOptions();
  const active = new Set(pi.getActiveTools());
  const gitFileLabels = new Set(git.files.map((file) => file.label));
  const row = (label: string, value: unknown): PanelRow => ({ label, detail: inspect(value), cards: [valueCard(label, value)] });
  const usage = ctx.getContextUsage();
  const context = usage ? { percent: usage.percent, tokens: usage.tokens, limit: usage.contextWindow } : undefined;
  const files = sessionFiles(entries, manager.getCwd());
  const totals = usageRows(entries);
  const stats = sessionStats(entries);
  const recordedInput = stats.usage.input + stats.usage.cacheRead + stats.usage.cacheWrite;
  const allTools = pi.getAllTools();
  const commands = pi.getCommands();
  const settings = pi.getSettings();
  const contextLimit = context?.limit ?? ctx.model?.contextWindow;
  const contextCard: Card = {
    title: "Context", tone: context && (context.percent ?? 0) >= 85 ? "error" : "warning",
    fields: [
      { label: "Tokens", value: `${context?.tokens === null || !context ? "Unknown" : formatNumber(context.tokens)} / ${contextLimit === undefined ? "Unknown" : formatNumber(contextLimit)}`, tone: "accent" },
      { label: "Auto-compaction", value: settings.compaction?.enabled === false ? "Disabled" : "Enabled", tone: "warning" },
    ],
    meter: { label: "Used", percent: context?.percent ?? null, value: "Estimated model context" },
  };
  const usageCard: Card = {
    title: "Recorded usage", tone: "success", fields: [
      { label: "Requests", value: String(stats.usage.requests), tone: "accent" },
      { label: "User turns", value: String(stats.turns), tone: "accent" },
      { label: "Input", value: formatNumber(stats.usage.input), tone: "accent" },
      { label: "Output", value: formatNumber(stats.usage.output), tone: "success" },
      { label: "Cache read", value: formatNumber(stats.usage.cacheRead), tone: "accent" },
      { label: "Cache write", value: formatNumber(stats.usage.cacheWrite), tone: "accent" },
      { label: "Cost", value: `$${stats.usage.cost.toFixed(4)}`, tone: "success" },
    ],
    meter: { label: "Cache served", percent: recordedInput ? stats.usage.cacheRead / recordedInput * 100 : null,
      value: "of recorded input tokens" },
    text: "Recorded usage, not subscription quota or invoice cost.",
  };
  const toolCard: Card = { title: "Most used tools (top 10)", tone: "accent", bars: stats.tools.slice(0, 10).map((tool) => ({ label: tool.name, value: tool.count, suffix: `${tool.count}${tool.errors ? ` (${tool.errors} errors)` : ""}` })) };
  const cards = historyCards(entries);
  const history = historyRows(entries).map((item, index) => ({ ...item, cards: cards[index] }));
  return [
    { name: "Session", context, cards: [
      { title: "Session", tone: "accent", fields: [
        { label: "Title", value: manager.getSessionName() ?? "Unnamed", tone: "accent" },
        { label: "ID", value: manager.getSessionId(), tone: "muted" },
        { label: "Model", value: `${ctx.model?.provider ?? "none"}/${ctx.model?.id ?? "none"}`, tone: "accent" },
        { label: "Thinking", value: pi.getThinkingLevel(), tone: "warning" },
        { label: "State", value: ctx.isIdle() ? "Idle" : "Running", tone: ctx.isIdle() ? "success" : "warning" },
        { label: "Started", value: manager.getHeader()?.timestamp ?? "Unknown" },
        { label: "Working directory", value: ctx.cwd, tone: "accent" },
        { label: "Branch", value: git.lines.find((line) => line.startsWith("Branch:"))?.slice(8) ?? "Not a Git worktree", tone: "accent" },
        { label: "Storage", value: manager.getSessionFile() ?? "In memory", tone: "muted" },
      ] }, contextCard,
      { title: "Activity", tone: "success", fields: [
        { label: "User turns", value: String(stats.turns), tone: "accent" },
        { label: "Entries", value: String(entries.length) },
        { label: "Session files", value: String(files.length), tone: "success" },
        { label: "Git changes", value: String(git.files.length), tone: "warning" },
        { label: "Cost", value: `$${stats.usage.cost.toFixed(4)}`, tone: "success" },
      ] },
    ],
      summary: [`${ctx.isIdle() ? "[IDLE]" : "[RUNNING]"} ${manager.getSessionName() ?? "unnamed"}`, `${entries.length} entries`, `${files.length} session files`, `${git.files.length} Git changes`], rows: [
      row(`Name: ${manager.getSessionName() ?? "unnamed"}`, manager.getHeader()),
      row(`ID: ${manager.getSessionId()}`, manager.getSessionId()),
      { label: `File: ${manager.getSessionFile() ?? "in memory"}`, path: manager.getSessionFile(), detail: manager.getSessionFile() },
      row(`Working directory: ${ctx.cwd}`, { current: ctx.cwd, original: manager.getCwd(), sessionDirectory: manager.getSessionDir() }),
      row(`State: ${ctx.isIdle() ? "idle" : "running"}; queued messages: ${ctx.hasPendingMessages() ? "yes" : "no"}`, { mode: ctx.mode, projectTrusted: ctx.isProjectTrusted() }),
      row(`Entries: ${entries.length}; all: ${manager.getEntries().length}; active leaf: ${manager.getLeafId()}`, manager.getLeafEntry()),
      row("Session tree (all branches and labels)", manager.getTree()),
      row("Parent session", manager.getHeader()?.parentSession ?? null),
    ] },
    { name: "Model / Usage", context, cards: [usageCard, contextCard,
      { title: "Response durations (last 10)", tone: "warning", bars: stats.durations }, toolCard,
      { title: "Model", tone: "accent", fields: [
        { label: "Provider", value: ctx.model?.provider ?? "None" },
        { label: "Model", value: ctx.model?.id ?? "None", tone: "accent" },
        { label: "Thinking", value: pi.getThinkingLevel(), tone: "warning" },
        { label: "Scoped models", value: String(ctx.scopedModels.length) },
      ] },
    ],
      summary: [ctx.model?.id ?? "no model", `thinking: ${pi.getThinkingLevel()}`, totals.at(-1)?.label ?? "No recorded usage"], rows: [
      row(`Model: ${ctx.model?.provider ?? "none"}/${ctx.model?.id ?? "none"}`, ctx.model),
      row(`Thinking: ${pi.getThinkingLevel()}`, pi.getThinkingLevel()),
      row(`Context: ${usage?.tokens ?? "unknown"} / ${usage?.contextWindow ?? "unknown"} (${usage?.percent?.toFixed(1) ?? "unknown"}%)`, usage),
      row("Scoped models", ctx.scopedModels),
      { label: "Recorded usage, not subscription quota or invoice cost" },
      ...totals,
      ...entries.filter((entry) => entry.type === "model_change" || entry.type === "thinking_level_change").map((entry) => row(`${entry.timestamp} ${entry.type}`, entry)),
    ] },
    { name: "Context", cards: [contextCard,
      { title: "Context files", tone: "accent", fields: (prompt.contextFiles ?? []).map((file) => ({ label: "File", value: file.path, tone: "accent" })) },
      { title: "Available skills", tone: "success", fields: (prompt.skills ?? []).map((skill) => ({ label: skill.name, value: skill.description ?? skill.filePath })) },
      { title: "System prompt", tone: "muted", text: "Use v to browse prompt sections, sources and the active model projection. j opens the selected raw data." },
    ], summary: [`${prompt.contextFiles?.length ?? 0} context files`, `${prompt.skills?.length ?? 0} skills`, "Active model context"], rows: [
      { label: "Effective system prompt", detail: ctx.getSystemPrompt() },
      row("System prompt construction options", prompt),
      row("Model-visible session projection (before request hooks)", manager.buildSessionProjection()),
      ...entries.filter((entry) => ["compaction", "branch_summary", "context_edit"].includes(entry.type)).map((entry) => row(`${entry.timestamp} ${entry.type}`, entry)),
      ...(prompt.contextFiles ?? []).map((file) => ({ label: `Context file: ${file.path}`, detail: file.content, path: file.path })),
      ...(prompt.skills ?? []).map((skill) => ({ label: `Skill: ${skill.name}`, detail: inspect(skill), path: skill.filePath })),
    ] },
    { name: "History", summary: [`${entries.length} entries`, "Newest first", "Enter to expand"], rows: history },
    { name: "Session files", summary: [`${files.length} reported files`, "Preview: current Git diff, not a session baseline"], rows: [
      { label: "Reported successful edit/write and summary file lists. Shell/external changes may be missing." },
      ...files,
    ] },
    { name: "Git", summary: [git.lines.find((line) => line.startsWith("Branch:")) ?? "Git", `${git.files.length} changed files`, git.lines.find((line) => line.startsWith("Ahead:")) ?? "Worktree snapshot"], rows: [
      ...git.lines.filter((label) => label.trim() && !gitFileLabels.has(label) && (label !== "Status:" || !git.files.length)).map((label) => ({ label, detail: label })),
      ...(git.files.length ? [{ label: "Changed files: XY = index/worktree, ?? = untracked, U = conflict" }] : []),
      ...git.files.map((file) => ({ ...file, detail: file.path, diff: true })),
    ] },
    { name: "Tools", cards: [toolCard,
      { title: "Tool registry", tone: "success", fields: [
        { label: "Active", value: String(active.size), tone: "success" },
        { label: "Registered", value: String(allTools.length), tone: "accent" },
        { label: "Extension MCP", value: String(pi.getMcpServers().length) },
      ] },
      { title: "Active tools", tone: "accent", fields: allTools.filter((tool) => active.has(tool.name)).map((tool) => ({ label: tool.name, value: tool.description })) },
    ], summary: [`${active.size} active tools`, `${pi.getAllTools().length} registered`, `${pi.getMcpServers().length} extension MCP registrations`], rows: [
      ...allTools.map((tool) => row(`${active.has(tool.name) ? "[active]" : "[registered]"} ${tool.name}`, tool)),
      ...pi.getMcpServers().map((server) => row(`Extension MCP registration: ${server.name}`, server)),
    ] },
    { name: "Settings", cards: [
      { title: "Runtime settings", tone: "accent", fields: [
        { label: "Theme", value: ctx.ui.theme.name ?? "Custom", tone: "accent" },
        { label: "Mode", value: ctx.mode },
        { label: "Project trusted", value: ctx.isProjectTrusted() ? "Yes" : "No", tone: ctx.isProjectTrusted() ? "success" : "warning" },
        { label: "External editor", value: process.env.EDITOR || settings.externalEditor || process.env.VISUAL ? "Configured" : "Not configured" },
        { label: "Compaction", value: settings.compaction?.enabled === false ? "Disabled" : "Enabled" },
      ] },
      { title: "Commands", tone: "success", fields: commands.map((command) => ({ label: `/${command.name}`, value: command.description ?? command.source })) },
    ], summary: [`Theme: ${ctx.ui.theme.name ?? "custom"}`, `${pi.getCommands().length} commands`, "Credentials redacted"], rows: [
      row("Effective settings (sensitive fields redacted)", settings),
      row("Current theme", { name: ctx.ui.theme.name, appearance: ctx.ui.theme.appearance }),
      ...commands.map((command) => row(`/${command.name} (${command.source})`, command)),
    ] },
  ];
}
