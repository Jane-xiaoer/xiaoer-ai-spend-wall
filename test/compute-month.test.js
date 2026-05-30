import { test } from "node:test";
import assert from "node:assert/strict";
import { currentPeriod, mergeWithPrevious } from "../lib/compute-month.js";

test("currentPeriod 返回 YYYY-MM 格式", () => {
  assert.match(currentPeriod(), /^\d{4}-\d{2}$/);
  // 用本地时间构造避免时区边界翻车（getMonth/getFullYear 都按 local）
  assert.equal(currentPeriod(new Date(2026, 4, 28, 12)), "2026-05"); // 月份 0-based
  assert.equal(currentPeriod(new Date(2026, 0, 15, 12)), "2026-01");
  assert.equal(currentPeriod(new Date(2026, 11, 15, 12)), "2026-12");
});

test("mergeWithPrevious：全部成功 → 直接返回 fresh", () => {
  const fresh = [
    { name: "Claude", costUSD: 100, totalTokens: 1e9 },
    { name: "Codex", costUSD: 50, totalTokens: 5e8 },
    { name: "Gemini", costUSD: 10, totalTokens: 1e7 },
  ];
  const merged = mergeWithPrevious(fresh, null);
  assert.deepEqual(merged, fresh);
});

test("mergeWithPrevious：一家失败 + previous 有值 → 用 previous 占位", () => {
  const fresh = [
    { name: "Claude", costUSD: 0, totalTokens: 0, error: "ENOENT ccusage", costNote: "Subscription" },
    { name: "Codex", costUSD: 50, totalTokens: 5e8 },
    { name: "Gemini", costUSD: 10, totalTokens: 1e7 },
  ];
  const previous = {
    providers: [
      { name: "Claude", costUSD: 2963.51, totalTokens: 4e9, costNote: "Subscription" },
      { name: "Codex", costUSD: 45, totalTokens: 4e8 },
      { name: "Gemini", costUSD: 9, totalTokens: 9e6 },
    ],
  };
  const merged = mergeWithPrevious(fresh, previous);
  assert.equal(merged[0].costUSD, 2963.51, "Claude 必须用上次值");
  assert.equal(merged[0].totalTokens, 4e9);
  assert.match(merged[0].costNote, /上次缓存/);
  assert.ok(merged[0]._stale, "必须打 _stale 标记");
  assert.equal(merged[0]._stale.reason, "ENOENT ccusage");
  // 其它两家保留 fresh
  assert.equal(merged[1].costUSD, 50);
  assert.equal(merged[2].costUSD, 10);
});

test("mergeWithPrevious：失败但 previous 也是 0 → 写真 0（首次失败保命）", () => {
  const fresh = [{ name: "Claude", costUSD: 0, totalTokens: 0, error: "boom" }];
  const previous = { providers: [{ name: "Claude", costUSD: 0, totalTokens: 0 }] };
  const merged = mergeWithPrevious(fresh, previous);
  assert.equal(merged[0].error, "boom", "保留 error 字段，不假装成功");
  assert.equal(merged[0].costUSD, 0);
  assert.ok(!merged[0]._stale, "previous 没值不算 stale fallback");
});

test("mergeWithPrevious：没 error 但数字是 0（月初真 0） → 不当失败", () => {
  const fresh = [{ name: "Claude", costUSD: 0, totalTokens: 0, costNote: "Subscription" }];
  const previous = { providers: [{ name: "Claude", costUSD: 9999, totalTokens: 9e9 }] };
  const merged = mergeWithPrevious(fresh, previous);
  assert.equal(merged[0].costUSD, 0, "没 error 就是月初真 0，不能拿旧值冒充");
  assert.ok(!merged[0]._stale);
});

test("mergeWithPrevious：没有 previous → 失败就是失败，不报错", () => {
  const fresh = [{ name: "Claude", costUSD: 0, totalTokens: 0, error: "boom" }];
  const merged = mergeWithPrevious(fresh, null);
  assert.equal(merged[0].error, "boom");
  assert.equal(merged[0].costUSD, 0);
});
