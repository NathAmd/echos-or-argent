import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  mkdir as mkdirAsync,
  open as openAsync,
  rename as renameAsync,
  rm as rmAsync,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  SHARED_SESSION_PROTOCOL_VERSION,
  isSharedSessionId,
  parseSharedCompatibility,
  parseSharedProgression,
  parseSharedSessionCommand,
  parseSharedPlayerProfile,
  type SharedCompatibility,
  type SharedPlayerSnapshot,
  type SharedSessionSnapshot,
} from "../domain/shared-sessions.js";
import { isUserId } from "../validation.js";

const MAX_STORE_BYTES = 64 * 1024 * 1024;
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
const JOURNAL_COMPACTION_BYTES = 8 * 1024 * 1024;
const MAX_JOURNAL_RECORDS = 100_000;
const MAX_SESSIONS = 1_024;
const MAX_PLAYERS = 2;
const MAX_COMMANDS_PER_PLAYER = 256;
const MAX_FINGERPRINT_BYTES = 16 * 1024;
const MAX_PENDING_EVENTS = 128;
const MAX_CONTINUITY_HEADS = 65_536;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const CONTINUITY_FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const STATE_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export interface StoredSharedSessionCommand {
  readonly appliedRevision: number;
  readonly commandId: string;
  readonly fingerprint: string;
}

export interface StoredSharedSessionCommandCache {
  readonly commands: readonly StoredSharedSessionCommand[];
  readonly playerId: string;
}

export interface StoredSharedSession {
  readonly commandCaches: readonly StoredSharedSessionCommandCache[];
  readonly compatibility: SharedCompatibility;
  readonly lastActivityAt: number;
  readonly ownerId: string;
  readonly peerUserId: string;
  readonly snapshot: SharedSessionSnapshot;
}

export interface StoredSharedSessionContinuityHead {
  readonly activeSessionId?: string;
  readonly continuityId: string;
  readonly fingerprint: string;
  readonly ownerId: string;
  readonly policyId: string;
  readonly revision: number;
}

export interface StoredSharedSessionState {
  readonly continuityHeads: readonly StoredSharedSessionContinuityHead[];
  readonly sessions: readonly StoredSharedSession[];
  readonly version: 3;
}

export interface LegacyStoredSharedSessionState {
  readonly sessions: readonly StoredSharedSession[];
  readonly version: 2;
}

export type LoadedSharedSessionState = StoredSharedSessionState | LegacyStoredSharedSessionState;

export interface SharedSessionStore {
  close?(): Promise<void> | void;
  flush?(): Promise<void> | void;
  load(): LoadedSharedSessionState;
  save(state: StoredSharedSessionState): void;
}

export interface FileSharedSessionStoreOptions {
  readonly journalCompactionBytes?: number;
}

interface StoredSharedSessionJournalHeader {
  readonly baseDigest: string;
  readonly version: 1;
}

interface StoredSharedSessionContinuityKey {
  readonly continuityId: string;
  readonly policyId: string;
}

interface StoredSharedSessionJournalRecord {
  readonly continuityHeadRemovals: readonly StoredSharedSessionContinuityKey[];
  readonly continuityHeadUpserts: readonly StoredSharedSessionContinuityHead[];
  readonly resultDigest: string;
  readonly sequence: number;
  readonly sessionRemovals: readonly string[];
  readonly sessionUpserts: readonly StoredSharedSession[];
  readonly version: 1;
}

export const emptySharedSessionState = (): StoredSharedSessionState => ({
  continuityHeads: [],
  sessions: [],
  version: 3,
});

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    });
};

