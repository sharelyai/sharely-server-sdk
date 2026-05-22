import type { AgentInput } from "@sharely/protocol";

export interface CoreMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Converts a Sharely `AgentInput` into the `messages` array Vercel AI's
 * `streamText` expects — the thread history followed by the current user turn.
 */
export const toCoreMessages = (input: AgentInput): CoreMessage[] => [
  ...input.history.map(m => ({
    role: m.role,
    content: m.content ?? ""
  })),
  { role: "user" as const, content: input.message }
];
