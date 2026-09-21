import { ServiceError } from "../errors.js";
import {
  isSharedSessionId,
  parseSharedSessionCommand,
  parseSharedPosition,
  type SharedPosition,
  type SharedSessionCommand,
} from "../domain/shared-sessions.js";

const MAX_MESSAGE_BYTES = 16 * 1024;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/;

export type SharedSessionClientMessage =
  | Readonly<{
      readonly requestId: string;
      readonly sessionId: string;
      readonly type: "attach";
    }>
  | Readonly<{
      readonly command: SharedSessionCommand;
      readonly requestId: string;
      readonly type: "command";
    }>
  | Readonly<{
      readonly requestId: string;
      readonly type: "detach";
    }>
  | Readonly<{
      readonly requestId: string;
      readonly type: "request-snapshot";
    }>
  | Readonly<{
      readonly admissionId: string;
      readonly decision:
        | Readonly<{ readonly arrival: SharedPosition; readonly kind: "accept" }>
        | Readonly<{ readonly kind: "accept" }>
        | Readonly<{ readonly code: string; readonly kind: "reject" }>;
      readonly type: "admission-response";
    }>;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
};

const hasExactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) return false;
  const expected = new Set(keys);
  return keys.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => expected.has(key));
};

const requireRequestId = (value: unknown): string => {
  if (typeof value !== "string" || !OPAQUE_ID_PATTERN.test(value)) {
    throw new ServiceError(400, "BAD_REQUEST", "requestId is invalid");
  }
  return value;
};

export const parseSharedSessionClientMessage = (text: string): SharedSessionClientMessage => {
  if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
    throw new ServiceError(413, "PAYLOAD_TOO_LARGE", "Realtime message is too large");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new ServiceError(400, "BAD_REQUEST", "Realtime message must be valid JSON");
  }
  if (!isPlainRecord(value) || typeof value.type !== "string") {
    throw new ServiceError(400, "BAD_REQUEST", "Realtime message is invalid");
  }
  if (value.type === "admission-response") {
    if (!hasExactKeys(value, ["type", "admissionId", "decision"])) {
      throw new ServiceError(400, "BAD_REQUEST", "Admission response is invalid");
    }
    const admissionId = requireRequestId(value.admissionId);
    if (!isPlainRecord(value.decision) || typeof value.decision.kind !== "string") {
      throw new ServiceError(400, "BAD_REQUEST", "Admission decision is invalid");
    }
    if (value.decision.kind === "accept") {
      const decisionKeys = Object.keys(value.decision);
      if (decisionKeys.length === 1 && decisionKeys[0] === "kind") {
        return { admissionId, decision: { kind: "accept" }, type: "admission-response" };
      }
      if (
        decisionKeys.length !== 2
        || !Object.hasOwn(value.decision, "arrival")
        || decisionKeys.some((key) => key !== "kind" && key !== "arrival")
      ) {
        throw new ServiceError(400, "BAD_REQUEST", "Admission acceptance is invalid");
      }
      const arrival = parseSharedPosition(value.decision.arrival);
      if (arrival === undefined) {
        throw new ServiceError(400, "BAD_REQUEST", "Admission arrival is invalid");
      }
      return { admissionId, decision: { arrival, kind: "accept" }, type: "admission-response" };
    }
    if (value.decision.kind === "reject") {
      if (
        !hasExactKeys(value.decision, ["kind", "code"])
        || typeof value.decision.code !== "string"
        || value.decision.code.length < 1
        || value.decision.code.length > 64
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.decision.code)
      ) {
        throw new ServiceError(400, "BAD_REQUEST", "Admission rejection is invalid");
      }
      return {
        admissionId,
        decision: { code: value.decision.code, kind: "reject" },
        type: "admission-response",
      };
    }
    throw new ServiceError(400, "BAD_REQUEST", "Admission decision is invalid");
  }
  if (value.type === "attach") {
    if (!hasExactKeys(value, ["type", "requestId", "sessionId"])) {
      throw new ServiceError(400, "BAD_REQUEST", "Attach message is invalid");
    }
    if (!isSharedSessionId(value.sessionId)) {
      throw new ServiceError(400, "BAD_REQUEST", "sessionId is invalid");
    }
    return {
      requestId: requireRequestId(value.requestId),
      sessionId: value.sessionId,
      type: "attach",
    };
  }
  if (value.type === "command") {
    if (!hasExactKeys(value, ["type", "requestId", "command"])) {
      throw new ServiceError(400, "BAD_REQUEST", "Command message is invalid");
    }
    const command = parseSharedSessionCommand(value.command);
    if (command === undefined) {
      throw new ServiceError(400, "BAD_REQUEST", "Shared session command is invalid");
    }
    return {
      command,
      requestId: requireRequestId(value.requestId),
      type: "command",
    };
  }
  if (value.type === "detach" || value.type === "request-snapshot") {
    if (!hasExactKeys(value, ["type", "requestId"])) {
      throw new ServiceError(400, "BAD_REQUEST", "Realtime request is invalid");
    }
    return {
      requestId: requireRequestId(value.requestId),
      type: value.type,
    };
  }
  throw new ServiceError(400, "BAD_REQUEST", "Unsupported realtime message type");
};
