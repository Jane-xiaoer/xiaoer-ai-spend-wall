import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketByTime } from "../lib/timebuckets.js";

const now = new Date("2026-05-23T12:00:00");

test("分桶 today/yesterday/week/month", () => {
  const entries = [
    { date: "2026-05-23", cost: 5, tokens: 100 },   // today
    { date: "2026-05-22", cost: 10, tokens: 200 },  // yesterday + week + month
    { date: "2026-05-18", cost: 3, tokens: 50 },    // week(近7天: 17~23) + month
    { date: "2026-05-10", cost: 7, tokens: 70 },    // month only
    { date: "2026-04-30", cost: 99, tokens: 999 },  // 都不算
  ];
  const b = bucketByTime(entries, now);
  assert.equal(b.today.cost, 5);
  assert.equal(b.yesterday.cost, 10);
  assert.equal(b.week.cost, 18);   // 5+10+3
  assert.equal(b.month.cost, 25);  // 5+10+3+7
  assert.equal(b.today.tokens, 100);
  assert.equal(b.week.tokens, 350);
});

test("空输入不报错", () => {
  const b = bucketByTime([], now);
  assert.equal(b.month.cost, 0);
});
