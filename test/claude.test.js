import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fromCcusage, buildClaudeWindow } from "../providers/claude.js";

test("buildClaudeWindow 从 blocks 取当前窗用量+限额+状态", () => {
  const blocks = { blocks: [
    { isActive: false, isGap: false, totalTokens: 999 },
    { isActive: true, isGap: false, totalTokens: 50_000_000,
      projection: { totalTokens: 80_000_000, remainingMinutes: 90 }, endTime: "2026-05-23T10:00:00.000Z",
      tokenLimitStatus: { limit: 100_000_000, status: "warning" } },
  ] };
  const w = buildClaudeWindow(blocks);
  assert.equal(w.used, 50_000_000);
  assert.equal(w.limit, 100_000_000);
  assert.equal(w.pct, 0.5);
  assert.equal(w.projectedPct, 0.8);
  assert.equal(w.status, "warning");
  assert.equal(w.remainingMinutes, 90);
});

test("buildClaudeWindow 无活跃块 → null", () => {
  assert.equal(buildClaudeWindow({ blocks: [{ isActive: false }] }), null);
});

test("取当月行并映射为标准对象", async () => {
  const raw = JSON.parse(await readFile(new URL("./fixtures/ccusage-monthly.json", import.meta.url)));
  const cfg = { thresholds: { yellow: 0.5, red: 0.85 }, claudeDetailUrl: "https://x" };
  const r = fromCcusage(raw, "2026-05", cfg);
  assert.equal(r.name, "Claude");
  assert.equal(r.period, "2026-05");
  assert.equal(r.totalTokens, 3250223773);
  assert.ok(Math.abs(r.costUSD - 2297.42) < 0.01);
  assert.equal(r.costNote, "订阅折算");
  assert.equal(r.limit.type, "plan");
  assert.equal(r.color, "green");
  assert.equal(r.detail, "https://x");
});

test("当月无数据 → 0 且不抛错", async () => {
  const r = fromCcusage({ monthly: [] }, "2026-05", { thresholds: { yellow: 0.5, red: 0.85 } });
  assert.equal(r.totalTokens, 0);
  assert.equal(r.costUSD, 0);
});
