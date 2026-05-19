/**
 * Stub for the typed client to sharelyai-be (Sharely Platform Services).
 *
 * The real shape is owned by @sharely/api (TASK.md §10, Spec 04) and will be
 * generated from sharelyai-be's OpenAPI document. This placeholder exists so
 * @sharely/protocol can reference `SharelyAPIClient` on AgentContext without
 * pulling in the generated client.
 */
export interface SharelyAPIClient {
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly roleId?: string | null;
}
