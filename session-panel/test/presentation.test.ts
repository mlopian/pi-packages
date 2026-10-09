import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyLine, diffLines, historyStyle, progressBar, rowTone, type Tone } from "../presentation.ts";

test("classifies diff headers, content, metadata and JSON keys", () => {
  const cases: [string, Tone][] = [
    ["diff --git a/a b/a", "accent"], ["--- a/a", "accent"], ["+++ b/a", "accent"],
    ["@@ -3 +4 @@", "accent"], ["@@@ -1 -1 +1 @@@", "accent"],
    ["+added", "success"], ["-deleted", "error"], [" context", "text"],
    ["index abc..def 100644", "muted"], ["new file mode 100644", "muted"],
    ["deleted file mode 100644", "muted"], ["rename from a", "muted"],
    ["Binary files a/a and b/a differ", "muted"], ["GIT binary patch", "muted"],
    ["Staged:", "muted"], ["Unstaged:", "muted"], ["\\ No newline at end of file", "dim"],
    ['  "totalTokens": 42,', "accent"], ['  "escaped\\\"key": true', "accent"],
    ["Repository: /repo", "muted"], ["", "dim"],
  ];
  for (const [line, tone] of cases) assert.equal(classifyLine(line, true), tone, line);
  assert.equal(classifyLine("+ordinary text", false), "text");
  assert.equal(classifyLine("-ordinary text", false), "text");
});

test("renders ASCII progress with clamping and unknown values", () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(progressBar(value, 4), "[????]");
  }
  assert.equal(progressBar(50, 6), "[###---]");
  assert.equal(progressBar(-10, 4), "[----]");
  assert.equal(progressBar(120, 4), "[####]");
  assert.equal(progressBar(0, 4), "[----]");
  assert.equal(progressBar(100, 4), "[####]");
  assert.equal(progressBar(50, 3.9), "[##-]");
  for (const width of [-1, 0, NaN, Infinity]) assert.equal(progressBar(50, width), "[]");
});

test("classifies porcelain statuses and tool status labels", () => {
  const cases: [string, Tone][] = [
    ["??", "warning"], [" M", "warning"], ["M ", "warning"],
    ["UU", "error"], ["D ", "error"], ["A ", "success"],
    ["AD", "error"], ["AM", "warning"], ["AA", "error"], ["DD", "error"],
    ["R ", "accent"], ["!!", "dim"],
  ];
  for (const [status, tone] of cases) {
    assert.equal(rowTone(status), tone, status);
    assert.equal(rowTone(`${status} \"file.ts\"`), tone, status);
  }
  assert.equal(rowTone("[active] read"), "success");
  assert.equal(rowTone("[IDLE] session"), "success");
  assert.equal(rowTone("[RUNNING] session"), "warning");
  assert.equal(rowTone("Git unavailable: timeout"), "error");
  assert.equal(rowTone("Clean"), "success");
  assert.equal(rowTone("No changes"), "success");
  assert.equal(rowTone("2026-01-01 id toolResult edit [error]: failed"), "error");
  assert.equal(rowTone("[active] edit [error]"), "error");
  assert.equal(rowTone("[registered] read"), "muted");
  assert.equal(rowTone("ordinary row"), "text");
});

test("numbers additions, deletions and context with independent old and new positions", () => {
  const rows = diffLines("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -3,3 +4,3 @@ heading\n same\n-old\n+new\n last\n\\ No newline at end of file");
  assert.deepEqual(rows.map((row) => row.gutter), ["", "", "", "", "   3    4", "   4     ", "        5", "   5    6", ""]);
  assert.deepEqual(rows.slice(4, 8).map((row) => row.tone), ["text", "error", "success", "text"]);
});

