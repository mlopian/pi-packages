import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

export function editorInvocation(editor: string, path: string): [string, string[]] {
  if (!editor.trim()) throw new Error("Set $EDITOR to open files.");
  if (!isAbsolute(path) || path.includes("\0")) throw new Error("Invalid file path.");
  return ["/bin/sh", ["-c", `exec ${editor} "$@"`, "session-panel-editor", path]];
}

export async function openEditor(editor: string, path: string, cwd: string, signal: AbortSignal): Promise<void> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error("The selected path is not an existing file.");
  signal.throwIfAborted();
  const [command, args] = editorInvocation(editor, path);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", signal });
    let error: Error | undefined;
    child.once("error", (cause) => { error = cause; });
    child.once("close", (code) => {
      if (error) reject(error);
      else if (code === 0) resolve();
      else reject(new Error(`Editor exited with status ${code ?? "signal"}.`));
    });
  });
}
