import { isUserId } from "../validation.js";
import type {
  SharedSessionStore,
  StoredSharedSession,
  StoredSharedSessionContinuityHead,
  StoredSharedSessionState,
} from "../persistence/shared-session-store.js";

export const SHARED_SESSION_PROTOCOL_VERSION = 2 as const;
const PROTOCOL_VERSION = SHARED_SESSION_PROTOCOL_VERSION;
const MAX_COORDINATE = 1_000_000;
const MAX_MAP_ID = 0xffff;
const MAX_SPRITE_ID = 0xffff;
const MAX_COMMAND_ID_LENGTH = 128;
const MAX_APPLICATION_ID_LENGTH = 32;
const MAX_PENDING_EVENTS = 128;
const MAX_EVENT_EFFECTS_PER_COMMAND = 32;
const MAX_PROGRESSION_COUNTERS = 256;
const MAX_PROGRESSION_MILESTONES = 512;
const MIN_PROGRESSION_COUNTER_VALUE = -1_000_000_000;
const MAX_PROGRESSION_COUNTER_VALUE = 1_000_000_000;
const MAX_SESSIONS = 1_024;
const MAX_CONTINUITY_HEADS = 65_536;
const MAX_SESSIONS_PER_USER = 4;
const MAX_REMEMBERED_COMMANDS_PER_USER = 256;
const MAX_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_SHARED_SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1_000;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const APPLICATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONTINUITY_FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type SharedDirection = "north" | "south" | "west" | "east";

export interface SharedPosition {
  readonly direction: SharedDirection;
  readonly mapId: number;
  readonly x: number;
  readonly z: number;
}

export interface SharedCompatibility {
  readonly applicationId: string;
  readonly locale: number;
  readonly release: number;
}

export interface SharedPlayerProfile {
  readonly displayName: string;
  readonly gender: "male" | "female";
  readonly position: SharedPosition;
  readonly spriteId: number;
}

export interface SharedJoinInput {
  readonly compatibility: SharedCompatibility;
  readonly player: SharedPlayerProfile;
  readonly sessionId: string;
  readonly userId: string;
}

export interface SharedJoinInspection {
  readonly compatibility: SharedCompatibility;
  readonly kind: "already-member" | "requires-admission";
  readonly ownerId: string;
  readonly player: SharedPlayerProfile;
  readonly snapshot: SharedSessionSnapshot;
}

export interface SharedPlayerSnapshot extends SharedPlayerProfile {
  readonly movementSequence: number;
  readonly playerId: string;
  readonly state: "active" | "away";
}

export interface SharedProgression {
  readonly counters: readonly Readonly<{ readonly id: string; readonly value: number }>[];
  readonly milestoneIds: readonly string[];
}

export interface SharedSessionSnapshot {
  readonly pendingEvents: readonly SharedPendingEventSnapshot[];
  readonly players: readonly SharedPlayerSnapshot[];
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly revision: number;
  readonly sessionId: string;
  readonly sharedProgression: SharedProgression;
}

export interface SharedPendingEventSnapshot {
  readonly eventId: string;
  readonly eventRevision: number;
  readonly pendingPlayerIds: readonly string[];
}

export interface SharedMovementCommand {
  readonly arrival?: SharedPosition;
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly from: SharedPosition;
  readonly kind: "movement";
  readonly mode: "walk" | "run";
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly sequence: number;
  readonly to: SharedPosition;
}

export interface SharedProgressionCounterMutation {
  readonly expectedValue: number | null;
  readonly id: string;
  readonly value: number;
}

export interface SharedEventCommand {
  readonly commandId: string;
  readonly counters: readonly SharedProgressionCounterMutation[];
  readonly eventId: string;
  readonly expectedRevision: number;
  readonly kind: "shared-event";
  readonly milestoneIds: readonly string[];
  readonly protocolVersion: typeof PROTOCOL_VERSION;
}

export interface SharedEventAcknowledgementCommand {
  readonly commandId: string;
  readonly eventId: string;
  readonly eventRevision: number;
  readonly expectedRevision: number;
  readonly kind: "event-ack";
  readonly protocolVersion: typeof PROTOCOL_VERSION;
}

export type SharedSessionCommand =
  | SharedMovementCommand
  | SharedEventCommand
  | SharedEventAcknowledgementCommand;

export type SharedSessionErrorCode =
  | "command-id-conflict"
  | "compatibility-mismatch"
  | "continuity-active"
  | "continuity-capacity-reached"
  | "continuity-divergent"
  | "continuity-future"
  | "continuity-owner-conflict"
  | "continuity-stale"
  | "continuity-state-conflict"
  | "event-already-acknowledged"
  | "event-already-committed"
  | "event-capacity-reached"
  | "event-not-pending"
  | "event-revision-conflict"
  | "event-state-conflict"
  | "invalid-command"
  | "invalid-input"
  | "join-rejected"
  | "join-unattested"
  | "movement-destination-occupied"
  | "movement-origin-conflict"
  | "movement-sequence-conflict"
  | "movement-state-conflict"
  | "movement-step-conflict"
  | "peer-mismatch"
  | "player-not-found"
  | "port-failed"
  | "port-rejected"
  | "position-occupied"
  | "progression-capacity-reached"
  | "progression-counter-conflict"
  | "revision-conflict"
  | "revision-exhausted"
  | "session-mutation-in-progress"
  | "session-exists"
  | "session-limit"
  | "session-not-found"
  | "transition-attestation-mismatch"
  | "transition-unattested";

export interface SharedSessionError {
  readonly code: SharedSessionErrorCode;
  readonly commandId?: string;
  readonly counterId?: string;
  readonly eventId?: string;
  readonly eventRevision?: number;
  readonly expectedRevision?: number;
  readonly message: string;
  readonly playerId?: string;
  readonly portCode?: string;
  readonly receivedRevision?: number;
  readonly sessionId: string;
}

export type SharedSessionResult<Value> =
  | Readonly<{ readonly ok: true; readonly value: Value }>
  | Readonly<{ readonly error: SharedSessionError; readonly ok: false }>;

export type SharedSessionEvent =
  | Readonly<{ readonly snapshot: SharedSessionSnapshot; readonly type: "snapshot" }>
  | Readonly<{
      readonly reason: "idle-timeout" | "member-left" | "owner-left" | "server-shutdown";
      readonly sessionId: string;
      readonly type: "ended";
    }>;

export interface SharedMovementAdmissionInput {
  readonly command: SharedMovementCommand;
  readonly playerId: string;
  readonly sessionId: string;
  readonly snapshot: SharedSessionSnapshot;
}

export interface SharedEventAdmissionInput {
  readonly command: SharedEventCommand;
  readonly compatibility: SharedCompatibility;
  readonly playerId: string;
  readonly sessionId: string;
  readonly snapshot: SharedSessionSnapshot;
}

export type SharedAdmissionDecision =
  | Readonly<{ readonly kind: "accept" }>
  | Readonly<{ readonly code: string; readonly kind: "reject"; readonly message: string }>;

export type SharedMovementAdmissionDecision = SharedAdmissionDecision;
export type SharedEventAdmissionDecision = SharedAdmissionDecision;

export interface SharedSessionContinuityInspectionInput {
  readonly compatibility: SharedCompatibility;
  readonly sharedProgression: SharedProgression;
}

export type SharedSessionContinuityInspection =
  | Readonly<{ readonly kind: "unclaimed" }>
  | Readonly<{
      readonly continuityId: string;
      readonly fingerprint: string;
      readonly kind: "claim";
      readonly revision: number;
    }>
  | Readonly<{ readonly code: string; readonly kind: "reject"; readonly message: string }>;

export interface SharedSessionContinuityPolicy {
  readonly inspect: (
    input: SharedSessionContinuityInspectionInput,
  ) => SharedSessionContinuityInspection;
  readonly policyId: string;
}

export interface SharedSessionServiceOptions {
  readonly continuityPolicy?: SharedSessionContinuityPolicy;
  readonly idleTtlMs?: number;
  readonly maximumSessions?: number;
  readonly maximumSessionsPerUser?: number;
  readonly movementAdmission?: (
    input: SharedMovementAdmissionInput,
  ) => SharedMovementAdmissionDecision;
  readonly now?: () => number;
  readonly sharedEventAdmission?: (
    input: SharedEventAdmissionInput,
  ) => SharedEventAdmissionDecision;
  readonly store?: SharedSessionStore;
}

export interface SharedMovementSubmissionOptions {
  readonly arrivalAttestation?: SharedPosition;
}

interface RememberedCommand {
  readonly appliedRevision: number;
  readonly fingerprint: string;
}

interface CommandCache {
  readonly entries: Map<string, RememberedCommand>;
  readonly order: string[];
}

interface ListenerRecord {
  readonly listener: (event: SharedSessionEvent) => void;
  readonly userId: string;
}

interface SessionRecord {
  readonly commandCaches: Map<string, CommandCache>;
  readonly compatibility: SharedCompatibility;
  readonly connectedUsers: Set<string>;
  readonly listeners: Set<ListenerRecord>;
  readonly ownerId: string;
  readonly pendingEvents: Map<string, SharedPendingEventSnapshot>;
  readonly peerUserId: string;
  continuity: SessionContinuityClaim | undefined;
  evaluatingAdmission: boolean;
  lastActivityAt: number;
  snapshot: SharedSessionSnapshot;
}

interface SessionCheckpoint {
  readonly commandCaches: Map<string, CommandCache>;
  readonly connectedUsers: Set<string>;
  readonly continuity: SessionContinuityClaim | undefined;
  readonly continuityHeads: Map<string, ContinuityHead>;
  readonly lastActivityAt: number;
  readonly pendingEvents: Map<string, SharedPendingEventSnapshot>;
  readonly snapshot: SharedSessionSnapshot;
}

