import { ServiceError } from "../errors.js";
import { requireExactObject } from "../validation.js";

export const OPAQUE_OBJECT_MEDIA_TYPE = "application/vnd.opaque-vault.v1+json";
export const MAX_CIPHERTEXT_BYTES = 1024 * 1024 + 16;
// Le quota d'octets reste la borne principale ; le quota de fichiers autorise
// plusieurs petits documents opaques sans révéler leur nature au service.
export const MAX_OBJECTS_PER_USER = 64;
export const MAX_USER_CIPHERTEXT_BYTES = 8 * 1024 * 1024;
export const MAX_CONCURRENT_OBJECT_REQUESTS = 16;
export const MAX_CONCURRENT_OBJECT_REQUESTS_PER_USER = 4;

const OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const REVISION_PATTERN = /^[a-f0-9]{32}$/;
const MUTATION_PATTERN = /^[a-f0-9]{32}$/;

/**
 * Horloge logique opaque attribuée par le service. Elle ordonne les mutations
 * acceptées sans faire confiance à l'horloge de l'appareil qui envoie l'objet.
 */
export type OpaqueObjectMutation = string;
export const LEGACY_OBJECT_MUTATION: OpaqueObjectMutation = "00000000000000000000000000000000";

export interface OpaqueObjectEnvelope {
  readonly algorithm: "A256GCM";
  readonly ciphertext: string;
  readonly iv: string;
  readonly version: 1;
}

export interface StoredOpaqueObject {
  readonly envelope: OpaqueObjectEnvelope;
  readonly mutation: OpaqueObjectMutation;
  readonly revision: string;
}

export type OpaqueObjectWriteCondition =
  | { readonly kind: "create" }
  | { readonly kind: "match"; readonly revision: string };

export interface OpaqueObjectWriteResult {
  readonly created: boolean;
  readonly mutation: OpaqueObjectMutation;
  readonly revision: string;
}

export interface OpaqueObjectStore {
  delete(userId: string, objectId: string, revision: string): Promise<void>;
  get(userId: string, objectId: string): Promise<StoredOpaqueObject | null>;
  put(
    userId: string,
    objectId: string,
    envelope: OpaqueObjectEnvelope,
    condition: OpaqueObjectWriteCondition,
  ): Promise<OpaqueObjectWriteResult>;
}

export const isObjectId = (value: unknown): value is string => {
  if (typeof value !== "string" || !OBJECT_ID_PATTERN.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === 16 && decoded.toString("base64url") === value;
};

export const requireObjectId = (value: unknown): string => {
  if (!isObjectId(value)) {
    throw new ServiceError(400, "BAD_REQUEST", "objectId is invalid");
  }
  return value;
};

export const isObjectRevision = (value: unknown): value is string =>
  typeof value === "string" && REVISION_PATTERN.test(value);

export const isObjectMutation = (value: unknown): value is OpaqueObjectMutation =>
  typeof value === "string" && MUTATION_PATTERN.test(value);

const decodeCanonicalBase64Url = (value: unknown, fieldName: string): Buffer => {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) {
    throw new ServiceError(400, "BAD_REQUEST", `${fieldName} must be unpadded base64url`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new ServiceError(400, "BAD_REQUEST", `${fieldName} must be canonical base64url`);
  }
  return decoded;
};

export const parseOpaqueObjectEnvelope = (value: unknown): OpaqueObjectEnvelope => {
  const record = requireExactObject(
    value,
    ["version", "algorithm", "iv", "ciphertext"],
    "opaque object envelope",
  );
  if (Object.keys(record).length !== 4 || record.version !== 1 || record.algorithm !== "A256GCM") {
    throw new ServiceError(400, "BAD_REQUEST", "Opaque object envelope is invalid");
  }
  const iv = decodeCanonicalBase64Url(record.iv, "iv");
  if (iv.length !== 12) {
    throw new ServiceError(400, "BAD_REQUEST", "iv must contain exactly 12 bytes");
  }
  const ciphertext = decodeCanonicalBase64Url(record.ciphertext, "ciphertext");
  if (ciphertext.length < 16) {
    throw new ServiceError(400, "BAD_REQUEST", "ciphertext is too short");
  }
  if (ciphertext.length > MAX_CIPHERTEXT_BYTES) {
    throw new ServiceError(413, "PAYLOAD_TOO_LARGE", "ciphertext is too large");
  }
  return {
    algorithm: "A256GCM",
    ciphertext: record.ciphertext as string,
    iv: record.iv as string,
    version: 1,
  };
};

export const ciphertextByteLength = (envelope: OpaqueObjectEnvelope): number =>
  Buffer.from(envelope.ciphertext, "base64url").length;

export const formatObjectEtag = (revision: string): string => {
  if (!isObjectRevision(revision)) {
    throw new Error("Cannot format an invalid object revision");
  }
  return `"r-${revision}"`;
};

export const parseObjectEtag = (value: string): string | null => {
  const match = /^"r-([a-f0-9]{32})"$/.exec(value);
  return match?.[1] ?? null;
};

export const formatObjectMutation = (mutation: OpaqueObjectMutation): string => {
  if (!isObjectMutation(mutation)) {
    throw new Error("Cannot format an invalid object mutation");
  }
  return `m-${mutation}`;
};