test("resets positions across hunks and files including untracked and deleted files", () => {
  const rows = diffLines("Staged:\ndiff --git a/a b/a\n@@ -8 +9 @@\n-old\n+new\n@@ -20 +30 @@\n same\nUnstaged:\ndiff --git a/b b/b\nnew file mode 100644\n--- /dev/null\n+++ b/b\n@@ -0,0 +1,2 @@\n+first\n+second\ndiff --git a/c b/c\n--- a/c\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-first\n-second");
  assert.deepEqual(rows.filter((row) => row.gutter).map((row) => row.gutter), [
    "   8     ", "        9", "  20   30", "        1", "        2", "   1     ", "   2     ",
  ]);
  assert.ok(rows.filter((row) => /^(?:diff |--- |\+\+\+ |@@|Staged:|Unstaged:|new file)/.test(row.text)).every((row) => row.gutter === ""));
});

test("does not invent positions for malformed, combined, binary or excess content", () => {
  for (const hunk of ["@@ broken @@", "@@ -1,x +2 @@", "@@ -1 +2 @@junk", "@@ -0 +1 @@", "@@ -999999999999999999999 +1 @@", "@@@ -1,1 -2,1 +3,1 @@@"]) {
    const rows = diffLines(`@@ -1,2 +1,2 @@\n valid\n${hunk}\n-orphan\n+orphan\n context`);
    assert.equal(rows[1].gutter, "   1    1");
    assert.ok(rows.slice(2).every((row) => row.gutter === ""), hunk);
  }
  assert.ok(diffLines("GIT binary patch\nliteral 3\nabc\nBinary files a and b differ").every((row) => row.gutter === ""));
  const rows = diffLines("@@ -1 +1 @@\n context\n+extra\n-orphan");
  assert.deepEqual(rows.map((row) => row.gutter), ["", "   1    1", "", ""]);
  assert.ok(diffLines("@@ -1,3 +1,3 @@\ndiff --git a/next b/next\n--- a/next\n+++ b/next\n+orphan").every((row) => row.gutter === ""));
  assert.equal(diffLines("@@ -1,2 +1,2 @@\n first\nindex abc..def\n second")[3].gutter, "");
});

test("no-newline marker does not advance positions", () => {
  const rows = diffLines("@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file");
  assert.deepEqual(rows.map((row) => row.gutter), ["", "   1     ", "", "        1", ""]);
});

test("sanitizes terminal escape sequences before classification and parsing", () => {
  assert.equal(classifyLine("\x1b[32m+added\x1b[0m", true), "success");
  assert.equal(rowTone("\x1b]8;;https://example.com\x1b\\[active] read\x1b]8;;\x1b\\"), "success");
  const rows = diffLines("\x1b[31m@@ -3 +4 @@\x1b[0m\r\n\x1b]52;c;evil\x07 same\x00\r\n");
  assert.deepEqual(rows, [
    { text: "@@ -3 +4 @@", tone: "accent", gutter: "" },
    { text: " same", tone: "text", gutter: "   3    4" },
    { text: "", tone: "dim", gutter: "" },
  ]);
});

test("header-like content remains colored and numbered inside an active hunk", () => {
  const rows = diffLines("--- a/file\n+++ b/file\n@@ -1 +1 @@\n--- heading\n+++ heading");
  assert.deepEqual(rows.slice(3), [
    { text: "--- heading", tone: "error", gutter: "   1     " },
    { text: "+++ heading", tone: "success", gutter: "        1" },
  ]);
});


test("history badges distinguish message roles and session events", () => {
  assert.deepEqual(historyStyle("user"), { label: "USER", tone: "accent" });
  assert.deepEqual(historyStyle("assistant"), { label: "ASSISTANT", tone: "success" });
  assert.deepEqual(historyStyle("toolResult"), { label: "TOOL", tone: "warning" });
  assert.deepEqual(historyStyle("system"), { label: "SYSTEM", tone: "muted" });
  assert.deepEqual(historyStyle("compaction"), { label: "COMPACT", tone: "warning" });
  assert.deepEqual(historyStyle("model_change"), { label: "MODEL", tone: "accent" });
  for (const kind of ["toolResult", "assistant", "bashExecution"]) {
    assert.deepEqual(historyStyle(kind, true), { label: "ERROR", tone: "error" });
  }
  assert.deepEqual(historyStyle("__proto__"), { label: "__PROTO__", tone: "dim" });
});
