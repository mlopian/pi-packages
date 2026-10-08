export interface UsageWindow {
  label: string;
  percentRemaining: number;
  resetsAt: string | null;
}

export interface Usage {
  windows: UsageWindow[];
  stale: boolean;
}

interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt?: number | null;
}

interface RateLimit {
  limitId?: string;
  limitName?: string;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
}

export function parseUsage(result: { rateLimits?: RateLimit; rateLimitsByLimitId?: Record<string, RateLimit> }): Usage {
  const windows: UsageWindow[] = [];
  function add(limit: RateLimit | undefined, prefix = "") {
    for (const window of [limit?.primary, limit?.secondary]) {
      if (window == null) continue;
      const duration = window.windowDurationMins;
      if (
        !Number.isFinite(window.usedPercent) ||
        !Number.isFinite(duration) || duration <= 0 ||
        (window.resetsAt != null && (!Number.isFinite(window.resetsAt) || !Number.isFinite(new Date(window.resetsAt * 1000).getTime())))
      ) {
        throw new Error("Invalid Codex usage window");
      }
      const baseLabel = duration >= 6 * 1440 ? "week"
        : duration >= 1440 ? `${Math.round(duration / 1440)}d`
        : duration === 300 ? "5h" : `${duration}m`;
      const label = (prefix ? `${prefix} - ${baseLabel}` : baseLabel)
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(/[\u2013\u2014]/g, "-");
      windows.push({
        label,
        percentRemaining: 100 - Math.max(0, Math.min(100, window.usedPercent)),
        resetsAt: window.resetsAt == null ? null : new Date(window.resetsAt * 1000).toISOString(),
      });
    }
  }
  const base = result?.rateLimits;
  add(base);
  for (const [id, limit] of Object.entries(result?.rateLimitsByLimitId ?? {})) {
    if (limit === base || id === base?.limitId) continue;
    add(limit, limit.limitName ?? id);
  }
  if (!windows.length) throw new Error("Codex usage unavailable");
  return { windows, stale: false };
}

export function bar(percentRemaining: number): string {
  const filled = Math.round(percentRemaining / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

export function countdown(resetsAt: string, now: number): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(resetsAt) - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

export function colorFor(percentRemaining: number): "success" | "warning" | "error" {
  return percentRemaining > 50 ? "success" : percentRemaining > 20 ? "warning" : "error";
}
