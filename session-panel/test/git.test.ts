import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readGit, readGitDiff } from "../git.ts";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "session-panel-git-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Git Test");
  git("config", "user.email", "git-test@example.invalid");
  git("config", "commit.gpgsign", "false");
  await writeFile(join(root, "original name.txt"), "original\n");
  await writeFile(join(root, "both.txt"), "base\n");
  git("add", ".");
  git("commit", "-m", "Initial commit");
  return { root, git };
}

test("status parses rename destinations, spaces, staged, unstaged and untracked files", async (t) => {
  const { root, git } = await fixture(t);
  git("mv", "original name.txt", "renamed file.txt");
  await writeFile(join(root, "both.txt"), "base\nstaged\n");
  git("add", "both.txt");
  await writeFile(join(root, "both.txt"), "base\nstaged\nunstaged\n");
  await writeFile(join(root, "untracked space.txt"), "new\n");
  await mkdir(join(root, "nested"));
  const result = await readGit(join(root, "nested"));
  assert.equal(result.root, root);
  assert.deepEqual(result.files.map((file) => file.path).sort(), ["both.txt", "renamed file.txt", "untracked space.txt"].map((file) => join(root, file)).sort());
  assert.equal(result.files.find((file) => file.path.endsWith("renamed file.txt"))?.label, 'R  "original name.txt" -> "renamed file.txt"');
  assert.equal(result.files.find((file) => file.path.endsWith("both.txt"))?.label, 'MM "both.txt"');
  assert.equal(result.files.find((file) => file.path.endsWith("untracked space.txt"))?.label, '?? "untracked space.txt"');
  assert.ok(result.lines.includes("Branch: main"));
  assert.ok(result.lines.includes(`HEAD: ${git("rev-parse", "HEAD")}`));
  assert.ok(result.lines.some((line) => line.endsWith("Initial commit")));
  const diff = await readGitDiff(root, join(root, "both.txt"));
  assert.match(diff, /Staged:[\s\S]*\+staged/);
  assert.match(diff, /Unstaged:[\s\S]*\+unstaged/);
  assert.match(await readGitDiff(root, join(root, "untracked space.txt")), /\+new/);
});

test("diff output is bounded", async (t) => {
  const { root } = await fixture(t);
  const file = join(root, "large.txt");
  await writeFile(file, "large line\n".repeat(100000));
  await assert.rejects(readGitDiff(root, file), { message: "Git command failed or exceeded its limits" });
});

test("clean status, upstream divergence and detached HEAD", async (t) => {
  const { root, git } = await fixture(t);
  git("branch", "upstream-local");
  git("branch", "--set-upstream-to=upstream-local", "main");
  await writeFile(join(root, "ahead.txt"), "ahead\n");
  git("add", ".");
  git("commit", "-m", "Ahead commit");
  git("checkout", "upstream-local");
  await writeFile(join(root, "behind.txt"), "behind\n");
  git("add", ".");
  git("commit", "-m", "Behind commit");
  git("checkout", "main");
  const result = await readGit(root);
  assert.ok(result.lines.includes("Upstream: upstream-local"));
  assert.ok(result.lines.includes("Ahead: 1, behind: 1"));
  assert.ok(result.lines.includes("Clean"));
  assert.deepEqual(result.files, []);
  assert.equal(await readGitDiff(root, join(root, "both.txt")), "No changes");
  git("checkout", "--detach");
  assert.ok((await readGit(root)).lines.includes("Branch: (detached)"));
});

test("conflicts remain visible in status and diff", async (t) => {
  const { root, git } = await fixture(t);
  git("checkout", "-b", "other");
  await writeFile(join(root, "both.txt"), "other\n");
  git("add", ".");
  git("commit", "-m", "Other change");
  git("checkout", "main");
  await writeFile(join(root, "both.txt"), "main\n");
  git("add", ".");
  git("commit", "-m", "Main change");
  assert.throws(() => git("merge", "other"));
  const result = await readGit(root);
  assert.equal(result.files[0]?.label, 'UU "both.txt"');
  assert.match(await readGitDiff(root, join(root, "both.txt")), /<<<<<<< HEAD/);
});

test("not a repository and unborn repository are graceful", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "session-panel-nonrepo-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await readGit(root), { lines: ["Not a Git working tree"], files: [] });
  assert.equal(await readGitDiff(root, join(root, "file")), "Not a Git working tree");
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  await writeFile(join(root, "new.txt"), "new\n");
  const result = await readGit(root);
  assert.ok(result.lines.includes("HEAD: (no commits)"));
  assert.equal(result.files[0]?.path, join(root, "new.txt"));
  assert.match(await readGitDiff(root, join(root, "new.txt")), /\+new/);
});

test("aborted requests reject without leaking subprocess diagnostics", async (t) => {
  const { root } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readGit(root, controller.signal), { name: "AbortError", message: "Git request aborted" });
  await assert.rejects(readGitDiff(root, join(root, "both.txt"), controller.signal), { name: "AbortError" });
  const running = new AbortController();
  const pending = readGit(root, running.signal);
  running.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("diff uses literal paths, rejects outside paths and disables external diff and textconv", async (t) => {
  const { root, git } = await fixture(t);
  const marker = join(root, "command-ran");
  git("config", "diff.external", `touch ${marker}`);
  git("config", "diff.preview.textconv", `touch ${marker}`);
  await writeFile(join(root, ".gitattributes"), "*.txt diff=preview\n");
  await writeFile(join(root, "both.txt"), "changed\n");
  assert.match(await readGitDiff(root, join(root, "both.txt")), /\+changed/);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  await writeFile(join(root, ":(glob)*.txt"), "literal\n");
  assert.match(await readGitDiff(root, join(root, ":(glob)*.txt")), /\+literal/);
  assert.equal(await readGitDiff(root, join(root, "..", "outside.txt")), "File is outside the Git working tree");
  assert.equal(await readGitDiff(root, "both.txt"), "File is outside the Git working tree");
});
