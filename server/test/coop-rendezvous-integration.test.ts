import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createApplication, type ServerApplication } from "../src/app.js";
import { sha256Token } from "../src/auth.js";
import type { ServerConfig } from "../src/config.js";
import { CoopRendezvousService } from "../src/domain/coop-rendezvous.js";
import { ServiceError } from "../src/errors.js";
import { MemoryCoopRendezvousStore } from "../src/persistence/coop-rendezvous-store.js";
import { MemoryFriendStore } from "../src/persistence/friend-store.js";

const ORIGIN = "https://coop-client.example";
const TOKENS = {
  alice: "alice-coop-rendezvous-token-with-entropy",
  bob: "bob-coop-rendezvous-token-with-entropy",
  carol: "carol-coop-rendezvous-token-with-entropy",
} as const;
const compatibility = { applicationId: "IPKE", locale: 3, release: 7 } as const;
const alicePlayer = {
  displayName: "ALICE",
  gender: "female",
  position: { direction: "south", mapId: 1, x: 1, z: 1 },
  spriteId: 97,
} as const;

type UserId = keyof typeof TOKENS;
type Snapshot = {
  current: Record<string, unknown>;
  invitations: Array<Record<string, unknown>>;
  protocolVersion: 1;
};

const serverConfig = (
  directory: string,
  allowLegacyCoopBootstrap: boolean,
): ServerConfig => ({
  accountEntitlementPolicy: "open",
  accountSessionTtlMs: 86_400_000,
  accountStorePath: join(directory, "accounts.json"),
  allowLegacyCoopBootstrap,
  allowLoopbackOrigins: false,
  allowedOrigins: new Set([ORIGIN]),
  authTokenHashes: new Map(
    Object.entries(TOKENS).map(([userId, token]) => [userId, sha256Token(token)]),
  ),
  coopRendezvousStorePath: join(directory, "coop-rendezvous.json"),
  coopRendezvousTtlMs: 120_000,
  friendStorePath: join(directory, "friends.json"),
  host: "127.0.0.1",
  lanDevelopmentMode: false,
  matchmakingAuthorizationTtlMs: 120_000,
  matchmakingQueueTtlMs: 120_000,
  objectStorePath: join(directory, "objects"),
  port: 0,
  sharedSessionIdleTtlMs: 86_400_000,
  sharedSessionStorePath: join(directory, "shared-sessions.json"),
  ticketTtlMs: 30_000,
});