const requireExactRecord = (
  value: unknown,
  keys: readonly string[],
  context: string,
): Record<string, unknown> => {
  if (!isPlainRecord(value)) throw new Error(`${context} must be a plain object`);
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${context} has an invalid shape`);
  }
  return value;
};

const isBoundedInteger = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;

const isDenseArray = (value: unknown, maximumEntries: number): value is unknown[] => {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximumEntries
    || Object.keys(value).length !== value.length
  ) return false;
  return Reflect.ownKeys(value).every((key) => key === "length"
    || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)))
    && value.every((_entry, index) => Object.hasOwn(value, index));
};

const parseIdentifierList = (
  value: unknown,
  maximumEntries: number,
  context: string,
): string[] => {
  if (!isDenseArray(value, maximumEntries)) {
    throw new Error(`${context} is invalid or exceeds its limit`);
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (
      typeof entry !== "string"
      || entry.length > 128
      || !IDENTIFIER_PATTERN.test(entry)
      || seen.has(entry)
    ) {
      throw new Error(`${context} entry ${index} is invalid or duplicated`);
    }
    seen.add(entry);
    return entry;
  });
};

const parsePlayerSnapshot = (value: unknown, context: string): SharedPlayerSnapshot => {
  const record = requireExactRecord(
    value,
    ["displayName", "gender", "movementSequence", "playerId", "position", "spriteId", "state"],
    context,
  );
  const profile = parseSharedPlayerProfile({
    displayName: record.displayName,
    gender: record.gender,
    position: record.position,
    spriteId: record.spriteId,
  });
  if (
    profile === undefined
    || !isUserId(record.playerId)
    || !isBoundedInteger(record.movementSequence)
    || (record.state !== "active" && record.state !== "away")
  ) {
    throw new Error(`${context} is invalid`);
  }
  return {
    ...profile,
    movementSequence: record.movementSequence,
    playerId: record.playerId,
    state: record.state,
  };
};

const parseSnapshotHeader = (
  record: Record<string, unknown>,
  context: string,
): Readonly<{
  players: SharedPlayerSnapshot[];
  revision: number;
  sessionId: string;
}> => {
  if (
    !isSharedSessionId(record.sessionId)
    || !isBoundedInteger(record.revision)
    || !isDenseArray(record.players, MAX_PLAYERS)
    || record.players.length < 1
  ) throw new Error(`${context} header is invalid`);
  const playerIds = new Set<string>();
  const players = record.players.map((player, index) => {
    const parsed = parsePlayerSnapshot(player, `${context} player ${index}`);
    if (playerIds.has(parsed.playerId)) {
      throw new Error(`${context} player identities are duplicated`);
    }
    playerIds.add(parsed.playerId);
    return parsed;
  });
  return { players, revision: record.revision, sessionId: record.sessionId };
};

const parseSnapshot = (value: unknown, context: string): SharedSessionSnapshot => {
  const record = requireExactRecord(
    value,
    ["pendingEvents", "players", "protocolVersion", "revision", "sessionId", "sharedProgression"],
    context,
  );
  if (record.protocolVersion !== SHARED_SESSION_PROTOCOL_VERSION) {
    throw new Error(`${context} protocol version is unsupported`);
  }
  const { players, revision, sessionId } = parseSnapshotHeader(record, context);
  const sharedProgression = parseSharedProgression(record.sharedProgression);
  if (sharedProgression === undefined) throw new Error(`${context} shared progression is invalid`);
  if (!isDenseArray(record.pendingEvents, MAX_PENDING_EVENTS)) {
    throw new Error(`${context} pending events are invalid or exceed their limit`);
  }
  const playerIds = new Set(players.map(({ playerId }) => playerId));
  const eventIds = new Set<string>();
  const eventRevisions = new Set<number>();
  const pendingEvents = record.pendingEvents.map((event, index) => {
    const candidate = requireExactRecord(
      event,
      ["eventId", "eventRevision", "pendingPlayerIds"],
      `${context} pending event ${index}`,
    );
    if (
      typeof candidate.eventId !== "string"
      || candidate.eventId.length > 128
      || !IDENTIFIER_PATTERN.test(candidate.eventId)
      || eventIds.has(candidate.eventId)
      || !isBoundedInteger(candidate.eventRevision, 1)
      || candidate.eventRevision > revision
      || eventRevisions.has(candidate.eventRevision)
      || !sharedProgression.milestoneIds.includes(candidate.eventId)
    ) throw new Error(`${context} pending event ${index} is invalid or duplicated`);
    const pendingPlayerIds = parseIdentifierList(
      candidate.pendingPlayerIds,
      MAX_PLAYERS,
      `${context} pending event ${index} players`,
    );
    if (
      pendingPlayerIds.length < 1
      || pendingPlayerIds.some((playerId) => !isUserId(playerId) || !playerIds.has(playerId))
    ) throw new Error(`${context} pending event ${index} players are invalid`);
    eventIds.add(candidate.eventId);
    eventRevisions.add(candidate.eventRevision);
    return {
      eventId: candidate.eventId,
      eventRevision: candidate.eventRevision,
      pendingPlayerIds,
    };
  });
  return {
    pendingEvents,
    players,
    protocolVersion: SHARED_SESSION_PROTOCOL_VERSION,
    revision,
    sessionId,
    sharedProgression,
  };
};

const migrateLegacySnapshot = (value: unknown, context: string): SharedSessionSnapshot => {
  const record = requireExactRecord(
    value,
    ["pendingEventIds", "players", "protocolVersion", "revision", "sessionId", "sharedProgression"],
    context,
  );
  if (record.protocolVersion !== 1) throw new Error(`${context} legacy protocol version is unsupported`);
  const pendingEventIds = parseIdentifierList(
    record.pendingEventIds,
    MAX_PENDING_EVENTS,
    `${context} legacy pending events`,
  );
  if (pendingEventIds.length !== 0) {
    throw new Error(`${context} has legacy pending events that cannot be migrated safely`);
  }
  const { players, revision, sessionId } = parseSnapshotHeader(record, context);
  const sharedProgression = parseSharedProgression(record.sharedProgression);
  if (sharedProgression === undefined) throw new Error(`${context} shared progression is invalid`);
  return {
    pendingEvents: [],
    players,
    protocolVersion: SHARED_SESSION_PROTOCOL_VERSION,
    revision,
    sessionId,
    sharedProgression,
  };
};

const parseCommandCache = (
  value: unknown,
  snapshot: SharedSessionSnapshot,
  context: string,
  legacy: boolean,
): StoredSharedSessionCommandCache => {
  const record = requireExactRecord(value, ["commands", "playerId"], context);
  if (
    !isUserId(record.playerId)
    || !snapshot.players.some(({ playerId }) => playerId === record.playerId)
    || !isDenseArray(record.commands, MAX_COMMANDS_PER_PLAYER)
  ) {
    throw new Error(`${context} is invalid or exceeds its limit`);
  }
  const commandIds = new Set<string>();
  const player = snapshot.players.find(({ playerId }) => playerId === record.playerId)!;
  const commands = record.commands.map((command, index): StoredSharedSessionCommand => {
    const candidate = requireExactRecord(
      command,
      ["appliedRevision", "commandId", "fingerprint"],
      `${context} command ${index}`,
    );
    if (
      typeof candidate.commandId !== "string"
      || commandIds.has(candidate.commandId)
      || !isBoundedInteger(candidate.appliedRevision)
      || candidate.appliedRevision > snapshot.revision
      || typeof candidate.fingerprint !== "string"
      || Buffer.byteLength(candidate.fingerprint, "utf8") > MAX_FINGERPRINT_BYTES
    ) {
      throw new Error(`${context} command ${index} is invalid or duplicated`);
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(candidate.fingerprint) as unknown;
    } catch {
      throw new Error(`${context} command ${index} fingerprint is invalid JSON`);
    }
    const migrated = legacy && isPlainRecord(decoded) && decoded.kind === "movement"
      ? { ...decoded, protocolVersion: SHARED_SESSION_PROTOCOL_VERSION }
      : decoded;
    const parsed = parseSharedSessionCommand(migrated);
    const canonicalFingerprint = parsed === undefined ? undefined : JSON.stringify(parsed);
    const eventReceiptMissing = parsed?.kind === "shared-event"
      && (
        !snapshot.sharedProgression.milestoneIds.includes(parsed.eventId)
        || parsed.milestoneIds.some((milestoneId) =>
          !snapshot.sharedProgression.milestoneIds.includes(milestoneId))
      );
    const nonMovementRevisionInvalid = parsed !== undefined
      && parsed.kind !== "movement"
      && (
        parsed.expectedRevision === Number.MAX_SAFE_INTEGER
        || candidate.appliedRevision !== parsed.expectedRevision + 1
      );
    const acknowledgedPlayerStillPending = parsed?.kind === "event-ack"
      && snapshot.pendingEvents.some((event) =>
        event.eventId === parsed.eventId
        && event.eventRevision === parsed.eventRevision
        && event.pendingPlayerIds.includes(record.playerId as string));
    if (
      parsed === undefined
      || parsed.commandId !== candidate.commandId
      || (parsed.kind === "movement" && parsed.sequence > player.movementSequence)
      || eventReceiptMissing
      || nonMovementRevisionInvalid
      || acknowledgedPlayerStillPending
      || (!legacy && canonicalFingerprint !== candidate.fingerprint)
    ) {
      throw new Error(`${context} command ${index} fingerprint is not canonical`);
    }
    commandIds.add(candidate.commandId);
    return {
      appliedRevision: candidate.appliedRevision,
      commandId: candidate.commandId,
      fingerprint: canonicalFingerprint!,
    };
  });
  return { commands, playerId: record.playerId };
};

const parseSession = (value: unknown, index: number, legacy: boolean): StoredSharedSession => {
  const context = `shared session ${index}`;
  const record = requireExactRecord(
    value,
    ["commandCaches", "compatibility", "lastActivityAt", "ownerId", "peerUserId", "snapshot"],
    context,
  );
  const compatibility = parseSharedCompatibility(record.compatibility);
  const snapshot = legacy
    ? migrateLegacySnapshot(record.snapshot, `${context} snapshot`)
    : parseSnapshot(record.snapshot, `${context} snapshot`);
  if (
    compatibility === undefined
    || !isUserId(record.ownerId)
    || !isUserId(record.peerUserId)
    || record.ownerId === record.peerUserId
    || !isBoundedInteger(record.lastActivityAt)
    || !snapshot.players.some(({ playerId }) => playerId === record.ownerId)
    || snapshot.players.some(({ playerId }) => playerId !== record.ownerId && playerId !== record.peerUserId)
    || !isDenseArray(record.commandCaches, MAX_PLAYERS)
    || record.commandCaches.length !== snapshot.players.length
  ) {
    throw new Error(`${context} is invalid`);
  }
  const cachePlayerIds = new Set<string>();
  const commandCaches = record.commandCaches.map((cache, cacheIndex) => {
    const parsed = parseCommandCache(cache, snapshot, `${context} command cache ${cacheIndex}`, legacy);
    if (cachePlayerIds.has(parsed.playerId)) {
      throw new Error(`${context} command caches are duplicated`);
    }
    cachePlayerIds.add(parsed.playerId);
    return parsed;
  });
  if (snapshot.players.some(({ playerId }) => !cachePlayerIds.has(playerId))) {
    throw new Error(`${context} command caches are incomplete`);
  }
  return {
    commandCaches,
    compatibility,
    lastActivityAt: record.lastActivityAt,
    ownerId: record.ownerId,
    peerUserId: record.peerUserId,
    snapshot,
  };
};

const parseContinuityHead = (
  value: unknown,
  index: number,
): StoredSharedSessionContinuityHead => {
  const context = `shared session continuity head ${index}`;
  if (!isPlainRecord(value)) throw new Error(`${context} must be a plain object`);
  const expectedKeys = Object.hasOwn(value, "activeSessionId")
    ? ["activeSessionId", "continuityId", "fingerprint", "ownerId", "policyId", "revision"]
    : ["continuityId", "fingerprint", "ownerId", "policyId", "revision"];
  const record = requireExactRecord(value, expectedKeys, context);
  if (
    typeof record.policyId !== "string"
    || record.policyId.length > 64
    || !IDENTIFIER_PATTERN.test(record.policyId)
    || typeof record.continuityId !== "string"
    || record.continuityId.length > 128
    || !IDENTIFIER_PATTERN.test(record.continuityId)
    || typeof record.fingerprint !== "string"
    || !CONTINUITY_FINGERPRINT_PATTERN.test(record.fingerprint)
    || !isUserId(record.ownerId)
    || !isBoundedInteger(record.revision)
    || (Object.hasOwn(record, "activeSessionId") && !isSharedSessionId(record.activeSessionId))
  ) throw new Error(`${context} is invalid`);
  return {
    ...(Object.hasOwn(record, "activeSessionId")
      ? { activeSessionId: record.activeSessionId as string }
      : {}),
    continuityId: record.continuityId,
    fingerprint: record.fingerprint,
    ownerId: record.ownerId,
    policyId: record.policyId,
    revision: record.revision,
  };
};

export const parseStoredSharedSessionState = (value: unknown): LoadedSharedSessionState => {
  if (!isPlainRecord(value)) throw new Error("shared session store must be a plain object");
  const version = value.version;
  const record = requireExactRecord(
    value,
    version === 3 ? ["continuityHeads", "sessions", "version"] : ["sessions", "version"],
    "shared session store",
  );
  if (record.version !== 1 && record.version !== 2 && record.version !== 3) {
    throw new Error("Unsupported shared session store version");
  }
  const legacy = record.version === 1;
  if (!isDenseArray(record.sessions, MAX_SESSIONS)) {
    throw new Error("Shared session store sessions are invalid or exceed their limit");
  }
  const sessionIds = new Set<string>();
  const sessions = record.sessions.map((session, index) => {
    const parsed = parseSession(session, index, legacy);
    if (sessionIds.has(parsed.snapshot.sessionId)) {
      throw new Error(`shared session ${index} is duplicated`);
    }
    sessionIds.add(parsed.snapshot.sessionId);
    return parsed;
  });
  if (record.version !== 3) return { sessions, version: 2 };
  if (!isDenseArray(record.continuityHeads, MAX_CONTINUITY_HEADS)) {
    throw new Error("Shared session store continuity heads are invalid or exceed their limit");
  }
  const continuityKeys = new Set<string>();
  const activeSessionIds = new Set<string>();
  const continuityHeads = record.continuityHeads.map((head, index) => {
    const parsed = parseContinuityHead(head, index);
    const key = JSON.stringify([parsed.policyId, parsed.continuityId]);
    if (continuityKeys.has(key)) {
      throw new Error(`shared session continuity head ${index} is duplicated`);
    }
    if (parsed.activeSessionId !== undefined) {
      if (activeSessionIds.has(parsed.activeSessionId)) {
        throw new Error(`shared session continuity head ${index} reuses an active session`);
      }
      activeSessionIds.add(parsed.activeSessionId);
    }
    continuityKeys.add(key);
    return parsed;
  });
  return { continuityHeads, sessions, version: 3 };
};

const cloneLoadedState = (state: LoadedSharedSessionState): LoadedSharedSessionState => {
  // Validate the caller-owned graph before serializing it. Otherwise a class
  // instance (or an object with a custom toJSON method) could turn itself into
  // an apparently valid plain record and bypass the exact-shape boundary.
  const validated = parseStoredSharedSessionState(state);
  return parseStoredSharedSessionState(JSON.parse(JSON.stringify(validated)) as unknown);
};

const cloneState = (state: StoredSharedSessionState): StoredSharedSessionState => {
  const cloned = cloneLoadedState(state);
  if (cloned.version !== 3) throw new Error("Only V3 shared session state can be saved");
  return cloned;
};

export class MemorySharedSessionStore implements SharedSessionStore {
  private state: LoadedSharedSessionState;

  constructor(initialState: LoadedSharedSessionState = emptySharedSessionState()) {
    this.state = cloneLoadedState(initialState);
  }

  load(): LoadedSharedSessionState {
    return cloneLoadedState(this.state);
  }

  save(state: StoredSharedSessionState): void {
    this.state = cloneState(state);
  }
}

const fileStatus = (filePath: string): ReturnType<typeof lstatSync> | undefined => {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const serializeState = (state: StoredSharedSessionState): string => JSON.stringify(state);

const serializedStateDigest = (serialized: string): string =>
  createHash("sha256").update(serialized).digest("hex");

const stateDigest = (state: StoredSharedSessionState): string =>
  serializedStateDigest(serializeState(state));

const storedSessionId = (session: StoredSharedSession): string => session.snapshot.sessionId;

const storedContinuityKey = (
  head: StoredSharedSessionContinuityHead | StoredSharedSessionContinuityKey,
): string => JSON.stringify([head.policyId, head.continuityId]);

const sameJsonValue = (first: unknown, second: unknown): boolean =>
  JSON.stringify(first) === JSON.stringify(second);

const sameOrder = (first: readonly string[], second: readonly string[]): boolean =>
  first.length === second.length && first.every((value, index) => value === second[index]);

const buildJournalRecord = (
  previous: StoredSharedSessionState,
  next: StoredSharedSessionState,
  sequence: number,
  resultDigest: string,
): StoredSharedSessionJournalRecord => {
  const previousSessions = new Map(previous.sessions.map((session) => [storedSessionId(session), session]));
  const nextSessions = new Map(next.sessions.map((session) => [storedSessionId(session), session]));
  const sessionRemovals = [...previousSessions.keys()].filter((sessionId) => !nextSessions.has(sessionId));
  const sessionUpserts = [...nextSessions].flatMap(([sessionId, session]) => {
    const prior = previousSessions.get(sessionId);
    return prior === undefined || !sameJsonValue(prior, session) ? [session] : [];
  });

  const previousHeads = new Map(previous.continuityHeads.map((head) => [storedContinuityKey(head), head]));
  const nextHeads = new Map(next.continuityHeads.map((head) => [storedContinuityKey(head), head]));
  const continuityHeadRemovals = [...previousHeads].flatMap(([key, head]) =>
    nextHeads.has(key) ? [] : [{ continuityId: head.continuityId, policyId: head.policyId }]);
  const continuityHeadUpserts = [...nextHeads].flatMap(([key, head]) => {
    const prior = previousHeads.get(key);
    return prior === undefined || !sameJsonValue(prior, head) ? [head] : [];
  });

  const projectedSessionIds = [...previousSessions.keys()];
  for (const sessionId of sessionRemovals) {
    projectedSessionIds.splice(projectedSessionIds.indexOf(sessionId), 1);
  }
  for (const session of sessionUpserts) {
    const sessionId = storedSessionId(session);
    if (!previousSessions.has(sessionId)) projectedSessionIds.push(sessionId);
  }
  const projectedHeadKeys = [...previousHeads.keys()];
  for (const head of continuityHeadRemovals) {
    const key = storedContinuityKey(head);
    projectedHeadKeys.splice(projectedHeadKeys.indexOf(key), 1);
  }
  for (const head of continuityHeadUpserts) {
    const key = storedContinuityKey(head);
    if (!previousHeads.has(key)) projectedHeadKeys.push(key);
  }
  const orderChanged = (
    !sameOrder(projectedSessionIds, [...nextSessions.keys()])
    || !sameOrder(projectedHeadKeys, [...nextHeads.keys()])
  );

  return {
    continuityHeadRemovals: orderChanged
      ? [...previousHeads.values()].map(({ continuityId, policyId }) => ({ continuityId, policyId }))
      : continuityHeadRemovals,
    continuityHeadUpserts: orderChanged ? [...nextHeads.values()] : continuityHeadUpserts,
    resultDigest,
    sequence,
    sessionRemovals: orderChanged ? [...previousSessions.keys()] : sessionRemovals,
    sessionUpserts: orderChanged ? [...nextSessions.values()] : sessionUpserts,
    version: 1,
  };
};

const parseJournalHeader = (value: unknown): StoredSharedSessionJournalHeader => {
  const record = requireExactRecord(value, ["baseDigest", "version"], "shared session journal header");
  if (record.version !== 1 || typeof record.baseDigest !== "string" || !STATE_DIGEST_PATTERN.test(record.baseDigest)) {
    throw new Error("Shared session journal header is invalid");
  }
  return { baseDigest: record.baseDigest, version: 1 };
};

const parseJournalContinuityKey = (
  value: unknown,
  context: string,
): StoredSharedSessionContinuityKey => {
  const record = requireExactRecord(value, ["continuityId", "policyId"], context);
  if (
    typeof record.policyId !== "string"
    || record.policyId.length > 64
    || !IDENTIFIER_PATTERN.test(record.policyId)
    || typeof record.continuityId !== "string"
    || record.continuityId.length > 128
    || !IDENTIFIER_PATTERN.test(record.continuityId)
  ) throw new Error(`${context} is invalid`);
  return { continuityId: record.continuityId, policyId: record.policyId };
};

const parseJournalRecord = (
  value: unknown,
  expectedSequence: number,
): StoredSharedSessionJournalRecord => {
  const context = `shared session journal record ${expectedSequence}`;
  const record = requireExactRecord(value, [
    "continuityHeadRemovals",
    "continuityHeadUpserts",
    "resultDigest",
    "sequence",
    "sessionRemovals",
    "sessionUpserts",
    "version",
  ], context);
  if (
    record.version !== 1
    || record.sequence !== expectedSequence
    || typeof record.resultDigest !== "string"
    || !STATE_DIGEST_PATTERN.test(record.resultDigest)
    || !isDenseArray(record.sessionRemovals, MAX_SESSIONS)
    || !isDenseArray(record.sessionUpserts, MAX_SESSIONS)
    || !isDenseArray(record.continuityHeadRemovals, MAX_CONTINUITY_HEADS)
    || !isDenseArray(record.continuityHeadUpserts, MAX_CONTINUITY_HEADS)
  ) throw new Error(`${context} is invalid or out of order`);

  const removedSessionIds = new Set<string>();
  const sessionRemovals = record.sessionRemovals.map((sessionId, index) => {
    if (!isSharedSessionId(sessionId) || removedSessionIds.has(sessionId)) {
      throw new Error(`${context} session removal ${index} is invalid or duplicated`);
    }
    removedSessionIds.add(sessionId);
    return sessionId;
  });
  const upsertedSessionIds = new Set<string>();
  const sessionUpserts = record.sessionUpserts.map((session, index) => {
    const parsed = parseSession(session, index, false);
    const sessionId = storedSessionId(parsed);
    if (upsertedSessionIds.has(sessionId)) {
      throw new Error(`${context} session upsert ${index} is duplicated`);
    }
    upsertedSessionIds.add(sessionId);
    return parsed;
  });
  const removedHeadKeys = new Set<string>();
  const continuityHeadRemovals = record.continuityHeadRemovals.map((head, index) => {
    const parsed = parseJournalContinuityKey(head, `${context} continuity removal ${index}`);
    const key = storedContinuityKey(parsed);
    if (removedHeadKeys.has(key)) throw new Error(`${context} continuity removal ${index} is duplicated`);
    removedHeadKeys.add(key);
    return parsed;
  });
  const upsertedHeadKeys = new Set<string>();
  const continuityHeadUpserts = record.continuityHeadUpserts.map((head, index) => {
    const parsed = parseContinuityHead(head, index);
    const key = storedContinuityKey(parsed);
    if (upsertedHeadKeys.has(key)) {
      throw new Error(`${context} continuity upsert ${index} is duplicated`);
    }
    upsertedHeadKeys.add(key);
    return parsed;
  });
  return {
    continuityHeadRemovals,
    continuityHeadUpserts,
    resultDigest: record.resultDigest,
    sequence: expectedSequence,
    sessionRemovals,
    sessionUpserts,
    version: 1,
  };
};

const applyJournalRecord = (
  state: StoredSharedSessionState,
  record: StoredSharedSessionJournalRecord,
): StoredSharedSessionState => {
  const sessions = new Map(state.sessions.map((session) => [storedSessionId(session), session]));
  for (const sessionId of record.sessionRemovals) {
    if (!sessions.delete(sessionId)) throw new Error("Shared session journal removes a missing session");
  }
  for (const session of record.sessionUpserts) sessions.set(storedSessionId(session), session);

  const continuityHeads = new Map(state.continuityHeads.map((head) => [storedContinuityKey(head), head]));
  for (const head of record.continuityHeadRemovals) {
    if (!continuityHeads.delete(storedContinuityKey(head))) {
      throw new Error("Shared session journal removes a missing continuity head");
    }
  }
  for (const head of record.continuityHeadUpserts) {
    continuityHeads.set(storedContinuityKey(head), head);
  }
  const next = cloneState({
    continuityHeads: [...continuityHeads.values()],
    sessions: [...sessions.values()],
    version: 3,
  });
  if (stateDigest(next) !== record.resultDigest) {
    throw new Error("Shared session journal state digest does not match");
  }
  return next;
};

interface LoadedJournal {
  readonly bytes: number;
  readonly digest: string;
  readonly recordCount: number;
  readonly stale: boolean;
  readonly state: StoredSharedSessionState;
}

const loadJournal = (
  journalPath: string,
  initialState: StoredSharedSessionState,
): LoadedJournal => {
  const initialDigest = stateDigest(initialState);
  const metadata = fileStatus(journalPath);
  if (metadata === undefined) {
    return { bytes: 0, digest: initialDigest, recordCount: 0, stale: false, state: initialState };
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_JOURNAL_BYTES) {
    throw new Error("Shared session journal is not a regular bounded non-symlink file");
  }
  const descriptor = openSync(journalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let contents: string;
  try {
    const openedMetadata = fstatSync(descriptor);
    if (!openedMetadata.isFile() || openedMetadata.size > MAX_JOURNAL_BYTES) {
      throw new Error("Shared session journal changed or exceeds its size limit");
    }
    contents = readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
  if (contents === "" || !contents.endsWith("\n")) {
    throw new Error("Shared session journal has a truncated tail");
  }
  const lines = contents.slice(0, -1).split("\n");
  if (lines.length - 1 > MAX_JOURNAL_RECORDS) {
    throw new Error("Shared session journal exceeds its record limit");
  }
  let rawHeader: unknown;
  try {
    rawHeader = JSON.parse(lines[0] ?? "") as unknown;
  } catch {
    throw new Error("Shared session journal header contains invalid JSON");
  }
  const header = parseJournalHeader(rawHeader);
  const records = lines.slice(1).map((line, index) => {
    let rawRecord: unknown;
    try {
      rawRecord = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`Shared session journal record ${index + 1} contains invalid JSON`);
    }
    return parseJournalRecord(rawRecord, index + 1);
  });
  if (header.baseDigest !== initialDigest) {
    if (records.at(-1)?.resultDigest === initialDigest) {
      return {
        bytes: Number(metadata.size),
        digest: initialDigest,
        recordCount: 0,
        stale: true,
        state: initialState,
      };
    }
    throw new Error("Shared session journal does not follow its checkpoint");
  }
  let state = initialState;
  for (const record of records) state = applyJournalRecord(state, record);
  return {
    bytes: Number(metadata.size),
    digest: stateDigest(state),
    recordCount: records.length,
    stale: false,
    state,
  };
};

/**
 * Keeps acknowledged mutations durable in a small fsynced write-ahead log.
 * Full JSON checkpoints are compacted asynchronously; a frozen journal and
 * digest chain make both sides of a concurrent compaction crash-recoverable.
 * The adapter intentionally supports one writer process per path.
 */
export class FileSharedSessionStore implements SharedSessionStore {
  private readonly filePath: string;
  private readonly journalPath: string;
  private readonly frozenJournalPath: string;
  private readonly journalCompactionBytes: number;
  private activeBaseDigest: string | undefined;
  private activeJournalBytes = 0;
  private activeJournalRecords = 0;
  private activeJournalStale = false;
  private backgroundFlushScheduled = false;
  private checkpointExists = false;
  private closeTask: Promise<void> | undefined;
  private closed = false;
  private closing = false;
  private currentDigest: string | undefined;
  private currentGeneration = 0;
  private currentState: StoredSharedSessionState | undefined;
  private diskGeneration = 0;
  private flushTail: Promise<void> = Promise.resolve();
  private frozenGeneration: number | undefined;
  private frozenJournalStale = false;
  private frozenState: StoredSharedSessionState | undefined;
  private initialized = false;
  private legacyState: LegacyStoredSharedSessionState | undefined;

  constructor(filePath: string, options: FileSharedSessionStoreOptions = {}) {
    if (filePath.trim() === "" || filePath.includes("\0")) {
      throw new Error("Shared session store path cannot be empty or contain NUL");
    }
    const journalCompactionBytes = options.journalCompactionBytes ?? JOURNAL_COMPACTION_BYTES;
    if (
      !Number.isSafeInteger(journalCompactionBytes)
      || journalCompactionBytes < 1
      || journalCompactionBytes > MAX_JOURNAL_BYTES
    ) throw new TypeError("Shared session journal compaction threshold is invalid");
    this.filePath = resolve(filePath);
    this.journalPath = `${this.filePath}.journal`;
    this.frozenJournalPath = `${this.filePath}.journal.checkpoint`;
    this.journalCompactionBytes = journalCompactionBytes;
  }

  load(): LoadedSharedSessionState {
    if (this.closed || this.closing) throw new Error("Shared session store is closed");
    if (this.initialized) {
      if (this.currentState !== undefined) return cloneState(this.currentState);
      if (this.legacyState !== undefined) return cloneLoadedState(this.legacyState);
      throw new Error("Shared session store initialization is inconsistent");
    }
    this.requireSafeDirectory(false);
    const metadata = fileStatus(this.filePath);
    let parsedState: LoadedSharedSessionState;
    if (metadata === undefined) {
      parsedState = emptySharedSessionState();
    } else {
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_STORE_BYTES) {
        throw new Error("Shared session store is not a regular bounded non-symlink file");
      }
      const descriptor = openSync(
        this.filePath,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const openedMetadata = fstatSync(descriptor);
        if (!openedMetadata.isFile() || openedMetadata.size > MAX_STORE_BYTES) {
          throw new Error("Shared session store changed or exceeds its size limit");
        }
        const contents = readFileSync(descriptor, "utf8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(contents) as unknown;
        } catch {
          throw new Error("Shared session store contains invalid JSON");
        }
        parsedState = parseStoredSharedSessionState(parsed);
      } finally {
        closeSync(descriptor);
      }
    }

    this.checkpointExists = metadata !== undefined;
    this.initialized = true;
    if (parsedState.version !== 3) {
      if (fileStatus(this.journalPath) !== undefined || fileStatus(this.frozenJournalPath) !== undefined) {
        throw new Error("Legacy shared session checkpoint cannot have a journal");
      }
      this.legacyState = parsedState;
      return cloneLoadedState(parsedState);
    }

    const checkpoint = cloneState(parsedState);
    const frozen = loadJournal(this.frozenJournalPath, checkpoint);
    const active = loadJournal(this.journalPath, frozen.state);
    this.frozenJournalStale = frozen.stale || (frozen.bytes > 0 && frozen.recordCount === 0);
    if (!frozen.stale && frozen.recordCount > 0) {
      this.frozenState = frozen.state;
      this.frozenGeneration = frozen.recordCount;
    }
    this.activeBaseDigest = frozen.digest;
    this.activeJournalBytes = active.bytes;
    this.activeJournalRecords = active.recordCount;
    this.activeJournalStale = active.stale;
    this.currentGeneration = frozen.recordCount + active.recordCount;
    this.currentDigest = active.digest;
    this.currentState = active.state;
    return cloneState(active.state);
  }

  save(state: StoredSharedSessionState): void {
    this.requireWritable();
    const validated = cloneState(state);
    const serialized = serializeState(validated);
    if (Buffer.byteLength(serialized, "utf8") + 1 > MAX_STORE_BYTES) {
      throw new Error("Shared session store would exceed its size limit");
    }
    const validatedDigest = serializedStateDigest(serialized);
    if (!this.initialized) this.load();
    if (this.currentState === undefined || !this.checkpointExists) {
      this.writeCheckpointSync(validated);
      this.installStandaloneCheckpoint(validated);
      return;
    }
    if (this.currentDigest === validatedDigest) return;

    const record = buildJournalRecord(
      this.currentState,
      validated,
      this.activeJournalRecords + 1,
      validatedDigest,
    );
    const line = `${JSON.stringify(record)}\n`;
    const header = this.activeJournalRecords === 0
      ? `${JSON.stringify({ baseDigest: this.activeBaseDigest, version: 1 })}\n`
      : "";
    const appendedBytes = Buffer.byteLength(header, "utf8") + Buffer.byteLength(line, "utf8");
    if (
      this.activeJournalBytes + appendedBytes > MAX_JOURNAL_BYTES
      || this.activeJournalRecords + 1 > MAX_JOURNAL_RECORDS
    ) {
      this.scheduleBackgroundFlush();
      throw new Error("Shared session journal requires checkpoint capacity");
    }
    this.appendJournal(`${header}${line}`);
    this.activeJournalBytes += appendedBytes;
    this.activeJournalRecords += 1;
    this.currentGeneration += 1;
    this.currentDigest = validatedDigest;
    this.currentState = validated;
    if (this.activeJournalBytes >= this.journalCompactionBytes) this.scheduleBackgroundFlush();
  }

  flush(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (!this.initialized) this.load();
    const targetGeneration = this.currentGeneration;
    const task = this.flushTail.then(() => this.flushThrough(targetGeneration));
    this.flushTail = task.catch(() => undefined);
    return task;
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.closeTask !== undefined) return this.closeTask;
    if (!this.initialized) this.load();
    this.closing = true;
    const task = this.flush().then(() => {
      this.closed = true;
      this.closing = false;
    }).catch((error: unknown) => {
      this.closing = false;
      this.closeTask = undefined;
      throw error;
    });
    this.closeTask = task;
    return task;
  }

  protected syncJournal(descriptor: number): void {
    fsyncSync(descriptor);
  }

  protected async writeCheckpoint(state: StoredSharedSessionState): Promise<void> {
    const serialized = this.serializeCheckpoint(state);
    const directory = dirname(this.filePath);
    await mkdirAsync(directory, { mode: 0o700, recursive: true });
    this.requireSafeDirectory(true);
    const targetMetadata = fileStatus(this.filePath);
    if (targetMetadata?.isSymbolicLink()) {
      throw new Error("Shared session store target cannot be a symbolic link");
    }
    if (targetMetadata !== undefined && !targetMetadata.isFile()) {
      throw new Error("Shared session store target must be a regular file");
    }
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof openAsync>> | undefined;
    try {
      handle = await openAsync(
        temporaryPath,
        constants.O_CREAT
          | constants.O_EXCL
          | constants.O_WRONLY
          | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await renameAsync(temporaryPath, this.filePath);
      const directoryHandle = await openAsync(directory, constants.O_RDONLY);
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rmAsync(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private appendJournal(payload: string): void {
    const directory = dirname(this.filePath);
    mkdirSync(directory, { mode: 0o700, recursive: true });
    this.requireSafeDirectory(true);
    this.removeStaleJournalsSync();
    const metadata = fileStatus(this.journalPath);
    if (metadata?.isSymbolicLink() || (metadata !== undefined && !metadata.isFile())) {
      throw new Error("Shared session journal target must be a regular non-symlink file");
    }
    if (metadata !== undefined && metadata.size !== this.activeJournalBytes) {
      throw new Error("Shared session journal changed outside this store");
    }
    const previousSize = Number(metadata?.size ?? 0);
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        this.journalPath,
        constants.O_APPEND
          | constants.O_CREAT
          | constants.O_WRONLY
          | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      writeFileSync(descriptor, payload, "utf8");
      this.syncJournal(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      if (previousSize === 0) this.syncDirectorySync(directory);
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          ftruncateSync(descriptor, previousSize);
          fsyncSync(descriptor);
        } catch {
          // The original failure remains the actionable cause; recovery will
          // fail closed if the journal tail could not be restored.
        }
        closeSync(descriptor);
      } else {
        this.rollbackJournal(previousSize);
      }
      if (previousSize === 0) {
        rmSync(this.journalPath, { force: true });
        this.syncDirectorySync(directory);
      }
      throw error;
    }
  }

  private async compactFrozenJournal(): Promise<void> {
    const state = this.frozenState;
    const generation = this.frozenGeneration;
    if (state === undefined || generation === undefined) return;
    if (this.diskGeneration < generation) {
      await this.writeCheckpoint(state);
      this.checkpointExists = true;
      this.diskGeneration = generation;
    }
    await rmAsync(this.frozenJournalPath, { force: true });
    await this.syncDirectoryAsync(dirname(this.filePath));
    if (this.frozenState === state && this.frozenGeneration === generation) {
      this.frozenState = undefined;
      this.frozenGeneration = undefined;
      this.frozenJournalStale = false;
    }
  }

  private async flushThrough(targetGeneration: number): Promise<void> {
    // Keep stale-sidecar cleanup in the same synchronous turn as rotation.
    // A save cannot then recreate the active path while an asynchronous unlink
    // of the stale inode is still pending.
    this.removeStaleJournalsSync();
    while (this.diskGeneration < targetGeneration) {
      if (this.frozenState !== undefined) {
        await this.compactFrozenJournal();
        continue;
      }
      if (this.activeJournalRecords === 0) {
        throw new Error("Shared session checkpoint generation is inconsistent");
      }
      this.rotateActiveJournal();
      await this.compactFrozenJournal();
    }
  }

  private installStandaloneCheckpoint(state: StoredSharedSessionState): void {
    this.currentState = state;
    this.currentDigest = stateDigest(state);
    this.legacyState = undefined;
    this.checkpointExists = true;
    this.activeBaseDigest = this.currentDigest;
    this.activeJournalBytes = 0;
    this.activeJournalRecords = 0;
    this.activeJournalStale = false;
    this.currentGeneration = 0;
    this.diskGeneration = 0;
    this.frozenGeneration = undefined;
    this.frozenJournalStale = false;
    this.frozenState = undefined;
    this.initialized = true;
  }

  private removeStaleJournalsSync(): void {
    const directory = dirname(this.filePath);
    let changed = false;
    if (this.frozenJournalStale) {
      rmSync(this.frozenJournalPath, { force: true });
      this.frozenJournalStale = false;
      changed = true;
    }
    if (this.activeJournalStale) {
      rmSync(this.journalPath, { force: true });
      this.activeJournalStale = false;
      this.activeJournalBytes = 0;
      changed = true;
    }
    if (changed) this.syncDirectorySync(directory);
  }

  private requireWritable(): void {
    if (this.closed || this.closing) throw new Error("Shared session store is closed");
  }

  private rollbackJournal(size: number): void {
    const metadata = fileStatus(this.journalPath);
    if (metadata === undefined || metadata.isSymbolicLink() || !metadata.isFile()) return;
    const descriptor = openSync(
      this.journalPath,
      constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      ftruncateSync(descriptor, size);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  private rotateActiveJournal(): void {
    if (this.currentState === undefined || this.activeJournalRecords === 0) return;
    this.removeStaleJournalsSync();
    if (this.frozenState !== undefined || fileStatus(this.frozenJournalPath) !== undefined) {
      throw new Error("Shared session journal compaction is already pending");
    }
    renameSync(this.journalPath, this.frozenJournalPath);
    this.frozenState = this.currentState;
    this.frozenGeneration = this.currentGeneration;
    if (this.currentDigest === undefined) {
      throw new Error("Shared session journal digest is unavailable");
    }
    this.activeBaseDigest = this.currentDigest;
    this.activeJournalBytes = 0;
    this.activeJournalRecords = 0;
    this.activeJournalStale = false;
    this.syncDirectorySync(dirname(this.filePath));
  }

  private scheduleBackgroundFlush(): void {
    if (this.backgroundFlushScheduled || this.closed || this.closing) return;
    this.backgroundFlushScheduled = true;
    void this.flush().then(
      () => {
        this.backgroundFlushScheduled = false;
        if (this.activeJournalBytes >= this.journalCompactionBytes) this.scheduleBackgroundFlush();
      },
      () => {
        // The WAL remains the durable authority. Explicit flush/close retries
        // the checkpoint and surfaces an error if storage is still unhealthy.
        this.backgroundFlushScheduled = false;
      },
    );
  }

  private serializeCheckpoint(state: StoredSharedSessionState): string {
    const serialized = `${serializeState(state)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) {
      throw new Error("Shared session store would exceed its size limit");
    }
    return serialized;
  }

  private async syncDirectoryAsync(directory: string): Promise<void> {
    const directoryHandle = await openAsync(directory, constants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  }

  private syncDirectorySync(directory: string): void {
    const directoryDescriptor = openSync(directory, constants.O_RDONLY);
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  }

  private writeCheckpointSync(state: StoredSharedSessionState): void {
    const serialized = this.serializeCheckpoint(state);
    const directory = dirname(this.filePath);
    mkdirSync(directory, { mode: 0o700, recursive: true });
    this.requireSafeDirectory(true);
    const targetMetadata = fileStatus(this.filePath);
    if (targetMetadata?.isSymbolicLink()) {
      throw new Error("Shared session store target cannot be a symbolic link");
    }
    if (targetMetadata !== undefined && !targetMetadata.isFile()) {
      throw new Error("Shared session store target must be a regular file");
    }
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        temporaryPath,
        constants.O_CREAT
          | constants.O_EXCL
          | constants.O_WRONLY
          | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      writeFileSync(descriptor, serialized, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, this.filePath);
      this.syncDirectorySync(directory);
      rmSync(this.journalPath, { force: true });
      rmSync(this.frozenJournalPath, { force: true });
      this.syncDirectorySync(directory);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  private requireSafeDirectory(required: boolean): void {
    const directory = dirname(this.filePath);
    const metadata = fileStatus(directory);
    if (metadata === undefined) {
      if (required) throw new Error("Shared session store directory is missing");
      return;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Shared session store directory must be a non-symlink directory");
    }
  }
}
