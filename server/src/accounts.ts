import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { ServiceError } from "./errors.js";
import {
  MAX_ACCOUNTS,
  MAX_SESSIONS,
  type AccountStore,
  type StoredAccount,
  type StoredAccountRole,
  type StoredAccountSession,
  type StoredAccountState,
  type StoredPasswordHash,
} from "./persistence/account-store.js";

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{2,31})$/;
const MAX_PASSWORD_BYTES = 256;
const MAX_ACTIVE_SESSIONS_PER_ACCOUNT = 20;
const MAX_BEARER_BYTES = 512;

export const ACCOUNT_ENTITLEMENTS = [
  "cloud-storage",
  "development",
  "online",
  "premium-client",
] as const;
export type AccountEntitlement = (typeof ACCOUNT_ENTITLEMENTS)[number];
export type AccountProviderEntitlement = Exclude<AccountEntitlement, "development">;
export type AccountEntitlementPolicy = "open" | "patreon";

export interface PublicAccount {
  readonly entitlements: readonly AccountEntitlement[];
  readonly id: string;
  readonly role: StoredAccountRole;
  readonly username: string;
  readonly vaultKeyId?: string;
}

export interface AccountSessionResult {
  readonly accessToken: string;
  readonly expiresAt: number;
}

export interface AccountAuthenticationResult {
  readonly account: PublicAccount;
  readonly accountId: string;
  readonly authenticationSessionId: string;
}

export interface AccountLoginResult {
  readonly account: PublicAccount;
  readonly session: AccountSessionResult;
}

export interface ScryptParameters {
  readonly blockSize: 8;
  readonly cost: number;
  readonly keyLength: 32;
  readonly maxmem: number;
  readonly parallelization: 1;
}

export interface AccountEntitlementProvider {
  entitlementsFor(account: Readonly<StoredAccount>): readonly AccountProviderEntitlement[];
}

/** Point d'extension volontairement inactif tant que l'intégration Patreon n'existe pas. */
export class InactivePatreonEntitlementProvider implements AccountEntitlementProvider {
  entitlementsFor(_account: Readonly<StoredAccount>): readonly AccountProviderEntitlement[] {
    return [];
  }
}

export interface AccountServiceOptions {
  readonly entitlementPolicy: AccountEntitlementPolicy;
  readonly entitlementProvider?: AccountEntitlementProvider;
  readonly knownUserIds: Set<string>;
  /** Optional reduced ceiling used by constrained embeddings and deterministic tests. */
  readonly maximumSessions?: number;
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Buffer;
  readonly scryptParameters?: ScryptParameters;
  readonly sessionTtlMs: number;
}

const PRODUCTION_SCRYPT_PARAMETERS: ScryptParameters = {
  blockSize: 8,
  cost: 2 ** 17,
  keyLength: 32,
  maxmem: 192 * 1024 * 1024,
  parallelization: 1,
};

const cloneState = (state: StoredAccountState): StoredAccountState => ({
  accounts: state.accounts.map((account) => ({ ...account, password: { ...account.password } })),
  sessions: state.sessions.map((session) => ({ ...session })),
  version: 1,
});

const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

const parseBearerToken = (header: string | undefined): string | null => {
  if (header === undefined) return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  const token = match?.[1];
  if (token === undefined || Buffer.byteLength(token, "utf8") > MAX_BEARER_BYTES) return null;
  return token;
};

export const normalizeUsername = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  return USERNAME_PATTERN.test(normalized) ? normalized : null;
};

const isAcceptablePassword = (value: unknown): value is string =>
  typeof value === "string"
  && value.length >= 10
  && Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES;

const deriveScrypt = (
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, parameters.keyLength, {
    N: parameters.cost,
    maxmem: parameters.maxmem,
    p: parameters.parallelization,
    r: parameters.blockSize,
  }, (error, derivedKey) => {
    if (error === null) resolve(derivedKey);
    else reject(error);
  });
});

const parametersForStoredHash = (stored: StoredPasswordHash): ScryptParameters => ({
  blockSize: stored.blockSize,
  cost: stored.cost,
  keyLength: 32,
  maxmem: Math.max(64 * 1024 * 1024, 160 * stored.cost * stored.blockSize),
  parallelization: stored.parallelization,
});

