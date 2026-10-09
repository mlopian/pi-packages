import { plainText } from "./data.ts";

export type Tone = "accent" | "success" | "warning" | "error" | "muted" | "dim" | "text";

export function classifyLine(line: string, diff: boolean): Tone {
  line = plainText(line);
  if (diff) {
    if (/^(?:diff |--- |\+\+\+ |@@)/.test(line)) return "accent";
    if (/^(?:index |(?:new|deleted) file mode |(?:old|new) mode |(?:dis)?similarity index |(?:rename|copy) (?:from|to) |Binary files |GIT binary patch|Staged:|Unstaged:)/.test(line)) return "muted";
    if (line.startsWith("+")) return "success";
    if (line.startsWith("-")) return "error";
    if (line.startsWith("\\")) return "dim";
  }
  if (/^\s*"(?:[^"\\]|\\.)+"\s*:/.test(line)) return "accent";
  if (/^[A-Za-z][\w /()-]*:/.test(line)) return "muted";
  return line.trim() ? "text" : "dim";
}

export function progressBar(percent: number | null | undefined, width: number): string {
  const size = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  if (typeof percent !== "number" || !Number.isFinite(percent)) return `[${"?".repeat(size)}]`;
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 100 * size);
  return `[${"#".repeat(filled)}${"-".repeat(size - filled)}]`;
}

export function rowTone(label: string): Tone {
  label = plainText(label);
  if (/\[error\]/i.test(label) || /^(?:Git|Diff) (?:diff )?unavailable/i.test(label)) return "error";
  if (/^\[IDLE\]/.test(label)) return "success";
  if (/^\[RUNNING\]/.test(label)) return "warning";
  const status = /^([ MADRCU?!]{2})(?: |$)/.exec(label)?.[1];
  if (status) {
    if (status.includes("U") || status === "AA" || status === "DD") return "error";
    if (status.includes("D")) return "error";
    if (status.includes("M") || status === "??") return "warning";
    if (/[AC]/.test(status)) return "success";
    if (status.includes("R")) return "accent";
    if (status === "!!") return "dim";
  }
  if (/\[active\]/.test(label) || /^(?:Clean|No changes)$/.test(label.trim())) return "success";
  if (/\[registered\]/.test(label)) return "muted";
  return classifyLine(label, false);
}

const HISTORY_STYLES: Record<string, { label: string; tone: Tone }> = {
  user: { label: "USER", tone: "accent" },
  assistant: { label: "ASSISTANT", tone: "success" },
  toolResult: { label: "TOOL", tone: "warning" },
  system: { label: "SYSTEM", tone: "muted" },
  bashExecution: { label: "SHELL", tone: "warning" },
  custom: { label: "CUSTOM", tone: "accent" },
  custom_message: { label: "CUSTOM", tone: "accent" },
  compaction: { label: "COMPACT", tone: "warning" },
  compactionSummary: { label: "COMPACT", tone: "warning" },
  branch_summary: { label: "SUMMARY", tone: "warning" },
  branchSummary: { label: "SUMMARY", tone: "warning" },
  model_change: { label: "MODEL", tone: "accent" },
  thinking_level_change: { label: "THINKING", tone: "accent" },
  context_edit: { label: "CONTEXT", tone: "muted" },
  usage: { label: "USAGE", tone: "dim" },
};

export function historyStyle(kind: string, error = false): { label: string; tone: Tone } {
  if (error) return { label: "ERROR", tone: "error" };
  return Object.hasOwn(HISTORY_STYLES, kind) ? { ...HISTORY_STYLES[kind] } : { label: plainText(kind).replace(/\s+/g, " ").toUpperCase(), tone: "dim" };
}

export function diffLines(text: string): { text: string; tone: Tone; gutter: string }[] {
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  return plainText(text).split("\n").map((line) => {
    let gutter = "";
    let tone = classifyLine(line, true);
    if (line.startsWith("@@")) {
      oldRemaining = newRemaining = 0;
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(line);
      if (hunk) {
        const oldStart = Number(hunk[1]);
        const newStart = Number(hunk[3]);
        const oldCount = Number(hunk[2] ?? 1);
        const newCount = Number(hunk[4] ?? 1);
        if ([oldStart, newStart, oldCount, newCount].every(Number.isSafeInteger)
          && (oldStart > 0 || oldCount === 0) && (newStart > 0 || newCount === 0)) {
          oldLine = oldStart;
          newLine = newStart;
          oldRemaining = oldCount;
          newRemaining = newCount;
        }
      }
    } else if (line.startsWith("diff ")) {
      oldRemaining = newRemaining = 0;
    } else if ((oldRemaining || newRemaining) && /^[ +\-]/.test(line)) {
      const oldUsed = line[0] !== "+";
      const newUsed = line[0] !== "-";
      if ((!oldUsed || oldRemaining > 0) && (!newUsed || newRemaining > 0)) {
        gutter = `${oldUsed ? String(oldLine).padStart(4) : "    "} ${newUsed ? String(newLine).padStart(4) : "    "}`;
        tone = line[0] === "+" ? "success" : line[0] === "-" ? "error" : "text";
        if (oldUsed) { oldLine++; oldRemaining--; }
        if (newUsed) { newLine++; newRemaining--; }
      } else {
        oldRemaining = newRemaining = 0;
      }
    } else if (!line.startsWith("\\ No newline at end of file")) {
      oldRemaining = newRemaining = 0;
    }
    return { text: line, tone, gutter };
  });
}
