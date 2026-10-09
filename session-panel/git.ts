import { execFile } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type GitData = {
  root?: string;
  lines: string[];
  files: { path: string; label: string }[];
};

function git(cwd: string, args: string[], signal?: AbortSignal, allowedCodes: number[] = []): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile("git", ["--no-pager", "--literal-pathspecs", ...args], {
      cwd,
      signal,
      timeout: 5000,
      maxBuffer: 512 * 1024,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    }, (error, stdout) => {
      if (!error || (typeof error.code === "number" && allowedCodes.includes(error.code) && !error.killed)) {
        resolveOutput(stdout);
      } else if (signal?.aborted || error.name === "AbortError") {
        reject(Object.assign(new Error("Git request aborted"), { name: "AbortError" }));
      } else {
        reject(new Error("Git command failed or exceeded its limits"));
      }
    });
  });
}

async function optionalGit(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  try {
    return await git(cwd, args, signal);
  } catch (error) {
    if (signal?.aborted || (error as Error).name === "AbortError") throw error;
    return "";
  }
}

export async function readGit(cwd: string, signal?: AbortSignal): Promise<GitData> {
  const root = (await optionalGit(cwd, ["rev-parse", "--show-toplevel"], signal)).replace(/\n$/, "");
  if (!root) return { lines: ["Not a Git working tree"], files: [] };

  const [branch, head, upstream, status, log] = await Promise.all([
    optionalGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal),
    optionalGit(root, ["rev-parse", "--verify", "HEAD"], signal),
    optionalGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], signal),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], signal),
    optionalGit(root, ["log", "-12", "--format=%h %s", "--no-decorate"], signal),
  ]);
  const lines = [
    `Repository: ${root}`,
    `Branch: ${branch.trimEnd() || "(detached)"}`,
    `HEAD: ${head.trimEnd() || "(no commits)"}`,
    `Upstream: ${upstream.trimEnd() || "(none)"}`,
  ];
  if (upstream) {
    const counts = (await optionalGit(root, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], signal)).trim().split(/\s+/);
    if (counts.length === 2) lines.push(`Ahead: ${counts[0]}, behind: ${counts[1]}`);
  }

  const files: GitData["files"] = [];
  const entries = status.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const state = entry.slice(0, 2);
    const path = entry.slice(3);
    const original = /[RC]/.test(state) ? entries[++i] : undefined;
    const label = `${state} ${original === undefined ? "" : `${JSON.stringify(original)} -> `}${JSON.stringify(path)}`;
    files.push({ path: resolve(root, path), label });
  }
  lines.push("", "Status:", ...(files.length ? files.map((file) => file.label) : ["Clean"]));
  lines.push("", "Log:", ...(log ? log.trimEnd().split("\n") : ["No commits"]));
  return { root, lines, files };
}

export async function readGitDiff(cwd: string, file: string, signal?: AbortSignal): Promise<string> {
  const root = (await optionalGit(cwd, ["rev-parse", "--show-toplevel"], signal)).replace(/\n$/, "");
  if (!root) return "Not a Git working tree";
  const path = relative(root, file);
  if (!isAbsolute(file) || !path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    return "File is outside the Git working tree";
  }
  const tracked = await git(root, ["ls-files", "-z", "--", path], signal);
  const diffArgs = ["--no-ext-diff", "--no-textconv", "--no-color"];
  if (!tracked) {
    return await git(root, ["diff", "--no-index", ...diffArgs, "--", process.platform === "win32" ? "NUL" : "/dev/null", file], signal, [1]) || "No changes";
  }
  const [staged, unstaged] = await Promise.all([
    git(root, ["diff", "--cached", ...diffArgs, "--", path], signal),
    git(root, ["diff", ...diffArgs, "--", path], signal),
  ]);
  return [staged && `Staged:\n${staged}`, unstaged && `Unstaged:\n${unstaged}`].filter(Boolean).join("\n") || "No changes";
}