const createStoredPassword = async (
  password: string,
  random: (size: number) => Buffer,
  parameters: ScryptParameters,
): Promise<StoredPasswordHash> => {
  const salt = random(16);
  const digest = await deriveScrypt(password, salt, parameters);
  return {
    algorithm: "scrypt",
    blockSize: parameters.blockSize,
    cost: parameters.cost,
    digest: digest.toString("base64url"),
    parallelization: parameters.parallelization,
    salt: salt.toString("base64url"),
  };
};

const verifyPassword = async (password: string, stored: StoredPasswordHash): Promise<boolean> => {
  const expected = Buffer.from(stored.digest, "base64url");
  const candidate = await deriveScrypt(
    password,
    Buffer.from(stored.salt, "base64url"),
    parametersForStoredHash(stored),
  );
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};

const invalidCredentials = (): ServiceError =>
  new ServiceError(401, "INVALID_CREDENTIALS", "Username or password is invalid");

const accountCapacityReached = (): ServiceError =>
  new ServiceError(503, "UNAVAILABLE", "Account capacity reached");

const accountSessionCapacityReached = (): ServiceError =>
  new ServiceError(503, "UNAVAILABLE", "Account session capacity reached");

export class AccountService {
  private accountById = new Map<string, StoredAccount>();
  private readonly entitlementProvider: AccountEntitlementProvider;
  private readonly maximumSessions: number;
  private readonly now: () => number;
  private readonly random: (size: number) => Buffer;
  private readonly scryptParameters: ScryptParameters;
  private state: StoredAccountState;
  private mutationTail: Promise<void> = Promise.resolve();
  private sessionByTokenHash = new Map<string, StoredAccountSession>();
  private readonly dummyPassword: StoredPasswordHash;

  private constructor(
    private readonly store: AccountStore,
    private readonly options: AccountServiceOptions,
    initialState: StoredAccountState,
    dummyPassword: StoredPasswordHash,
  ) {
    if (initialState.accounts.length > MAX_ACCOUNTS) {
      throw new Error("Account store exceeds the global account capacity");
    }
    this.maximumSessions = options.maximumSessions ?? MAX_SESSIONS;
    if (
      !Number.isSafeInteger(this.maximumSessions)
      || this.maximumSessions < 1
      || this.maximumSessions > MAX_SESSIONS
    ) throw new TypeError("maximumSessions is outside the supported range");
    if (initialState.sessions.length > this.maximumSessions) {
      throw new Error("Account store exceeds the configured session capacity");
    }
    this.state = cloneState(initialState);
    this.now = options.now ?? Date.now;
    this.random = options.randomBytes ?? randomBytes;
    this.scryptParameters = options.scryptParameters ?? PRODUCTION_SCRYPT_PARAMETERS;
    this.entitlementProvider = options.entitlementProvider ?? new InactivePatreonEntitlementProvider();
    this.dummyPassword = dummyPassword;
    this.rebuildIndexes();
    for (const account of this.state.accounts) {
      if (options.knownUserIds.has(account.id)) {
        throw new Error(`Account ID ${account.id} collides with a legacy identity`);
      }
      options.knownUserIds.add(account.id);
    }
  }

  static async create(store: AccountStore, options: AccountServiceOptions): Promise<AccountService> {
    const parameters = options.scryptParameters ?? PRODUCTION_SCRYPT_PARAMETERS;
    const random = options.randomBytes ?? randomBytes;
    const dummyPassword = await createStoredPassword(
      random(32).toString("base64url"),
      random,
      parameters,
    );
    return new AccountService(store, options, await store.load(), dummyPassword);
  }

  accountIds(): readonly string[] {
    return [...this.accountById.keys()];
  }

  authenticateAuthorizationHeader(header: string | undefined): AccountAuthenticationResult | null {
    const token = parseBearerToken(header);
    if (token === null) return null;
    const tokenHash = hashSessionToken(token);
    const now = this.now();
    const session = this.sessionByTokenHash.get(tokenHash);
    if (session === undefined || session.revokedAt !== null || session.expiresAt <= now) return null;
    const account = this.accountById.get(session.accountId);
    return account === undefined
      ? null
      : {
          account: this.toPublicAccount(account),
          accountId: account.id,
          authenticationSessionId: session.tokenHash,
        };
  }

