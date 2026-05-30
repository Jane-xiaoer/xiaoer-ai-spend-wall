import { test } from "node:test";
import assert from "node:assert/strict";
import { assess } from "../lib/utilization.js";

test("充分度分档", () => {
  assert.equal(assess(0.05).key, "idle");   // 没充分用
  assert.equal(assess(0.3).key, "low");     // 偏低
  assert.equal(assess(0.6).key, "good");    // 充分
  assert.equal(assess(0.9).key, "high");    // 很满
  assert.equal(assess(1.2).key, "over");    // 超
  assert.equal(assess(null).key, "unknown");
});

test("每档带 emoji 与颜色", () => {
  assert.equal(assess(0.05).emoji, "💤");
  assert.equal(assess(0.6).color, "green");
  assert.equal(assess(1.5).color, "red");
});
