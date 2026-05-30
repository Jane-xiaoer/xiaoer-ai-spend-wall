import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("config.json 可解析且含端口", async () => {
  const cfg = JSON.parse(await readFile(new URL("../config.json", import.meta.url)));
  assert.ok(cfg.geminiMeterPort > 0);
});
