import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUsage, buildLogLine } from "../gemini-meter/server.js";

const SSE = `data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}

data: {"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"thoughtsTokenCount":2,"totalTokenCount":17},"modelVersion":"gemini-2.5-flash"}

`;

test("extractUsage 从 SSE 抽最后的 usageMetadata", () => {
  const u = extractUsage(SSE);
  assert.equal(u.promptTokenCount, 10);
  assert.equal(u.candidatesTokenCount, 5);
  assert.equal(u.thoughtsTokenCount, 2);
  assert.equal(u.totalTokenCount, 17);
});

test("buildLogLine 组装含 tool/model/cost 的日志对象", () => {
  const u = { promptTokenCount: 1_000_000, candidatesTokenCount: 0, thoughtsTokenCount: 0, totalTokenCount: 1_000_000 };
  const line = buildLogLine(u, "gemini-2.5-flash", "xiaoer-ask");
  assert.equal(line.tool, "xiaoer-ask");
  assert.equal(line.model, "gemini-2.5-flash");
  assert.equal(line.promptTokens, 1_000_000);
  assert.equal(line.totalTokens, 1_000_000);
  assert.ok(Math.abs(line.costUSD - 0.30) < 1e-6);
  assert.ok(line.ts);
});
