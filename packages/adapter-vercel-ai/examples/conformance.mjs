// Conformance smoke for @sharely/adapter-vercel-ai.
// Feeds the adapter a fake `streamText` fullStream per conformance scenario and
// asserts the translated AgentEvent stream is structurally valid and matches
// the golden sequence.
//
//   node packages/adapter-vercel-ai/examples/conformance.mjs
//
// Requires a build first (`npx turbo run build`).

import { scenarios, runHandlerConformance } from "@sharely/conformance";
import { toSharelyHandler } from "../dist/index.js";

const fakeStream = parts => ({
  fullStream: (async function* () {
    for (const p of parts) yield p;
  })()
});

// A fake Vercel `fullStream` per scenario — the part shapes `streamText` emits.
const fixtures = {
  "text-only": [
    { type: "text-delta", textDelta: "Hello, " },
    { type: "text-delta", textDelta: "world." },
    { type: "finish", finishReason: "stop", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } }
  ],
  thinking: [
    { type: "reasoning", textDelta: "Considering..." },
    { type: "text-delta", textDelta: "Done." },
    { type: "finish", finishReason: "stop", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } }
  ],
  "tool-call": [
    { type: "tool-call", toolCallId: "tc1", toolName: "search_knowledge", args: { query: "topic" } },
    { type: "tool-result", toolCallId: "tc1", result: { totalResults: 1 } },
    { type: "text-delta", textDelta: "Per the docs." },
    { type: "source", source: { id: "k1", title: "Doc" } },
    { type: "finish", finishReason: "stop", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } }
  ],
  error: [{ type: "error", error: "upstream model unavailable" }]
};

let allOk = true;

for (const scenario of Object.values(scenarios)) {
  const parts = fixtures[scenario.name];
  if (!parts) {
    console.log("SKIP", scenario.name, "(no fixture)");
    continue;
  }
  const handler = toSharelyHandler(() => fakeStream(parts), { model: "conformance" });
  const report = await runHandlerConformance(handler, scenario);
  const status = report.ok ? "PASS" : "FAIL";
  console.log(`${status}  ${scenario.name}`);
  if (!report.ok) {
    allOk = false;
    for (const e of report.structural.errors) console.log(`   structural: ${e}`);
    for (const e of report.golden.errors) console.log(`   golden: ${e}`);
    if (report.threw) console.log(`   threw: ${report.threw}`);
  }
}

// AbortSignal bridge: an aborted input must stop the stream cleanly.
const aborted = new AbortController();
aborted.abort();
const abortHandler = toSharelyHandler(() => fakeStream(fixtures["text-only"]));
const abortEvents = [];
for await (const e of abortHandler({
  message: "x", history: [], context: {}, signal: aborted.signal
})) abortEvents.push(e);
const abortOk = abortEvents.length <= 1; // message_start may slip out before the abort check
console.log(`${abortOk ? "PASS" : "FAIL"}  abort-signal halts stream (${abortEvents.length} events)`);
if (!abortOk) allOk = false;

console.log(allOk ? "\nall conformance checks passed" : "\nCONFORMANCE FAILED");
process.exit(allOk ? 0 : 1);
