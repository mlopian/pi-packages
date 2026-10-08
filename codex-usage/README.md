# Pi Codex usage

Shows Codex subscription limits above the prompt: 10-cell colored bars, percentage remaining and reset countdowns. It does not replace the footer, so pi-statusline keeps working.

## Install

Requires macOS/Linux, Pi and `codex` on PATH. Authenticate Codex using `codex login`.

```sh
pi install git:github.com/mlopian/pi-packages
```

From the repository root of a local clone: `pi install .`

Run `/reload` in Pi, or start a new session.

## Behavior

- Loads immediately without blocking startup.
- Updates every minute and after an agent run. Every refresh reads live limits directly from `codex app-server`.
- `/codex-usage` refreshes live limits.
- Green: more than 50% remaining. Yellow: more than 20%. Red: 20% or less.
- Failed reads preserve the previous limits with a visible `[stale]` marker.
- Runs only in the terminal UI, not RPC, print or JSON mode.
- Cleans up its timer and terminates the Codex app-server process group on shutdown/reload or a 35-second timeout.
- Credentials remain managed by Codex CLI. Nothing is added to the conversation or model context.

This reports the account logged into Codex CLI, which may differ from the account logged into Pi.

## Troubleshooting

- If `codex` is not found, install the Codex CLI and ensure `codex --version` works in the same shell used to start Pi.
- If authentication is missing or expired, run `codex login`, then `/codex-usage` in Pi.
- If limits are unavailable or marked `[stale]`, run `/codex-usage` to retry. Check that the account logged into Codex CLI has subscription limits; Pi's model credentials are not used for this widget.
- If the widget is missing, run `/reload` and make sure Pi is running in the terminal UI, not print, JSON or RPC mode.

## Test

With Node.js 22.6 or newer, run from the repository root or the `codex-usage` directory:

```sh
npm test
```
