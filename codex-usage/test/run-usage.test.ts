import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { runUsage } from "../run-usage.ts";

test("CLI execution and process-tree cleanup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-codex-usage-"));
  const previousPath = process.env.PATH;
  process.env.PATH = `${directory}:${previousPath}`;
  const executable = join(directory, "codex");
  const controller = new AbortController();
  try {
    await t.test("initializes app-server and reads rate limits", async () => {
      await writeFile(executable, `#!${process.execPath}
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), ['-s', 'read-only', '-a', 'never', 'app-server']);
let initialized = false;
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    process.stdout.write('startup diagnostic\\n');
    process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');
  } else if (request.method === 'initialized') {
    initialized = true;
  } else {
    assert.equal(initialized, true);
    assert.equal(request.method, 'account/rateLimits/read');
    const response = JSON.stringify({ id: request.id, result: { rateLimits: {
      primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: null }
    } } }) + '\\n';
    process.stdout.write(response.slice(0, 10));
    setTimeout(() => process.stdout.write(response.slice(10)), 10);
  }
});
`, { mode: 0o700 });
      assert.deepEqual(await runUsage(controller.signal), {
        stale: false,
        windows: [{ label: "5h", percentRemaining: 80, resetsAt: null }],
      });
    });

    await t.test("rejects RPC errors without exposing diagnostics", async () => {
      await writeFile(executable, `#!${process.execPath}\nprocess.stdin.once('data', () => console.log(JSON.stringify({ id: 1, error: { message: 'sensitive' } })));\n`, { mode: 0o700 });
      await assert.rejects(runUsage(controller.signal), { message: "Codex RPC failed" });
    });

    await t.test("rejects oversized output", async () => {
      await writeFile(executable, `#!${process.execPath}\nprocess.stdout.write('x'.repeat(300 * 1024)); setInterval(() => {}, 1000);\n`, { mode: 0o700 });
      await assert.rejects(runUsage(controller.signal), { message: "Codex response too large" });
    });

    await t.test("does not expose subprocess error output", async () => {
      await writeFile(executable, `#!${process.execPath}\nprocess.stderr.write('sensitive diagnostic'); process.exit(1);\n`, { mode: 0o700 });
      await assert.rejects(runUsage(controller.signal), { message: "Codex app-server exited" });
    });

    await t.test("abort terminates both CLI and its child", async () => {
      const pidFile = join(directory, "pids.json");
      await writeFile(executable, `#!${process.execPath}
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));
setInterval(() => {}, 1000);
`, { mode: 0o700 });
      const pending = runUsage(controller.signal);
      const rejected = assert.rejects(pending, { message: "Codex usage request aborted" });
      let pids: number[] = [];
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          pids = JSON.parse(await readFile(pidFile, "utf8"));
          break;
        } catch {
          await setTimeout(10);
        }
      }
      assert.equal(pids.length, 2);
      controller.abort();
      await rejected;
      for (const pid of pids) {
        let state = "";
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            state = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
          } catch {
            state = "";
          }
          if (!state || state.startsWith("Z")) break;
          await setTimeout(10);
        }
        assert.ok(!state || state.startsWith("Z"), `Process ${pid} still running: ${state}`);
      }
      await assert.rejects(async () => runUsage(controller.signal), { name: "AbortError" });
    });
  } finally {
    controller.abort();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});
