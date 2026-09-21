import { ServiceError } from "./errors.js";

const USER_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,63})$/;

export const isUserId = (value: unknown): value is string =>
  typeof value === "string" && USER_ID_PATTERN.test(value);

export const requireUserId = (value: unknown, fieldName = "userId"): string => {
  if (!isUserId(value)) {
    throw new ServiceError(400, "BAD_REQUEST", `${fieldName} is invalid`);
  }
  return value;
};

export const requireExactObject = (
  value: unknown,
  allowedKeys: readonly string[],
  context = "body",
): Record<string, unknown> => {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new ServiceError(400, "BAD_REQUEST", `${context} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ServiceError(400, "BAD_REQUEST", `${context} contains an unsupported field: ${key}`);
    }
  }
  return record;
};
