// Pure formatting helpers of the admin interface (static/js/admin/admin-format.js).
// Run: `node --test annzarro/tests/js/admin-format.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAge, formatBytes, formatCount, formatMb, formatTimestamp, isValidUsername, quotaLevel, quotaPercent,
} from "../../../static/js/admin/admin-format.js";

test("usernames follow the server rule", () => {
  for (const ok of ["a", "alice", "A.b_c-d@e", "x".repeat(64)]) assert.equal(isValidUsername(ok), true, ok);
  for (const bad of ["", "x".repeat(65), "a b", "a/b", "ä", "a:b", "<b>", null, 5]) assert.equal(isValidUsername(bad), false, String(bad));
});

test("bytes use binary units with one decimal under 10", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(12288), "12 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 * 1024), "1 MB");
  assert.equal(formatBytes(5 * 1024 ** 3), "5 GB");
  assert.equal(formatBytes(1024 ** 5), "1024 TB");
  for (const bad of [null, undefined, -1, NaN, "12"]) assert.equal(formatBytes(bad), "-");
  assert.equal(formatMb(410), "410 MB");
  assert.equal(formatMb(1945), "1.9 GB");
  assert.equal(formatMb(null), "-");
});

test("ages show the two largest units", () => {
  assert.equal(formatAge(2), "2 s");
  assert.equal(formatAge(59.9), "59 s");
  assert.equal(formatAge(60), "1 min");
  assert.equal(formatAge(3600), "1 h");
  assert.equal(formatAge(3600 + 600), "1 h 10 min");
  assert.equal(formatAge(86400 * 2 + 3600 * 4), "2 d 4 h");
  assert.equal(formatAge(-1), "-");
  assert.equal(formatAge(undefined), "-");
});

test("counts get thousands separators", () => {
  assert.equal(formatCount(12031), "12,031");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1234567), "1,234,567");
  assert.equal(formatCount(null), "-");
});

test("timestamps are local and minute-precise, bad input is a dash", () => {
  const d = new Date(2026, 9, 11, 9, 5);
  assert.equal(formatTimestamp(d.toISOString()), "2026-10-11 09:05");
  assert.equal(formatTimestamp(null), "-");
  assert.equal(formatTimestamp("not a date"), "-");
});

test("quota percent clamps and treats a missing limit as unlimited", () => {
  assert.equal(quotaPercent(300, 500), 60);
  assert.equal(quotaPercent(600, 500), 100);
  assert.equal(quotaPercent(-5, 500), 0);
  assert.equal(quotaPercent(10, 0), 0);
  assert.equal(quotaPercent(10, null), 0);
  assert.equal(quotaLevel(79), "success");
  assert.equal(quotaLevel(80), "warning");
  assert.equal(quotaLevel(100), "danger");
});
