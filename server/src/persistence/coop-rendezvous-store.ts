import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  isCoopRendezvousSessionId,
  type CoopRendezvousMode,
  type CoopRendezvousSessionStatus,
} from "../domain/coop-rendezvous.js";
import { isUserId } from "../validation.js";

const MAX_STORE_BYTES = 4 * 1024 * 1024;
const MAX_QUEUED = 1_000;
const MAX_SESSIONS = 1_000;

export interface StoredCoopRendezvousQueueEntry {
  readonly expiresAt: number;
  readonly joinedAt: number;
  readonly userId: string;
}

export interface StoredCoopRendezvousSession {
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly guestUserId: string;
  readonly hostUserId: string;
  readonly mode: CoopRendezvousMode;
  readonly sessionId: string;
  readonly status: CoopRendezvousSessionStatus;
}

export interface StoredCoopRendezvousState {
  queued: StoredCoopRendezvousQueueEntry[];
  sessions: StoredCoopRendezvousSession[];
  readonly version: 1;
}

export interface CoopRendezvousStore {
  load(): StoredCoopRendezvousState;
  save(state: StoredCoopRendezvousState): void;
}

export const emptyCoopRendezvousState = (): StoredCoopRendezvousState => ({
  queued: [],
  sessions: [],
  version: 1,
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

const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const parseQueueEntry = (value: unknown, index: number): StoredCoopRendezvousQueueEntry => {
  const record = requireExactRecord(
    value,
    ["expiresAt", "joinedAt", "userId"],
    `Coop rendezvous queue entry ${index}`,
  );
  if (
    !isTimestamp(record.expiresAt)
    || !isTimestamp(record.joinedAt)
    || record.expiresAt < record.joinedAt
    || !isUserId(record.userId)
  ) throw new Error(`Coop rendezvous queue entry ${index} is invalid`);
  return {
    expiresAt: record.expiresAt,
    joinedAt: record.joinedAt,
    userId: record.userId,
  };
};

const parseSession = (value: unknown, index: number): StoredCoopRendezvousSession => {
  const record = requireExactRecord(
    value,
    [
      "createdAt",
      "expiresAt",
      "guestUserId",
      "hostUserId",
      "mode",
      "sessionId",
      "status",
    ],
    `Coop rendezvous session ${index}`,
  );
  if (
    !isTimestamp(record.createdAt)
    || !isTimestamp(record.expiresAt)
    || record.expiresAt < record.createdAt
    || !isUserId(record.guestUserId)
    || !isUserId(record.hostUserId)
    || record.guestUserId === record.hostUserId
    || (record.mode !== "friend" && record.mode !== "random")
    || !isCoopRendezvousSessionId(record.sessionId)
    || (record.status !== "offered" && record.status !== "ready" && record.status !== "active")
    || (record.status === "offered" && record.mode !== "friend")
    || (record.mode === "random" && record.hostUserId > record.guestUserId)
  ) throw new Error(`Coop rendezvous session ${index} is invalid`);
  return {
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    guestUserId: record.guestUserId,
    hostUserId: record.hostUserId,
    mode: record.mode,
    sessionId: record.sessionId,
    status: record.status,
  };
};

export const parseStoredCoopRendezvousState = (value: unknown): StoredCoopRendezvousState => {
  const record = requireExactRecord(
    value,
    ["queued", "sessions", "version"],
    "Coop rendezvous store",
  );
  if (record.version !== 1) throw new Error("Unsupported Coop rendezvous store version");
  if (!isDenseArray(record.queued, MAX_QUEUED)) {
    throw new Error("Coop rendezvous queue is invalid or exceeds its limit");
  }
  if (!isDenseArray(record.sessions, MAX_SESSIONS)) {
    throw new Error("Coop rendezvous sessions are invalid or exceed their limit");
  }
  const engagedUsers = new Set<string>();
  const queued = record.queued.map((entry, index) => {
    const parsed = parseQueueEntry(entry, index);
    if (engagedUsers.has(parsed.userId)) {
      throw new Error(`Coop rendezvous queue entry ${index} duplicates an identity`);
    }
    engagedUsers.add(parsed.userId);
    return parsed;
  });
  const sessionIds = new Set<string>();
  const sessions = record.sessions.map((session, index) => {
    const parsed = parseSession(session, index);
    if (sessionIds.has(parsed.sessionId)) {
      throw new Error(`Coop rendezvous session ${index} duplicates a session ID`);
    }
    if (engagedUsers.has(parsed.hostUserId) || engagedUsers.has(parsed.guestUserId)) {
      throw new Error(`Coop rendezvous session ${index} reuses an engaged identity`);
    }
    sessionIds.add(parsed.sessionId);
    engagedUsers.add(parsed.hostUserId);
    engagedUsers.add(parsed.guestUserId);
    return parsed;
  });
  return { queued, sessions, version: 1 };
};

const cloneState = (state: StoredCoopRendezvousState): StoredCoopRendezvousState => {
  const validated = parseStoredCoopRendezvousState(state);
  return parseStoredCoopRendezvousState(JSON.parse(JSON.stringify(validated)) as unknown);
};

export class MemoryCoopRendezvousStore implements CoopRendezvousStore {
  private state: StoredCoopRendezvousState;

  constructor(initialState: StoredCoopRendezvousState = emptyCoopRendezvousState()) {
    this.state = cloneState(initialState);
  }

  load(): StoredCoopRendezvousState {
    return cloneState(this.state);
  }

  save(state: StoredCoopRendezvousState): void {
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

export class FileCoopRendezvousStore implements CoopRendezvousStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    if (filePath.trim() === "" || filePath.includes("\0")) {
      throw new Error("Coop rendezvous store path cannot be empty or contain NUL");
    }
    this.filePath = resolve(filePath);
  }

  load(): StoredCoopRendezvousState {
    this.requireSafeDirectory(false);
    const metadata = fileStatus(this.filePath);
    if (metadata === undefined) return emptyCoopRendezvousState();
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_STORE_BYTES) {
      throw new Error("Coop rendezvous store is not a regular bounded non-symlink file");
    }
    const descriptor = openSync(this.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const openedMetadata = fstatSync(descriptor);
      if (!openedMetadata.isFile() || openedMetadata.size > MAX_STORE_BYTES) {
        throw new Error("Coop rendezvous store changed or exceeds its size limit");
      }
      const contents = readFileSync(descriptor, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(contents) as unknown;
      } catch {
        throw new Error("Coop rendezvous store contains invalid JSON");
      }
      return parseStoredCoopRendezvousState(parsed);
    } finally {
      closeSync(descriptor);
    }
  }

  save(state: StoredCoopRendezvousState): void {
    const validated = cloneState(state);
    const directory = dirname(this.filePath);
    mkdirSync(directory, { mode: 0o700, recursive: true });
    this.requireSafeDirectory(true);
    const targetMetadata = fileStatus(this.filePath);
    if (targetMetadata?.isSymbolicLink()) {
      throw new Error("Coop rendezvous store target cannot be a symbolic link");
    }
    if (targetMetadata !== undefined && !targetMetadata.isFile()) {
      throw new Error("Coop rendezvous store target must be a regular file");
    }
    const serialized = `${JSON.stringify(validated, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) {
      throw new Error("Coop rendezvous store would exceed its size limit");
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
      const directoryDescriptor = openSync(directory, constants.O_RDONLY);
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
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
      if (required) throw new Error("Coop rendezvous store directory is missing");
      return;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Coop rendezvous store directory must be a non-symlink directory");
    }
  }
}