describe("authenticated Coop rendezvous REST contract", () => {
  it("survives offered, ready, active and queued restarts while preserving one server host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coop-rendezvous-integration-"));
    const friendStore = new MemoryFriendStore();
    const config = serverConfig(directory, false);
    let application: ServerApplication | undefined;
    let baseUrl = "";

    const start = async (): Promise<void> => {
      application = await createApplication(config, { friendStore });
      const address = await application.listen();
      baseUrl = `http://${address.host}:${address.port}`;
    };
    const stop = async (): Promise<void> => {
      await application?.close();
      application = undefined;
    };
    const request = (
      path: string,
      user?: UserId,
      init: RequestInit = {},
    ): Promise<Response> => fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Origin: ORIGIN,
        ...(user === undefined ? {} : { Authorization: `Bearer ${TOKENS[user]}` }),
        ...init.headers,
      },
    });
    const json = async (response: Response): Promise<Snapshot> => (await response.json()) as Snapshot;
    const becomeFriends = async (first: UserId, second: UserId): Promise<void> => {
      assert.equal((await request("/v1/friend-requests", first, {
        body: JSON.stringify({ userId: second }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })).status, 201);
      assert.equal((await request(`/v1/friend-requests/${first}/accept`, second, {
        method: "POST",
      })).status, 200);
    };
    const invite = (host: UserId, guest: UserId): Promise<Response> =>
      request("/v1/coop-rendezvous/invitations", host, {
        body: JSON.stringify({ peerUserId: guest }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

    try {
      await start();
      assert.equal((await request("/v1/coop-rendezvous")).status, 401);
      assert.deepEqual(await request("/v1/coop-rendezvous", "alice").then(json), {
        current: { status: "idle" },
        invitations: [],
        protocolVersion: 1,
      });
      assert.equal((await invite("alice", "bob")).status, 403);
      await becomeFriends("alice", "bob");
      await becomeFriends("carol", "bob");

      const race = await Promise.all([invite("alice", "bob"), invite("carol", "bob")]);
      assert.deepEqual(race.map(({ status }) => status).sort(), [200, 409]);
      const won = race.find(({ status }) => status === 200)!;
      const racedSnapshot = await json(won);
      const racedSessionId = racedSnapshot.current.sessionId;
      assert.equal(typeof racedSessionId, "string");
      const decline = await request(
        `/v1/coop-rendezvous/invitations/${racedSessionId as string}`,
        "bob",
        { method: "DELETE" },
      );
      assert.equal(decline.status, 200);
      assert.deepEqual((await json(decline)).current, { status: "idle" });
      assert.equal((await request(
        `/v1/coop-rendezvous/invitations/${racedSessionId as string}`,
        "bob",
        { method: "DELETE" },
      )).status, 200);

      const offeredResponse = await invite("alice", "bob");
      assert.equal(offeredResponse.status, 200);
      const offered = await json(offeredResponse);
      assert.equal(offered.current.status, "offered");
      assert.equal(offered.current.mode, "friend");
      assert.equal(offered.current.role, "host");
      assert.equal(offered.current.peerUserId, "bob");
      assert.match(offered.current.sessionId as string, /^[A-Za-z0-9_-]{21}[AQgw]$/);
      const sessionId = offered.current.sessionId as string;
      assert.deepEqual(await invite("alice", "bob").then(json), offered);

      const bobOffered = await request("/v1/coop-rendezvous", "bob").then(json);
      assert.deepEqual(bobOffered.current, { status: "idle" });
      assert.deepEqual(bobOffered.invitations, [{
        expiresAt: offered.current.expiresAt,
        fromUserId: "alice",
        intent: "coop",
        sessionId,
      }]);

      const directLegacyId = Buffer.alloc(16, 80).toString("base64url");
      const forbiddenLegacy = await request("/v1/shared-sessions", "alice", {
        body: JSON.stringify({
          compatibility,
          peerUserId: "bob",
          player: alicePlayer,
          sessionId: directLegacyId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(forbiddenLegacy.status, 403);

      await stop();
      await start();
      assert.deepEqual(await request("/v1/coop-rendezvous", "alice").then(json), offered);
      assert.equal((await request(
        `/v1/coop-rendezvous/invitations/${sessionId}/accept`,
        "carol",
        { method: "POST" },
      )).status, 404);

      const acceptedResponse = await request(
        `/v1/coop-rendezvous/invitations/${sessionId}/accept`,
        "bob",
        { method: "POST" },
      );
      assert.equal(acceptedResponse.status, 200);
      const accepted = await json(acceptedResponse);
      assert.deepEqual(accepted.current, {
        expiresAt: accepted.current.expiresAt,
        mode: "friend",
        peerUserId: "alice",
        role: "guest",
        sessionId,
        status: "ready",
      });
      assert.deepEqual(await request(
        `/v1/coop-rendezvous/invitations/${sessionId}/accept`,
        "bob",
        { method: "POST" },
      ).then(json), accepted);

      await stop();
      await start();
      const hostReady = await request("/v1/coop-rendezvous", "alice").then(json);
      assert.deepEqual(hostReady.current, {
        ...accepted.current,
        peerUserId: "bob",
        role: "host",
      });

      const wrongHost = await request("/v1/shared-sessions", "bob", {
        body: JSON.stringify({
          compatibility,
          peerUserId: "alice",
          player: alicePlayer,
          sessionId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(wrongHost.status, 403);

      const created = await request("/v1/shared-sessions", "alice", {
        body: JSON.stringify({
          compatibility,
          peerUserId: "bob",
          player: alicePlayer,
          sessionId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(created.status, 201);
      assert.equal((await request("/v1/coop-rendezvous", "alice").then(json)).current.status, "active");

      await stop();
      await start();
      assert.equal((await request("/v1/coop-rendezvous", "bob").then(json)).current.status, "active");
      const resumed = await request("/v1/shared-sessions", "alice", {
        body: JSON.stringify({
          compatibility,
          peerUserId: "bob",
          player: { ...alicePlayer, position: { ...alicePlayer.position, x: 12 } },
          sessionId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(resumed.status, 200);
      const resumedBody = await resumed.json() as {
        snapshot: { players: Array<{ position: { x: number } }> };
      };
      assert.equal(resumedBody.snapshot.players.length, 1);
      assert.equal(resumedBody.snapshot.players[0]?.position.x, alicePlayer.position.x);
      const cancelled = await request("/v1/coop-rendezvous/current", "bob", { method: "DELETE" });
      assert.equal(cancelled.status, 200);
      assert.deepEqual((await json(cancelled)).current, { status: "idle" });
      assert.deepEqual((await request("/v1/coop-rendezvous", "alice").then(json)).current, {
        status: "idle",
      });

      const badRandomBody = await request("/v1/coop-rendezvous/random", "alice", {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(badRandomBody.status, 413);
      const queued = await request("/v1/coop-rendezvous/random", "bob", { method: "POST" });
      assert.equal(queued.status, 200);
      assert.equal((await json(queued)).current.status, "queued");

      await stop();
      await start();
      const paired = await request("/v1/coop-rendezvous/random", "alice", { method: "POST" });
      assert.equal(paired.status, 200);
      const aliceRandom = await json(paired);
      assert.equal(aliceRandom.current.status, "ready");
      assert.equal(aliceRandom.current.mode, "random");
      assert.equal(aliceRandom.current.role, "host");
      const bobRandom = await request("/v1/coop-rendezvous", "bob").then(json);
      assert.equal(bobRandom.current.sessionId, aliceRandom.current.sessionId);
      assert.equal(bobRandom.current.role, "guest");
    } finally {
      await stop();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps the old friendship bootstrap only behind the explicit migration switch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coop-rendezvous-legacy-"));
    const friendStore = new MemoryFriendStore();
    const application = await createApplication(serverConfig(directory, true), { friendStore });
    const address = await application.listen();
    const baseUrl = `http://${address.host}:${address.port}`;
    const request = (path: string, user: UserId, init: RequestInit = {}): Promise<Response> =>
      fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${TOKENS[user]}`,
          Origin: ORIGIN,
          ...init.headers,
        },
      });
    try {
      assert.equal((await request("/v1/friend-requests", "alice", {
        body: JSON.stringify({ userId: "bob" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })).status, 201);
      assert.equal((await request("/v1/friend-requests/alice/accept", "bob", {
        method: "POST",
      })).status, 200);
      const legacySessionId = Buffer.alloc(16, 90).toString("base64url");
      assert.equal((await request("/v1/shared-sessions", "alice", {
        body: JSON.stringify({
          compatibility,
          peerUserId: "bob",
          player: alicePlayer,
          sessionId: legacySessionId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })).status, 201);
    } finally {
      await application.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("destroys a newly created SharedSession when Coop activation cannot commit", async () => {
    class FailingActivationRendezvous extends CoopRendezvousService {
      override markActive(): never {
        throw new ServiceError(503, "UNAVAILABLE", "Coop activation persistence failed");
      }
    }

    const directory = await mkdtemp(join(tmpdir(), "coop-activation-rollback-"));
    const sessionId = Buffer.alloc(16, 92).toString("base64url");
    const coopRendezvousService = new FailingActivationRendezvous({
      activeTtlMs: 120_000,
      areFriends: () => true,
      idFactory: () => sessionId,
      maintenanceIntervalMs: 60_000,
      queueTtlMs: 120_000,
      readyTtlMs: 120_000,
      store: new MemoryCoopRendezvousStore(),
    });
    coopRendezvousService.inviteFriend("alice", "bob");
    coopRendezvousService.acceptInvitation("bob", sessionId);
    const application = await createApplication(serverConfig(directory, false), {
      coopRendezvousService,
      friendStore: new MemoryFriendStore(),
    });
    const address = await application.listen();
    const baseUrl = `http://${address.host}:${address.port}`;
    const request = (path: string, init: RequestInit = {}): Promise<Response> =>
      fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${TOKENS.alice}`,
          Origin: ORIGIN,
          ...init.headers,
        },
      });
    try {
      const failed = await request("/v1/shared-sessions", {
        body: JSON.stringify({
          compatibility,
          peerUserId: "bob",
          player: alicePlayer,
          sessionId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(failed.status, 503);
      assert.equal((await failed.json() as { error: { code: string } }).error.code, "UNAVAILABLE");
      assert.equal((await request(`/v1/shared-sessions/${sessionId}`)).status, 404);
      assert.equal(coopRendezvousService.status("alice").current.status, "ready");
    } finally {
      await application.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
