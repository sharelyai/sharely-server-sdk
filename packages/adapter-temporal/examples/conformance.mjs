// Conformance smoke for @sharely/adapter-temporal.
// Drives the adapter against a fake Temporal client whose workflow handle is
// backed by a `createAgentEventSink()` buffer, then asserts the streamed
// AgentEvents are structurally valid and match each golden scenario.
//
//   node packages/adapter-temporal/examples/conformance.mjs
//
// Requires a build first (`npx turbo run build`).

import { scenarios, runHandlerConformance, validateEventStream } from "@sharely/conformance";
import { fromTemporal, createAgentEventSink, emitAgentEvent } from "../dist/index.js";

// A fake @temporalio/client whose workflow "runs" by replaying a golden stream
// into a sink. `query` is polled in two chunks to exercise cursor advancement.
const fakeClient = golden => ({
  start: async () => {
    const sink = createAgentEventSink();
    let emitted = 0;
    return {
      query: async (_q, cursor) => {
        // Release the golden stream two events at a time, simulating a workflow
        // emitting over multiple poll cycles.
        const batch = golden.slice(emitted, emitted + 2);
        for (const e of batch) emitAgentEvent(sink, e);
        emitted += batch.length;
        return sink.query(cursor);
      },
      cancel: async () => {}
    };
  }
});

let allOk = true;

for (const scenario of Object.values(scenarios)) {
  const handler = fromTemporal({
    client: fakeClient(scenario.golden),
    workflowType: "agentWorkflow",
    taskQueue: "sharely",
    pollIntervalMs: 1
  });
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

// Sink check: emitted events round-trip through query() in order.
const sink = createAgentEventSink();
for (const e of scenarios.toolCall.golden) emitAgentEvent(sink, e);
const page = sink.query(0);
const sinkOk =
  page.done &&
  page.events.length === scenarios.toolCall.golden.length &&
  validateEventStream(page.events).ok;
console.log(`${sinkOk ? "PASS" : "FAIL"}  sink buffers + reports done`);
if (!sinkOk) allOk = false;

// Disconnect check: an aborted signal cancels and stops the stream.
let cancelled = false;
const abortClient = {
  start: async () => ({
    query: async () => ({ events: [], done: false, cursor: 0 }),
    cancel: async () => { cancelled = true; }
  })
};
const ac = new AbortController();
const abortHandler = fromTemporal({
  client: abortClient, workflowType: "w", taskQueue: "q", pollIntervalMs: 5
});
const it = abortHandler({
  message: "x", history: [],
  context: { threadId: "t", trace: { messageId: "m" } },
  signal: ac.signal
})[Symbol.asyncIterator]();
const first = it.next();
ac.abort();
await first;
await it.next();
console.log(`${cancelled ? "PASS" : "FAIL"}  abort cancels the workflow`);
if (!cancelled) allOk = false;

console.log(allOk ? "\nall conformance checks passed" : "\nCONFORMANCE FAILED");
process.exit(allOk ? 0 : 1);