interface SessionContinuityClaim {
  readonly continuityId: string;
  readonly fingerprint: string;
  readonly key: string;
  readonly policyId: string;
  readonly revision: number;
}

interface ContinuityHead extends SessionContinuityClaim {
  readonly activeSessionId?: string;
  readonly ownerId: string;
}

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

const hasExactKeys = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
};

const isBoundedInteger = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number"
  && Number.isSafeInteger(value)
  && value >= minimum
  && value <= maximum;

const isDenseArray = (value: unknown, maximumLength: number): value is unknown[] => {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximumLength
    || Object.keys(value).length !== value.length
  ) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.every((key) => key === "length"
    || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)))
    && value.every((_entry, index) => Object.hasOwn(value, index));
};

const deepFreeze = <Value>(value: Value): Value => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
};

const parseDirection = (value: unknown): SharedDirection | undefined =>
  value === "north" || value === "south" || value === "west" || value === "east"
    ? value
    : undefined;

export const isSharedSessionId = (value: unknown): value is string =>
  typeof value === "string" && OPAQUE_ID_PATTERN.test(value);

const parseIdentifier = (value: unknown): string | undefined =>
  typeof value === "string"
  && value.length <= MAX_COMMAND_ID_LENGTH
  && IDENTIFIER_PATTERN.test(value)
    ? value
    : undefined;

const parseIdentifierList = (value: unknown, maximumLength: number): readonly string[] | undefined => {
  if (!isDenseArray(value, maximumLength)) return undefined;
  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const identifier = parseIdentifier(entry);
    if (identifier === undefined || seen.has(identifier)) return undefined;
    seen.add(identifier);
    parsed.push(identifier);
  }
  return deepFreeze(parsed);
};

export const parseSharedProgression = (value: unknown): SharedProgression | undefined => {
  if (!hasExactKeys(value, ["counters", "milestoneIds"])) return undefined;
  const milestoneIds = parseIdentifierList(value.milestoneIds, MAX_PROGRESSION_MILESTONES);
  if (milestoneIds === undefined || !isDenseArray(value.counters, MAX_PROGRESSION_COUNTERS)) {
    return undefined;
  }
  const counterIds = new Set<string>();
  const counters: Array<Readonly<{ id: string; value: number }>> = [];
  for (const rawCounter of value.counters) {
    if (!hasExactKeys(rawCounter, ["id", "value"])) return undefined;
    const id = parseIdentifier(rawCounter.id);
    if (
      id === undefined
      || counterIds.has(id)
      || !isBoundedInteger(
        rawCounter.value,
        MIN_PROGRESSION_COUNTER_VALUE,
        MAX_PROGRESSION_COUNTER_VALUE,
      )
    ) return undefined;
    counterIds.add(id);
    counters.push(deepFreeze({ id, value: rawCounter.value }));
  }
  return deepFreeze({ counters, milestoneIds });
};

export const parseSharedCompatibility = (value: unknown): SharedCompatibility | undefined => {
  if (!hasExactKeys(value, ["applicationId", "release", "locale"])) return undefined;
  if (
    typeof value.applicationId !== "string"
    || value.applicationId.length > MAX_APPLICATION_ID_LENGTH
    || !APPLICATION_ID_PATTERN.test(value.applicationId)
    || !isBoundedInteger(value.release, 0, 0xffff)
    || !isBoundedInteger(value.locale, 0, 0xff)
  ) return undefined;
  return deepFreeze({
    applicationId: value.applicationId,
    locale: value.locale,
    release: value.release,
  });
};

export const parseSharedPosition = (value: unknown): SharedPosition | undefined => {
  if (!hasExactKeys(value, ["mapId", "x", "z", "direction"])) return undefined;
  const direction = parseDirection(value.direction);
  if (
    direction === undefined
    || !isBoundedInteger(value.mapId, 0, MAX_MAP_ID)
    || !isBoundedInteger(value.x, -MAX_COORDINATE, MAX_COORDINATE)
    || !isBoundedInteger(value.z, -MAX_COORDINATE, MAX_COORDINATE)
  ) return undefined;
  return deepFreeze({ direction, mapId: value.mapId, x: value.x, z: value.z });
};

const parseDisplayName = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.trim() !== value) return undefined;
  const characters = [...value];
  if (characters.length < 1 || characters.length > 7) return undefined;
  return characters.some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  }) ? undefined : value;
};

export const parseSharedPlayerProfile = (value: unknown): SharedPlayerProfile | undefined => {
  if (!hasExactKeys(value, ["displayName", "gender", "position", "spriteId"])) return undefined;
  const displayName = parseDisplayName(value.displayName);
  const position = parseSharedPosition(value.position);
  if (
    displayName === undefined
    || position === undefined
    || (value.gender !== "male" && value.gender !== "female")
    || !isBoundedInteger(value.spriteId, 0, MAX_SPRITE_ID)
  ) return undefined;
  return deepFreeze({
    displayName,
    gender: value.gender,
    position,
    spriteId: value.spriteId,
  });
};

export const parseSharedMovementCommand = (value: unknown): SharedMovementCommand | undefined => {
  if (!hasExactKeys(
    value,
    ["protocolVersion", "commandId", "expectedRevision", "kind", "sequence", "from", "to", "mode"],
    ["arrival"],
  )) return undefined;
  const from = parseSharedPosition(value.from);
  const to = parseSharedPosition(value.to);
  const hasArrival = Object.hasOwn(value, "arrival");
  const arrival = hasArrival ? parseSharedPosition(value.arrival) : undefined;
  if (
    value.protocolVersion !== PROTOCOL_VERSION
    || value.kind !== "movement"
    || typeof value.commandId !== "string"
    || value.commandId.length > MAX_COMMAND_ID_LENGTH
    || !IDENTIFIER_PATTERN.test(value.commandId)
    || !isBoundedInteger(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER)
    || !isBoundedInteger(value.sequence, 0, Number.MAX_SAFE_INTEGER)
    || from === undefined
    || to === undefined
    || (hasArrival && arrival === undefined)
    || (value.mode !== "walk" && value.mode !== "run")
  ) return undefined;
  if (arrival !== undefined && samePosition(arrival, to)) return undefined;
  return deepFreeze({
    ...(arrival === undefined ? {} : { arrival }),
    commandId: value.commandId,
    expectedRevision: value.expectedRevision,
    from,
    kind: "movement" as const,
    mode: value.mode,
    protocolVersion: PROTOCOL_VERSION,
    sequence: value.sequence,
    to,
  });
};

export const parseSharedEventCommand = (value: unknown): SharedEventCommand | undefined => {
  if (!hasExactKeys(
    value,
    [
      "protocolVersion",
      "commandId",
      "expectedRevision",
      "kind",
      "eventId",
      "milestoneIds",
      "counters",
    ],
  )) return undefined;
  const commandId = parseIdentifier(value.commandId);
  const eventId = parseIdentifier(value.eventId);
  const milestoneIds = parseIdentifierList(value.milestoneIds, MAX_EVENT_EFFECTS_PER_COMMAND);
  if (
    value.protocolVersion !== PROTOCOL_VERSION
    || value.kind !== "shared-event"
    || commandId === undefined
    || eventId === undefined
    || !isBoundedInteger(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER)
    || milestoneIds === undefined
    || !isDenseArray(value.counters, MAX_EVENT_EFFECTS_PER_COMMAND)
  ) return undefined;
  const counterIds = new Set<string>();
  const counters: SharedProgressionCounterMutation[] = [];
  for (const rawCounter of value.counters) {
    if (!hasExactKeys(rawCounter, ["id", "expectedValue", "value"])) return undefined;
    const id = parseIdentifier(rawCounter.id);
    if (
      id === undefined
      || counterIds.has(id)
      || (rawCounter.expectedValue !== null && !isBoundedInteger(
        rawCounter.expectedValue,
        MIN_PROGRESSION_COUNTER_VALUE,
        MAX_PROGRESSION_COUNTER_VALUE,
      ))
      || !isBoundedInteger(
        rawCounter.value,
        MIN_PROGRESSION_COUNTER_VALUE,
        MAX_PROGRESSION_COUNTER_VALUE,
      )
    ) return undefined;
    counterIds.add(id);
    counters.push(deepFreeze({
      expectedValue: rawCounter.expectedValue,
      id,
      value: rawCounter.value,
    }));
  }
  return deepFreeze({
    commandId,
    counters,
    eventId,
    expectedRevision: value.expectedRevision,
    kind: "shared-event" as const,
    milestoneIds,
    protocolVersion: PROTOCOL_VERSION,
  });
};

export const parseSharedEventAcknowledgementCommand = (
  value: unknown,
): SharedEventAcknowledgementCommand | undefined => {
  if (!hasExactKeys(
    value,
    ["protocolVersion", "commandId", "expectedRevision", "kind", "eventId", "eventRevision"],
  )) return undefined;
  const commandId = parseIdentifier(value.commandId);
  const eventId = parseIdentifier(value.eventId);
  if (
    value.protocolVersion !== PROTOCOL_VERSION
    || value.kind !== "event-ack"
    || commandId === undefined
    || eventId === undefined
    || !isBoundedInteger(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER)
    || !isBoundedInteger(value.eventRevision, 1, Number.MAX_SAFE_INTEGER)
  ) return undefined;
  return deepFreeze({
    commandId,
    eventId,
    eventRevision: value.eventRevision,
    expectedRevision: value.expectedRevision,
    kind: "event-ack" as const,
    protocolVersion: PROTOCOL_VERSION,
  });
};

export const parseSharedSessionCommand = (value: unknown): SharedSessionCommand | undefined => {
  if (!isPlainRecord(value)) return undefined;
  if (value.kind === "movement") return parseSharedMovementCommand(value);
  if (value.kind === "shared-event") return parseSharedEventCommand(value);
  if (value.kind === "event-ack") return parseSharedEventAcknowledgementCommand(value);
  return undefined;
};

