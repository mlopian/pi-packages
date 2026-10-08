import { spawn } from "node:child_process";
import { parseUsage, type Usage } from "./usage.ts";

export function runUsage(signal: AbortSignal): Promise<Usage> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["-s", "read-only", "-a", "never", "app-server"], {
      detached: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
    });
    let buffer = "";
    let receivedBytes = 0;
    let settled = false;
    function finish(error?: Error, usage?: Usage) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      if (error) reject(error);
      else resolve(usage!);
    }
    function abort() {
      finish(new Error("Codex usage request aborted"));
    }
    function send(id: number, method: string, params: object = {}) {
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    }
    const timer = setTimeout(() => finish(new Error("Codex usage request timed out")), 35_000);
    child.on("error", () => finish(new Error("Codex app-server failed to start")));
    child.on("close", () => finish(new Error("Codex app-server exited")));
    child.stdin.on("error", () => finish(new Error("Codex app-server input failed")));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > 256 * 1024) {
        finish(new Error("Codex response too large"));
        return;
      }
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (settled) return;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message?.id !== 1 && message?.id !== 2) continue;
        if (message.error) {
          finish(new Error("Codex RPC failed"));
          return;
        }
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
          send(2, "account/rateLimits/read");
        } else {
          try {
            finish(undefined, parseUsage(message.result));
          } catch {
            finish(new Error("Invalid Codex usage response"));
          }
        }
      }
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else send(1, "initialize", {
      clientInfo: { name: "pi-codex-usage", title: "Pi Codex Usage", version: "0.1.0" },
    });
  });
}
