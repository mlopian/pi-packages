import { highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, ScrollView, SelectList, sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import { plainText, type PanelTab } from "./data.ts";
import { historyStyle, rowTone } from "./presentation.ts";
import { readableCards } from "./readable.ts";
import { renderCards } from "./render-cards.ts";
import { renderDiff } from "./render-diff.ts";

const singleLine = (text: string) => plainText(text).replace(/\s+/g, " ");

export interface PanelState {
  tab: number;
  selected: number;
  wholeSession: boolean;
  dashboard?: boolean;
  detail?: string;
  detailIsDiff?: boolean;
  raw?: boolean;
  detailScroll?: number;
}

export type PanelAction = { type: "close" | "refresh" | "scope" } | { type: "edit" | "diff"; path: string };

export class SessionPanel {
  private list?: SelectList;
  private listHeight = 0;
  private scroll: ScrollView;
  private layout?: { width: number; key: unknown; raw: boolean; lines: string[] };
  private previewPath?: string;
  private preview = "";
  private previewController?: AbortController;
  private disposed = false;

  constructor(private tabs: PanelTab[], private state: PanelState, private tui: TUI, private theme: Theme,
    private done: (action: PanelAction) => void,
    private loadDiff: (path: string, signal: AbortSignal) => Promise<string>) {
    this.scroll = new ScrollView({ render: (width) => this.content(width), invalidate() {} }, { scrollbar: "hidden" });
    this.updatePreview();
  }

  private current() { return this.tabs[this.state.tab].rows[this.state.selected]; }
  private overview() { return this.state.detail === undefined && (this.state.dashboard ?? true) && !!this.tabs[this.state.tab].cards?.length; }
  private scrolling() { return this.state.detail !== undefined || this.overview(); }

  private updatePreview() {
    const row = this.current();
    const path = !this.overview() && row?.diff ? row.path : undefined;
    if (this.disposed || path === this.previewPath) return;
    this.previewController?.abort();
    this.previewPath = path;
    this.preview = "";
    if (!path) return;
    const controller = new AbortController();
    this.previewController = controller;
    this.preview = "Loading Git diff...";
    const isCurrentPreview = () => !controller.signal.aborted && !this.disposed && this.previewController === controller;
    void this.loadDiff(path, controller.signal).then((text) => {
      if (isCurrentPreview()) this.preview = text;
    }).catch(() => {
      if (isCurrentPreview()) this.preview = "Diff unavailable: not a readable Git file, timeout or output limit.";
    }).finally(() => {
      if (!isCurrentPreview()) return;
      if (this.state.detailIsDiff && this.state.detail !== undefined) this.state.detail = this.preview;
      this.layout = undefined;
      this.tui.requestRender();
    });
  }

  private content(width: number): string[] {
    const row = this.current();
    const raw = this.state.raw ?? false;
    const diff = this.state.detail !== undefined ? this.state.detailIsDiff : row?.diff;
    const text = this.state.detail ?? (diff ? this.preview : row?.detail ?? row?.label ?? "No entries");
    const cards = this.overview() ? this.tabs[this.state.tab].cards! : row?.cards;
    const key = !raw && !diff && cards ? cards : text;
    const cached = this.layout;
    if (cached?.width === width && cached.key === key && cached.raw === raw) return cached.lines;
    let lines: string[];
    if (raw) {
      const clean = plainText(text);
      const preview = clean.length > 200_000 ? `${clean.slice(0, 200_000)}\n[Preview truncated at 200,000 characters]` : clean;
      let json = false;
      try { JSON.parse(clean); json = true; } catch {}
      lines = (json ? highlightCode(preview, "json") : preview.split("\n")).flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width)));
    } else if (diff) lines = [
      ...(row?.path ? [...renderCards([{ title: "File", tone: "accent", fields: [{ label: "Path", value: row.path, tone: "accent" }] }], width, this.theme), ""] : []),
      ...renderDiff(text, width, this.theme),
    ];
    else lines = renderCards(cards ?? readableCards(row?.label ?? "Details", text), width, this.theme);
    this.layout = { width, key, raw, lines };
    return lines;
  }

  private selectTab(tab: number) {
    this.state.tab = tab;
    this.state.selected = Math.max(0, this.tabs[tab].rows.findIndex((row) => row.diff));
    this.state.dashboard = true;
    this.resetDetail();
    this.invalidate();
    this.updatePreview();
  }

  private resetDetail() {
    this.state.detail = undefined;
    this.state.detailIsDiff = false;
    this.state.raw = false;
    this.state.detailScroll = 0;
    this.scroll.scrollToStart();
  }

  private finish(action: PanelAction) { this.dispose(); this.done(action); }

  private actions() {
    const row = this.current();
    return {
      expand: !this.scrolling() && !!row,
      edit: !this.overview() && !!row?.path,
      diff: !this.overview() && !!row?.diff && !!row.path && !this.state.detailIsDiff,
      raw: !this.overview() && !!row && !row.diff,
      view: this.state.detail === undefined && !!this.tabs[this.state.tab].cards?.length,
      scope: ["Session", "Model / Usage", "Context", "History", "Session files"].includes(this.tabs[this.state.tab].name),
    };
  }

  private hints(width: number) {
    const actions = this.actions();
    const hint = (key: string, label: string) => this.theme.fg("accent", key) + this.theme.fg("muted", ` ${label}`);
    const navigation = [hint(`Tab/1-${this.tabs.length}`, "tabs")];
    if (this.scrolling()) navigation.push(hint("Up/Down", "scroll"), hint("PgUp/PgDn", "page"), hint("Home/End", "ends"));
    else {
      if (actions.expand) navigation.push(hint("Enter", "open"));
      if (this.tabs[this.state.tab].rows.length > 1) navigation.push(hint("Up/Down", "select"));
    }
    const operations = [hint("Esc", this.state.detail !== undefined ? "back" : "close"), hint("r", "refresh")];
    if (actions.view) operations.push(hint("v", this.overview() ? "browse" : "dashboard"));
    if (actions.edit) operations.push(hint("e", "editor"));
    if (actions.diff) operations.push(hint("d", "diff"));
    if (actions.raw) operations.push(hint("j", this.state.raw ? "formatted" : "Raw"));
    if (actions.scope) operations.push(hint("b", "scope"));
    return [navigation, operations].map((items) => items.reduce((line, item) => {
      const next = line ? `${line}  ${item}` : item;
      return visibleWidth(next) <= width ? next : line;
    }, ""));
  }

  handleInput(data: string) {
    if (this.disposed) return;
    const actions = this.actions();
    if (matchesKey(data, "escape")) {
      if (this.state.detail !== undefined) { this.resetDetail(); this.invalidate(); this.updatePreview(); }
      else this.finish({ type: "close" });
    } else if (matchesKey(data, "tab") || matchesKey(data, "right") || matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
      const reverse = matchesKey(data, "shift+tab") || matchesKey(data, "left");
      this.selectTab((this.state.tab + (reverse ? -1 : 1) + this.tabs.length) % this.tabs.length);
    } else if (/^[1-8]$/.test(data) && Number(data) <= this.tabs.length) this.selectTab(Number(data) - 1);
    else if (data === "r") this.finish({ type: "refresh" });
    else if (data === "b" && actions.scope) this.finish({ type: "scope" });
    else if (data === "e" && actions.edit) this.finish({ type: "edit", path: this.current()!.path! });
    else if (data === "d" && actions.diff) this.finish({ type: "diff", path: this.current()!.path! });
    else if (data === "v" && actions.view) {
      this.state.dashboard = !this.overview();
      this.resetDetail();
      this.invalidate();
      this.updatePreview();
    } else if (data === "j" && actions.raw) {
      this.state.detail = this.current()?.detail ?? this.current()!.label;
      this.state.raw = !this.state.raw;
      this.state.detailIsDiff = false;
      this.state.detailScroll = 0;
      this.layout = undefined;
      this.scroll.scrollToStart();
    } else if (this.scrolling()) {
      const height = this.scroll.viewportHeight;
      if (matchesKey(data, "down")) this.scroll.scrollBy(1);
      else if (matchesKey(data, "up")) this.scroll.scrollBy(-1);
      else if (matchesKey(data, "pageDown")) this.scroll.scrollBy(height);
      else if (matchesKey(data, "pageUp")) this.scroll.scrollBy(-height);
      else if (matchesKey(data, "home")) this.scroll.scrollToStart();
      else if (matchesKey(data, "end")) this.scroll.scrollToEnd();
    } else this.list?.handleInput(data);
    if (!this.disposed) this.tui.requestRender();
  }

  private selection(height: number) {
    if (this.list && this.listHeight === height) return;
    this.listHeight = height;
    const rows = this.tabs[this.state.tab].rows;
    this.list = new SelectList(rows.map((row, index) => ({
      value: String(index), label: (row.kind ? `[${historyStyle(row.kind, row.error).label}] ` : "") + singleLine(row.label),
    })), height, {
      selectedPrefix: () => this.theme.fg("accent", "> "),
      selectedText: (text) => this.theme.style(text, { fg: "text", bg: "selectedBg", bold: true }),
      description: (text) => this.theme.fg("muted", text), scrollInfo: (text) => this.theme.fg("dim", text), noMatch: (text) => this.theme.fg("muted", text),
    }, { truncatePrimary: ({ text, maxWidth, item, isSelected }) => {
      const row = rows[Number(item.value)];
      const clipped = truncateToWidth(text, maxWidth);
      if (!row.kind) return isSelected ? clipped : this.theme.fg(rowTone(row.label), clipped);
      const style = historyStyle(row.kind, row.error);
      const badge = truncateToWidth(`[${style.label}]`, maxWidth);
      return this.theme.bold(this.theme.fg(style.tone, badge)) + this.theme.fg(isSelected ? "text" : "muted", sliceByColumn(clipped, visibleWidth(badge), maxWidth));
    } });
    this.state.selected = Math.min(this.state.selected, Math.max(0, rows.length - 1));
    this.list.setSelectedIndex(this.state.selected);
    this.updatePreview();
    this.list.onSelectionChange = (item) => { this.state.selected = Number(item.value); this.layout = undefined; this.updatePreview(); };
    this.list.onSelect = () => {
      const row = this.current();
      if (!row) return;
      this.state.detail = row.diff ? this.preview : row.detail ?? row.label;
      this.state.detailIsDiff = row.diff ?? false;
      this.state.raw = false;
      this.state.detailScroll = 0;
      this.layout = undefined;
      this.scroll.scrollToStart();
    };
  }

  private tabStrip(width: number) {
    const labels = ["Session", "Stats", "Context", "History", "Files", "Git", "Tools", "Settings"];
    const items = this.tabs.map((tab, index) => ({ index, text: `[${index + 1} ${labels[index] ?? tab.name}]` }));
    let start = 0;
    while (start < this.state.tab && visibleWidth(items.slice(start, this.state.tab + 1).map((item) => item.text).join(" ")) > width - 4) start++;
    return (start ? this.theme.fg("dim", "< ") : "") + items.slice(start).map((item) => item.index === this.state.tab
      ? this.theme.style(item.text, { fg: "accent", bg: "selectedBg", bold: true }) : this.theme.fg("muted", item.text)).join(" ");
  }

  render(width: number): string[] {
    if (width < 24 || this.tui.terminal.rows < 14) return ["SESSION PANEL", "Resize terminal", this.state.detail !== undefined ? "Esc back" : "Esc close"].slice(0, Math.max(1, this.tui.terminal.rows)).map((line) => truncateToWidth(line, width));
    const height = Math.max(1, this.tui.terminal.rows - 8);
    const rule = this.theme.fg("borderMuted", "─".repeat(width));
    let body: string[];
    if (this.scrolling()) {
      this.scroll.updateLayout(this.content(width).length, height, () => this.tui.requestRender());
      if (this.state.detailScroll !== undefined) { this.scroll.scrollTo(this.state.detailScroll); this.state.detailScroll = undefined; }
      body = this.scroll.render(width).slice(this.scroll.scrollTop, this.scroll.scrollTop + height);
    } else {
      const split = width >= 98;
      const listWidth = split ? Math.max(28, Math.floor(width * 0.33)) : width;
      const listHeight = split ? height : Math.max(2, Math.floor(height * 0.32));
      this.selection(Math.max(1, listHeight - 1));
      const list = this.list!.render(listWidth);
      const previewWidth = split ? width - listWidth - 3 : width;
      const preview = this.content(previewWidth);
      if (split) {
        body = [];
        for (let index = 0; index < height; index++) {
          const left = truncateToWidth(list[index] ?? "", listWidth);
          body.push(left + " ".repeat(Math.max(0, listWidth - visibleWidth(left))) + this.theme.fg("borderMuted", " │ ") + (preview[index] ?? ""));
        }
      } else body = [...list.slice(0, listHeight), this.theme.fg("borderMuted", "─".repeat(width)), ...preview.slice(0, Math.max(1, height - listHeight - 1))];
    }
    return [this.theme.bold(this.theme.fg("accent", "SESSION PANEL")) + this.theme.fg("muted", ` / ${this.tabs[this.state.tab].name} / ${this.state.wholeSession ? "whole session" : "active branch"}${this.state.raw ? " / Raw" : ""}`),
      this.tabStrip(width), rule, ...body, rule, ...this.hints(width), this.theme.fg("dim", "Local data may contain secrets. Git diffs are not a session baseline."),
    ].map((line) => truncateToWidth(line, width));
  }

  invalidate() { this.list = undefined; this.layout = undefined; this.scroll.invalidate(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.previewController?.abort();
    if (this.scrolling() && this.state.detailScroll === undefined) this.state.detailScroll = this.scroll.scrollTop;
    this.scroll.setScrollbarActive(false);
  }
}