const sameCompatibility = (first: SharedCompatibility, second: SharedCompatibility): boolean =>
  first.applicationId === second.applicationId
  && first.release === second.release
  && first.locale === second.locale;

const samePosition = (first: SharedPosition, second: SharedPosition): boolean =>
  first.mapId === second.mapId
  && first.x === second.x
  && first.z === second.z
  && first.direction === second.direction;

const occupiesSameTile = (first: SharedPosition, second: SharedPosition): boolean =>
  first.mapId === second.mapId && first.x === second.x && first.z === second.z;

const isSingleCardinalStep = (from: SharedPosition, to: SharedPosition): boolean => {
  const deltaX = to.x - from.x;
  const deltaZ = to.z - from.z;
  const direction = deltaX === 1 && deltaZ === 0 ? "east"
    : deltaX === -1 && deltaZ === 0 ? "west"
      : deltaX === 0 && deltaZ === 1 ? "south"
        : deltaX === 0 && deltaZ === -1 ? "north"
          : undefined;
  return from.mapId === to.mapId && direction === to.direction;
};

const createSnapshot = (
  sessionId: string,
  revision: number,
  players: readonly SharedPlayerSnapshot[],
  sharedProgression: SharedProgression = { counters: [], milestoneIds: [] },
): SharedSessionSnapshot => deepFreeze({
  pendingEvents: [],
  players,
  protocolVersion: PROTOCOL_VERSION,
  revision,
  sessionId,
  sharedProgression,
});

const advanceSnapshot = (
  current: SharedSessionSnapshot,
  revision: number,
  players: readonly SharedPlayerSnapshot[] = current.players,
  patch: Readonly<{
    pendingEvents?: readonly SharedPendingEventSnapshot[];
    sharedProgression?: SharedSessionSnapshot["sharedProgression"];
  }> = {},
): SharedSessionSnapshot => deepFreeze({
  pendingEvents: patch.pendingEvents ?? current.pendingEvents,
  players,
  protocolVersion: PROTOCOL_VERSION,
  revision,
  sessionId: current.sessionId,
  sharedProgression: patch.sharedProgression ?? current.sharedProgression,
});

const failure = (
  sessionId: string,
  code: SharedSessionErrorCode,
  message: string,
  details: Omit<SharedSessionError, "code" | "message" | "sessionId"> = {},
): SharedSessionResult<never> => deepFreeze({
  error: { code, message, sessionId, ...details },
  ok: false,
});

const success = <Value>(value: Value): SharedSessionResult<Value> =>
  deepFreeze({ ok: true, value });

const parseAdmissionDecision = (value: unknown): SharedAdmissionDecision | undefined => {
  if (!isPlainRecord(value) || (value.kind !== "accept" && value.kind !== "reject")) return undefined;
  if (value.kind === "accept") {
    return hasExactKeys(value, ["kind"])
      ? deepFreeze({ kind: "accept" as const })
      : undefined;
  }
  if (
    !hasExactKeys(value, ["kind", "code", "message"])
    || typeof value.code !== "string"
    || value.code.length < 1
    || value.code.length > 64
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.code)
    || typeof value.message !== "string"
    || value.message.length < 1
    || Buffer.byteLength(value.message, "utf8") > 512
  ) return undefined;
  return deepFreeze({ code: value.code, kind: "reject" as const, message: value.message });
};

const continuityKey = (policyId: string, continuityId: string): string =>
  JSON.stringify([policyId, continuityId]);

const parseContinuityInspection = (
  value: unknown,
): SharedSessionContinuityInspection | undefined => {
  if (!isPlainRecord(value)) return undefined;
  if (value.kind === "unclaimed") {
    return hasExactKeys(value, ["kind"])
      ? deepFreeze({ kind: "unclaimed" as const })
      : undefined;
  }
  if (value.kind === "reject") {
    const decision = parseAdmissionDecision(value);
    return decision?.kind === "reject" ? decision : undefined;
  }
  if (
    value.kind !== "claim"
    || !hasExactKeys(value, ["kind", "continuityId", "fingerprint", "revision"])
    || typeof value.continuityId !== "string"
    || value.continuityId.length > MAX_COMMAND_ID_LENGTH
    || !IDENTIFIER_PATTERN.test(value.continuityId)
    || typeof value.fingerprint !== "string"
    || !CONTINUITY_FINGERPRINT_PATTERN.test(value.fingerprint)
    || !isBoundedInteger(value.revision, 0, Number.MAX_SAFE_INTEGER)
  ) return undefined;
  return deepFreeze({
    continuityId: value.continuityId,
    fingerprint: value.fingerprint,
    kind: "claim" as const,
    revision: value.revision,
  });
};

const nextRevision = (snapshot: SharedSessionSnapshot): number | undefined =>
  snapshot.revision === Number.MAX_SAFE_INTEGER ? undefined : snapshot.revision + 1;

const profileSnapshot = (userId: string, profile: SharedPlayerProfile): SharedPlayerSnapshot =>
  deepFreeze({
    ...profile,
    movementSequence: 0,
    playerId: userId,
    state: "active" as const,
  });

export class SharedSessionService {
  private closeTask: Promise<void> | undefined;
  private readonly continuityHeads = new Map<string, ContinuityHead>();
  private readonly continuityPolicy: SharedSessionContinuityPolicy | undefined;
  private readonly idleTtlMs: number;
  private readonly maintenanceTimer: NodeJS.Timeout;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly maximumSessions: number;
  private readonly maximumSessionsPerUser: number;
  private readonly movementAdmission: ((
    input: SharedMovementAdmissionInput,
  ) => SharedMovementAdmissionDecision) | undefined;
  private readonly now: () => number;
  private readonly sharedEventAdmission: ((
    input: SharedEventAdmissionInput,
  ) => SharedEventAdmissionDecision) | undefined;
  private readonly store: SharedSessionStore | undefined;
  private stopped = false;

  constructor(options: SharedSessionServiceOptions = {}) {
    this.continuityPolicy = options.continuityPolicy;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_SHARED_SESSION_IDLE_TTL_MS;
    this.maximumSessions = options.maximumSessions ?? MAX_SESSIONS;
    this.maximumSessionsPerUser = options.maximumSessionsPerUser ?? MAX_SESSIONS_PER_USER;
    this.movementAdmission = options.movementAdmission;
    this.now = options.now ?? Date.now;
    this.sharedEventAdmission = options.sharedEventAdmission;
    this.store = options.store;
    if (
      this.continuityPolicy !== undefined
      && (
        this.continuityPolicy === null
        || typeof this.continuityPolicy !== "object"
        || typeof this.continuityPolicy.inspect !== "function"
        || typeof this.continuityPolicy.policyId !== "string"
        || this.continuityPolicy.policyId.length > 64
        || !IDENTIFIER_PATTERN.test(this.continuityPolicy.policyId)
      )
    ) throw new TypeError("continuityPolicy is invalid");
    if (!Number.isSafeInteger(this.idleTtlMs) || this.idleTtlMs < 1_000 || this.idleTtlMs > MAX_IDLE_TTL_MS) {
      throw new TypeError("idleTtlMs is outside the supported range");
    }
    if (!Number.isSafeInteger(this.maximumSessions) || this.maximumSessions < 1 || this.maximumSessions > 10_000) {
      throw new TypeError("maximumSessions is outside the supported range");
    }
    if (
      !Number.isSafeInteger(this.maximumSessionsPerUser)
      || this.maximumSessionsPerUser < 1
      || this.maximumSessionsPerUser > 16
    ) {
      throw new TypeError("maximumSessionsPerUser is outside the supported range");
    }
    this.restoreStoredSessions();
    const maintenanceIntervalMs = Math.min(60_000, Math.max(1_000, Math.floor(this.idleTtlMs / 4)));
    this.maintenanceTimer = setInterval(() => {
      try {
        this.purgeExpired();
      } catch {
        // A failed durable deletion remains visible and can be retried on the next pass.
      }
    }, maintenanceIntervalMs);
    this.maintenanceTimer.unref();
  }

