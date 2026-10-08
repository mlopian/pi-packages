import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { bar, colorFor, countdown, type Usage } from "./usage.ts";
import { runUsage } from "./run-usage.ts";

const KEY = "codex-usage";

interface Session {
  ctx: ExtensionContext;
  controller: AbortController;
  timer?: ReturnType<typeof setInterval>;
  pending?: Promise<void>;
  usage?: Usage;
  failed: boolean;
}

export default function codexUsage(pi: ExtensionAPI) {
  let session: Session | undefined;

  function draw(state: Session) {
    if (session !== state) return;
    state.ctx.ui.setWidget(KEY, (_tui, theme) => ({
      invalidate() {},
      render(width: number) {
        if (!state.usage) {
          return [truncateToWidth(theme.fg("muted", state.failed ? "Codex usage unavailable. Run /codex-usage to retry." : "Codex usage loading..."), width)];
        }
        const windows = state.usage.windows.map((window) => {
          const left = Math.round(window.percentRemaining * 10) / 10;
          const reset = window.resetsAt ? ` reset ${countdown(window.resetsAt, Date.now())}` : "";
          return theme.fg("muted", `${window.label} `) +
            theme.fg(colorFor(left), bar(left)) +
            theme.fg("muted", ` ${left}% left${reset}`);
        });
        const stale = state.usage.stale ? theme.fg("warning", " [stale]") : "";
        return [truncateToWidth(theme.fg("muted", "Codex  ") + windows.join("  ") + stale, width)];
      },
    }));
  }

  function refresh(state: Session): Promise<void> {
    if (state.pending) return state.pending;
    draw(state);
    state.pending = (async () => {
      try {
        const usage = await runUsage(state.controller.signal);
        if (session !== state || state.controller.signal.aborted) return;
        state.usage = usage;
        state.failed = state.usage.stale;
      } catch {
        state.failed = true;
        if (state.usage) state.usage = { ...state.usage, stale: true };
      } finally {
        state.pending = undefined;
        draw(state);
      }
    })();
    return state.pending;
  }

  async function stop() {
    if (!session) return;
    const previous = session;
    session = undefined;
    clearInterval(previous.timer);
    previous.controller.abort();
    previous.ctx.ui.setWidget(KEY, undefined);
    await previous.pending;
  }

  pi.on("session_start", async (_event, ctx) => {
    await stop();
    if (ctx.mode !== "tui") return;
    const state: Session = { ctx, controller: new AbortController(), failed: false };
    session = state;
    state.timer = setInterval(() => void refresh(state), 60_000);
    state.timer.unref();
    void refresh(state);
  });

  pi.on("agent_end", () => {
    if (session) void refresh(session);
  });

  pi.on("session_shutdown", stop);

  pi.registerCommand("codex-usage", {
    description: "Refresh Codex subscription limits",
    handler: async (_args, ctx) => {
      const state = session;
      if (!state) return;
      await state.pending;
      if (session !== state) return;
      await refresh(state);
      if (session !== state) return;
      ctx.ui.notify(state.failed ? "Codex usage unavailable or stale. Check codex login and retry /codex-usage." : "Codex usage refreshed", state.failed ? "warning" : "info");
    },
  });
}
