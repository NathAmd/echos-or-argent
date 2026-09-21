import { ServiceError } from "../errors.js";
import { requireExactObject, requireUserId } from "../validation.js";

const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_SDP_BYTES = 24 * 1024;
const MAX_ICE_CANDIDATE_BYTES = 2 * 1024;
// 128 bits aléatoires en base64url canonique, sans signification applicative.
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const SDP_LINE_TYPE_PATTERN = /^[vosiuepcbtrzkam]=/;
const SDP_MEDIA_LINE_PATTERN = /^m=[^ \t]+ [0-9]+(?:\/[0-9]+)? [^ \t]+(?: [^ \t]+)+$/;
const ICE_FOUNDATION_PATTERN = /^[A-Za-z0-9+/]{1,32}$/;
const ICE_TOKEN_PATTERN = /^[\x21-\x7e]+$/;

export type SignalPayload =
  | { readonly sdp: string; readonly type: "offer" | "answer" }
  | {
      readonly candidate: string;
      readonly sdpMid?: string | null;
      readonly sdpMLineIndex?: number | null;
      readonly type: "ice";
      readonly usernameFragment?: string | null;
    }
  | { readonly type: "hangup" };

export interface SignalRequest {
  readonly negotiationId: string;
  readonly payload: SignalPayload;
  readonly requestId: string;
  readonly to: string;
  readonly type: "signal";
}

const requireBoundedString = (
  value: unknown,
  name: string,
  maximumBytes: number,
  allowEmpty = false,
): string => {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new ServiceError(400, "BAD_REQUEST", `${name} is invalid or too large`);
  }
  return value;
};

const isWebRtcSdp = (value: string): boolean => {
  if (!value.startsWith("v=0\r\n") && !value.startsWith("v=0\n")) return false;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || /\r(?!\n)/.test(value)) {
    return false;
  }
  const lines = value.split(/\r\n|\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length < 5 || lines.length > 1_024 || lines[0] !== "v=0") return false;
  let origin = 0;
  let sessionName = 0;
  let timing = 0;
  let media = 0;
  let iceUfrag = false;
  let icePassword = false;
  let fingerprint = false;
  for (const line of lines) {
    if (!line || !SDP_LINE_TYPE_PATTERN.test(line) || Buffer.byteLength(line, "utf8") > 4 * 1024) {
      return false;
    }
    if (line.startsWith("v=")) {
      if (line !== "v=0") return false;
    } else if (line.startsWith("o=")) origin += 1;
    else if (line.startsWith("s=")) sessionName += 1;
    else if (line.startsWith("t=")) timing += 1;
    else if (line.startsWith("m=")) {
      if (!SDP_MEDIA_LINE_PATTERN.test(line)) return false;
      media += 1;
    } else if (line.startsWith("a=ice-ufrag:") && line.length > "a=ice-ufrag:".length) iceUfrag = true;
    else if (line.startsWith("a=ice-pwd:") && line.length > "a=ice-pwd:".length) icePassword = true;
    else if (line.startsWith("a=fingerprint:") && line.length > "a=fingerprint:".length) fingerprint = true;
  }
  // Le serveur reconnaît la structure produite par RTCPeerConnection sans
  // prétendre détecter un canal caché construit par un client modifié.
  return origin === 1 && sessionName === 1 && timing >= 1 && media >= 1
    && iceUfrag && icePassword && fingerprint;
};

const isIceCandidate = (value: string): boolean => {
  if (value === "") return true;
  if (/[^\x20-\x7e]/.test(value) || /\s{2,}/.test(value)) return false;
  const tokens = value.split(" ");
  if (tokens.length < 8 || (tokens.length - 8) % 2 !== 0) return false;
  const foundation = tokens[0]?.slice("candidate:".length);
  const component = Number(tokens[1]);
  const priority = Number(tokens[3]);
  const port = Number(tokens[5]);
  if (!tokens[0]?.startsWith("candidate:") || !foundation || !ICE_FOUNDATION_PATTERN.test(foundation)) return false;
  if (!Number.isSafeInteger(component) || component < 1 || component > 256) return false;
  if (!/^(?:udp|tcp)$/i.test(tokens[2] ?? "")) return false;
  if (!/^[0-9]{1,10}$/.test(tokens[3] ?? "") || priority < 0 || priority > 4_294_967_295) return false;
  if (!ICE_TOKEN_PATTERN.test(tokens[4] ?? "")) return false;
  if (!/^[0-9]{1,5}$/.test(tokens[5] ?? "") || port < 0 || port > 65_535) return false;
  if (tokens[6] !== "typ" || !/^(?:host|srflx|prflx|relay)$/.test(tokens[7] ?? "")) return false;
  for (let index = 8; index < tokens.length; index += 2) {
    if (!/^[A-Za-z0-9-]{1,32}$/.test(tokens[index] ?? "") || !ICE_TOKEN_PATTERN.test(tokens[index + 1] ?? "")) {
      return false;
    }
  }
  return true;
};