  create(input: Readonly<{
    compatibility: SharedCompatibility;
    ownerId: string;
    peerUserId: string;
    player: SharedPlayerProfile;
    sessionId: string;
    sharedProgression?: SharedProgression;
  }>): SharedSessionResult<SharedSessionSnapshot> {
    this.requireRunning();
    this.purgeExpired();
    const compatibility = parseSharedCompatibility(input.compatibility);
    const player = parseSharedPlayerProfile(input.player);
    const sharedProgression = input.sharedProgression === undefined
      ? deepFreeze({ counters: [], milestoneIds: [] })
      : parseSharedProgression(input.sharedProgression);
    if (
      !isSharedSessionId(input.sessionId)
      || !isUserId(input.ownerId)
      || !isUserId(input.peerUserId)
      || compatibility === undefined
      || player === undefined
      || sharedProgression === undefined
    ) {
      return failure(input.sessionId, "invalid-input", "The shared session input is invalid");
    }
    if (this.sessions.has(input.sessionId)) {
      return failure(input.sessionId, "session-exists", "The shared session already exists");
    }
    if (
      this.sessions.size >= this.maximumSessions
      || this.membershipCount(input.ownerId) >= this.maximumSessionsPerUser
    ) {
      return failure(input.sessionId, "session-limit", "Shared session capacity reached");
    }
    if (input.ownerId === input.peerUserId) {
      return failure(input.sessionId, "peer-mismatch", "The invited identity must be different");
    }
    const inspectedContinuity = this.inspectContinuity(
      input.sessionId,
      compatibility,
      sharedProgression,
    );
    if (!inspectedContinuity.ok) return inspectedContinuity;
    const continuity = inspectedContinuity.value;
    const previousHead = continuity === undefined
      ? undefined
      : this.continuityHeads.get(continuity.key);
    if (continuity !== undefined && previousHead !== undefined) {
      if (previousHead.ownerId !== input.ownerId) {
        return failure(
          input.sessionId,
          "continuity-owner-conflict",
          "This continuity belongs to a different identity",
        );
      }
      if (previousHead.activeSessionId !== undefined) {
        return failure(
          input.sessionId,
          "continuity-active",
          "This continuity already has an active shared session",
        );
      }
      if (continuity.revision < previousHead.revision) {
        return failure(
          input.sessionId,
          "continuity-stale",
          "This continuity is older than its durable state",
        );
      }
      if (continuity.revision > previousHead.revision) {
        return failure(
          input.sessionId,
          "continuity-future",
          "This continuity is ahead of its durable state",
        );
      }
      if (continuity.fingerprint !== previousHead.fingerprint) {
        return failure(
          input.sessionId,
          "continuity-divergent",
          "This continuity differs from its durable state",
        );
      }
    }
    if (
      continuity !== undefined
      && previousHead === undefined
      && this.continuityHeads.size >= MAX_CONTINUITY_HEADS
    ) {
      return failure(
        input.sessionId,
        "continuity-capacity-reached",
        "Continuity capacity reached",
      );
    }
    const snapshot = createSnapshot(
      input.sessionId,
      0,
      [profileSnapshot(input.ownerId, player)],
      sharedProgression,
    );
    const session: SessionRecord = {
      commandCaches: new Map([[input.ownerId, { entries: new Map(), order: [] }]]),
      compatibility,
      connectedUsers: new Set(),
      continuity,
      evaluatingAdmission: false,
      listeners: new Set(),
      ownerId: input.ownerId,
      pendingEvents: new Map(),
      peerUserId: input.peerUserId,
      lastActivityAt: this.now(),
      snapshot,
    };
    this.sessions.set(input.sessionId, session);
    if (continuity !== undefined) {
      this.continuityHeads.set(continuity.key, deepFreeze({
        ...continuity,
        activeSessionId: input.sessionId,
        ownerId: input.ownerId,
      }));
    }
    try {
      this.persist();
    } catch (error) {
      this.sessions.delete(input.sessionId);
      if (continuity !== undefined) {
        if (previousHead === undefined) this.continuityHeads.delete(continuity.key);
        else this.continuityHeads.set(continuity.key, previousHead);
      }
      throw error;
    }
    return success(snapshot);
  }

  resumeOwner(input: Readonly<{
    compatibility: SharedCompatibility;
    ownerId: string;
    peerUserId: string;
    sessionId: string;
  }>): SharedSessionResult<SharedSessionSnapshot> {
    this.requireRunning();
    this.purgeExpired();
    const compatibility = parseSharedCompatibility(input.compatibility);
    if (
      !isSharedSessionId(input.sessionId)
      || !isUserId(input.ownerId)
      || !isUserId(input.peerUserId)
      || input.ownerId === input.peerUserId
      || compatibility === undefined
    ) {
      return failure(input.sessionId, "invalid-input", "The shared session input is invalid");
    }
    const session = this.sessions.get(input.sessionId);
    if (session === undefined) return this.missingSession(input.sessionId);
    if (session.ownerId !== input.ownerId || session.peerUserId !== input.peerUserId) {
      return failure(input.sessionId, "peer-mismatch", "The shared session route differs", {
        playerId: input.ownerId,
      });
    }
    if (!sameCompatibility(session.compatibility, compatibility)) {
      return failure(
        input.sessionId,
        "compatibility-mismatch",
        "The client compatibility descriptor differs",
        { playerId: input.ownerId },
      );
    }
    if (!this.hasMember(session, input.ownerId)) {
      return this.missingPlayer(input.sessionId, input.ownerId);
    }
    this.persistMutation(session, () => this.touch(session));
    return success(session.snapshot);
  }

  inspectJoin(input: SharedJoinInput): SharedSessionResult<SharedJoinInspection> {
    this.requireRunning();
    const compatibility = parseSharedCompatibility(input.compatibility);
    const player = parseSharedPlayerProfile(input.player);
    if (
      !isSharedSessionId(input.sessionId)
      || !isUserId(input.userId)
      || compatibility === undefined
      || player === undefined
    ) {
      return failure(input.sessionId, "invalid-input", "The shared session input is invalid", {
        playerId: input.userId,
      });
    }
    const session = this.sessions.get(input.sessionId);
    if (session === undefined) return this.missingSession(input.sessionId);
    if (session.evaluatingAdmission) return this.mutationInProgress(input.sessionId, input.userId);
    if (input.userId !== session.peerUserId) {
      return failure(input.sessionId, "peer-mismatch", "This identity is not invited", {
        playerId: input.userId,
      });
    }
    if (!sameCompatibility(session.compatibility, compatibility)) {
      return failure(input.sessionId, "compatibility-mismatch", "The client compatibility descriptor differs", {
        playerId: input.userId,
      });
    }
    const existing = session.snapshot.players.find(({ playerId }) => playerId === input.userId);
    if (existing !== undefined) {
      if (
        existing.displayName !== player.displayName
        || existing.gender !== player.gender
        || existing.spriteId !== player.spriteId
      ) {
        return failure(input.sessionId, "peer-mismatch", "The existing player profile differs", {
          playerId: input.userId,
        });
      }
      return success({
        compatibility,
        kind: "already-member",
        ownerId: session.ownerId,
        player,
        snapshot: session.snapshot,
      });
    }
    if (this.membershipCount(input.userId) >= this.maximumSessionsPerUser) {
      return failure(input.sessionId, "session-limit", "Shared session capacity reached", {
        playerId: input.userId,
      });
    }
    if (session.snapshot.players.some(({ position }) => occupiesSameTile(position, player.position))) {
      return failure(input.sessionId, "position-occupied", "The initial position is occupied", {
        playerId: input.userId,
      });
    }
    if (nextRevision(session.snapshot) === undefined) {
      return this.revisionExhausted(input.sessionId, input.userId);
    }
    return success({
      compatibility,
      kind: "requires-admission",
      ownerId: session.ownerId,
      player,
      snapshot: session.snapshot,
    });
  }

  join(input: SharedJoinInput): SharedSessionResult<SharedSessionSnapshot> {
    this.requireRunning();
    this.purgeExpired();
    const compatibility = parseSharedCompatibility(input.compatibility);
    const player = parseSharedPlayerProfile(input.player);
    if (
      !isSharedSessionId(input.sessionId)
      || !isUserId(input.userId)
      || compatibility === undefined
      || player === undefined
    ) {
      return failure(input.sessionId, "invalid-input", "The shared session input is invalid", {
        playerId: input.userId,
      });
    }
    const session = this.sessions.get(input.sessionId);
    if (session === undefined) return this.missingSession(input.sessionId);
    if (session.evaluatingAdmission) return this.mutationInProgress(input.sessionId, input.userId);
    if (input.userId !== session.peerUserId) {
      return failure(input.sessionId, "peer-mismatch", "This identity is not invited", {
        playerId: input.userId,
      });
    }
    if (!sameCompatibility(session.compatibility, compatibility)) {
      return failure(input.sessionId, "compatibility-mismatch", "The client compatibility descriptor differs", {
        playerId: input.userId,
      });
    }
    const existing = session.snapshot.players.find(({ playerId }) => playerId === input.userId);
    if (existing !== undefined) {
      if (
        existing.displayName !== player.displayName
        || existing.gender !== player.gender
        || existing.spriteId !== player.spriteId
      ) {
        return failure(input.sessionId, "peer-mismatch", "The existing player profile differs", {
          playerId: input.userId,
        });
      }
      this.persistMutation(session, () => this.touch(session));
      return success(session.snapshot);
    }
    if (this.membershipCount(input.userId) >= this.maximumSessionsPerUser) {
      return failure(input.sessionId, "session-limit", "Shared session capacity reached", {
        playerId: input.userId,
      });
    }
    if (session.snapshot.players.some(({ position }) => occupiesSameTile(position, player.position))) {
      return failure(input.sessionId, "position-occupied", "The initial position is occupied", {
        playerId: input.userId,
      });
    }
    const revision = nextRevision(session.snapshot);
    if (revision === undefined) return this.revisionExhausted(input.sessionId, input.userId);
    this.persistMutation(session, () => {
      session.snapshot = advanceSnapshot(session.snapshot, revision, [
        ...session.snapshot.players,
        profileSnapshot(input.userId, player),
      ]);
      session.commandCaches.set(input.userId, { entries: new Map(), order: [] });
      this.touch(session);
    });
    this.publishSnapshot(session);
    return success(session.snapshot);
  }

  hasMembership(userId: string): boolean {
    if (this.stopped || !isUserId(userId)) return false;
    this.purgeExpired();
    return this.membershipCount(userId) > 0;
  }

  read(sessionId: string, userId: string): SharedSessionResult<SharedSessionSnapshot> {
    this.requireRunning();
    this.purgeExpired();
    const session = this.sessions.get(sessionId);
    if (session === undefined) return this.missingSession(sessionId);
    if (!this.hasMember(session, userId)) return this.missingPlayer(sessionId, userId);
    this.persistMutation(session, () => this.touch(session));
    return success(session.snapshot);
  }

  readOwnerId(sessionId: string, userId: string): SharedSessionResult<string> {
    this.requireRunning();
    this.purgeExpired();
    const session = this.sessions.get(sessionId);
    if (session === undefined) return this.missingSession(sessionId);
    if (!this.hasMember(session, userId)) return this.missingPlayer(sessionId, userId);
    this.persistMutation(session, () => this.touch(session));
    return success(session.ownerId);
  }

