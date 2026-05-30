import { test } from "node:test";
import assert from "node:assert/strict";
import { colorFor } from "../lib/color.js";

const th = { yellow: 0.5, red: 0.85 };

test("pct 低于 yellow → green", () => assert.equal(colorFor(0.2, th), "green"));
test("pct 在 yellow 与 red 之间 → yellow", () => assert.equal(colorFor(0.6, th), "yellow"));
test("pct 超 red → red", () => assert.equal(colorFor(0.9, th), "red"));
test("pct 为 null → green（无上限信息时不报警）", () => assert.equal(colorFor(null, th), "green"));
