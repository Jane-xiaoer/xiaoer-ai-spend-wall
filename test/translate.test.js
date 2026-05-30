import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiToOpenAI, openAIToGemini } from "../gemini-meter/translate.js";

test("Gemini→OpenAI：system + user 文本", () => {
  const g = {
    system_instruction: { parts: [{ text: "you are X" }] },
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 100 },
  };
  const o = geminiToOpenAI(g, "gemini-2.5-flash");
  assert.equal(o.model, "gemini-2.5-flash");
  assert.equal(o.messages[0].role, "system");
  assert.equal(o.messages[1].role, "user");
  assert.equal(o.messages[1].content, "hi");
  assert.equal(o.temperature, 0.4);
  assert.equal(o.max_tokens, 100);
});

test("Gemini→OpenAI：含图走多模态数组 + model 角色转 assistant", () => {
  const g = { contents: [
    { role: "model", parts: [{ text: "ok" }] },
    { role: "user", parts: [{ text: "what" }, { inline_data: { mime_type: "image/png", data: "AAA" } }] },
  ] };
  const o = geminiToOpenAI(g, "m");
  assert.equal(o.messages[0].role, "assistant");
  assert.ok(Array.isArray(o.messages[1].content));
  assert.equal(o.messages[1].content[1].type, "image_url");
  assert.match(o.messages[1].content[1].image_url.url, /^data:image\/png;base64,AAA/);
});

test("OpenAI→Gemini：抽 text + usage", () => {
  const o = { choices: [{ message: { content: "pong" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }, model: "gpt" };
  const g = openAIToGemini(o);
  assert.equal(g.candidates[0].content.parts[0].text, "pong");
  assert.equal(g.candidates[0].finishReason, "STOP");
  assert.equal(g.usageMetadata.promptTokenCount, 5);
  assert.equal(g.usageMetadata.totalTokenCount, 7);
});
