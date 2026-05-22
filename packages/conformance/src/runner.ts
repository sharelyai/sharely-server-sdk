import type {
  AgentContext,
  AgentEvent,
  AgentInput,
  Handler,
  SharelyAPIClient,
  TraceSpan
} from "@sharely/protocol";
import { checkGolden, validateEventStream, type ValidationResult } from "./validate.js";
import type { ConformanceScenario } from "./scenarios.js";

const noopApi: SharelyAPIClient = {
  baseUrl: "http://conformance.local",
  workspaceId: "ws-conformance"
};

const makeTrace = (): TraceSpan => {
  const span: TraceSpan = {
    traceId: "trace-conformance",
    messageId: "msg-conformance",
    event: () => {},
    child: () => span,
    end: () => {}
  };
  return span;
};

export const makeTestContext = (
  overrides: Partial<AgentContext> = {}
): AgentContext => ({
  workspaceId: "ws-conformance",
  threadId: "thread-conformance",
  authorization: "Bearer conformance",
  api: noopApi,
  trace: makeTrace(),
  ...overrides
});

export const makeTestInput = (
  message: string,
  overrides: Partial<AgentInput> = {}
): AgentInput => ({
  message,
  history: [],
  context: makeTestContext(),
  signal: new AbortController().signal,
  ...overrides
});

export interface ConformanceReport {
  scenario: string;
  ok: boolean;
  events: AgentEvent[];
  structural: ValidationResult;
  golden: ValidationResult;
  threw?: string;
}

/** Runs a Handler against a scenario and reports structural + golden conformance. */
export const runHandlerConformance = async (
  handler: Handler,
  scenario: ConformanceScenario,
  inputOverrides: Partial<AgentInput> = {}
): Promise<ConformanceReport> => {
  const input = makeTestInput(scenario.inputMessage, inputOverrides);
  const events: AgentEvent[] = [];
  let threw: string | undefined;

  try {
    for await (const event of handler(input)) events.push(event);
  } catch (err) {
    threw = err instanceof Error ? err.message : String(err);
  }

  const structural = validateEventStream(events);
  const golden = checkGolden(events, scenario.golden);

  return {
    scenario: scenario.name,
    ok: structural.ok && golden.ok && !threw,
    events,
    structural,
    golden,
    ...(threw !== undefined && { threw })
  };
};

/** A Handler that simply replays a scenario's golden stream. Proves the harness self-consistency. */
export const referenceHandler =
  (scenario: ConformanceScenario): Handler =>
  async function* () {
    for (const event of scenario.golden) yield event;
  };
