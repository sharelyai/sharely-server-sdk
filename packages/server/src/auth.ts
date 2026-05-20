export const extractAuthHeader = (
  headers: Record<string, unknown>
): string | undefined => {
  const raw = headers?.["authorization"] ?? headers?.["Authorization"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return undefined;
};

const INVALID_BEARER_VALUES = new Set(["null", "undefined", "public", ""]);

export const isInvalidBearer = (authorization: string): boolean => {
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  return INVALID_BEARER_VALUES.has(token);
};
