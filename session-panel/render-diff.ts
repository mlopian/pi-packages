import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { plainText } from "./data.ts";
import { diffLines } from "./presentation.ts";

export function renderDiff(text: string, width: number, theme: Theme): string[] {
  if (width < 6) return [truncateToWidth("Diff", width)];
  const inner = width - 4;
  const clean = plainText(text);
  const preview = clean.length > 200_000 ? `${clean.slice(0, 200_000)}\n[Preview truncated at 200,000 characters]` : clean;
  const source = diffLines(preview);
  const added = source.filter((line) => line.tone === "success").length;
  const removed = source.filter((line) => line.tone === "error").length;
  const title = truncateToWidth(" Diff ", width - 2, "");
  const row = (content: string) => {
    const clipped = truncateToWidth(content, inner);
    return theme.fg("border", "│ ") + clipped + " ".repeat(Math.max(0, inner - visibleWidth(clipped))) + theme.fg("border", " │");
  };
  const lines = [theme.fg("success", "╭" + title + "─".repeat(Math.max(0, width - 2 - visibleWidth(title))) + "╮"),
    row(theme.fg("success", `+${added}`) + theme.fg("muted", " / ") + theme.fg("error", `-${removed}`) + theme.fg("dim", "  current Git changes"))];
  const numbered = inner >= 35;
  if (numbered) lines.push(row(theme.fg("dim", " OLD  NEW │ CODE")));
  for (const line of source) {
    const changed = line.tone === "success" || line.tone === "error";
    const gutter = numbered ? (line.gutter || "         ") + " │ " : "";
    const gutterWidth = visibleWidth(gutter);
    const contentWidth = Math.max(1, inner - gutterWidth);
    const parts = wrapTextWithAnsi(line.text, contentWidth);
    const numberColor = line.tone === "success" ? "toolDiffAdded" : line.tone === "error" ? "toolDiffRemoved" : "dim";
    for (let index = 0; index < parts.length; index++) {
      const margin = index ? " ".repeat(gutterWidth) : gutter;
      const code = theme.fg(changed ? "text" : line.tone, parts[index]);
      const content = theme.fg(numberColor, margin) + code;
      const padded = content + " ".repeat(Math.max(0, inner - visibleWidth(content)));
      lines.push(row(changed ? theme.bg(line.tone === "success" ? "toolSuccessBg" : "toolErrorBg", padded) : padded));
    }
  }
  lines.push(theme.fg("success", "╰" + "─".repeat(width - 2) + "╯"));
  return lines;
}