  hasActiveSession(authenticationSessionId: string, accountId?: string): boolean {
    const session = this.sessionByTokenHash.get(authenticationSessionId);
    return session !== undefined
      && (accountId === undefined || session.accountId === accountId)
      && session.revokedAt === null
      && session.expiresAt > this.now()
      && this.accountById.has(session.accountId);
  }

  async register(usernameValue: unknown, passwordValue: unknown): Promise<AccountLoginResult> {
    const username = normalizeUsername(usernameValue);
    if (username === null) {
      throw new ServiceError(
        400,
        "BAD_REQUEST",
        "Username must contain 3 to 32 lowercase letters, numbers, dots, underscores or hyphens",
      );
    }
    if (!isAcceptablePassword(passwordValue)) {
      throw new ServiceError(
        400,
        "BAD_REQUEST",
        "Password must contain at least 10 characters and at most 256 UTF-8 bytes",
      );
    }
    // Capacity is checked before any salt generation or scrypt work. At the
    // boundary every otherwise valid username receives the same response, so
    // this fast path cannot distinguish an existing account from a free name.
    if (this.state.accounts.length >= MAX_ACCOUNTS) throw accountCapacityReached();
    if (this.activeSessionCount(this.now()) >= this.maximumSessions) {
      throw accountSessionCapacityReached();
    }
    const password = await createStoredPassword(passwordValue, this.random, this.scryptParameters);
    const createdAt = this.now();
    const material = this.newSessionMaterial(createdAt, username);
    const account: StoredAccount = {
      createdAt,
      id: username,
      password,
      role: "user",
      username,
      vaultKeyId: this.random(32).toString("base64url"),
    };
    await this.mutate((state) => {
      // Registration hashes run concurrently, but every commit is serialized
      // through mutate(). Recheck the shared state here so only one contender
      // can claim the final slot.
      if (state.accounts.length >= MAX_ACCOUNTS) throw accountCapacityReached();
      if (this.accountById.has(username) || this.options.knownUserIds.has(username)) {
        throw new ServiceError(409, "ACCOUNT_UNAVAILABLE", "Account cannot be created");
      }
      if (this.sessionByTokenHash.has(material.stored.tokenHash)) {
        throw new Error("Cryptographic session token collision");
      }
      state.accounts.push(account);
      state.sessions = this.withSessionCapacity(state.sessions, material.stored, createdAt);
    });
    this.options.knownUserIds.add(account.id);
    return {
      account: this.toPublicAccount(account),
      session: material.public,
    };
  }

  async login(usernameValue: unknown, passwordValue: unknown): Promise<AccountLoginResult> {
    const username = normalizeUsername(usernameValue);
    const account = username === null
      ? undefined
      : this.accountById.get(username);
    const password = typeof passwordValue === "string" ? passwordValue : "";
    const storedPassword = account?.password ?? this.dummyPassword;
    const verified = await verifyPassword(password, storedPassword);
    if (!verified || account === undefined || !isAcceptablePassword(passwordValue)) {
      throw invalidCredentials();
    }
    const createdAt = this.now();
    const material = this.newSessionMaterial(createdAt, account.id);
    await this.mutate((state) => {
      if (!this.accountById.has(account.id)) throw invalidCredentials();
      if (this.sessionByTokenHash.has(material.stored.tokenHash)) {
        throw new Error("Cryptographic session token collision");
      }
      state.sessions = this.withSessionCapacity(state.sessions, material.stored, createdAt);
    });
    return {
      account: this.toPublicAccount(account),
      session: material.public,
    };
  }

  async logout(header: string | undefined): Promise<boolean> {
    const token = parseBearerToken(header);
    if (token === null) return false;
    const tokenHash = hashSessionToken(token);
    const now = this.now();
    let revoked = false;
    await this.mutate((state) => {
      state.sessions = state.sessions.flatMap((session) => {
        if (session.expiresAt <= now || session.revokedAt !== null) return [];
        if (session.tokenHash !== tokenHash) return [session];
        revoked = true;
        return [{ ...session, revokedAt: now }];
      });
    });
    return revoked;
  }

