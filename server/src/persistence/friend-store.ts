import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { ServiceError } from "../errors.js";
import { isUserId, requireExactObject } from "../validation.js";

const MAX_STORE_BYTES = 8 * 1024 * 1024;
export const MAX_FRIEND_STORE_RELATIONSHIPS = 100_000;

export interface StoredFriendRequest {
  readonly from: string;
  readonly to: string;
}

export interface StoredFriendState {
  readonly friendships: readonly (readonly [string, string])[];
  readonly requests: readonly StoredFriendRequest[];
  readonly version: 1;
}

export interface FriendStore {
  load(): Promise<StoredFriendState>;
  save(state: StoredFriendState): Promise<void>;
}

export const emptyFriendState = (): StoredFriendState => ({
  friendships: [],
  requests: [],
  version: 1,
});

const cloneStoredState = (state: StoredFriendState): StoredFriendState => ({
  friendships: state.friendships.map(([first, second]) => [first, second] as const),
  requests: state.requests.map(({ from, to }) => ({ from, to })),
  version: 1,
});

const parseStoredState = (value: unknown): StoredFriendState => {
  const record = requireExactObject(value, ["version", "friendships", "requests"], "friend store");
  if (record.version !== 1) {
    throw new Error("Unsupported friend store version");
  }
  if (!Array.isArray(record.friendships) || !Array.isArray(record.requests)) {
    throw new Error("Friend store relationships must be arrays");
  }
  if (
    record.friendships.length > MAX_FRIEND_STORE_RELATIONSHIPS
    || record.requests.length > MAX_FRIEND_STORE_RELATIONSHIPS
  ) {
    throw new Error("Friend store exceeds its relationship limit");
  }
  const friendships = record.friendships.map((pair, index): readonly [string, string] => {
    if (!Array.isArray(pair) || pair.length !== 2 || !isUserId(pair[0]) || !isUserId(pair[1])) {
      throw new Error(`Invalid friendship at index ${index}`);
    }
    return [pair[0], pair[1]];
  });
  const requests = record.requests.map((request, index): StoredFriendRequest => {
    let candidate: Record<string, unknown>;
    try {
      candidate = requireExactObject(request, ["from", "to"], `friend request ${index}`);
    } catch (error) {
      if (error instanceof ServiceError) {
        throw new Error(error.message);
      }
      throw error;
    }
    if (!isUserId(candidate.from) || !isUserId(candidate.to)) {
      throw new Error(`Invalid friend request at index ${index}`);
    }
    return { from: candidate.from, to: candidate.to };
  });
  return { friendships, requests, version: 1 };
};

export class MemoryFriendStore implements FriendStore {
  private state: StoredFriendState;

  constructor(initialState: StoredFriendState = emptyFriendState()) {
    this.state = cloneStoredState(initialState);
  }

  async load(): Promise<StoredFriendState> {
    return cloneStoredState(this.state);
  }

  async save(state: StoredFriendState): Promise<void> {
    this.state = cloneStoredState(state);
  }
}

export class FileFriendStore implements FriendStore {
  constructor(private readonly filePath: string) {
    if (filePath.trim() === "") {
      throw new Error("Friend store path cannot be empty");
    }
  }

  async load(): Promise<StoredFriendState> {
    try {
      await access(this.filePath, constants.R_OK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyFriendState();
      }
      throw error;
    }
    const metadata = await stat(this.filePath);
    if (!metadata.isFile() || metadata.size > MAX_STORE_BYTES) {
      throw new Error("Friend store is not a regular bounded file");
    }
    const contents = await readFile(this.filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new Error("Friend store contains invalid JSON");
    }
    return parseStoredState(parsed);
  }

  async save(state: StoredFriendState): Promise<void> {
    const validatedState = parseStoredState(state);
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const serialized = `${JSON.stringify(validatedState, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) {
      throw new Error("Friend store would exceed its size limit");
    }
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.filePath);
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
