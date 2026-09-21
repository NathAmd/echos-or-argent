import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

const MAX_STORE_BYTES = 16 * 1024 * 1024;
export const MAX_ACCOUNTS = 10_000;
export const MAX_SESSIONS = 100_000;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type StoredAccountRole = "admin" | "user";

export interface StoredPasswordHash {
  readonly algorithm: "scrypt";
  readonly blockSize: 8;
  readonly cost: number;
  readonly digest: string;
  readonly parallelization: 1;
  readonly salt: string;
}

export interface StoredAccount {
  readonly createdAt: number;
  readonly id: string;
  readonly password: StoredPasswordHash;
  readonly role: StoredAccountRole;
  readonly username: string;
  readonly vaultKeyId?: string;
}

export interface StoredAccountSession {
  readonly accountId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
  readonly tokenHash: string;
}

export interface StoredAccountState {
  readonly accounts: readonly StoredAccount[];
  readonly sessions: readonly StoredAccountSession[];
  readonly version: 1;
}

export interface AccountStore {
  load(): Promise<StoredAccountState>;
  save(state: StoredAccountState): Promise<void>;
}

export const emptyAccountState = (): StoredAccountState => ({
  accounts: [],
  sessions: [],
  version: 1,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && !Array.isArray(value) && typeof value === "object";

const requireKeys = (
  value: unknown,
  keys: readonly string[],
  context: string,
): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${context} has an invalid shape`);
  }
  return value;
};

const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPowerOfTwo = (value: number): boolean =>
  value >= 1_024 && value <= 262_144 && (value & (value - 1)) === 0;

const parsePassword = (value: unknown, index: number): StoredPasswordHash => {
  const record = requireKeys(
    value,
    ["algorithm", "blockSize", "cost", "digest", "parallelization", "salt"],
    `account ${index} password`,
  );
  if (
    record.algorithm !== "scrypt"
    || typeof record.cost !== "number"
    || !Number.isSafeInteger(record.cost)
    || !isPowerOfTwo(record.cost)
    || record.blockSize !== 8
    || record.parallelization !== 1
    || typeof record.salt !== "string"
    || !BASE64URL_PATTERN.test(record.salt)
    || Buffer.from(record.salt, "base64url").length < 16
    || typeof record.digest !== "string"
    || !BASE64URL_PATTERN.test(record.digest)
    || Buffer.from(record.digest, "base64url").length !== 32
  ) {
    throw new Error(`account ${index} password is invalid`);
  }
  return {
    algorithm: "scrypt",
    blockSize: record.blockSize as 8,
    cost: record.cost,
    digest: record.digest,
    parallelization: record.parallelization as 1,
    salt: record.salt,
  };
};

const parseStoredState = (value: unknown): StoredAccountState => {
  const record = requireKeys(value, ["accounts", "sessions", "version"], "account store");
  if (record.version !== 1) throw new Error("Unsupported account store version");
  if (!Array.isArray(record.accounts) || record.accounts.length > MAX_ACCOUNTS) {
    throw new Error("Account store accounts are invalid or exceed their limit");
  }
  if (!Array.isArray(record.sessions) || record.sessions.length > MAX_SESSIONS) {
    throw new Error("Account store sessions are invalid or exceed their limit");
  }

  const accountIds = new Set<string>();
  const usernames = new Set<string>();
  const accounts = record.accounts.map((value, index): StoredAccount => {
    const rawAccount = isRecord(value) ? value : {};
    const account = requireKeys(value, rawAccount.vaultKeyId === undefined
      ? ["createdAt", "id", "password", "role", "username"]
      : ["createdAt", "id", "password", "role", "username", "vaultKeyId"], `account ${index}`);
    if (
      typeof account.id !== "string"
      || !/^[a-z0-9](?:[a-z0-9._-]{2,31})$/.test(account.id)
      || typeof account.username !== "string"
      || account.username !== account.id
      || (account.role !== "user" && account.role !== "admin")
      || !isTimestamp(account.createdAt)
      || accountIds.has(account.id)
      || usernames.has(account.username)
      || account.vaultKeyId !== undefined && (
        typeof account.vaultKeyId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(account.vaultKeyId)
      )
    ) {
      throw new Error(`account ${index} is invalid or duplicated`);
    }
    accountIds.add(account.id);
    usernames.add(account.username);
    return {
      createdAt: account.createdAt,
      id: account.id,
      password: parsePassword(account.password, index),
      role: account.role,
      username: account.username,
      ...(account.vaultKeyId === undefined ? {} : { vaultKeyId: account.vaultKeyId as string }),
    };
  });

  const tokenHashes = new Set<string>();
  const sessions = record.sessions.map((value, index): StoredAccountSession => {
    const session = requireKeys(
      value,
      ["accountId", "createdAt", "expiresAt", "revokedAt", "tokenHash"],
      `session ${index}`,
    );
    if (
      typeof session.accountId !== "string"
      || !accountIds.has(session.accountId)
      || !isTimestamp(session.createdAt)
      || !isTimestamp(session.expiresAt)
      || session.expiresAt <= session.createdAt
      || (session.revokedAt !== null && !isTimestamp(session.revokedAt))
      || typeof session.tokenHash !== "string"
      || !/^[a-f0-9]{64}$/.test(session.tokenHash)
      || tokenHashes.has(session.tokenHash)
    ) {
      throw new Error(`session ${index} is invalid or duplicated`);
    }
    tokenHashes.add(session.tokenHash);
    return {
      accountId: session.accountId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      tokenHash: session.tokenHash,
    };
  });

  return { accounts, sessions, version: 1 };
};

const cloneState = (state: StoredAccountState): StoredAccountState => ({
  accounts: state.accounts.map((account) => ({
    ...account,
    password: { ...account.password },
  })),
  sessions: state.sessions.map((session) => ({ ...session })),
  version: 1,
});

export class MemoryAccountStore implements AccountStore {
  private state: StoredAccountState;

  constructor(initialState: StoredAccountState = emptyAccountState()) {
    this.state = cloneState(parseStoredState(initialState));
  }

  async load(): Promise<StoredAccountState> {
    return cloneState(this.state);
  }

  async save(state: StoredAccountState): Promise<void> {
    this.state = cloneState(parseStoredState(state));
  }
}

export class FileAccountStore implements AccountStore {
  constructor(private readonly filePath: string) {
    if (filePath.trim() === "") throw new Error("Account store path cannot be empty");
  }

  async load(): Promise<StoredAccountState> {
    try {
      await access(this.filePath, constants.R_OK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyAccountState();
      throw error;
    }
    const metadata = await stat(this.filePath);
    if (!metadata.isFile() || metadata.size > MAX_STORE_BYTES) {
      throw new Error("Account store is not a regular bounded file");
    }
    const contents = await readFile(this.filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new Error("Account store contains invalid JSON");
    }
    return parseStoredState(parsed);
  }

  async save(state: StoredAccountState): Promise<void> {
    const validated = parseStoredState(state);
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const serialized = `${JSON.stringify(validated, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) {
      throw new Error("Account store would exceed its size limit");
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
