import { getMarkdownTheme, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Card } from "./dashboard.ts";
import { plainText } from "./data.ts";

export function renderCards(cards: Card[], width: number, theme: Theme): string[] {
  if (width < 6) return [truncateToWidth("Resize", width)];
  const inner = width - 4;
  const lines: string[] = [];
  let remaining = 200_000;
  let truncationShown = false;
  const previewText = (value: string) => {
    const text = plainText(value);
    const preview = text.slice(0, remaining);
    remaining -= preview.length;
    if (preview.length === text.length || truncationShown) return preview;
    truncationShown = true;
    return `${preview}\n[Preview truncated at 200,000 characters]`;
  };
  for (const card of cards) {
    const tone = card.tone;
    const title = truncateToWidth(` ${plainText(card.title).replace(/\s+/g, " ")} `, width - 2, "");
    const edge = (left: string, right: string) => theme.fg(tone, left + "─".repeat(width - 2) + right);
    const row = (text: string) => {
      const clipped = truncateToWidth(text, inner);
      return theme.fg(tone, "│ ") + clipped + " ".repeat(Math.max(0, inner - visibleWidth(clipped))) + theme.fg(tone, " │");
    };
    const labelWidth = Math.min(24, Math.max(8, Math.floor(inner * 0.3)), Math.max(0, inner - 8));
    const label = (value: string) => {
      const text = truncateToWidth(plainText(value).replace(/\s+/g, " "), labelWidth, "");
      return theme.fg("muted", text + " ".repeat(Math.max(0, labelWidth - visibleWidth(text))) + "  ");
    };
    const bar = (percent: number | null, length: number, color: Card["tone"]) => {
      const count = percent === null || !Number.isFinite(percent) ? 0 : Math.round(Math.min(100, Math.max(0, percent)) * length / 100);
      return theme.fg(color, "█".repeat(count)) + theme.fg("dim", "░".repeat(length - count));
    };
    lines.push(theme.fg(tone, "╭") + theme.bold(theme.fg(tone, title)) + theme.fg(tone, "─".repeat(Math.max(0, width - 2 - visibleWidth(title))) + "╮"));
    for (const field of card.fields ?? []) {
      const prefix = label(field.label);
      const valueWidth = Math.max(1, inner - visibleWidth(prefix));
      const values = previewText(field.value).split("\n").flatMap((part) => wrapTextWithAnsi(theme.fg(field.tone ?? "text", part), valueWidth));
      values.forEach((value, index) => lines.push(row((index ? " ".repeat(visibleWidth(prefix)) : prefix) + value)));
    }
    if (card.meter) {
      const meter = card.meter;
      const prefix = label(meter.label);
      const length = Math.max(1, Math.min(28, Math.floor((inner - visibleWidth(prefix)) * 0.45)));
      const caption = theme.fg(tone, ` ${meter.percent === null ? "?" : Math.round(meter.percent)}%`) + theme.fg("muted", ` ${plainText(meter.value)}`);
      lines.push(row(prefix + bar(meter.percent, length, tone) + caption));
    }
    if (card.bars?.length) {
      const maximum = Math.max(1, ...card.bars.map((item) => item.value));
      for (const item of card.bars) {
        const prefix = label(item.label);
        const length = Math.max(1, Math.min(36, Math.floor((inner - visibleWidth(prefix)) * 0.65)));
        lines.push(row(prefix + bar(item.value / maximum * 100, length, tone) + theme.fg("muted", ` ${plainText(item.suffix ?? String(item.value))}`)));
      }
    }
    if (!card.fields?.length && !card.bars?.length && !card.text && !card.meter) lines.push(row(theme.fg("muted", "No data recorded")));
    if (card.text) {
      if (card.fields?.length || card.meter || card.bars?.length) lines.push(row(""));
      const preview = previewText(card.text);
      const content = card.language ? highlightCode(preview, card.language).flatMap((line) => wrapTextWithAnsi(line, inner))
        : new Markdown(preview, 0, 0, getMarkdownTheme()).render(inner);
      lines.push(...content.map(row));
    }
    lines.push(edge("╰", "╯"), "");
  }
  return lines.length ? lines.slice(0, -1) : [theme.fg("muted", "No data recorded")];
}
