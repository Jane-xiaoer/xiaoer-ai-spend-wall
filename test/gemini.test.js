import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateLines } from "../providers/gemini.js";

test("按当月聚合 + 按工具拆分 + spend cap 占比", () => {
  const lines = [
    { ts: "2026-05-01T00:00:00Z", tool: "xiaoer-ask", totalTokens: 100, costUSD: 10 },
    { ts: "2026-05-02T00:00:00Z", tool: "rewind", totalTokens: 50, costUSD: 5 },
    { ts: "2026-04-30T00:00:00Z", tool: "xiaoer-ask", totalTokens: 999, costUSD: 99 },
  ];
  const cfg = { thresholds: { yellow: 0.5, red: 0.85 }, geminiSpendCapUSD: 50, geminiDetailUrl: "https://g" };
  const r = aggregateLines(lines, "2026-05", cfg);
  assert.equal(r.name, "Gemini");
  assert.equal(r.totalTokens, 150);
  assert.equal(r.costUSD, 15);
  assert.equal(r.costNote, "Metered");
  assert.deepEqual(r.byTool, { "xiaoer-ask": 100, "rewind": 50 });
  assert.equal(r.limit.type, "spend_cap");
  assert.equal(r.limit.pct, 0.3);
  assert.equal(r.color, "green");
  assert.equal(r.detail, "https://g");
});

test("backendSplit: google=真实Gemini花销 / relay=中转站token用量；老数据无backend当google", () => {
  const lines = [
    { ts: "2026-05-01T00:00:00Z", tool: "capture", backend: "google", totalTokens: 200, costUSD: 8 },
    { ts: "2026-05-02T00:00:00Z", tool: "rename", backend: "relay", totalTokens: 100, costUSD: 0 },
    { ts: "2026-05-03T00:00:00Z", tool: "xiaoer-ask", backend: "relay", totalTokens: 60, costUSD: 0 },
    { ts: "2026-05-04T00:00:00Z", tool: "legacy", totalTokens: 40, costUSD: 2 }, // 无 backend → google
  ];
  const cfg = { thresholds: { yellow: 0.5, red: 0.85 }, geminiSpendCapUSD: 100 };
  const r = aggregateLines(lines, "2026-05", cfg);
  // 真实 Gemini 花销 = google 后端 (capture + legacy)
  assert.equal(r.backendSplit.google.costUSD, 10);
  assert.equal(r.backendSplit.google.tokens, 240);
  // relay = 省钱目标，token 用量有但不算 Gemini 真钱
  assert.equal(r.backendSplit.relay.costUSD, 0);
  assert.equal(r.backendSplit.relay.tokens, 160);
  // 每工具后端归属
  assert.equal(r.byToolBackend.capture, "google");
  assert.equal(r.byToolBackend.rename, "relay");
  assert.equal(r.byToolBackend.legacy, "google");
});