const parseSignalPayload = (value: unknown): SignalPayload => {
  const base = requireExactObject(
    value,
    ["type", "sdp", "candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"],
    "payload",
  );
  if (base.type === "offer" || base.type === "answer") {
    const record = requireExactObject(base, ["type", "sdp"], "payload");
    const sdp = requireBoundedString(record.sdp, "payload.sdp", MAX_SDP_BYTES);
    if (!isWebRtcSdp(sdp)) {
      throw new ServiceError(400, "BAD_REQUEST", "payload.sdp is not a valid SDP envelope");
    }
    return {
      sdp,
      type: base.type,
    };
  }
  if (base.type === "ice") {
    const record = requireExactObject(
      base,
      ["type", "candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"],
      "payload",
    );
    const candidate = requireBoundedString(
      record.candidate,
      "payload.candidate",
      MAX_ICE_CANDIDATE_BYTES,
      true,
    );
    if (!isIceCandidate(candidate)) {
      throw new ServiceError(400, "BAD_REQUEST", "payload.candidate is not a valid ICE envelope");
    }
    const payload: {
      candidate: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
      type: "ice";
      usernameFragment?: string | null;
    } = {
      candidate,
      type: "ice",
    };
    if (record.sdpMid !== undefined) {
      payload.sdpMid =
        record.sdpMid === null
          ? null
          : requireBoundedString(record.sdpMid, "payload.sdpMid", 256, true);
      if (typeof payload.sdpMid === "string" && !/^[\x21-\x7e]{1,256}$/.test(payload.sdpMid)) {
        throw new ServiceError(400, "BAD_REQUEST", "payload.sdpMid is invalid");
      }
    }
    if (record.sdpMLineIndex !== undefined) {
      if (
        record.sdpMLineIndex !== null &&
        (!Number.isInteger(record.sdpMLineIndex) ||
          typeof record.sdpMLineIndex !== "number" ||
          record.sdpMLineIndex < 0 ||
          record.sdpMLineIndex > 65_535)
      ) {
        throw new ServiceError(400, "BAD_REQUEST", "payload.sdpMLineIndex is invalid");
      }
      payload.sdpMLineIndex = record.sdpMLineIndex as number | null;
    }
    if (record.usernameFragment !== undefined) {
      payload.usernameFragment =
        record.usernameFragment === null
          ? null
          : requireBoundedString(record.usernameFragment, "payload.usernameFragment", 256, true);
      if (
        typeof payload.usernameFragment === "string"
        && !/^[A-Za-z0-9+/]{4,256}$/.test(payload.usernameFragment)
      ) {
        throw new ServiceError(400, "BAD_REQUEST", "payload.usernameFragment is invalid");
      }
    }
    return payload;
  }
  if (base.type === "hangup") {
    requireExactObject(base, ["type"], "payload");
    return { type: "hangup" };
  }
  throw new ServiceError(400, "BAD_REQUEST", "Unsupported signal payload type");
};

export const parseClientMessage = (text: string): SignalRequest => {
  if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
    throw new ServiceError(413, "PAYLOAD_TOO_LARGE", "Realtime message is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ServiceError(400, "BAD_REQUEST", "Realtime message must be valid JSON");
  }
  const record = requireExactObject(
    parsed,
    ["type", "requestId", "negotiationId", "to", "payload"],
    "message",
  );
  if (record.type !== "signal") {
    throw new ServiceError(400, "BAD_REQUEST", "Unsupported realtime message type");
  }
  if (typeof record.requestId !== "string" || !OPAQUE_ID_PATTERN.test(record.requestId)) {
    throw new ServiceError(400, "BAD_REQUEST", "requestId is invalid");
  }
  if (
    typeof record.negotiationId !== "string" ||
    !OPAQUE_ID_PATTERN.test(record.negotiationId)
  ) {
    throw new ServiceError(400, "BAD_REQUEST", "negotiationId is invalid");
  }
  return {
    negotiationId: record.negotiationId,
    payload: parseSignalPayload(record.payload),
    requestId: record.requestId,
    to: requireUserId(record.to, "to"),
    type: "signal",
  };
};
