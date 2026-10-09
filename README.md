# pi-packages

Pi extensions.

| Extension | What it does |
| --- | --- |
| [`codex-usage`](codex-usage/) | Colored bars above the prompt with remaining Codex subscription limits and time to reset |
| [`session-panel`](session-panel/) | `/session-panel`: session dashboard with section cards, usage charts, readable history, full-row Git diffs and `$EDITOR` access |

## Install

```sh
pi install git:github.com/mlopian/pi-packages
```

From the root of a local clone: `pi install .`

Requires macOS/Linux and Pi. `codex-usage` additionally requires `codex` on PATH,
authenticated with `codex login`. `session-panel` uses Git when available and
`$EDITOR` for opening files.
Run `/reload` in Pi after installing. `/codex-usage` refreshes the displayed limits;
`/session-panel` opens the session dashboard.

## Test

With Node.js 22.6 or newer, run from the repository root:

```sh
npm test
```
