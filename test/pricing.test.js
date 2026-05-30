import { test } from "node:test";
import assert from "node:assert/strict";
import { costForGemini, costForCodex } from "../lib/pricing.js";

test("gemini-2.5-flash 成本：1M 输入 + 1M 输出", () => {
  const c = costForGemini("gemini-2.5-flash", { promptTokens: 1_000_000, candidatesTokens: 1_000_000, thoughtsTokens: 0 });
  assert.ok(Math.abs(c - (0.30 + 2.50)) < 1e-6);
});

test("gemini 未知模型 → 用 flash 兜底，不抛错", () => {
  const c = costForGemini("gemini-unknown-x", { promptTokens: 1_000_000, candidatesTokens: 0, thoughtsTokens: 0 });
  assert.ok(Math.abs(c - 0.30) < 1e-6);
});

test("codex gpt-5.5 成本：input + output（cached 单独价）", () => {
  const c = costForCodex("gpt-5.5", { input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 1_000_000 });
  assert.ok(Math.abs(c - (1.25 + 10)) < 1e-6);
});
