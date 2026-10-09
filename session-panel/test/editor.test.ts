import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editorInvocation, openEditor } from "../editor.ts";

test("requires an editor and an absolute safe path", () => {
  assert.throws(() => editorInvocation(" ", "/tmp/file"));
  assert.throws(() => editorInvocation("vi", "relative"));
  assert.throws(() => editorInvocation("vi", "/tmp/\0"));
  assert.deepEqual(editorInvocation("code --wait", "/tmp/a b"), ["/bin/sh", ["-c", 'exec code --wait "$@"', "session-panel-editor", "/tmp/a b"]]);
});

test("passes shell metacharacters in file names as a single literal argument", async () => {
  const directory = await mkdtemp(join(tmpdir(), "session-panel-editor-"));
  try {
    const file = join(directory, "a b; touch INJECTED");
    const output = join(directory, "received");
    const script = join(directory, "editor.cjs");
    await writeFile(file, "content");
    await writeFile(script, 'require("node:fs").writeFileSync(process.argv[2], process.argv[3]);');
    await openEditor(`${JSON.stringify(process.execPath)} ${JSON.stringify(script)} ${JSON.stringify(output)}`, file, directory, new AbortController().signal);
    assert.equal(await readFile(output, "utf8"), file);
    await assert.rejects(readFile(join(directory, "INJECTED")));
    await assert.rejects(openEditor("true", join(directory, "missing"), directory, new AbortController().signal));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(openEditor("true", file, directory, controller.signal));
    await assert.rejects(openEditor("false", file, directory, new AbortController().signal));
    const running = new AbortController();
    const timeout = setTimeout(() => running.abort(), 50);
    try {
      await assert.rejects(openEditor(`${JSON.stringify(process.execPath)} -e 'setInterval(() => {}, 1000)'`, file, directory, running.signal), { name: "AbortError" });
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
