import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import WebSocket from "ws";
import { AccountService, type PublicAccount, type ScryptParameters } from "../src/accounts.js";
import { createApplication, type ServerApplication } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { SharedSessionService } from "../src/domain/shared-sessions.js";
import { ServiceError } from "../src/errors.js";
import {
  FileAccountStore,
  MAX_ACCOUNTS,
  MemoryAccountStore,
  type StoredAccountState,
  type StoredPasswordHash,
} from "../src/persistence/account-store.js";
import { MemoryFriendStore } from "../src/persistence/friend-store.js";
import { MemorySharedSessionStore } from "../src/persistence/shared-session-store.js";
import { AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE } from "../src/realtime/authentication-session.js";

const ORIGIN = "https://client.example";
const TEST_SCRYPT: ScryptParameters = {
  blockSize: 8,
  cost: 2 ** 10,
  keyLength: 32,
  maxmem: 8 * 1024 * 1024,
  parallelization: 1,
};

const SEEDED_PASSWORD: StoredPasswordHash = {
  algorithm: "scrypt",
  blockSize: 8,
  cost: TEST_SCRYPT.cost,
  digest: Buffer.alloc(32, 0x5a).toString("base64url"),
  parallelization: 1,
  salt: Buffer.alloc(16, 0xa5).toString("base64url"),
};

const accountStateWith = (accountCount: number): StoredAccountState => ({
  accounts: Array.from({ length: accountCount }, (_, index) => {
    const username = `seed-${index.toString().padStart(5, "0")}`;
    return {
      createdAt: index,
      id: username,
      password: SEEDED_PASSWORD,
      role: "user" as const,
      username,
    };
  }),
  sessions: [],
  version: 1,
});

const assertAccountCapacityError = (error: unknown): void => {
  assert.equal(error instanceof ServiceError, true);
  if (!(error instanceof ServiceError)) return;
  assert.deepEqual(
    { code: error.code, message: error.message, status: error.status },
    { code: "UNAVAILABLE", message: "Account capacity reached", status: 503 },
  );
};

const assertAccountSessionCapacityError = (error: unknown): void => {
  assert.equal(error instanceof ServiceError, true);
  if (!(error instanceof ServiceError)) return;
  assert.deepEqual(
    { code: error.code, message: error.message, status: error.status },
    { code: "UNAVAILABLE", message: "Account session capacity reached", status: 503 },
  );
};

const config = (policy: "open" | "patreon" = "open"): ServerConfig => ({
  accountEntitlementPolicy: policy,
  accountSessionTtlMs: 86_400_000,
  accountStorePath: "unused-account-store.json",
  allowLegacyCoopBootstrap: false,
  allowLoopbackOrigins: false,
  allowedOrigins: new Set([ORIGIN]),
  authTokenHashes: new Map(),
  coopRendezvousStorePath: "unused-coop-rendezvous.json",
  coopRendezvousTtlMs: 120_000,
  friendStorePath: "unused-friend-store.json",
  host: "127.0.0.1",
  lanDevelopmentMode: false,
  matchmakingAuthorizationTtlMs: 120_000,
  matchmakingQueueTtlMs: 120_000,
  objectStorePath: "unused-object-store",
  port: 0,
  sharedSessionIdleTtlMs: 86_400_000,
  sharedSessionStorePath: "unused-shared-sessions.json",
  ticketTtlMs: 30_000,
});

const jsonRequest = (
  baseUrl: string,
  path: string,
  token: string | undefined,
  init: RequestInit = {},
): Promise<Response> => fetch(`${baseUrl}${path}`, {
  ...init,
  headers: {
    Origin: ORIGIN,
    ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    ...init.headers,
  },
});