  async setRole(usernameValue: unknown, role: StoredAccountRole): Promise<PublicAccount> {
    const username = normalizeUsername(usernameValue);
    if (username === null) throw new Error("Account username is invalid");
    let changed: StoredAccount | undefined;
    await this.mutate((state) => {
      state.accounts = state.accounts.map((account) => {
        if (account.id !== username) return account;
        changed = { ...account, role };
        return changed;
      });
      if (changed === undefined) throw new Error(`Account ${username} does not exist`);
    });
    return this.toPublicAccount(changed as StoredAccount);
  }

  private toPublicAccount(account: StoredAccount): PublicAccount {
    const entitlements = new Set<AccountEntitlement>();
    if (account.role === "admin") {
      for (const entitlement of ACCOUNT_ENTITLEMENTS) entitlements.add(entitlement);
    } else if (this.options.entitlementPolicy === "open") {
      for (const entitlement of ACCOUNT_ENTITLEMENTS) entitlements.add(entitlement);
    } else {
      for (const entitlement of this.entitlementProvider.entitlementsFor(account)) {
        entitlements.add(entitlement);
      }
    }
    return {
      entitlements: ACCOUNT_ENTITLEMENTS.filter((entitlement) => entitlements.has(entitlement)),
      id: account.id,
      role: account.role,
      username: account.username,
      ...(account.vaultKeyId === undefined ? {} : { vaultKeyId: account.vaultKeyId }),
    };
  }

  private activeSessionCount(now: number): number {
    let count = 0;
    for (const session of this.state.sessions) {
      if (session.expiresAt <= now || session.revokedAt !== null) continue;
      count += 1;
      if (count >= this.maximumSessions) return count;
    }
    return count;
  }

  private rebuildIndexes(): void {
    this.accountById = new Map(this.state.accounts.map((account) => [account.id, account]));
    this.sessionByTokenHash = new Map(
      this.state.sessions.map((session) => [session.tokenHash, session]),
    );
  }

  private newSessionMaterial(createdAt: number, accountId: string): {
    readonly public: AccountSessionResult;
    readonly stored: StoredAccountSession;
  } {
    const accessToken = this.random(32).toString("base64url");
    const expiresAt = createdAt + this.options.sessionTtlMs;
    return {
      public: { accessToken, expiresAt },
      stored: {
        accountId,
        createdAt,
        expiresAt,
        revokedAt: null,
        tokenHash: hashSessionToken(accessToken),
      },
    };
  }

  private withSessionCapacity(
    sessions: readonly StoredAccountSession[],
    unboundSession: StoredAccountSession,
    now: number,
  ): StoredAccountSession[] {
    const accountId = unboundSession.accountId;
    const retained = sessions.filter((session) =>
      session.expiresAt > now && session.revokedAt === null
    );
    const activeForAccount = retained
      .filter((session) => session.accountId === accountId && session.revokedAt === null)
      .sort((left, right) => left.createdAt - right.createdAt);
    const excess = Math.max(0, activeForAccount.length - MAX_ACTIVE_SESSIONS_PER_ACCOUNT + 1);
    const evicted = new Set(activeForAccount.slice(0, excess).map(({ tokenHash }) => tokenHash));
    const next = [
      ...retained.filter(({ tokenHash }) => !evicted.has(tokenHash)),
      unboundSession,
    ];
    if (next.length > this.maximumSessions) throw accountSessionCapacityReached();
    return next;
  }

  private async mutate(operation: (state: {
    accounts: StoredAccount[];
    sessions: StoredAccountSession[];
    version: 1;
  }) => void): Promise<void> {
    const run = this.mutationTail.then(async () => {
      const next = {
        accounts: this.state.accounts.map((account) => ({ ...account, password: { ...account.password } })),
        sessions: this.state.sessions.map((session) => ({ ...session })),
        version: 1 as const,
      };
      operation(next);
      await this.store.save(next);
      this.state = next;
      this.rebuildIndexes();
    });
    this.mutationTail = run.catch(() => undefined);
    return run;
  }
}

export const productionScryptParameters = (): ScryptParameters => ({
  ...PRODUCTION_SCRYPT_PARAMETERS,
});