  connect(sessionId: string, userId: string): SharedSessionResult<SharedSessionSnapshot> {
    this.requireRunning();
    this.purgeExpired();
    const session = this.sessions.get(sessionId);
    if (session === undefined) return this.missingSession(sessionId);
    if (session.evaluatingAdmission) return this.mutationInProgress(sessionId, userId);
    if (!this.hasMember(session, userId)) return this.missingPlayer(sessionId, userId);
    if (session.connectedUsers.has(userId)) {
      this.persistMutation(session, () => this.touch(session));
      return success(session.snapshot);
    }
    const player = session.snapshot.players.find((entry) => entry.playerId === userId)!;
    if (player.state === "active") {
      this.persistMutation(session, () => {
        session.connectedUsers.add(userId);
        this.touch(session);
      });
      return success(session.snapshot);
    }
    const revision = nextRevision(session.snapshot);
    if (revision === undefined) return this.revisionExhausted(sessionId, userId);
    this.persistMutation(session, () => {
      session.connectedUsers.add(userId);
      this.touch(session);
      session.snapshot = advanceSnapshot(session.snapshot, revision, session.snapshot.players.map((entry) =>
        entry.playerId === userId ? deepFreeze({ ...entry, state: "active" as const }) : entry));
    });
    this.publishSnapshot(session);
    return success(session.snapshot);
  }

  disconnect(sessionId: string, userId: string): SharedSessionResult<SharedSessionSnapshot> {
    this.requireRunning();
    const session = this.sessions.get(sessionId);
    if (session === undefined) return this.missingSession(sessionId);
    if (session.evaluatingAdmission) return this.mutationInProgress(sessionId, userId);
    if (!this.hasMember(session, userId)) return this.missingPlayer(sessionId, userId);
    if (!session.connectedUsers.has(userId)) {
      this.persistMutation(session, () => this.touch(session));
      return success(session.snapshot);
    }
    const player = session.snapshot.players.find((entry) => entry.playerId === userId)!;
    if (player.state === "away") {
      this.persistMutation(session, () => {
        session.connectedUsers.delete(userId);
        this.touch(session);
      });
      return success(session.snapshot);
    }
    const revision = nextRevision(session.snapshot);
    if (revision === undefined) return this.revisionExhausted(sessionId, userId);
    this.persistMutation(session, () => {
      session.connectedUsers.delete(userId);
      this.touch(session);
      session.snapshot = advanceSnapshot(session.snapshot, revision, session.snapshot.players.map((entry) =>
        entry.playerId === userId ? deepFreeze({ ...entry, state: "away" as const }) : entry));
    });
    this.publishSnapshot(session);
    return success(session.snapshot);
  }

  leave(sessionId: string, userId: string): SharedSessionResult<Readonly<{ destroyed: boolean }>> {
    this.requireRunning();
    this.purgeExpired();
    const session = this.sessions.get(sessionId);
    if (session === undefined) return this.missingSession(sessionId);
    if (session.evaluatingAdmission) return this.mutationInProgress(sessionId, userId);
    if (!this.hasMember(session, userId)) return this.missingPlayer(sessionId, userId);
    if (userId === session.ownerId) {
      const continuityHeads = new Map(this.continuityHeads);
      try {
        this.sessions.delete(sessionId);
        this.releaseContinuity(session);
        this.persist();
      } catch (error) {
        this.sessions.set(sessionId, session);
        this.continuityHeads.clear();
        for (const [key, head] of continuityHeads) this.continuityHeads.set(key, head);
        throw error;
      }
      this.publishEnded(session, "owner-left");
      return success({ destroyed: true });
    }
    const revision = nextRevision(session.snapshot);
    if (revision === undefined) return this.revisionExhausted(sessionId, userId);
    this.persistMutation(session, () => {
      session.connectedUsers.delete(userId);
      session.commandCaches.delete(userId);
      for (const [eventId, event] of session.pendingEvents) {
        if (!event.pendingPlayerIds.includes(userId)) continue;
        const pendingPlayerIds = event.pendingPlayerIds.filter((playerId) => playerId !== userId);
        if (pendingPlayerIds.length === 0) session.pendingEvents.delete(eventId);
        else session.pendingEvents.set(eventId, deepFreeze({ ...event, pendingPlayerIds }));
      }
      session.snapshot = advanceSnapshot(
        session.snapshot,
        revision,
        session.snapshot.players.filter(({ playerId }) => playerId !== userId),
        { pendingEvents: [...session.pendingEvents.values()] },
      );
      this.touch(session);
    });
    for (const record of [...session.listeners]) {
      if (record.userId === userId) {
        session.listeners.delete(record);
        this.callListener(record.listener, deepFreeze({
          reason: "member-left" as const,
          sessionId,
          type: "ended" as const,
        }));
      }
    }
    this.publishSnapshot(session);
    return success({ destroyed: false });
  }

  subscribe(
    sessionId: string,
    userId: string,
    listener: (event: SharedSessionEvent) => void,
  ): SharedSessionResult<Readonly<{ unsubscribe: () => void }>> {
    this.requireRunning();
    this.purgeExpired();
    const session = this.sessions.get(sessionId);
    if (session === undefined) return this.missingSession(sessionId);
    if (!this.hasMember(session, userId)) return this.missingPlayer(sessionId, userId);
    const record = { listener, userId };
    session.listeners.add(record);
    let active = true;
    return success(deepFreeze({
      unsubscribe: () => {
        if (!active) return;
        active = false;
        session.listeners.delete(record);
      },
    }));
  }

  submitMovement(
    sessionId: string,
    userId: string,
    rawCommand: unknown,
    options: SharedMovementSubmissionOptions = {},
  ): SharedSessionResult<Readonly<{
    appliedRevision: number;
    replayed: boolean;
    snapshot: SharedSessionSnapshot;
  }>> {
    this.requireRunning();
    this.purgeExpired();
    const session = this.sessions.get(sessionId);
    if (session === undefined) return this.missingSession(sessionId);
    if (session.evaluatingAdmission) return this.mutationInProgress(sessionId, userId);
    const player = session.snapshot.players.find(({ playerId }) => playerId === userId);
    if (player === undefined) return this.missingPlayer(sessionId, userId);
    const command = parseSharedMovementCommand(rawCommand);
    if (command === undefined) {
      return failure(sessionId, "invalid-command", "The movement command is invalid", {
        playerId: userId,
      });
    }
    const fingerprint = JSON.stringify(command);
    const cache = session.commandCaches.get(userId)!;
    const remembered = cache.entries.get(command.commandId);
    if (remembered !== undefined) {
      if (remembered.fingerprint !== fingerprint) {
        return failure(sessionId, "command-id-conflict", "The command identifier has different content", {
          commandId: command.commandId,
          playerId: userId,
        });
      }
      this.persistMutation(session, () => this.touch(session));
      return success({
        appliedRevision: remembered.appliedRevision,
        replayed: true,
        snapshot: session.snapshot,
      });
    }
    if (command.expectedRevision > session.snapshot.revision) {
      return failure(sessionId, "revision-conflict", "The command expects a future revision", {
        commandId: command.commandId,
        expectedRevision: session.snapshot.revision,
        playerId: userId,
        receivedRevision: command.expectedRevision,
      });
    }
    if (player.state !== "active") {
      return failure(sessionId, "movement-state-conflict", "The player is not active", {
        commandId: command.commandId,
        playerId: userId,
      });
    }
    const expectedSequence = player.movementSequence + 1;
    if (player.movementSequence === Number.MAX_SAFE_INTEGER || command.sequence !== expectedSequence) {
      return failure(sessionId, "movement-sequence-conflict", "The movement sequence is not next", {
        commandId: command.commandId,
        playerId: userId,
      });
    }
    if (!samePosition(player.position, command.from)) {
      return failure(sessionId, "movement-origin-conflict", "The movement origin differs", {
        commandId: command.commandId,
        playerId: userId,
      });
    }
    if (!isSingleCardinalStep(command.from, command.to)) {
      return failure(sessionId, "movement-step-conflict", "The movement is not one cardinal step", {
        commandId: command.commandId,
        playerId: userId,
      });
    }
    const finalPosition = command.arrival ?? command.to;
    const blockingPlayer = session.snapshot.players.find((entry) =>
      entry.playerId !== userId
      && (occupiesSameTile(entry.position, command.to) || occupiesSameTile(entry.position, finalPosition)));
    if (blockingPlayer !== undefined) {
      return failure(sessionId, "movement-destination-occupied", "The movement destination is occupied", {
        commandId: command.commandId,
        playerId: userId,
      });
    }
    const hasArrivalAttestation = Object.hasOwn(options, "arrivalAttestation");
    const arrivalAttestation = hasArrivalAttestation
      ? parseSharedPosition(options.arrivalAttestation)
      : undefined;
    if (
      (hasArrivalAttestation && arrivalAttestation === undefined)
      || (command.arrival === undefined && arrivalAttestation !== undefined)
      || (command.arrival !== undefined
        && arrivalAttestation !== undefined
        && !samePosition(command.arrival, arrivalAttestation))
    ) {
      return failure(sessionId, "transition-attestation-mismatch", "The transition attestation differs", {
        commandId: command.commandId,
        playerId: userId,
      });
    }
    if (
      command.arrival !== undefined
      && arrivalAttestation === undefined
      && this.movementAdmission === undefined
    ) {
      return failure(sessionId, "transition-unattested", "The transition requires an attestation", {
        commandId: command.commandId,
        playerId: userId,
      });
    }
    if (this.movementAdmission !== undefined) {
      let rawAdmission: unknown;
      session.evaluatingAdmission = true;
      try {
        rawAdmission = this.movementAdmission({
          command,
          playerId: userId,
          sessionId,
          snapshot: session.snapshot,
        });
      } catch {
        return failure(sessionId, "port-failed", "The movement admission port failed", {
          commandId: command.commandId,
          playerId: userId,
        });
      } finally {
        session.evaluatingAdmission = false;
      }
      if (this.sessions.get(sessionId) !== session) return this.missingSession(sessionId);
      const admission = parseAdmissionDecision(rawAdmission);
      if (admission === undefined) {
        return failure(sessionId, "port-failed", "The movement admission port returned invalid data", {
          commandId: command.commandId,
          playerId: userId,
        });
      }
      if (admission.kind === "reject") {
        return failure(sessionId, "port-rejected", admission.message, {
          commandId: command.commandId,
          playerId: userId,
          portCode: admission.code,
        });
      }
    }
    const revision = nextRevision(session.snapshot);
    if (revision === undefined) return this.revisionExhausted(sessionId, userId, command.commandId);
    this.persistMutation(session, () => {
      session.snapshot = advanceSnapshot(session.snapshot, revision, session.snapshot.players.map((entry) =>
        entry.playerId === userId ? deepFreeze({
          ...entry,
          movementSequence: command.sequence,
          position: finalPosition,
        }) : entry));
      this.remember(cache, command.commandId, { appliedRevision: revision, fingerprint });
      this.touch(session);
    });
    this.publishSnapshot(session);
    return success({ appliedRevision: revision, replayed: false, snapshot: session.snapshot });
  }