describe("account authentication", () => {
  const temporaryDirectories: string[] = [];
  const applications: ServerApplication[] = [];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.close()));
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    ));
  });

  it("normalizes immutable usernames, hashes passwords and persists only session digests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "account-store-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "accounts.json");
    const store = new FileAccountStore(path);
    let now = 10_000;
    const knownUserIds = new Set<string>();
    const service = await AccountService.create(store, {
      entitlementPolicy: "open",
      knownUserIds,
      now: () => now,
      scryptParameters: TEST_SCRYPT,
      sessionTtlMs: 1_000,
    });

    const registered = await service.register("  Alice  ", "correct horse battery staple");
    assert.deepEqual({ ...registered.account, vaultKeyId: undefined }, {
      entitlements: ["cloud-storage", "development", "online", "premium-client"],
      id: "alice",
      role: "user",
      username: "alice",
      vaultKeyId: undefined,
    });
    const registeredVaultKeyId = registered.account.vaultKeyId;
    assert.ok(registeredVaultKeyId);
    assert.match(registeredVaultKeyId, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(knownUserIds.has("alice"), true);
    const registeredAuthentication = service.authenticateAuthorizationHeader(
      `Bearer ${registered.session.accessToken}`,
    );
    assert.equal(registeredAuthentication?.accountId, "alice");
    assert.match(registeredAuthentication?.authenticationSessionId ?? "", /^[a-f0-9]{64}$/);
    assert.equal(
      service.hasActiveSession(registeredAuthentication?.authenticationSessionId ?? ""),
      true,
    );

    const persisted = await readFile(path, "utf8");
    assert.equal(persisted.includes("correct horse battery staple"), false);
    assert.equal(persisted.includes(registered.session.accessToken), false);
    assert.match(persisted, /"algorithm": "scrypt"/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    const duplicate = await service.register("ALICE", "another long secure password").catch((error) => error);
    assert.equal((duplicate as { code: string }).code, "ACCOUNT_UNAVAILABLE");

    const wrongPassword = await service.login("alice", "wrong password").catch((error) => error);
    const unknownAccount = await service.login("nobody", "wrong password").catch((error) => error);
    assert.deepEqual(
      { code: (wrongPassword as { code: string }).code, message: (wrongPassword as Error).message },
      { code: (unknownAccount as { code: string }).code, message: (unknownAccount as Error).message },
    );

    now = 11_001;
    assert.equal(
      service.authenticateAuthorizationHeader(`Bearer ${registered.session.accessToken}`),
      null,
    );

    const loggedIn = await service.login("ALIce", "correct horse battery staple");
    assert.equal(loggedIn.account.vaultKeyId, registered.account.vaultKeyId);
    const loggedInAuthentication = service.authenticateAuthorizationHeader(
      `Bearer ${loggedIn.session.accessToken}`,
    );
    assert.notEqual(
      loggedInAuthentication?.authenticationSessionId,
      registeredAuthentication?.authenticationSessionId,
    );
    assert.equal(await service.logout(`Bearer ${loggedIn.session.accessToken}`), true);
    assert.equal(
      service.hasActiveSession(loggedInAuthentication?.authenticationSessionId ?? ""),
      false,
    );
    assert.equal(
      service.authenticateAuthorizationHeader(`Bearer ${loggedIn.session.accessToken}`),
      null,
    );

    const restarted = await AccountService.create(store, {
      entitlementPolicy: "open",
      knownUserIds: new Set(),
      now: () => now,
      scryptParameters: TEST_SCRYPT,
      sessionTtlMs: 1_000,
    });
    assert.deepEqual(restarted.accountIds(), ["alice"]);
    assert.equal(
      restarted.authenticateAuthorizationHeader(`Bearer ${loggedIn.session.accessToken}`),
      null,
    );
  });

  it("keeps an unexpired session valid after reconstructing the file store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "account-session-reload-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "accounts.json");
    let now = 10_000;
    const service = await AccountService.create(new FileAccountStore(path), {
      entitlementPolicy: "open",
      knownUserIds: new Set(),
      now: () => now,
      scryptParameters: TEST_SCRYPT,
      sessionTtlMs: 1_000,
    });
    const registered = await service.register("alice", "correct horse battery staple");

    now = 10_500;
    const restarted = await AccountService.create(new FileAccountStore(path), {
      entitlementPolicy: "open",
      knownUserIds: new Set(),
      now: () => now,
      scryptParameters: TEST_SCRYPT,
      sessionTtlMs: 1_000,
    });

    assert.equal(
      restarted.authenticateAuthorizationHeader(`Bearer ${registered.session.accessToken}`)?.accountId,
      "alice",
    );
  });

  it("atomically admits only one concurrent registration at the global account boundary", async () => {
    const store = new MemoryAccountStore(accountStateWith(MAX_ACCOUNTS - 1));
    const service = await AccountService.create(store, {
      entitlementPolicy: "open",
      knownUserIds: new Set(),
      scryptParameters: TEST_SCRYPT,
      sessionTtlMs: 86_400_000,
    });

    const outcomes = await Promise.allSettled([
      service.register("capacity-a", "a sufficiently long password"),
      service.register("capacity-b", "a sufficiently long password"),
    ]);
    const fulfilled = outcomes.find(({ status }) => status === "fulfilled");
    assert.ok(fulfilled && fulfilled.status === "fulfilled");
    assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = outcomes.find(({ status }) => status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assertAccountCapacityError(rejected.reason);
    assert.equal(service.accountIds().length, MAX_ACCOUNTS);
    assert.equal((await store.load()).accounts.length, MAX_ACCOUNTS);

    // A rejected tail must not poison later serialized mutations.
    assert.equal(
      (await service.login(fulfilled.value.account.username, "a sufficiently long password")).account.id,
      fulfilled.value.account.id,
    );

    const restarted = await AccountService.create(store, {
      entitlementPolicy: "open",
      knownUserIds: new Set(),
      scryptParameters: TEST_SCRYPT,
      sessionTtlMs: 86_400_000,
    });
    assert.equal(restarted.accountIds().length, MAX_ACCOUNTS);
  });

  it("preserves the file boundary and skips scrypt uniformly when registration is full", async () => {
    const directory = await mkdtemp(join(tmpdir(), "account-capacity-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "accounts.json");
    const seedStore = new FileAccountStore(path);
    await seedStore.save(accountStateWith(MAX_ACCOUNTS - 1));
    const fillingService = await AccountService.create(new FileAccountStore(path), {
      entitlementPolicy: "open",
      knownUserIds: new Set(),
      scryptParameters: TEST_SCRYPT,
      sessionTtlMs: 86_400_000,
    });
    const finalRegistration = await fillingService.register(
      "final-slot",
      "a sufficiently long password",
    );
    assert.equal(finalRegistration.account.id, "final-slot");
    assert.equal((await new FileAccountStore(path).load()).accounts.length, MAX_ACCOUNTS);

    let registrationPhase = false;
    let registrationRandomCalls = 0;
    const service = await AccountService.create(new FileAccountStore(path), {
      entitlementPolicy: "open",
      knownUserIds: new Set(),
      randomBytes: (size) => {
        if (registrationPhase) {
          registrationRandomCalls += 1;
          throw new Error("registration must not generate cryptographic material at capacity");
        }
        return Buffer.alloc(size, size);
      },
      scryptParameters: TEST_SCRYPT,
      sessionTtlMs: 86_400_000,
    });
    registrationPhase = true;
    assert.equal(
      service.authenticateAuthorizationHeader(`Bearer ${finalRegistration.session.accessToken}`)?.accountId,
      "final-slot",
    );

    const errors = await Promise.all([
      service.register("final-slot", "a sufficiently long password").catch((error: unknown) => error),
      service.register("unused-name", "a sufficiently long password").catch((error: unknown) => error),
    ]);
    for (const error of errors) assertAccountCapacityError(error);
    assert.equal(registrationRandomCalls, 0);
    assert.equal((await new FileAccountStore(path).load()).accounts.length, MAX_ACCOUNTS);

    const beforeOverflow = await readFile(path, "utf8");
    await assert.rejects(
      seedStore.save(accountStateWith(MAX_ACCOUNTS + 1)),
      /accounts are invalid or exceed their limit/,
    );
    assert.equal(await readFile(path, "utf8"), beforeOverflow);
  });

  it("validates the memory store boundary without replacing its last valid state", async () => {
    const exactBoundary = accountStateWith(MAX_ACCOUNTS);
    const overflow = accountStateWith(MAX_ACCOUNTS + 1);
    assert.throws(
      () => new MemoryAccountStore(overflow),
      /accounts are invalid or exceed their limit/,
    );

    const store = new MemoryAccountStore(exactBoundary);
    await assert.rejects(
      store.save(overflow),
      /accounts are invalid or exceed their limit/,
    );
    const retained = await store.load();
    assert.equal(retained.accounts.length, MAX_ACCOUNTS);
    assert.equal(retained.accounts.at(-1)?.id, exactBoundary.accounts.at(-1)?.id);
  });

  it("serializes global session capacity and keeps the mutation queue usable", async () => {
    let randomCounter = 0;
    let rejectRegistrationRandom = false;
    let rejectedRandomCalls = 0;
    const random = (size: number): Buffer => {
      if (rejectRegistrationRandom) {
        rejectedRandomCalls += 1;
        throw new Error("registration must not generate cryptographic material at session capacity");
      }
      const value = Buffer.alloc(size);
      value.writeUInt32BE(randomCounter, 0);
      randomCounter += 1;
      return value;
    };
    const store = new MemoryAccountStore();
    const service = await AccountService.create(store, {
      entitlementPolicy: "open",
      knownUserIds: new Set(),
      maximumSessions: 2,
      randomBytes: random,
      scryptParameters: TEST_SCRYPT,
      sessionTtlMs: 86_400_000,
    });
    const aliceRegistration = await service.register("alice", "alice password is long enough");
    const bobRegistration = await service.register("bob", "bob password is long enough");

    rejectRegistrationRandom = true;
    const registrationError = await service.register(
      "carol",
      "carol password is long enough",
    ).catch((error: unknown) => error);
    assertAccountSessionCapacityError(registrationError);
    assert.equal(rejectedRandomCalls, 0);
    rejectRegistrationRandom = false;

    assert.equal(await service.logout(`Bearer ${bobRegistration.session.accessToken}`), true);
    const outcomes = await Promise.allSettled([
      service.login("alice", "alice password is long enough"),
      service.login("bob", "bob password is long enough"),
    ]);
    assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = outcomes.find(({ status }) => status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assertAccountSessionCapacityError(rejected.reason);

    // This mutation runs after the rejected commit and frees one active slot.
    assert.equal(await service.logout(`Bearer ${aliceRegistration.session.accessToken}`), true);
    assert.equal((await service.login("bob", "bob password is long enough")).account.id, "bob");
    assert.equal((await store.load()).sessions.length, 2);
  });

  it("invalidates the internal binding when session capacity evicts an old login", async () => {
    const service = await AccountService.create(new MemoryAccountStore(), {
      entitlementPolicy: "open",
      knownUserIds: new Set(),
      scryptParameters: TEST_SCRYPT,
      sessionTtlMs: 86_400_000,
    });
    const registered = await service.register("alice", "correct horse battery staple");
    const oldest = service.authenticateAuthorizationHeader(
      `Bearer ${registered.session.accessToken}`,
    );
    assert.notEqual(oldest, null);
    let newestToken = registered.session.accessToken;
    for (let index = 0; index < 20; index += 1) {
      newestToken = (await service.login("alice", "correct horse battery staple"))
        .session.accessToken;
    }

    assert.equal(service.hasActiveSession(oldest?.authenticationSessionId ?? "", "alice"), false);
    assert.equal(
      service.authenticateAuthorizationHeader(`Bearer ${registered.session.accessToken}`),
      null,
    );
    const newest = service.authenticateAuthorizationHeader(`Bearer ${newestToken}`);
    assert.equal(service.hasActiveSession(newest?.authenticationSessionId ?? "", "alice"), true);
  });

  it("supports account-only HTTP registration, login, friendship and logout", async () => {
    const accountStore = new MemoryAccountStore();
    const application = await createApplication(config(), {
      accountScryptParameters: TEST_SCRYPT,
      accountStore,
      friendStore: new MemoryFriendStore(),
      sharedSessionStore: new MemorySharedSessionStore(),
    });
    applications.push(application);
    const address = await application.listen();
    const baseUrl = `http://${address.host}:${address.port}`;

    const register = async (username: string): Promise<string> => {
      const response = await jsonRequest(baseUrl, "/v1/accounts/register", undefined, {
        body: JSON.stringify({ password: "a sufficiently long password", username }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = (await response.json()) as { session: { accessToken: string } };
      return body.session.accessToken;
    };

    const aliceToken = await register("Alice");
    const bobToken = await register("bob");
    const account = await jsonRequest(baseUrl, "/v1/account", aliceToken);
    assert.equal(account.status, 200);
    const accountBody = await account.json() as { account: PublicAccount };
    assert.deepEqual({ ...accountBody.account, vaultKeyId: undefined }, {
      entitlements: ["cloud-storage", "development", "online", "premium-client"],
      id: "alice",
      role: "user",
      username: "alice",
      vaultKeyId: undefined,
    });
    const accountVaultKeyId = accountBody.account.vaultKeyId;
    assert.ok(accountVaultKeyId);
    assert.match(accountVaultKeyId, /^[A-Za-z0-9_-]{43}$/);

    const friendRequest = await jsonRequest(baseUrl, "/v1/friend-requests", aliceToken, {
      body: JSON.stringify({ userId: "BOB" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(friendRequest.status, 201);
    const bobSocial = await jsonRequest(baseUrl, "/v1/social", bobToken);
    assert.deepEqual(await bobSocial.json(), { friends: [], incoming: ["alice"], outgoing: [] });

    const logout = await jsonRequest(baseUrl, "/v1/accounts/logout", aliceToken, { method: "POST" });
    assert.equal(logout.status, 204);
    assert.equal((await jsonRequest(baseUrl, "/v1/account", aliceToken)).status, 401);

    const login = await jsonRequest(baseUrl, "/v1/accounts/login", undefined, {
      body: JSON.stringify({ password: "a sufficiently long password", username: "ALICE" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(login.status, 200);

    const failedLogin = async (username: string): Promise<{ code: string; message: string }> => {
      const response = await jsonRequest(baseUrl, "/v1/accounts/login", undefined, {
        body: JSON.stringify({ password: "this password is incorrect", username }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(response.status, 401);
      return ((await response.json()) as { error: { code: string; message: string } }).error;
    };
    assert.deepEqual(await failedLogin("bob"), await failedLogin("unknown-user"));
  });

  it("revokes realtime tickets and sockets for only the logged-out account session", async () => {
    const application = await createApplication(config(), {
      accountScryptParameters: TEST_SCRYPT,
      accountStore: new MemoryAccountStore(),
      friendStore: new MemoryFriendStore(),
      sharedSessionStore: new MemorySharedSessionStore(),
    });
    applications.push(application);
    const address = await application.listen();
    const baseUrl = `http://${address.host}:${address.port}`;
    const password = "a sufficiently long password";
    const sockets: WebSocket[] = [];

    const accountToken = async (path: "login" | "register"): Promise<string> => {
      const response = await jsonRequest(baseUrl, `/v1/accounts/${path}`, undefined, {
        body: JSON.stringify({ password, username: "alice" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(response.status, path === "register" ? 201 : 200);
      return (await response.json() as { session: { accessToken: string } }).session.accessToken;
    };
    const issueTicket = async (token: string): Promise<string> => {
      const response = await jsonRequest(baseUrl, "/v1/realtime-ticket", token, { method: "POST" });
      assert.equal(response.status, 201);
      return (await response.json() as { ticket: string }).ticket;
    };
    const connect = async (
      ticket: string,
      path: "/v1/realtime" | "/v1/shared-sessions/realtime",
      protocol: "authoritative-session.v1" | "social-signaling.v1",
    ): Promise<WebSocket> => {
      const socket = new WebSocket(
        `${baseUrl.replace("http://", "ws://")}${path}?ticket=${encodeURIComponent(ticket)}`,
        protocol,
        { origin: ORIGIN },
      );
      sockets.push(socket);
      const ready = once(socket, "message");
      await once(socket, "open");
      assert.equal((JSON.parse((await ready)[0].toString("utf8")) as { type: string }).type, "ready");
      return socket;
    };
    const assertAlive = async (socket: WebSocket): Promise<void> => {
      const pong = once(socket, "pong");
      socket.ping();
      await pong;
      assert.equal(socket.readyState, WebSocket.OPEN);
    };
    const rejectedUpgradeStatus = (ticket: string): Promise<number> => new Promise((resolve, reject) => {
      const socket = new WebSocket(
        `${baseUrl.replace("http://", "ws://")}/v1/realtime?ticket=${encodeURIComponent(ticket)}`,
        "social-signaling.v1",
        { origin: ORIGIN },
      );
      sockets.push(socket);
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for ticket rejection")), 2_000);
      timeout.unref();
      socket.on("error", () => undefined);
      socket.once("open", () => {
        clearTimeout(timeout);
        reject(new Error("A revoked realtime ticket opened a WebSocket"));
      });
      socket.once("unexpected-response", (_request, response) => {
        clearTimeout(timeout);
        const status = response.statusCode ?? 0;
        response.resume();
        resolve(status);
      });
    });

    const firstSession = await accountToken("register");
    const secondSession = await accountToken("login");
    const firstSignaling = await connect(
      await issueTicket(firstSession),
      "/v1/realtime",
      "social-signaling.v1",
    );
    const unusedFirstTicket = await issueTicket(firstSession);
    const secondShared = await connect(
      await issueTicket(secondSession),
      "/v1/shared-sessions/realtime",
      "authoritative-session.v1",
    );

    const firstSignalingClosed = once(firstSignaling, "close");
    assert.equal((await jsonRequest(baseUrl, "/v1/accounts/logout", firstSession, {
      method: "POST",
    })).status, 204);
    assert.equal((await firstSignalingClosed)[0], AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE);
    assert.equal(await rejectedUpgradeStatus(unusedFirstTicket), 401);
    await assertAlive(secondShared);
    assert.equal((await jsonRequest(baseUrl, "/v1/account", secondSession)).status, 200);

    const secondSignaling = await connect(
      await issueTicket(secondSession),
      "/v1/realtime",
      "social-signaling.v1",
    );
    const thirdSession = await accountToken("login");
    const secondSharedReplaced = once(secondShared, "close");
    const thirdShared = await connect(
      await issueTicket(thirdSession),
      "/v1/shared-sessions/realtime",
      "authoritative-session.v1",
    );
    assert.equal((await secondSharedReplaced)[0], 4000);

    const thirdSharedClosed = once(thirdShared, "close");
    assert.equal((await jsonRequest(baseUrl, "/v1/accounts/logout", thirdSession, {
      method: "POST",
    })).status, 204);
    assert.equal((await thirdSharedClosed)[0], AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE);
    await assertAlive(secondSignaling);

    for (const socket of sockets) socket.close();
  });

  it("fences a delayed leave from an older device after a newer attachment", async () => {
    const sharedSessions = new SharedSessionService({ store: new MemorySharedSessionStore() });
    const application = await createApplication(config(), {
      accountScryptParameters: TEST_SCRYPT,
      accountStore: new MemoryAccountStore(),
      friendStore: new MemoryFriendStore(),
      sharedSessionService: sharedSessions,
    });
    applications.push(application);
    const address = await application.listen();
    const baseUrl = `http://${address.host}:${address.port}`;
    const password = "a sufficiently long password";
    const sessionId = Buffer.alloc(16, 111).toString("base64url");
    const authenticate = async (path: "login" | "register"): Promise<string> => {
      const response = await jsonRequest(baseUrl, `/v1/accounts/${path}`, undefined, {
        body: JSON.stringify({ password, username: "alice" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(response.status, path === "register" ? 201 : 200);
      return (await response.json() as { session: { accessToken: string } }).session.accessToken;
    };
    const firstToken = await authenticate("register");
    const secondToken = await authenticate("login");
    assert.equal(sharedSessions.create({
      compatibility: { applicationId: "IPKE", locale: 3, release: 7 },
      ownerId: "alice",
      peerUserId: "bob",
      player: {
        displayName: "ALICE",
        gender: "female",
        position: { direction: "south", mapId: 1, x: 1, z: 1 },
        spriteId: 97,
      },
      sessionId,
    }).ok, true);
    const connect = async (token: string): Promise<WebSocket> => {
      const ticketResponse = await jsonRequest(baseUrl, "/v1/realtime-ticket", token, {
        method: "POST",
      });
      assert.equal(ticketResponse.status, 201);
      const { ticket } = await ticketResponse.json() as { ticket: string };
      const socket = new WebSocket(
        `${baseUrl.replace("http://", "ws://")}/v1/shared-sessions/realtime?ticket=${encodeURIComponent(ticket)}`,
        "authoritative-session.v1",
        { origin: ORIGIN },
      );
      const ready = once(socket, "message");
      await once(socket, "open");
      await ready;
      return socket;
    };
    const attach = async (socket: WebSocket, seed: number): Promise<string> => {
      const response = once(socket, "message");
      socket.send(JSON.stringify({
        requestId: Buffer.alloc(16, seed).toString("base64url"),
        sessionId,
        type: "attach",
      }));
      const message = JSON.parse((await response)[0].toString("utf8")) as {
        attachmentId: string;
        type: string;
      };
      assert.equal(message.type, "attached");
      return message.attachmentId;
    };
    const firstSocket = await connect(firstToken);
    const firstAttachment = await attach(firstSocket, 112);
    let delayedRequest: ReturnType<typeof httpRequest>;
    const delayedLeave = new Promise<Readonly<{ status: number; body: string }>>((resolve, reject) => {
      const url = new URL(`/v1/shared-sessions/${sessionId}/members/me`, baseUrl);
      delayedRequest = httpRequest(url, {
        headers: {
          Authorization: `Bearer ${firstToken}`,
          Origin: ORIGIN,
          "Shared-Attachment": firstAttachment,
          "Transfer-Encoding": "chunked",
        },
        method: "DELETE",
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () => resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          status: response.statusCode ?? 0,
        }));
      });
      delayedRequest.once("error", reject);
      delayedRequest.flushHeaders();
    });
    const replaced = once(firstSocket, "close");
    const secondSocket = await connect(secondToken);
    assert.equal((await replaced)[0], 4000);
    const secondAttachment = await attach(secondSocket, 113);
    assert.notEqual(secondAttachment, firstAttachment);
    delayedRequest!.end();
    const stale = await delayedLeave;
    assert.equal(stale.status, 409);
    assert.equal((JSON.parse(stale.body) as { error: { code: string } }).error.code, "STALE_ATTACHMENT");
    assert.equal((await jsonRequest(
      baseUrl,
      `/v1/shared-sessions/${sessionId}`,
      secondToken,
    )).status, 200);
    const snapshotResponse = once(secondSocket, "message");
    secondSocket.send(JSON.stringify({
      requestId: Buffer.alloc(16, 114).toString("base64url"),
      type: "request-snapshot",
    }));
    assert.equal(
      (JSON.parse((await snapshotResponse)[0].toString("utf8")) as { type: string }).type,
      "snapshot-response",
    );
    secondSocket.close();
  });

  it("cancels a pending SharedSession join when that guest session logs out", async () => {
    const application = await createApplication({
      ...config(),
      allowLegacyCoopBootstrap: true,
    }, {
      accountScryptParameters: TEST_SCRYPT,
      accountStore: new MemoryAccountStore(),
      friendStore: new MemoryFriendStore(),
      sharedSessionStore: new MemorySharedSessionStore(),
    });
    applications.push(application);
    const address = await application.listen();
    const baseUrl = `http://${address.host}:${address.port}`;
    const password = "a sufficiently long password";
    const sessionId = Buffer.alloc(16, 94).toString("base64url");
    const requestId = Buffer.alloc(16, 95).toString("base64url");
    const register = async (username: string): Promise<string> => {
      const response = await jsonRequest(baseUrl, "/v1/accounts/register", undefined, {
        body: JSON.stringify({ password, username }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(response.status, 201);
      return (await response.json() as { session: { accessToken: string } }).session.accessToken;
    };
    const issueTicket = async (token: string): Promise<string> => {
      const response = await jsonRequest(baseUrl, "/v1/realtime-ticket", token, { method: "POST" });
      assert.equal(response.status, 201);
      return (await response.json() as { ticket: string }).ticket;
    };
    const nextJson = (
      socket: WebSocket,
      predicate: (message: Record<string, unknown>) => boolean,
    ): Promise<Record<string, unknown>> => new Promise((resolve) => {
      const onMessage = (raw: WebSocket.RawData): void => {
        const message = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
        if (!predicate(message)) return;
        socket.off("message", onMessage);
        resolve(message);
      };
      socket.on("message", onMessage);
    });

    const alice = await register("alice");
    const bob = await register("bob");
    assert.equal((await jsonRequest(baseUrl, "/v1/friend-requests", alice, {
      body: JSON.stringify({ userId: "bob" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })).status, 201);
    assert.equal((await jsonRequest(
      baseUrl,
      "/v1/friend-requests/alice/accept",
      bob,
      { method: "POST" },
    )).status, 200);
    const compatibility = { applicationId: "IPKE", locale: 3, release: 7 };
    const alicePlayer = {
      displayName: "ALICE",
      gender: "female",
      position: { direction: "south", mapId: 1, x: 1, z: 1 },
      spriteId: 97,
    };
    const bobPlayer = {
      displayName: "BOB",
      gender: "male",
      position: { direction: "west", mapId: 1, x: 4, z: 1 },
      spriteId: 0,
    };
    assert.equal((await jsonRequest(baseUrl, "/v1/shared-sessions", alice, {
      body: JSON.stringify({
        compatibility,
        peerUserId: "bob",
        player: alicePlayer,
        sessionId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })).status, 201);

    const owner = new WebSocket(
      `${baseUrl.replace("http://", "ws://")}/v1/shared-sessions/realtime?ticket=${encodeURIComponent(
        await issueTicket(alice),
      )}`,
      "authoritative-session.v1",
      { origin: ORIGIN },
    );
    const ready = nextJson(owner, (message) => message.type === "ready");
    await once(owner, "open");
    await ready;
    const attached = nextJson(
      owner,
      (message) => message.type === "attached" && message.requestId === requestId,
    );
    owner.send(JSON.stringify({ requestId, sessionId, type: "attach" }));
    await attached;

    const admissionRequest = nextJson(owner, (message) => message.type === "join-admission-request");
    const joinResponse = jsonRequest(baseUrl, `/v1/shared-sessions/${sessionId}/join`, bob, {
      body: JSON.stringify({ compatibility, player: bobPlayer }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const admission = await admissionRequest;
    assert.equal((await jsonRequest(baseUrl, "/v1/accounts/logout", bob, {
      method: "POST",
    })).status, 204);
    const cancelledJoin = await joinResponse;
    assert.equal(cancelledJoin.status, 409);
    assert.equal((await cancelledJoin.json() as { error: { code: string } }).error.code,
      "join-unattested");

    const lateDecision = nextJson(owner, (message) => message.code === "admission-not-found");
    owner.send(JSON.stringify({
      admissionId: admission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    await lateDecision;
    const unchanged = await jsonRequest(baseUrl, `/v1/shared-sessions/${sessionId}`, alice);
    assert.equal(unchanged.status, 200);
    assert.equal((await unchanged.json() as { snapshot: { players: unknown[] } })
      .snapshot.players.length, 1);
    owner.close();
  });

  it("rate-limits credential work by canonical account name", async () => {
    const application = await createApplication(config(), {
      accountScryptParameters: TEST_SCRYPT,
      accountStore: new MemoryAccountStore(),
      friendStore: new MemoryFriendStore(),
      sharedSessionStore: new MemorySharedSessionStore(),
    });
    applications.push(application);
    const address = await application.listen();
    const baseUrl = `http://${address.host}:${address.port}`;
    const attempt = (): Promise<Response> => jsonRequest(baseUrl, "/v1/accounts/login", undefined, {
      body: JSON.stringify({ password: "incorrect password", username: "Target-User" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    for (let index = 0; index < 20; index += 1) {
      assert.equal((await attempt()).status, 401);
    }
    assert.equal((await attempt()).status, 429);
  });

  it("enforces provider policy on the VPS while admin accounts bypass it", async () => {
    const accountStore = new MemoryAccountStore();
    const bootstrap = await AccountService.create(accountStore, {
      entitlementPolicy: "patreon",
      knownUserIds: new Set(),
      scryptParameters: TEST_SCRYPT,
      sessionTtlMs: 86_400_000,
    });
    const adminRegistration = await bootstrap.register("server-admin", "admin password is long enough");
    await bootstrap.setRole("server-admin", "admin");

    const application = await createApplication(config("patreon"), {
      accountScryptParameters: TEST_SCRYPT,
      accountStore,
      friendStore: new MemoryFriendStore(),
      sharedSessionStore: new MemorySharedSessionStore(),
    });
    applications.push(application);
    const address = await application.listen();
    const baseUrl = `http://${address.host}:${address.port}`;
    const adminToken = adminRegistration.session.accessToken;

    const userRegistration = await jsonRequest(baseUrl, "/v1/accounts/register", undefined, {
      body: JSON.stringify({ password: "regular password is long", username: "regular-user" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const userBody = (await userRegistration.json()) as {
      account: { entitlements: string[] };
      session: { accessToken: string };
    };
    assert.deepEqual(userBody.account.entitlements, []);

    const deniedSocial = await jsonRequest(baseUrl, "/v1/social", userBody.session.accessToken);
    assert.equal(deniedSocial.status, 403);
    assert.equal(((await deniedSocial.json()) as { error: { code: string } }).error.code, "ENTITLEMENT_REQUIRED");
    assert.equal((await jsonRequest(baseUrl, "/v1/social", adminToken)).status, 200);

    const objectId = Buffer.alloc(16, 9).toString("base64url");
    assert.equal(
      (await jsonRequest(baseUrl, `/v1/objects/${objectId}`, userBody.session.accessToken)).status,
      403,
    );
    assert.equal((await jsonRequest(baseUrl, `/v1/objects/${objectId}`, adminToken)).status, 404);

    const adminAccount = await jsonRequest(baseUrl, "/v1/account", adminToken);
    const adminBody = (await adminAccount.json()) as { account: { entitlements: string[]; role: string } };
    assert.equal(adminBody.account.role, "admin");
    assert.deepEqual(adminBody.account.entitlements, [
      "cloud-storage",
      "development",
      "online",
      "premium-client",
    ]);
  });
});
