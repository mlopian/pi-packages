import { realpath } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readGit, readGitDiff } from "./git.ts";
import { openEditor } from "./editor.ts";
import { SessionPanel, type PanelAction, type PanelState } from "./panel.ts";
import { snapshot } from "./snapshot.ts";

export default function sessionPanel(pi: ExtensionAPI) {
  let controller: AbortController | undefined;
  pi.on("session_shutdown", () => controller?.abort());
  pi.registerCommand("session-panel", {
    description: "Inspect the current session, context, files and Git; open files with $EDITOR",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/session-panel requires interactive TUI mode.", "warning");
        return;
      }
      if (controller) return;
      const operation = new AbortController();
      controller = operation;
      let closePanel: (() => void) | undefined;
      operation.signal.addEventListener("abort", () => closePanel?.(), { once: true });
      const state: PanelState = { tab: 0, selected: 0, wholeSession: false };
      async function loadGit() {
        try {
          return await readGit(ctx.cwd, operation.signal);
        } catch (error) {
          if (operation.signal.aborted) throw error;
          return { lines: ["Git unavailable: command failed, exceeded 5 seconds or exceeded 512 KiB of output."], files: [] };
        }
      }
      try {
        let git = await loadGit();
        while (!operation.signal.aborted) {
          const tabs = snapshot(pi, ctx, git, state.wholeSession);
          let action: PanelAction;
          try {
            action = await ctx.ui.custom<PanelAction>((tui, theme, _keys, done) => {
              const panel = new SessionPanel(tabs, state, tui, theme, done,
                (path, signal) => readGitDiff(ctx.cwd, path, AbortSignal.any([signal, operation.signal])));
              closePanel = () => {
                panel.dispose();
                done({ type: "close" });
              };
              if (operation.signal.aborted) closePanel();
              return panel;
            });
          } finally {
            closePanel = undefined;
          }
          operation.signal.throwIfAborted();
          if (action.type === "close") break;
          if (action.type === "scope") {
            state.wholeSession = !state.wholeSession;
            state.selected = 0;
            state.detail = undefined;
            state.detailIsDiff = false;
            state.detailScroll = 0;
          } else if (action.type === "diff") {
            try {
              state.detail = await readGitDiff(ctx.cwd, action.path, operation.signal);
            } catch (error) {
              if (operation.signal.aborted) throw error;
              state.detail = "Git diff unavailable: command failed, exceeded 5 seconds or exceeded 512 KiB of output.";
            }
            state.detailIsDiff = true;
            state.detailScroll = 0;
          } else {
            if (action.type === "edit") {
              const sessionFile = ctx.sessionManager.getSessionFile();
              if (sessionFile) {
                const [selectedPath, sessionPath] = await Promise.all([action.path, sessionFile].map((path) => realpath(path).catch(() => path)));
                if (selectedPath === sessionPath && !(await ctx.ui.confirm("Edit current session storage?", "Manual changes to the current session JSONL may corrupt session storage. Open it in the editor anyway?"))) continue;
              }
              operation.signal.throwIfAborted();
              const editor = process.env.EDITOR ?? pi.getSettings().externalEditor ?? process.env.VISUAL ?? "";
              await ctx.ui.custom<void>(async (tui, _theme, _keys, done) => {
                tui.stop();
                try {
                  await openEditor(editor, action.path, ctx.cwd, operation.signal);
                } catch (error) {
                  if (operation.signal.aborted) throw error;
                  state.detail = "Unable to open file. Check that it exists and $EDITOR is configured; GUI editors may need a wait flag.";
                  state.detailIsDiff = false;
                  state.detailScroll = 0;
                } finally {
                  tui.start();
                  tui.requestRender(true);
                  done();
                }
                return { render: () => [], invalidate() {} };
              });
            }
            git = await loadGit();
          }
        }
      } catch {
        if (!operation.signal.aborted) ctx.ui.notify("Session panel could not load. Check local Git and session data.", "error");
      } finally {
        operation.abort();
        controller = undefined;
      }
    },
  });
}