  submitCommand(
    sessionId: string,
    userId: string,
    rawCommand: unknown,
    options: SharedMovementSubmissionOptions = {},
  ): SharedSessionResult<Readonly<{
    appliedRevision: number;
    replayed: boolean;
    snapshot: SharedSessionSnapshot;
  }>> {
    const command = parseSharedSessionCommand(rawCommand);
    if (command?.kind === "movement") return this.submitMovement(sessionId, userId, command, options);
    if (command?.kind === "shared-event") return this.submitSharedEvent(sessionId, userId, command);
    if (command?.kind === "event-ack") return this.submitEventAcknowledgement(sessionId, userId, command);
    this.requireRunning();
    this.purgeExpired();
    const session = this.sessions.get(sessionId);
    if (session === undefined) return this.missingSession(sessionId);
    if (!this.hasMember(session, userId)) return this.missingPlayer(sessionId, userId);
    return failure(sessionId, "invalid-command", "The shared session command is invalid", {
      playerId: userId,
    });
  }

  submitSharedEvent(
    sessionId: string,
    userId: string,
    rawCommand: unknown,
  ): SharedSessionResult<Readonly<{
    appliedRevision: number;
    replayed: boolean;
    snapshot: SharedSessionSnapshot;
  }>> {
    this.requireRunning();
    this.purgeExpired();
    const session = this.sessions.get(sessionId);
    if (session === undefined) return this.missingSession(sessionId);
    if (session.evaluatingAdmission) return this.mutationInProgress(sessionId, userId);
    const player = session.snapshot.players.find(({ playerId }) => playerId === userId);
    if (player === undefined) return this.missingPlayer(sessionId, userId);
    const command = parseSharedEventCommand(rawCommand);
    if (command === undefined) {
      return failure(sessionId, "invalid-command", "The shared event command is invalid", {
        playerId: userId,
      });
    }
    const fingerprint = JSON.stringify(command);
    const cache = session.commandCaches.get(userId)!;
    const remembered = cache.entries.get(command.commandId);
    if (remembered !== undefined) {
      if (remembered.fingerprint !== fingerprint) {
        return failure(sessionId, "command-id-conflict", "The command identifier has different content", {
          commandId: command.commandId,
          eventId: command.eventId,
          playerId: userId,
        });
      }
      this.persistMutation(session, () => this.touch(session));
      return success({
        appliedRevision: remembered.appliedRevision,
        replayed: true,
        snapshot: session.snapshot,
      });
    }
    if (session.snapshot.sharedProgression.milestoneIds.includes(command.eventId)) {
      return failure(sessionId, "event-already-committed", "The shared event was already committed", {
        commandId: command.commandId,
        eventId: command.eventId,
        playerId: userId,
      });
    }
    if (command.expectedRevision !== session.snapshot.revision) {
      return failure(sessionId, "revision-conflict", "The shared event expects a different revision", {
        commandId: command.commandId,
        eventId: command.eventId,
        expectedRevision: session.snapshot.revision,
        playerId: userId,
        receivedRevision: command.expectedRevision,
      });
    }
    if (player.state !== "active") {
      return failure(sessionId, "event-state-conflict", "The player is not active", {
        commandId: command.commandId,
        eventId: command.eventId,
        playerId: userId,
      });
    }
    if (session.pendingEvents.size >= MAX_PENDING_EVENTS) {
      return failure(sessionId, "event-capacity-reached", "The pending shared event limit was reached", {
        commandId: command.commandId,
        eventId: command.eventId,
        playerId: userId,
      });
    }
    if (this.sharedEventAdmission !== undefined) {
      let rawAdmission: unknown;
      session.evaluatingAdmission = true;
      try {
        rawAdmission = this.sharedEventAdmission({
          command,
          compatibility: session.compatibility,
          playerId: userId,
          sessionId,
          snapshot: session.snapshot,
        });
      } catch {
        return failure(sessionId, "port-failed", "The shared event admission port failed", {
          commandId: command.commandId,
          eventId: command.eventId,
          playerId: userId,
        });
      } finally {
        session.evaluatingAdmission = false;
      }
      if (this.sessions.get(sessionId) !== session) return this.missingSession(sessionId);
      const admission = parseAdmissionDecision(rawAdmission);
      if (admission === undefined) {
        return failure(sessionId, "port-failed", "The shared event admission port returned invalid data", {
          commandId: command.commandId,
          eventId: command.eventId,
          playerId: userId,
        });
      }
      if (admission.kind === "reject") {
        return failure(sessionId, "port-rejected", admission.message, {
          commandId: command.commandId,
          eventId: command.eventId,
          playerId: userId,
          portCode: admission.code,
        });
      }
    }
    const milestoneIds = [...session.snapshot.sharedProgression.milestoneIds];
    const milestoneSet = new Set(milestoneIds);
    milestoneSet.add(command.eventId);
    milestoneIds.push(command.eventId);
    for (const milestoneId of command.milestoneIds) {
      if (!milestoneSet.has(milestoneId)) {
        milestoneSet.add(milestoneId);
        milestoneIds.push(milestoneId);
      }
    }
    const counters = session.snapshot.sharedProgression.counters.map((counter) => ({ ...counter }));
    const counterIndexes = new Map(counters.map((counter, index) => [counter.id, index]));
    for (const mutation of command.counters) {
      const index = counterIndexes.get(mutation.id);
      const currentValue = index === undefined ? null : counters[index]!.value;
      if (currentValue !== mutation.expectedValue) {
        return failure(sessionId, "progression-counter-conflict", "The progression counter differs", {
          commandId: command.commandId,
          counterId: mutation.id,
          eventId: command.eventId,
          playerId: userId,
        });
      }
      if (index === undefined) {
        counterIndexes.set(mutation.id, counters.length);
        counters.push({ id: mutation.id, value: mutation.value });
      } else {
        counters[index] = { id: mutation.id, value: mutation.value };
      }
    }
    if (
      milestoneIds.length > MAX_PROGRESSION_MILESTONES
      || counters.length > MAX_PROGRESSION_COUNTERS
    ) {
      return failure(sessionId, "progression-capacity-reached", "The shared progression limit was reached", {
        commandId: command.commandId,
        eventId: command.eventId,
        playerId: userId,
      });
    }
    const nextProgression = deepFreeze({ counters, milestoneIds });
    const inspectedContinuity = this.inspectContinuity(
      sessionId,
      session.compatibility,
      nextProgression,
      { commandId: command.commandId, eventId: command.eventId, playerId: userId },
    );
    if (!inspectedContinuity.ok) return inspectedContinuity;
    const nextContinuity = inspectedContinuity.value;
    if (
      (session.continuity === undefined) !== (nextContinuity === undefined)
      || (
        session.continuity !== undefined
        && nextContinuity !== undefined
        && (
          session.continuity.key !== nextContinuity.key
          || session.continuity.revision === Number.MAX_SAFE_INTEGER
          || nextContinuity.revision !== session.continuity.revision + 1
        )
      )
    ) {
      return failure(
        sessionId,
        "continuity-state-conflict",
        "The shared event does not preserve continuity",
        { commandId: command.commandId, eventId: command.eventId, playerId: userId },
      );
    }
    if (session.continuity !== undefined) {
      const head = this.continuityHeads.get(session.continuity.key);
      if (
        head === undefined
        || head.activeSessionId !== sessionId
        || head.ownerId !== session.ownerId
        || head.revision !== session.continuity.revision
        || head.fingerprint !== session.continuity.fingerprint
      ) {
        return failure(
          sessionId,
          "continuity-state-conflict",
          "The durable continuity is inconsistent",
          { commandId: command.commandId, eventId: command.eventId, playerId: userId },
        );
      }
    }
    const revision = nextRevision(session.snapshot);
    if (revision === undefined) return this.revisionExhausted(sessionId, userId, command.commandId);
    const pendingEvent: SharedPendingEventSnapshot = deepFreeze({
      eventId: command.eventId,
      eventRevision: revision,
      pendingPlayerIds: session.snapshot.players.map(({ playerId }) => playerId),
    });
    this.persistMutation(session, () => {
      session.pendingEvents.set(command.eventId, pendingEvent);
      session.snapshot = advanceSnapshot(session.snapshot, revision, undefined, {
        pendingEvents: [...session.pendingEvents.values()],
        sharedProgression: nextProgression,
      });
      session.continuity = nextContinuity;
      if (nextContinuity !== undefined) {
        this.continuityHeads.set(nextContinuity.key, deepFreeze({
          ...nextContinuity,
          activeSessionId: sessionId,
          ownerId: session.ownerId,
        }));
      }
      this.remember(cache, command.commandId, { appliedRevision: revision, fingerprint });
      this.touch(session);
    });
    this.publishSnapshot(session);
    return success({ appliedRevision: revision, replayed: false, snapshot: session.snapshot });
  }

