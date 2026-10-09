# Session panel

Run `/session-panel` in interactive Pi to inspect the current session without making a model request.
Session, Stats, Context, Tools and Settings open as dashboards with colored section cards,
aligned labels, context/cache meters and tool/response-duration charts. History separates messages,
thinking, tool input and results instead of dumping JSON. Raw data remains available with `j`.
Wide browsing views show a list and preview side by side; narrow terminals stack them.
Requires Pi 1.1.0 or a compatible extension API, macOS/Linux, and optional Git on PATH.

## Install

Install all extensions in this repository:

```sh
pi install git:github.com/mlopian/pi-packages
```

Or run `pi install .` from the repository root. Run `/reload` after installation or changes.

## Tabs

- Session: name, ID, creation metadata, storage, cwd, parent session, tree, trust and runtime state.
- Stats (Model / Usage): recorded token/cost totals, cache share, context estimate, last ten recorded assistant response durations and ten most used tools. Browse exposes model capabilities, thinking, scoped models and usage grouped by model and operation.
- Context: effective system prompt, prompt construction, context files, available skill metadata, projected messages, summaries and context edits.
- History: readable cards for prompts, responses, recorded thinking, tool input, results, errors and nested call records. Tool results include their original input, matched by call ID and name in the entry's ancestry; Bash inputs show the executed command. Missing source calls show an unavailable notice. Raw entries are optional.
  Leading colored badges distinguish USER (accent), ASSISTANT (green), TOOL/SHELL (yellow),
  SYSTEM (muted), summaries (yellow) and model/thinking changes (accent). Failed or aborted
  responses, failed tool results and failed/cancelled shell executions have red ERROR badges.
  Badges remain colored when selected and appear in expanded detail headings.
- Session files: successful recorded edit/write calls, successful nested calls, and modified-file lists from summaries.
- Git: repository, branch, HEAD, upstream, status, files and recent commits; diff preview for selected files.
- Tools: registered tools, active declarations, schemas, exposure, source and extension MCP registrations.
- Settings: merged settings, theme and available extension/skill/prompt slash commands.

## Keys

| Key | Action |
| --- | --- |
| Tab / Shift+Tab or Left / Right | Next / previous tab |
| 1-8 | Jump to a tab |
| Up / Down | Scroll a dashboard/details or select a browsing row |
| Enter | Expand the selected preview or file diff |
| PageUp / PageDown / Home / End | Scroll dashboards and expanded details |
| v | Switch between dashboard and browsing view where available |
| j | Show the selected row as Raw, or return to formatted cards |
| e | Open the selected file in the external editor |
| d | Expand selected Git/session file's current staged and unstaged diffs |
| b | Switch between active-branch and whole-session accounting/history/files |
| r | Refresh the snapshot and Git |
| Esc | Back from details, then close |

Footer hints follow the tab, selected row and view. Dashboards scroll directly; `v` opens the
browsing list for selecting individual sources or metadata. Raw and editor actions are hidden
until a row is visibly selected. Editor appears only for file rows;
diff only for Git/session-file rows not already showing an expanded diff. Scope appears only
in Session, Model / Usage, Context, History and Session files. Expanded details replace Enter
with scrolling hints. Hidden unavailable actions are ignored. Narrow terminals omit whole
hint items rather than cutting key labels in half.

Selecting a file in Git or Session files automatically loads its current Git diff. Additions are
shown on full-width themed green backgrounds, deletions on red backgrounds, hunk headers
highlighted, and wide previews include old/new line numbers. Code remains readable on both backgrounds.
Untracked files are compared with an empty file. Enter expands the diff for vertical scrolling;
long diff lines wrap to terminal width, including their change backgrounds. Selection changes and closing the panel cancel
pending previews. Session-file previews show current Git changes, not changes since session start.

Data is a snapshot, refreshed explicitly with `r`. Model context always follows the active branch,
even when viewing whole-session history. Changing branches in Pi does not revert files on disk.
Formatted previews use aligned fields, Markdown and syntax-highlighted shell inputs. Only
explicit Raw mode uses JSON syntax highlighting for serialized metadata. Colors follow Pi's
active theme and are preserved when lines wrap. Large previews are capped at 200,000 characters
with a truncation notice. Structured object previews show up to 60 fields and four nesting levels;
Raw preserves the serialized structure.
Git subprocesses are limited to 5 seconds and 512 KiB of output each. Failed or oversized
status/diff requests show an unavailable notice without closing the panel.

## External editor

Set `EDITOR`, for example `EDITOR='nvim'` or `EDITOR='code --wait'`.
Fallbacks are Pi's `externalEditor` setting, then `VISUAL`. There is no implicit editor default.
The terminal is released while the editor runs and restored when it exits. GUI editors need
an appropriate wait flag. Editor commands are trusted shell configuration; file paths are
passed separately as literal arguments. Only existing regular files can be opened.
Opening a file permits editing it, including the session JSONL itself; modifying session storage
manually can corrupt it; opening the current session JSONL requires confirmation.
Deleted files can still appear in history or Git but cannot be opened.

## Limits and privacy

This is a local inspector, not an upload/export tool. Common credential configuration fields,
MCP environment values and headers are redacted, but arbitrary prompts, tool outputs, shell
commands, file contents and URLs can contain secrets. Do not share panel screenshots blindly.
No authentication file or complete process environment is read.

Session files are inferred from successful tool results and summary metadata. This is not an
audit of every filesystem mutation: shell commands, custom tools, omitted nested records and
external editors may be missing. Failed tools can also partially modify files. The list is not
a diff from the start of the session. Git displays the current worktree, including changes made
before the session or by other processes; committed changes no longer appear in status.

Usage is recorded token/cost data, not subscription quota or invoice cost. Summary/tool usage
without model attribution is shown separately. Context token counts are estimates and may
be unknown after compaction. Session projections precede request hooks. MCP registrations
are not a complete list of configured servers or live connection states. Built-in slash commands
are not included by Pi's extension command-list API. Queue contents and prior operation timings
not recorded in history are unavailable.

## Test

From the repository root, run `npm test`, or `npm --prefix session-panel test`.
The render/cancellation integration test uses the installed `pi` CLI in RPC mode without a
model request. It reports a skip if Pi is not on PATH. Pure data, diff and editor tests do not
need the Pi runtime. Rendering assertions cover narrow/wide terminals, short heights, Unicode,
theme invalidation, dashboard/expanded scrolling, Raw toggling, structured messages and
cancellation of stale/disposed diff previews.
For a loading check without a model request:

```sh
pi --no-extensions -e /path/to/pi-packages --help
```

For visual checks, run `/session-panel` in both regular and fullscreen Pi, navigate each tab,
open and scroll details, resize the terminal, refresh, inspect diffs, and open a disposable file
with a terminal editor and a GUI editor configured with its wait flag.
