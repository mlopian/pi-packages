# pi-packages

Pi extensions.

| Extension | What it does |
| --- | --- |
| [`codex-usage`](codex-usage/) | Colored bars above the prompt with remaining Codex subscription limits and time to reset |

## Install

```sh
pi install git:github.com/mlopian/pi-packages
```

From the root of a local clone: `pi install .`

Requires macOS/Linux, Pi and `codex` on PATH, authenticated with `codex login`.
Run `/reload` in Pi after installing. `/codex-usage` refreshes the displayed limits.

## Test

With Node.js 22.6 or newer, run from the repository root:

```sh
npm test
```
