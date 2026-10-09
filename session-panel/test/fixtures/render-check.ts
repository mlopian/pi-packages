import assert from "node:assert/strict";
import { highlightCode, type ExtensionAPI, type SessionEntry, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { SessionPanel, type PanelAction, type PanelState } from "../../panel.ts";
import { historyRows, plainText, type PanelTab } from "../../data.ts";
import { entryCards, historyCards } from "../../readable.ts";
import { renderCards } from "../../render-cards.ts";
import { renderDiff } from "../../render-diff.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    try {
      const colors = { accent: 36, success: 32, error: 31, warning: 33, muted: 37, dim: 90, border: 90, borderMuted: 90, text: 37, toolDiffAdded: 32, toolDiffRemoved: 31 };
      const backgrounds = { toolSuccessBg: 42, toolErrorBg: 41 };
      const theme = {
        fg: (tone: string, text: string) => `\x1b[${colors[tone as keyof typeof colors] ?? 37}m${text}\x1b[39m`,
        bg: (tone: string, text: string) => `\x1b[${backgrounds[tone as keyof typeof backgrounds] ?? 40}m${text}\x1b[49m`,
        style: (text: string) => `\x1b[1;36m${text}\x1b[0m`,
        bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
      } as unknown as Theme;
      const tui = { terminal: { rows: 34 }, requestRender() {} };
      const names = ["Session", "Model / Usage", "Context", "History", "Session files", "Git", "Tools", "Settings"];
      const tabs: PanelTab[] = names.map((name) => ({
        name,
        rows: [{ label: "Details", detail: '{\n  "name": "wide 中文 👩‍💻",\n  "count": 42,\n  "enabled": true,\n  "empty": null\n}' }],
        summary: ["[IDLE] example\nname", "3 files"],
      }));
      tabs[0].context = { percent: 40, tokens: 400, limit: 1000 };
      tabs[0].cards = [{ title: "Session", tone: "accent", fields: [
        { label: "Name", value: "wide 中文 👩‍💻", tone: "accent" }, { label: "State", value: "Idle", tone: "success" },
      ], meter: { label: "Context", percent: 40, value: "400 / 1,000" } },
      { title: "Tool calls", tone: "warning", bars: [{ label: "Bash", value: 5 }, { label: "Read", value: 2 }] }];
      tabs[2].cards = [{ title: "Context", tone: "accent", text: "Browse context files with v." }];
      tabs[5].rows = [{ label: " M a.ts", path: "/a.ts", diff: true }, { label: "?? b.ts", path: "/b.ts", diff: true }];
      const requests: { path: string; signal: AbortSignal; resolve: (value: string) => void }[] = [];
      let action: PanelAction | undefined;
      const state: PanelState = { tab: 0, selected: 0, wholeSession: false };
      const panel = new SessionPanel(tabs, state, tui as unknown as TUI, theme,
        (result) => { action = result; },
        (path, signal) => new Promise((resolve) => { requests.push({ path, signal, resolve }); }));

      function checkBounds() {
        for (const rows of [14, 18, 34]) {
          tui.terminal.rows = rows;
          for (const width of [8, 24, 42, 80, 98, 132]) {
            const lines = panel.render(width);
            assert.ok(lines.every((line) => visibleWidth(line) <= width && !line.includes("\n")));
            assert.ok(lines.length <= rows);
          }
        }
      }
      const footer = (component: SessionPanel, width = 132) => component.render(width).slice(-3, -1).map(plainText).join("\n");
      checkBounds();
      assert.ok(footer(panel).includes("v browse") && footer(panel).includes("b scope") && footer(panel).includes("Up/Down scroll"));
      assert.ok(!footer(panel).includes("Enter open") && !footer(panel).includes("e editor") && !footer(panel).includes("d diff") && !footer(panel).includes("j Raw"));
      let frame = panel.render(132);
      assert.ok(frame.some((line) => line.includes("╭") && line.includes("Session")));
      assert.ok(frame.some((line) => line.includes("╰") && line.includes("╯")));
      assert.ok(frame.some((line) => line.includes("█") && line.includes("░")));
      assert.ok(!frame.some((line) => plainText(line).includes('"name"')));
      panel.handleInput("j");
      panel.handleInput("e");
      assert.equal(action, undefined);
      assert.equal(state.detail, undefined);
      panel.handleInput("v");
      assert.ok(footer(panel).includes("Enter open") && footer(panel).includes("j Raw"));
      assert.ok(panel.render(132).some((line) => plainText(line).includes("wide 中文 👩‍💻")));
      panel.handleInput("\r");
      assert.ok(footer(panel).includes("Up/Down scroll") && footer(panel).includes("Esc back"));
      assert.ok(!footer(panel).includes("Enter open"));
      panel.handleInput("j");
      const highlighted = highlightCode(tabs[0].rows[0].detail!, "json");
      assert.ok(highlighted[2].includes("\x1b["));
      for (const line of highlighted) assert.ok(panel.render(132).some((rendered) => rendered.includes(line)));
      assert.ok(panel.render(132)[0].includes("Raw"));
      panel.handleInput("j");
      assert.ok(!panel.render(132)[0].includes("Raw"));
      panel.handleInput("\x1b");
      panel.handleInput("6");
      panel.render(132);
      assert.equal(requests[0].path, "/a.ts");
      assert.ok(footer(panel).includes("e editor") && footer(panel).includes("d diff"));
      assert.ok(!footer(panel).includes("b scope"));
      panel.handleInput("b");
      assert.equal(action, undefined);
      assert.ok(footer(panel, 42).includes("Esc close"));
      panel.handleInput("\x1b[B");
      assert.equal(requests[0].signal.aborted, true);
      assert.equal(requests[1].path, "/b.ts");
      requests[0].resolve("STALE RESPONSE");
      requests[1].resolve("diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1,1 +1,1 @@\n-old\n+new");
      await new Promise((resolve) => setImmediate(resolve));
      let lines = panel.render(132);
      assert.ok(lines.some((line) => line.includes("+new")));
      assert.ok(!lines.some((line) => line.includes("STALE RESPONSE")));
      panel.handleInput("\r");
      assert.equal(state.detailIsDiff, true);
      assert.ok(footer(panel).includes("e editor") && !footer(panel).includes("d diff"));
      panel.handleInput("d");
      assert.equal(action, undefined);
      checkBounds();
      colors.success = 35;
      backgrounds.toolSuccessBg = 45;
      panel.invalidate();
      lines = panel.render(132);
      assert.ok(lines.some((line) => line.includes("\x1b[45m") && line.includes("+new")));
      assert.ok(lines.some((line) => line.includes("\x1b[41m") && line.includes("-old")));
      panel.handleInput("\x1b");
      panel.render(132);
      panel.handleInput("\x1b[A");
      const last = requests.at(-1)!;
      panel.dispose();
      panel.dispose();
      assert.equal(last.signal.aborted, true);
      last.resolve("DISPOSED RESPONSE");
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(action, undefined);

      tabs[2].rows.push({ label: "Context file", path: "/context.json", detail: "{}" });
      let fileAction: PanelAction | undefined;
      const contextPanel = new SessionPanel(tabs, { tab: 2, selected: 0, wholeSession: false }, tui as unknown as TUI, theme,
        (result) => { fileAction = result; }, async () => "No changes");
      assert.ok(!footer(contextPanel).includes("e editor"));
      contextPanel.handleInput("v");
      contextPanel.render(132);
      contextPanel.handleInput("\x1b[B");
      assert.ok(footer(contextPanel).includes("e editor") && !footer(contextPanel).includes("d diff"));
      contextPanel.handleInput("d");
      assert.equal(fileAction, undefined);
      contextPanel.handleInput("e");
      assert.deepEqual(fileAction, { type: "edit", path: "/context.json" });
      for (const tab of [6, 7]) {
        let invalidAction: PanelAction | undefined;
        const unscoped = new SessionPanel(tabs, { tab, selected: 0, wholeSession: false }, tui as unknown as TUI, theme,
          (result) => { invalidAction = result; }, async () => "No changes");
        assert.ok(!footer(unscoped).includes("b scope"));
        unscoped.handleInput("b");
        assert.equal(invalidAction, undefined);
        unscoped.dispose();
      }

      const historyEntries = [
        { type: "message", message: { role: "user", content: "hello" } },
        { type: "message", message: { role: "assistant", content: [], stopReason: "stop" } },
        { type: "message", message: { role: "toolResult", toolName: "read", content: [], isError: false } },
        { type: "message", message: { role: "toolResult", toolName: "edit", content: [], isError: true } },
        { type: "message", message: { role: "system", content: "instructions" } },
      ].map((entry, index) => ({ ...entry, id: String(index), parentId: null, timestamp: "2026-01-01" })) as unknown as SessionEntry[];
      tabs[3].rows = historyRows(historyEntries).reverse().map((row, index) => ({ ...row, cards: entryCards(historyEntries[index]) }));
      const historyPanel = new SessionPanel(tabs, { tab: 3, selected: 0, wholeSession: false }, tui as unknown as TUI, theme, () => {}, async () => "No changes");
      for (const [index, badge, color] of [[0, "USER", 36], [1, "ASSISTANT", 35], [2, "TOOL", 33], [3, "ERROR", 31], [4, "SYSTEM", 37]] as const) {
        if (index) historyPanel.handleInput("\x1b[B");
        assert.ok(historyPanel.render(132).some((line) => line.includes(`\x1b[${color}m[${badge}]`)));
        for (const width of [24, 42, 80, 132]) assert.ok(historyPanel.render(width).every((line) => visibleWidth(line) <= width));
        historyPanel.handleInput("\r");
        assert.ok(historyPanel.render(132).some((line) => line.includes(`\x1b[${color}m [${badge}]`)));
        historyPanel.handleInput("\x1b");
        historyPanel.render(132);
      }
      historyPanel.dispose();
      const toolEntries = [
        { type: "message", id: "a", parentId: null, timestamp: "2026-01-01", message: { role: "assistant", content: [
          { type: "toolCall", id: "bash-call", name: "bash", arguments: { command: "echo command-from-history" } },
        ] } },
        { type: "message", id: "r", parentId: "a", timestamp: "2026-01-01", message: { role: "toolResult", toolCallId: "bash-call", toolName: "bash", content: [{ type: "text", text: "command output" }], isError: false } },
      ] as unknown as SessionEntry[];
      const toolCards = historyCards(toolEntries);
      tabs[3].rows = historyRows(toolEntries).map((row, index) => ({ ...row, cards: toolCards[index] }));
      const toolPanel = new SessionPanel(tabs, { tab: 3, selected: 0, wholeSession: false }, tui as unknown as TUI, theme, () => {}, async () => "No changes");
      for (const expanded of [false, true]) {
        if (expanded) toolPanel.handleInput("\r");
        const preview = toolPanel.render(132).map(plainText).join("\n");
        assert.ok(preview.includes("echo command-from-history") && preview.includes("command output"));
      }
      toolPanel.dispose();

      tabs[0].rows[0].detail = Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n");
      const scrollState: PanelState = { tab: 0, selected: 0, wholeSession: false, dashboard: false };
      const scrolling = new SessionPanel(tabs, scrollState, tui as unknown as TUI, theme, () => {}, async () => "No changes");
      scrolling.render(80);
      scrolling.handleInput("\r");
      scrolling.render(80);
      scrolling.handleInput("\x1b[F");
      assert.ok(scrolling.render(80).some((line) => line.includes("line 99")));
      scrolling.dispose();
      const resumed = new SessionPanel(tabs, scrollState, tui as unknown as TUI, theme, () => {}, async () => "No changes");
      assert.ok(resumed.render(80).some((line) => line.includes("line 99")));
      resumed.dispose();
      tabs[0].cards = [{ title: "Large dashboard", tone: "accent", fields: Array.from({ length: 100 }, (_, index) => ({ label: `Field ${index}`, value: `value ${index}` })) }];
      const dashboardState: PanelState = { tab: 0, selected: 0, wholeSession: false };
      const dashboard = new SessionPanel(tabs, dashboardState, tui as unknown as TUI, theme, () => {}, async () => "No changes");
      dashboard.render(80);
      dashboard.handleInput("\x1b[F");
      assert.ok(dashboard.render(80).some((line) => line.includes("value 99")));
      dashboard.dispose();
      const dashboardResume = new SessionPanel(tabs, dashboardState, tui as unknown as TUI, theme, () => {}, async () => "No changes");
      assert.ok(dashboardResume.render(80).some((line) => line.includes("value 99")));
      dashboardResume.dispose();
      const longDiff = renderDiff(`@@ -1 +1 @@\n-old\n+${"中文 👩‍💻 ".repeat(40)}END_LONG`, 42, theme);
      assert.ok(longDiff.every((line) => visibleWidth(line) <= 42));
      assert.ok(longDiff.some((line) => plainText(line).includes("END_LONG")));
      assert.ok(longDiff.filter((line) => line.includes("\x1b[45m")).length > 3);
      const bounded = renderCards([{ title: "Bounded", tone: "accent", fields: [
        { label: "First", value: "x".repeat(150_000) }, { label: "Second", value: "x".repeat(150_000) },
      ] }], 42, theme).map(plainText).join("\n");
      assert.ok((bounded.match(/x/g) ?? []).length <= 200_000);
      assert.match(bounded, /truncated/i);
      process.stdout.write("PANEL_RENDER_CHECK_PASSED\n");
    } finally {
      ctx.shutdown();
    }
  });
}
