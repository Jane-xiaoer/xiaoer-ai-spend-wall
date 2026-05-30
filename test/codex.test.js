import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionTotals, aggregate } from "../providers/codex.js";

const FIXTURE = new URL("./fixtures/codex-rollout.jsonl", import.meta.url).pathname;

test("sessionTotals 取会话最后一条 token_count + rate_limit", async () => {
  const s = await sessionTotals(FIXTURE);
  assert.equal(s.usage.total_tokens, 4000);
  assert.equal(s.usage.input_tokens, 2000);
  assert.equal(s.usage.cached_input_tokens, 1000);
  assert.equal(s.ratePct, 0.04);
  assert.equal(s.resetsAt, 1779006790);
});

test("aggregate 汇总多个会话 totals + 取最新 rate + 周窗 + 时间分桶", () => {
  const now = new Date("2026-05-23T12:00:00");
  const sessions = [
    { usage: { input_tokens: 2000, cached_input_tokens: 1000, output_tokens: 800, total_tokens: 4000 }, ratePct: 0.04, resetsAt: 1779006790, weekPct: 0.12, weekResetsAt: 1779593590, mtime: 200, day: "2026-05-23" },
    { usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 50, total_tokens: 150 }, ratePct: 0.01, resetsAt: 1778000000, mtime: 100, day: "2026-05-22" },
  ];
  const cfg = { thresholds: { yellow: 0.5, red: 0.85 }, codexModel: "gpt-5.5", codexDetailUrl: "https://c" };
  const r = aggregate(sessions, "2026-05", cfg, now);
  assert.equal(r.name, "Codex");
  assert.equal(r.totalTokens, 4150);
  assert.equal(r.limit.pct, 0.04);
  assert.equal(r.limit.resetsAt, 1779006790);
  assert.ok(r.costUSD > 0);
  assert.equal(r.color, "green");
  // 窗口：5小时 + 本周
  assert.equal(r.stats.windows.length, 2);
  assert.equal(r.stats.windows[1].name, "Week");
  assert.equal(r.stats.windows[1].pct, 0.12);
  // 时间分桶
  assert.equal(r.stats.byTime.today.tokens, 4000);
  assert.equal(r.stats.byTime.yesterday.tokens, 150);
  assert.equal(r.stats.byTime.month.tokens, 4150);
});
