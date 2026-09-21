import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import WebSocket from "ws";
import { createApplication, type ServerApplication } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { MemoryFriendStore } from "../src/persistence/friend-store.js";

const ORIGIN = "https://engagement-client.example";
const PASSWORD = "a sufficiently long engagement password";
const TEST_SCRYPT = {
  blockSize: 8,
  cost: 2 ** 10,
  keyLength: 32,
  maxmem: 8 * 1024 * 1024,
  parallelization: 1,
} as const;

type MatchmakingSnapshot = Readonly<{
  activity?: string;
  lease?: string;
  status: "idle" | "matched" | "queued";
}>;

type CoopSnapshot = Readonly<{
  current: Readonly<{ lease?: string; sessionId?: string; status: string }>;
  invitations: readonly Readonly<{ sessionId: string }>[];
  protocolVersion: 1;
}>;

interface Harness {
  readonly application: ServerApplication;
  readonly baseUrl: string;
  readonly directory: string;
  readonly sockets: WebSocket[];
}

const harnesses: Harness[] = [];

const config = (directory: string): ServerConfig => ({
  accountEntitlementPolicy: "open",
  accountSessionTtlMs: 86_400_000,
  accountStorePath: join(directory, "accounts.json"),
  allowLegacyCoopBootstrap: true,
  allowLoopbackOrigins: false,
  allowedOrigins: new Set([ORIGIN]),
  authTokenHashes: new Map(),
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

const startHarness = async (): Promise<Harness> => {
  const directory = await mkdtemp(join(tmpdir(), "online-engagement-test-"));
  const application = await createApplication(config(directory), {
    accountScryptParameters: TEST_SCRYPT,
    friendStore: new MemoryFriendStore(),
  });
  const address = await application.listen();
  const harness = {
    application,
    baseUrl: `http://${address.host}:${address.port}`,
    directory,
    sockets: [],
  };
  harnesses.push(harness);
  return harness;
};

const request = (
  harness: Harness,
  path: string,
  token?: string,
  init: RequestInit = {},
): Promise<Response> => fetch(`${harness.baseUrl}${path}`, {
  ...init,
  headers: {
    Origin: ORIGIN,
    ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    ...init.headers,
  },
});

const register = async (harness: Harness, username: string): Promise<string> => {
  const response = await request(harness, "/v1/accounts/register", undefined, {
    body: JSON.stringify({ password: PASSWORD, username }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { session: { accessToken: string } }).session.accessToken;
};

const login = async (harness: Harness, username: string): Promise<string> => {
  const response = await request(harness, "/v1/accounts/login", undefined, {
    body: JSON.stringify({ password: PASSWORD, username }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.equal(response.status, 200);
  return ((await response.json()) as { session: { accessToken: string } }).session.accessToken;
};

const connect = async (harness: Harness, token: string): Promise<void> => {
  const ticketResponse = await request(harness, "/v1/realtime-ticket", token, { method: "POST" });
  assert.equal(ticketResponse.status, 201);
  const ticket = ((await ticketResponse.json()) as { ticket: string }).ticket;
  const socket = new WebSocket(
    `${harness.baseUrl.replace("http://", "ws://")}/v1/realtime?ticket=${encodeURIComponent(ticket)}`,
    "social-signaling.v1",
    { origin: ORIGIN },
  );
  harness.sockets.push(socket);
  const ready = once(socket, "message");
  await once(socket, "open");
  const [raw] = await ready;
  assert.equal((JSON.parse(raw.toString("utf8")) as { type?: string }).type, "ready");
};

const joinMatchmaking = (
  harness: Harness,
  token: string,
  activity: "coop" | "pvp" | "trade" = "trade",
): Promise<Response> => request(harness, "/v1/matchmaking", token, {
  body: JSON.stringify({ activity }),
  headers: { "Content-Type": "application/json" },
  method: "POST",
});

const joinRandomCoop = (harness: Harness, token: string): Promise<Response> =>
  request(harness, "/v1/coop-rendezvous/random", token, { method: "POST" });

const getMatchmaking = async (
  harness: Harness,
  token: string,
): Promise<MatchmakingSnapshot> => {
  const snapshot: unknown = await request(
    harness,
    "/v1/matchmaking",
    token,
  ).then((response) => response.json());
  return snapshot as MatchmakingSnapshot;
};

const getCoop = async (harness: Harness, token: string): Promise<CoopSnapshot> => {
  const snapshot: unknown = await request(
    harness,
    "/v1/coop-rendezvous",
    token,
  ).then((response) => response.json());
  return snapshot as CoopSnapshot;
};

const becomeFriends = async (
  harness: Harness,
  firstToken: string,
  firstId: string,
  secondToken: string,
  secondId: string,
): Promise<void> => {
  assert.equal((await request(harness, "/v1/friend-requests", firstToken, {
    body: JSON.stringify({ userId: secondId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })).status, 201);
  assert.equal((await request(
    harness,
    `/v1/friend-requests/${firstId}/accept`,
    secondToken,
    { method: "POST" },
  )).status, 200);
};

const invite = async (
  harness: Harness,
  hostToken: string,
  guestId: string,
): Promise<{ response: Response; sessionId?: string }> => {
  const response = await request(harness, "/v1/coop-rendezvous/invitations", hostToken, {
    body: JSON.stringify({ peerUserId: guestId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (response.status !== 200) return { response };
  const snapshot = (await response.json()) as CoopSnapshot;
  assert.equal(typeof snapshot.current.sessionId, "string");
  return { response, sessionId: snapshot.current.sessionId as string };
};

const expectConflict = async (response: Response): Promise<void> => {
  assert.equal(response.status, 409);
  const body = (await response.json()) as { error?: { code?: string } };
  assert.equal(body.error?.code, "CONFLICT");
};

const waitForMatch = async (harness: Harness, token: string): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if ((await getMatchmaking(harness, token)).status === "matched") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for a realtime match");
};

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(async (harness) => {
    for (const socket of harness.sockets) socket.close();
    await harness.application.close();
    await rm(harness.directory, { force: true, recursive: true });
  }));
});

describe("account-wide online engagement exclusion", () => {
  it("fences delayed matchmaking and Coop cancels from an older account session", async () => {
    const harness = await startHarness();
    const first = await register(harness, "alice");
    const second = await login(harness, "alice");
    await connect(harness, first);
    await connect(harness, second);

    const firstMatchmaking = await joinMatchmaking(harness, first);
    assert.equal(firstMatchmaking.status, 202);
    const firstMatchmakingLease = (await firstMatchmaking.json() as MatchmakingSnapshot).lease;
    const secondMatchmaking = await joinMatchmaking(harness, second);
    assert.equal(secondMatchmaking.status, 202);
    const secondMatchmakingLease = (await secondMatchmaking.json() as MatchmakingSnapshot).lease;
    assert.notEqual(firstMatchmakingLease, secondMatchmakingLease);
    const staleMatchmakingCancel = await request(harness, "/v1/matchmaking", first, {
      headers: { "Engagement-Lease": firstMatchmakingLease ?? "" },
      method: "DELETE",
    });
    assert.equal(staleMatchmakingCancel.status, 409);
    assert.equal((await getMatchmaking(harness, second)).status, "queued");
    assert.equal((await request(harness, "/v1/matchmaking", second, {
      headers: { "Engagement-Lease": secondMatchmakingLease ?? "" },
      method: "DELETE",
    })).status, 204);

    const firstCoop = await joinRandomCoop(harness, first);
    assert.equal(firstCoop.status, 200);
    const firstCoopLease = (await firstCoop.json() as CoopSnapshot).current.lease;
    const secondCoop = await joinRandomCoop(harness, second);
    assert.equal(secondCoop.status, 200);
    const secondCoopLease = (await secondCoop.json() as CoopSnapshot).current.lease;
    assert.notEqual(firstCoopLease, secondCoopLease);
    const staleCoopCancel = await request(harness, "/v1/coop-rendezvous/current", first, {
      headers: { "Engagement-Lease": firstCoopLease ?? "" },
      method: "DELETE",
    });
    assert.equal(staleCoopCancel.status, 409);
    assert.equal((await getCoop(harness, second)).current.status, "queued");
  });

  it("atomically admits only one concurrent activity from two sessions of the same account", async () => {
    const harness = await startHarness();
    const firstDeviceToken = await register(harness, "alice");
    const secondDeviceToken = await login(harness, "ALICE");
    await connect(harness, firstDeviceToken);

    const responses = await Promise.all([
      joinMatchmaking(harness, firstDeviceToken),
      joinRandomCoop(harness, secondDeviceToken),
    ]);
    assert.equal(responses.filter(({ status }) => status === 409).length, 1);
    assert.equal(responses.filter(({ status }) => status === 200 || status === 202).length, 1);

    const matchmaking = await getMatchmaking(harness, firstDeviceToken);
    const coop = await getCoop(harness, secondDeviceToken);
    assert.notEqual(matchmaking.status === "idle", coop.current.status === "idle");
  });

  it("blocks the opposite activity for both a queue slot and a completed match", async () => {
    const harness = await startHarness();
    const alice = await register(harness, "alice");
    const bob = await register(harness, "bob");
    await connect(harness, alice);
    await connect(harness, bob);

    assert.equal((await joinRandomCoop(harness, alice)).status, 200);
    await expectConflict(await joinMatchmaking(harness, alice));
    const coopLease = (await getCoop(harness, alice)).current.lease;
    assert.equal((await request(
      harness,
      "/v1/coop-rendezvous/current",
      alice,
      { headers: { "Engagement-Lease": coopLease ?? "" }, method: "DELETE" },
    )).status, 200);

    assert.equal((await joinMatchmaking(harness, alice, "pvp")).status, 202);
    await expectConflict(await joinRandomCoop(harness, alice));
    assert.equal((await joinMatchmaking(harness, bob, "pvp")).status, 202);
    await waitForMatch(harness, alice);
    await expectConflict(await joinRandomCoop(harness, alice));
  });

  it("keeps a received offer passive but refuses its acceptance during matchmaking", async () => {
    const harness = await startHarness();
    const alice = await register(harness, "alice");
    const bob = await register(harness, "bob");
    await becomeFriends(harness, alice, "alice", bob, "bob");
    await connect(harness, alice);
    await connect(harness, bob);

    const offered = await invite(harness, alice, "bob");
    assert.equal(offered.response.status, 200);
    assert.equal(typeof offered.sessionId, "string");
    const sessionId = offered.sessionId as string;

    assert.equal((await joinMatchmaking(harness, bob)).status, 202);
    await expectConflict(await request(
      harness,
      `/v1/coop-rendezvous/invitations/${sessionId}/accept`,
      bob,
      { method: "POST" },
    ));
    assert.equal((await getCoop(harness, bob)).invitations[0]?.sessionId, sessionId);
    assert.equal((await getCoop(harness, alice)).current.status, "offered");
    assert.equal((await request(
      harness,
      `/v1/coop-rendezvous/invitations/${sessionId}`,
      alice,
      { method: "DELETE" },
    )).status, 200);

    const offeredWhileBusy = await invite(harness, alice, "bob");
    assert.equal(offeredWhileBusy.response.status, 200);
    assert.equal(typeof offeredWhileBusy.sessionId, "string");
    const busySessionId = offeredWhileBusy.sessionId as string;
    await expectConflict(await request(
      harness,
      `/v1/coop-rendezvous/invitations/${busySessionId}/accept`,
      bob,
      { method: "POST" },
    ));
    await expectConflict(await joinMatchmaking(harness, alice));

    const matchmakingLease = (await getMatchmaking(harness, bob)).lease;
    assert.equal((await request(harness, "/v1/matchmaking", bob, {
      headers: { "Engagement-Lease": matchmakingLease ?? "" },
      method: "DELETE",
    })).status, 204);
    assert.equal((await request(
      harness,
      `/v1/coop-rendezvous/invitations/${busySessionId}/accept`,
      bob,
      { method: "POST" },
    )).status, 200);
    await expectConflict(await joinMatchmaking(harness, bob));
  });

  it("serializes a concurrent invitation acceptance and matchmaking join across devices", async () => {
    const harness = await startHarness();
    const alice = await register(harness, "alice");
    const firstBobDevice = await register(harness, "bob");
    const secondBobDevice = await login(harness, "BOB");
    await becomeFriends(harness, alice, "alice", firstBobDevice, "bob");
    await connect(harness, firstBobDevice);
    const offered = await invite(harness, alice, "bob");
    assert.equal(typeof offered.sessionId, "string");

    const responses = await Promise.all([
      request(
        harness,
        `/v1/coop-rendezvous/invitations/${offered.sessionId as string}/accept`,
        firstBobDevice,
        { method: "POST" },
      ),
      joinMatchmaking(harness, secondBobDevice),
    ]);
    assert.equal(responses.filter(({ status }) => status === 409).length, 1);
    assert.equal(responses.filter(({ status }) => status === 200 || status === 202).length, 1);

    const matchmaking = await getMatchmaking(harness, firstBobDevice);
    const coop = await getCoop(harness, secondBobDevice);
    assert.notEqual(matchmaking.status === "idle", coop.current.status === "idle");
    if (matchmaking.status !== "idle") {
      assert.equal(coop.invitations[0]?.sessionId, offered.sessionId);
    }
  });

  it("blocks matchmaking while an account remains a SharedSession member", async () => {
    const harness = await startHarness();
    const alice = await register(harness, "alice");
    const bob = await register(harness, "bob");
    await becomeFriends(harness, alice, "alice", bob, "bob");
    await connect(harness, alice);
    const sessionId = Buffer.alloc(16, 93).toString("base64url");
    const created = await request(harness, "/v1/shared-sessions", alice, {
      body: JSON.stringify({
        compatibility: { applicationId: "IPKE", locale: 3, release: 7 },
        peerUserId: "bob",
        player: {
          displayName: "ALICE",
          gender: "female",
          position: { direction: "south", mapId: 1, x: 1, z: 1 },
          spriteId: 97,
        },
        sessionId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(created.status, 201);

    await expectConflict(await joinMatchmaking(harness, alice));
    assert.equal((await request(
      harness,
      `/v1/shared-sessions/${sessionId}/members/me`,
      alice,
      { method: "DELETE" },
    )).status, 204);
    assert.equal((await joinMatchmaking(harness, alice)).status, 202);
  });
});