  submitEventAcknowledgement(
    sessionId: string,
    userId: string,
    rawCommand: unknown,
  ): SharedSessionResult<Readonly<{
    appliedRevision: number;
    replayed: boolean;
    snapshot: SharedSessionSnapshot;
  }>> {
    this.requireRunning();
    this.purgeExpired();
    const session = this.sessions.get(sessionId);
    if (session === undefined) return this.missingSession(sessionId);
    if (session.evaluatingAdmission) return this.mutationInProgress(sessionId, userId);
    const player = session.snapshot.players.find(({ playerId }) => playerId === userId);
    if (player === undefined) return this.missingPlayer(sessionId, userId);
    const command = parseSharedEventAcknowledgementCommand(rawCommand);
    if (command === undefined) {
      return failure(sessionId, "invalid-command", "The event acknowledgement command is invalid", {
        playerId: userId,
      });
    }
    const fingerprint = JSON.stringify(command);
    const cache = session.commandCaches.get(userId)!;
    const remembered = cache.entries.get(command.commandId);
    if (remembered !== undefined) {
      if (remembered.fingerprint !== fingerprint) {
        return failure(sessionId, "command-id-conflict", "The command identifier has different content", {
          commandId: command.commandId,
          eventId: command.eventId,
          playerId: userId,
        });
      }
      this.persistMutation(session, () => this.touch(session));
      return success({
        appliedRevision: remembered.appliedRevision,
        replayed: true,
        snapshot: session.snapshot,
      });
    }
    const pendingEvent = session.pendingEvents.get(command.eventId);
    if (pendingEvent === undefined) {
      return failure(sessionId, "event-not-pending", "The shared event is not pending", {
        commandId: command.commandId,
        eventId: command.eventId,
        eventRevision: command.eventRevision,
        playerId: userId,
      });
    }
    if (pendingEvent.eventRevision !== command.eventRevision) {
      return failure(sessionId, "event-revision-conflict", "The shared event revision differs", {
        commandId: command.commandId,
        eventId: command.eventId,
        eventRevision: pendingEvent.eventRevision,
        playerId: userId,
        receivedRevision: command.eventRevision,
      });
    }
    if (!pendingEvent.pendingPlayerIds.includes(userId)) {
      return failure(sessionId, "event-already-acknowledged", "The player already acknowledged this event", {
        commandId: command.commandId,
        eventId: command.eventId,
        eventRevision: command.eventRevision,
        playerId: userId,
      });
    }
    if (command.expectedRevision !== session.snapshot.revision) {
      return failure(sessionId, "revision-conflict", "The event acknowledgement expects a different revision", {
        commandId: command.commandId,
        eventId: command.eventId,
        expectedRevision: session.snapshot.revision,
        playerId: userId,
        receivedRevision: command.expectedRevision,
      });
    }
    if (player.state !== "active") {
      return failure(sessionId, "event-state-conflict", "The player is not active", {
        commandId: command.commandId,
        eventId: command.eventId,
        playerId: userId,
      });
    }
    const revision = nextRevision(session.snapshot);
    if (revision === undefined) return this.revisionExhausted(sessionId, userId, command.commandId);
    const pendingPlayerIds = pendingEvent.pendingPlayerIds.filter((playerId) => playerId !== userId);
    this.persistMutation(session, () => {
      if (pendingPlayerIds.length === 0) session.pendingEvents.delete(command.eventId);
      else session.pendingEvents.set(command.eventId, deepFreeze({ ...pendingEvent, pendingPlayerIds }));
      session.snapshot = advanceSnapshot(session.snapshot, revision, undefined, {
        pendingEvents: [...session.pendingEvents.values()],
      });
      this.remember(cache, command.commandId, { appliedRevision: revision, fingerprint });
      this.touch(session);
    });
    this.publishSnapshot(session);
    return success({ appliedRevision: revision, replayed: false, snapshot: session.snapshot });
  }

  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.maintenanceTimer);
    if (this.store !== undefined) {
      // A process stop is transport loss, not a terminal room event. The next
      // process restores every member as away without extending lastActivityAt.
      this.sessions.clear();
      return;
    }
    for (const session of this.sessions.values()) this.publishEnded(session, "server-shutdown");
    this.sessions.clear();
  }

  close(): Promise<void> {
    if (this.closeTask !== undefined) return this.closeTask;
    this.shutdown();
    const closeStore = this.store?.close === undefined
      ? this.store?.flush?.()
      : this.store.close();
    const task = Promise.resolve(closeStore).catch((error: unknown) => {
      this.closeTask = undefined;
      throw error;
    });
    this.closeTask = task;
    return task;
  }

  purgeExpired(): number {
    this.requireRunning();
    const now = this.now();
    const expired: Array<readonly [string, SessionRecord]> = [];
    const rebased: Array<readonly [SessionRecord, number]> = [];
    const continuityHeads = new Map(this.continuityHeads);
    const rollback = (): void => {
      for (const [session, lastActivityAt] of rebased) session.lastActivityAt = lastActivityAt;
      for (const [sessionId, session] of expired) this.sessions.set(sessionId, session);
      this.continuityHeads.clear();
      for (const [key, head] of continuityHeads) this.continuityHeads.set(key, head);
    };
    try {
      for (const [sessionId, session] of this.sessions) {
        if (
          session.evaluatingAdmission
          || session.connectedUsers.size > 0
        ) continue;
        if (now < session.lastActivityAt) {
          // A wall-clock correction must not keep an abandoned room alive until
          // the old future timestamp is reached. Rebase it durably and grant at
          // most one normal TTL from the corrected clock.
          rebased.push([session, session.lastActivityAt]);
          session.lastActivityAt = now;
        }
        if (now - session.lastActivityAt < this.idleTtlMs) continue;
        expired.push([sessionId, session]);
        this.sessions.delete(sessionId);
        this.releaseContinuity(session);
      }
      if (expired.length === 0 && rebased.length === 0) return 0;
      this.persist();
    } catch (error) {
      rollback();
      throw error;
    }
    for (const [, session] of expired) this.publishEnded(session, "idle-timeout");
    return expired.length;
  }

  private callListener(listener: (event: SharedSessionEvent) => void, event: SharedSessionEvent): void {
    try {
      listener(event);
    } catch {
      // Observers cannot roll back an already committed state change.
    }
  }

  private hasMember(session: SessionRecord, userId: string): boolean {
    return session.snapshot.players.some(({ playerId }) => playerId === userId);
  }

  private membershipCount(userId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (this.hasMember(session, userId)) count += 1;
    }
    return count;
  }

  private inspectContinuity(
    sessionId: string,
    compatibility: SharedCompatibility,
    sharedProgression: SharedProgression,
    details: Omit<SharedSessionError, "code" | "message" | "sessionId"> = {},
  ): SharedSessionResult<SessionContinuityClaim | undefined> {
    if (this.continuityPolicy === undefined) return success(undefined);
    let rawInspection: unknown;
    try {
      rawInspection = this.continuityPolicy.inspect(deepFreeze({
        compatibility,
        sharedProgression,
      }));
    } catch {
      return failure(sessionId, "port-failed", "The continuity policy failed", details);
    }
    const inspection = parseContinuityInspection(rawInspection);
    if (inspection === undefined) {
      return failure(sessionId, "port-failed", "The continuity policy returned invalid data", details);
    }
    if (inspection.kind === "reject") {
      return failure(sessionId, "port-rejected", inspection.message, {
        ...details,
        portCode: inspection.code,
      });
    }
    if (inspection.kind === "unclaimed") return success(undefined);
    const policyId = this.continuityPolicy.policyId;
    return success(deepFreeze({
      continuityId: inspection.continuityId,
      fingerprint: inspection.fingerprint,
      key: continuityKey(policyId, inspection.continuityId),
      policyId,
      revision: inspection.revision,
    }));
  }

  private inspectStoredContinuity(
    compatibility: SharedCompatibility,
    sharedProgression: SharedProgression,
    context: string,
  ): SessionContinuityClaim | undefined {
    const inspected = this.inspectContinuity(context, compatibility, sharedProgression);
    if (!inspected.ok) {
      const suffix = inspected.error.portCode === undefined
        ? inspected.error.code
        : `${inspected.error.code}:${inspected.error.portCode}`;
      throw new Error(`${context} continuity is invalid (${suffix})`);
    }
    return inspected.value;
  }

  private missingPlayer(sessionId: string, playerId: string): SharedSessionResult<never> {
    return failure(sessionId, "player-not-found", "The identity is not a member", { playerId });
  }

  private missingSession(sessionId: string): SharedSessionResult<never> {
    return failure(sessionId, "session-not-found", "The shared session does not exist");
  }

  private mutationInProgress(sessionId: string, playerId: string): SharedSessionResult<never> {
    return failure(
      sessionId,
      "session-mutation-in-progress",
      "The shared session is already evaluating an authoritative mutation",
      { playerId },
    );
  }

  private publishEnded(
    session: SessionRecord,
    reason: Extract<SharedSessionEvent, { type: "ended" }>["reason"],
  ): void {
    const event = deepFreeze({ reason, sessionId: session.snapshot.sessionId, type: "ended" as const });
    for (const record of session.listeners) this.callListener(record.listener, event);
    session.listeners.clear();
    session.connectedUsers.clear();
  }

  private publishSnapshot(session: SessionRecord): void {
    const event = deepFreeze({ snapshot: session.snapshot, type: "snapshot" as const });
    for (const record of session.listeners) this.callListener(record.listener, event);
  }

  private releaseContinuity(session: SessionRecord): void {
    if (session.continuity === undefined) return;
    const head = this.continuityHeads.get(session.continuity.key);
    if (
      head === undefined
      || head.activeSessionId !== session.snapshot.sessionId
      || head.ownerId !== session.ownerId
      || head.revision !== session.continuity.revision
      || head.fingerprint !== session.continuity.fingerprint
    ) throw new Error("Shared session continuity lease is inconsistent");
    const { activeSessionId: _activeSessionId, ...inactiveHead } = head;
    this.continuityHeads.set(head.key, deepFreeze(inactiveHead));
  }

  private requireRunning(): void {
    if (this.stopped) throw new Error("Shared session service is shut down");
  }

  private remember(cache: CommandCache, commandId: string, command: RememberedCommand): void {
    cache.entries.set(commandId, command);
    cache.order.push(commandId);
    if (cache.order.length > MAX_REMEMBERED_COMMANDS_PER_USER) {
      cache.entries.delete(cache.order.shift()!);
    }
  }

  private revisionExhausted(
    sessionId: string,
    playerId: string,
    commandId?: string,
  ): SharedSessionResult<never> {
    return failure(sessionId, "revision-exhausted", "The session revision cannot advance", {
      ...(commandId === undefined ? {} : { commandId }),
      playerId,
    });
  }

  private checkpoint(session: SessionRecord): SessionCheckpoint {
    return {
      commandCaches: new Map([...session.commandCaches].map(([playerId, cache]) => [playerId, {
        entries: new Map(cache.entries),
        order: [...cache.order],
      }])),
      connectedUsers: new Set(session.connectedUsers),
      continuity: session.continuity,
      continuityHeads: new Map(this.continuityHeads),
      lastActivityAt: session.lastActivityAt,
      pendingEvents: new Map(session.pendingEvents),
      snapshot: session.snapshot,
    };
  }

  private persist(): void {
    this.store?.save(this.serializeState());
  }

  private persistMutation(session: SessionRecord, mutation: () => void): void {
    const checkpoint = this.checkpoint(session);
    mutation();
    try {
      this.persist();
    } catch (error) {
      session.commandCaches.clear();
      for (const [playerId, cache] of checkpoint.commandCaches) {
        session.commandCaches.set(playerId, cache);
      }
      session.connectedUsers.clear();
      for (const userId of checkpoint.connectedUsers) session.connectedUsers.add(userId);
      session.continuity = checkpoint.continuity;
      this.continuityHeads.clear();
      for (const [key, head] of checkpoint.continuityHeads) this.continuityHeads.set(key, head);
      session.lastActivityAt = checkpoint.lastActivityAt;
      session.pendingEvents.clear();
      for (const [eventId, event] of checkpoint.pendingEvents) session.pendingEvents.set(eventId, event);
      session.snapshot = checkpoint.snapshot;
      throw error;
    }
  }

  private restoreStoredSessions(): void {
    if (this.store === undefined) return;
    const stored = this.store.load();
    let persistedSessions = [...stored.sessions];
    let changed = stored.version !== 3;
    if (stored.version === 3) {
      for (const persisted of stored.continuityHeads) {
        const key = continuityKey(persisted.policyId, persisted.continuityId);
        this.continuityHeads.set(key, deepFreeze({ ...persisted, key }));
      }
    } else {
      const grouped = new Map<string, Array<Readonly<{
        claim: SessionContinuityClaim;
        persisted: StoredSharedSession;
      }>>>();
      for (const persisted of persistedSessions) {
        const claim = this.inspectStoredContinuity(
          persisted.compatibility,
          persisted.snapshot.sharedProgression,
          `shared session ${persisted.snapshot.sessionId}`,
        );
        if (claim === undefined) continue;
        const entries = grouped.get(claim.key) ?? [];
        entries.push({ claim, persisted });
        grouped.set(claim.key, entries);
      }
      const discardedSessionIds = new Set<string>();
      for (const entries of grouped.values()) {
        const first = entries[0]!;
        if (entries.length > 1) {
          const identical = entries.every(({ claim, persisted }) =>
            persisted.ownerId === first.persisted.ownerId
            && claim.revision === first.claim.revision
            && claim.fingerprint === first.claim.fingerprint);
          if (!identical) {
            throw new Error("Legacy shared session continuities diverge");
          }
          for (const { persisted } of entries) {
            discardedSessionIds.add(persisted.snapshot.sessionId);
          }
        }
        this.continuityHeads.set(first.claim.key, deepFreeze({
          ...first.claim,
          ...(entries.length === 1
            ? { activeSessionId: first.persisted.snapshot.sessionId }
            : {}),
          ownerId: first.persisted.ownerId,
        }));
      }
      if (discardedSessionIds.size > 0) {
        persistedSessions = persistedSessions.filter(({ snapshot }) =>
          !discardedSessionIds.has(snapshot.sessionId));
      }
    }
    if (this.continuityHeads.size > MAX_CONTINUITY_HEADS) {
      throw new Error("Shared session store exceeds the continuity capacity");
    }
    if (persistedSessions.length > this.maximumSessions) {
      throw new Error("Shared session store exceeds the configured session capacity");
    }
    const storedClaims = new Map<string, SessionContinuityClaim | undefined>();
    const persistedById = new Map(persistedSessions.map((persisted) =>
      [persisted.snapshot.sessionId, persisted]));
    const activeHeadBySessionId = new Map<string, ContinuityHead>();
    for (const head of this.continuityHeads.values()) {
      if (head.activeSessionId !== undefined) activeHeadBySessionId.set(head.activeSessionId, head);
    }
    for (const persisted of persistedSessions) {
      const sessionId = persisted.snapshot.sessionId;
      const claim = this.inspectStoredContinuity(
        persisted.compatibility,
        persisted.snapshot.sharedProgression,
        `shared session ${sessionId}`,
      );
      storedClaims.set(sessionId, claim);
      if (claim === undefined) {
        if (activeHeadBySessionId.has(sessionId)) {
          throw new Error("Stored continuity lease points to an unclaimed shared session");
        }
        continue;
      }
      const head = this.continuityHeads.get(claim.key);
      if (
        head === undefined
        || head.activeSessionId !== sessionId
        || head.ownerId !== persisted.ownerId
        || head.revision !== claim.revision
        || head.fingerprint !== claim.fingerprint
      ) throw new Error("Stored shared session continuity does not match its durable head");
    }
    for (const sessionId of activeHeadBySessionId.keys()) {
      if (!persistedById.has(sessionId)) {
        throw new Error("Stored continuity head points to a missing shared session");
      }
    }
    const now = this.now();
    for (const persisted of persistedSessions) {
      const continuity = storedClaims.get(persisted.snapshot.sessionId);
      const lastActivityAt = Math.min(persisted.lastActivityAt, now);
      if (lastActivityAt !== persisted.lastActivityAt) changed = true;
      if (now - lastActivityAt >= this.idleTtlMs) {
        if (continuity !== undefined) {
          const head = this.continuityHeads.get(continuity.key)!;
          const { activeSessionId: _activeSessionId, ...inactiveHead } = head;
          this.continuityHeads.set(continuity.key, deepFreeze(inactiveHead));
        }
        changed = true;
        continue;
      }
      const hadActivePlayer = persisted.snapshot.players.some(({ state }) => state === "active");
      if (hadActivePlayer && persisted.snapshot.revision === Number.MAX_SAFE_INTEGER) {
        throw new Error("Cannot restore an active session with an exhausted revision");
      }
      const snapshot = deepFreeze({
        ...persisted.snapshot,
        players: persisted.snapshot.players.map((player) => deepFreeze({
          ...player,
          position: deepFreeze({ ...player.position }),
          state: "away" as const,
        })),
        pendingEvents: persisted.snapshot.pendingEvents.map((event) => deepFreeze({
          ...event,
          pendingPlayerIds: [...event.pendingPlayerIds],
        })),
        revision: persisted.snapshot.revision + (hadActivePlayer ? 1 : 0),
        sharedProgression: {
          counters: persisted.snapshot.sharedProgression.counters.map((counter) => deepFreeze({ ...counter })),
          milestoneIds: [...persisted.snapshot.sharedProgression.milestoneIds],
        },
      });
      if (hadActivePlayer) changed = true;
      this.sessions.set(snapshot.sessionId, {
        commandCaches: new Map(persisted.commandCaches.map((cache) => [cache.playerId, {
          entries: new Map(cache.commands.map((command) => [command.commandId, {
            appliedRevision: command.appliedRevision,
            fingerprint: command.fingerprint,
          }])),
          order: cache.commands.map(({ commandId }) => commandId),
        }])),
        compatibility: deepFreeze({ ...persisted.compatibility }),
        connectedUsers: new Set(),
        continuity,
        evaluatingAdmission: false,
        lastActivityAt,
        listeners: new Set(),
        ownerId: persisted.ownerId,
        pendingEvents: new Map(snapshot.pendingEvents.map((event) => [event.eventId, event])),
        peerUserId: persisted.peerUserId,
        snapshot,
      });
    }
    for (const session of this.sessions.values()) {
      for (const { playerId } of session.snapshot.players) {
        if (this.membershipCount(playerId) > this.maximumSessionsPerUser) {
          throw new Error("Shared session store exceeds the configured per-user capacity");
        }
      }
    }
    if (changed) this.persist();
  }

  private serializeState(): StoredSharedSessionState {
    const continuityHeads: StoredSharedSessionContinuityHead[] = [...this.continuityHeads.values()]
      .map(({ key: _key, ...head }) => head);
    const sessions: StoredSharedSession[] = [...this.sessions.values()].map((session) => ({
      commandCaches: [...session.commandCaches].map(([playerId, cache]) => ({
        commands: cache.order.map((commandId) => {
          const command = cache.entries.get(commandId);
          if (command === undefined) throw new Error("Shared session command cache is inconsistent");
          return { ...command, commandId };
        }),
        playerId,
      })),
      compatibility: session.compatibility,
      lastActivityAt: session.lastActivityAt,
      ownerId: session.ownerId,
      peerUserId: session.peerUserId,
      snapshot: session.snapshot,
    }));
    return { continuityHeads, sessions, version: 3 };
  }

  private touch(session: SessionRecord): void {
    session.lastActivityAt = this.now();
  }
}
