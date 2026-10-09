import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

let pi: string | undefined;
try {
  pi = execFileSync("which", ["pi"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {}

test("renders framed previews and cancels stale diff loads through the installed Pi runtime", { skip: !pi && "Pi CLI is not installed" }, () => {
  const cwd = mkdtempSync(join(tmpdir(), "session-panel-ui-"));
  try {
    const result = spawnSync(pi!, ["--no-extensions", "--no-session", "--mode", "rpc", "-e", fileURLToPath(new URL("./fixtures/render-check.ts", import.meta.url))], {
      cwd,
      input: "",
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 512 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0);
    assert.ok((result.stdout + result.stderr).includes("PANEL_RENDER_CHECK_PASSED"), "Pi did not complete the rendering assertions");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
