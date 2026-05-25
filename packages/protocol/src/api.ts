/**
 * Stub for the typed client to sharelyai-be (Sharely Platform Services).
 *
 * The real shape is owned by @sharelyai/api and will be generated from
 * sharelyai-be's OpenAPI document. This placeholder exists so
 * @sharelyai/protocol can reference `SharelyAPIClient` on AgentContext
 * without pulling in the generated client.
 */
export interface SharelyAPIClient {
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly roleId?: string | null;
}
