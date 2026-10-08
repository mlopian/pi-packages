import assert from "node:assert/strict";
import { test } from "node:test";
import { bar, colorFor, countdown, parseUsage } from "../usage.ts";

const window = (overrides = {}) => ({ usedPercent: 20, windowDurationMins: 300, resetsAt: 1791457200, ...overrides });

test("normalizes base and additional limits without duplicating the base", () => {
  const primary = window();
  assert.deepEqual(parseUsage({
    rateLimits: { limitId: "codex", primary },
    rateLimitsByLimitId: {
      codex: { primary },
      extra: { limitName: "extra\u001b - quota", secondary: window({ usedPercent: 120, windowDurationMins: 10080, resetsAt: null }) },
    },
  }), {
    stale: false,
    windows: [
      { label: "5h", percentRemaining: 80, resetsAt: new Date(1791457200 * 1000).toISOString() },
      { label: "extra - quota - week", percentRemaining: 0, resetsAt: null },
    ],
  });
});

test("supports unknown resets and clamps negative usage", () => {
  assert.deepEqual(parseUsage({ rateLimits: { primary: window({ usedPercent: -5, resetsAt: null }) } }).windows,
    [{ label: "5h", percentRemaining: 100, resetsAt: null }]);
});

test("rejects unavailable and malformed data", () => {
  assert.throws(() => parseUsage({}));
  for (const overrides of [
    { usedPercent: "20" }, { usedPercent: NaN }, { usedPercent: Infinity },
    { windowDurationMins: 0 }, { windowDurationMins: "300" },
    { resetsAt: "invalid" }, { resetsAt: 1e100 },
  ]) {
    assert.throws(() => parseUsage({ rateLimits: { primary: window(overrides) } }));
  }
});

test("renders bars and exact color thresholds", () => {
  assert.equal(bar(0), "░".repeat(10));
  assert.equal(bar(80), "████████░░");
  assert.equal(bar(100), "█".repeat(10));
  assert.equal(colorFor(51), "success");
  assert.equal(colorFor(50), "warning");
  assert.equal(colorFor(21), "warning");
  assert.equal(colorFor(20), "error");
});

test("reset countdown rounds up and does not go negative", () => {
  const now = Date.parse("2026-10-08T00:00:00Z");
  assert.equal(countdown("2026-10-08T00:00:01Z", now), "1m");
  assert.equal(countdown("2026-10-08T01:01:00Z", now), "1h 1m");
  assert.equal(countdown("2026-10-10T03:00:00Z", now), "2d 3h");
  assert.equal(countdown("2026-10-07T23:00:00Z", now), "0m");
});
