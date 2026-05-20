// Phase 1 acceptance smoke (TASK.md §9):
// boots a mock Backplane + an inline-Handler @sharely/server, sends one chat,
// prints each SSE event and asserts the full sequence required by §9.
//
//   node packages/server/examples/smoke.mjs
//
// Requires the package to be built first (`npx turbo run build --filter=@sharely/server`).

import express from "express";
import { createSharelyServer } from "../dist/index.js";

const WS_ID = "ws-smoke";
const THREAD_ID = "thread-smoke";
const AUTH = "Bearer ak_test_token";

// ---------- mock Backplane ----------
const storedMessages = [];
const mock = express();
mock.use(express.json());
mock.get(`/v1/workspaces/${WS_ID}/agent/threads/${THREAD_ID}`, (_req, res) => {
  res.json({ id: THREAD_ID, messages: storedMessages });
});
mock.post(`/v1/workspaces/${WS_ID}/agent/threads/${THREAD_ID}/messages`, (req, res) => {
  const id = `msg-${storedMessages.length + 1}`;
  storedMessages.push({ id, ...req.body });
  res.json({ id });
});
const mockServer = await new Promise(r => {
  const s = mock.listen(0, () => r(s));
});
const mockPort = mockServer.address().port;
const apiUrl = `http://127.0.0.1:${mockPort}`;

// ---------- inline Handler emitting the §9 fixture ----------
const handler = async function* () {
  yield { type: "message_start", role: "assistant", model: "smoke-model-v1" };
  yield { type: "thinking_start", thinkingId: "t1", title: "Processing request" };
  yield { type: "thinking_delta", thinkingId: "t1", delta: "Considering knowledge sources..." };
  yield { type: "tool_call_start", toolCallId: "tc1", name: "search_knowledge", input: { query: "hello" } };
  yield { type: "tool_call_end", toolCallId: "tc1", output: { totalResults: 1, results: [{ id: "k1", title: "Doc" }] }, durationMs: 42 };
  yield { type: "thinking_end", thinkingId: "t1", status: "completed", durationMs: 120 };
  yield { type: "content_delta", delta: "Hello! " };
  yield { type: "content_delta", delta: "Found 1 result." };
  yield { type: "sources", sources: [{ id: "k1", type: "knowledge", title: "Doc" }] };
  yield { type: "content_end" };
  yield { type: "message_end", finishReason: "stop", tokenUsage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } };
};

// ---------- sharely server ----------
const app = createSharelyServer({ apiUrl, workspaceId: WS_ID, handler });
const sharelyServer = await new Promise(r => {
  const s = app.listen(0, () => r(s));
});
const sharelyPort = sharelyServer.address().port;

// ---------- exercise the chat endpoint ----------
const res = await fetch(`http://127.0.0.1:${sharelyPort}/agent/threads/${THREAD_ID}/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: AUTH },
  body: JSON.stringify({ message: "hi" })
});

if (!res.ok) {
  console.error("chat request failed:", res.status, await res.text());
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
const events = [];
let buf = "";

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buf.indexOf("\n\n")) >= 0) {
    const raw = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    const ev = {};
    for (const line of raw.split("\n")) {
      if (line.startsWith("event: ")) ev.type = line.slice(7);
      else if (line.startsWith("data: ")) ev.data = JSON.parse(line.slice(6));
    }
    if (ev.type) {
      events.push(ev);
      console.log(`-> ${ev.type}`, JSON.stringify(ev.data));
    }
  }
}

// ---------- assertions ----------
const expectedTypes = [
  "message_start", "thinking_start", "thinking_delta", "tool_call_start",
  "tool_call_end", "thinking_end", "content_delta", "content_delta",
  "sources", "content_end", "message_end", "done"
];
const got = events.map(e => e.type);
const ok = expectedTypes.every((t, i) => got[i] === t) && got.length === expectedTypes.length;

const userPersisted = storedMessages.some(m => m.role === "user" && m.content === "hi");
const assistantPersisted = storedMessages.some(
  m => m.role === "assistant"
    && m.content === "Hello! Found 1 result."
    && Array.isArray(m.thinkingSteps) && m.thinkingSteps.length === 1
    && Array.isArray(m.toolCalls) && m.toolCalls.length === 1
    && Array.isArray(m.sources) && m.sources.length === 1
    && m.tokenUsage?.totalTokens === 17
    && m.model === "smoke-model-v1"
);

console.log("\n--- assertions ---");
console.log("event sequence matches §9 fixture:", ok ? "PASS" : "FAIL");
console.log("  expected:", expectedTypes.join(", "));
console.log("  got:     ", got.join(", "));
console.log("user message persisted via Backplane:", userPersisted ? "PASS" : "FAIL");
console.log("assistant message persisted with thinkingSteps/toolCalls/sources/tokenUsage:", assistantPersisted ? "PASS" : "FAIL");

mockServer.close();
sharelyServer.close();
process.exit(ok && userPersisted && assistantPersisted ? 0 : 1);
