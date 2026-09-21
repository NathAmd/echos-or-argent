import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import WebSocket from "ws";
import { createApplication, type ServerApplication } from "../src/app.js";
import { sha256Token } from "../src/auth.js";
import type { ServerConfig } from "../src/config.js";
import { MemoryFriendStore } from "../src/persistence/friend-store.js";

const ORIGIN = "https://client.example";
const TOKENS = {
  alice: "alice-random-match-token",
  bob: "bob-random-match-token",
} as const;
const TEST_SCRYPT = {
  blockSize: 8,
  cost: 2 ** 10,
  keyLength: 32,
  maxmem: 8 * 1024 * 1024,
  parallelization: 1,
} as const;
const opaqueId = (seed: number): string => Buffer.alloc(16, seed).toString("base64url");
const VALID_SDP = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "a=ice-ufrag:test",
  "a=ice-pwd:0123456789012345678901",
  "a=fingerprint:sha-256 00",
  "",
].join("\r\n");

interface JsonSocket {
  readonly socket: WebSocket;
  next(predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
}

type MatchedStatus = {
  activity: "trade" | "pvp" | "coop";
  expiresAt: number;
  matchId: string;
  negotiationId: string;
  peerUserId: string;
  role: "offerer" | "answerer";
  status: "matched";
};

const wrapSocket = (socket: WebSocket): JsonSocket => {
  const buffered: Record<string, unknown>[] = [];
  const waiting: {
    predicate: (message: Record<string, unknown>) => boolean;
    resolve: (message: Record<string, unknown>) => void;
  }[] = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
    const index = waiting.findIndex(({ predicate }) => predicate(message));
    if (index === -1) buffered.push(message);
    else waiting.splice(index, 1)[0]?.resolve(message);
  });
  return {
    socket,
    next(predicate) {
      const index = buffered.findIndex(predicate);
      if (index !== -1) {
        return Promise.resolve(buffered.splice(index, 1)[0] as Record<string, unknown>);
      }
      return new Promise((resolve) => waiting.push({ predicate, resolve }));
    },
  };
};

describe("HTTP random matchmaking and ephemeral signaling", () => {
  let application: ServerApplication;
  let baseUrl: string;
  let objectStoreDirectory: string;
  const openSockets: WebSocket[] = [];

  const request = (path: string, userId: keyof typeof TOKENS, init: RequestInit = {}): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKENS[userId]}`,
        Origin: ORIGIN,
        ...init.headers,
      },
    });

  const connect = async (userId: keyof typeof TOKENS): Promise<JsonSocket> => {
    const ticketResponse = await request("/v1/realtime-ticket", userId, { method: "POST" });
    assert.equal(ticketResponse.status, 201);
    const ticketBody = (await ticketResponse.json()) as { ticket: string };
    const socket = new WebSocket(
      `${baseUrl.replace("http://", "ws://")}/v1/realtime?ticket=${encodeURIComponent(ticketBody.ticket)}`,
      "social-signaling.v1",
      { origin: ORIGIN },
    );
    openSockets.push(socket);
    const wrapped = wrapSocket(socket);
    await once(socket, "open");
    await wrapped.next((message) => message.type === "ready");
    return wrapped;
  };

  const getStatus = async (userId: keyof typeof TOKENS): Promise<Record<string, unknown>> => {
    const response = await request("/v1/matchmaking", userId);
    assert.equal(response.status, 200);
    return (await response.json()) as Record<string, unknown>;
  };

  const waitForStatus = async (
    userId: keyof typeof TOKENS,
    expected: "idle" | "matched",
  ): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const status = await getStatus(userId);
      if (status.status === expected) return status;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`Timed out waiting for matchmaking status ${expected}`);
  };

  const joinQueue = async (
    userId: keyof typeof TOKENS,
    activity: "trade" | "pvp" | "coop",
  ): Promise<Record<string, unknown>> => {
    const response = await request("/v1/matchmaking", userId, {
      body: JSON.stringify({ activity }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(response.status, 202);
    return (await response.json()) as Record<string, unknown>;
  };

  before(async () => {
    objectStoreDirectory = await mkdtemp(join(tmpdir(), "generic-matchmaking-test-"));
    const config: ServerConfig = {
      accountEntitlementPolicy: "open",
      accountSessionTtlMs: 86_400_000,
      accountStorePath: "unused-matchmaking-accounts.json",
      allowLegacyCoopBootstrap: true,
      allowLoopbackOrigins: false,
      allowedOrigins: new Set([ORIGIN]),
      authTokenHashes: new Map(
        Object.entries(TOKENS).map(([userId, token]) => [userId, sha256Token(token)]),
      ),
      coopRendezvousStorePath: join(objectStoreDirectory, "coop-rendezvous.json"),
      coopRendezvousTtlMs: 120_000,
      friendStorePath: "unused-matchmaking-friends.json",
      host: "127.0.0.1",
      lanDevelopmentMode: false,
      matchmakingAuthorizationTtlMs: 10_000,
      matchmakingQueueTtlMs: 10_000,
      objectStorePath: objectStoreDirectory,
      port: 0,
      sharedSessionIdleTtlMs: 86_400_000,
      sharedSessionStorePath: join(objectStoreDirectory, "shared-sessions.json"),
      ticketTtlMs: 30_000,
    };
    application = await createApplication(config, {
      accountScryptParameters: TEST_SCRYPT,
      friendStore: new MemoryFriendStore(),
    });
    const address = await application.listen();
    baseUrl = `http://${address.host}:${address.port}`;
  });

  after(async () => {
    for (const socket of openSockets) socket.close();
    await application.close();
    await rm(objectStoreDirectory, { force: true, recursive: true });
  });

  it("requires realtime, returns strict snapshots and authorizes only the assigned pair", async () => {
    const offline = await request("/v1/matchmaking", "alice", {
      body: JSON.stringify({ activity: "trade" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(offline.status, 409);

    const aliceSocket = await connect("alice");
    const bobSocket = await connect("bob");
    const invalid = await request("/v1/matchmaking", "alice", {
      body: JSON.stringify({ activity: "ranked", note: "unsupported" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(invalid.status, 400);

    const aliceQueued = await joinQueue("alice", "trade");
    assert.equal(aliceQueued.status, "queued");
    assert.equal(aliceQueued.activity, "trade");
    assert.equal(typeof aliceQueued.joinedAt, "number");
    assert.equal(typeof aliceQueued.expiresAt, "number");
    assert.deepEqual(Object.keys(aliceQueued).sort(), ["activity", "expiresAt", "joinedAt", "status"]);
    assert.deepEqual(await joinQueue("alice", "trade"), aliceQueued);
    assert.equal((await joinQueue("bob", "trade")).status, "queued");

    const alice = await waitForStatus("alice", "matched") as MatchedStatus;
    const bob = await waitForStatus("bob", "matched") as MatchedStatus;
    assert.deepEqual(Object.keys(alice).sort(), [
      "activity",
      "expiresAt",
      "matchId",
      "negotiationId",
      "peerUserId",
      "role",
      "status",
    ]);
    assert.match(alice.matchId, /^[A-Za-z0-9_-]{21}[AQgw]$/);
    assert.match(alice.negotiationId, /^[A-Za-z0-9_-]{21}[AQgw]$/);
    assert.notEqual(alice.matchId, alice.negotiationId);
    assert.deepEqual(alice, {
      activity: "trade",
      expiresAt: bob.expiresAt,
      matchId: bob.matchId,
      negotiationId: bob.negotiationId,
      peerUserId: "bob",
      role: "offerer",
      status: "matched",
    });
    assert.equal(bob.peerUserId, "alice");
    assert.equal(bob.role, "answerer");
    const repeatedMatch = await request("/v1/matchmaking", "alice", {
      body: JSON.stringify({ activity: "trade" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(repeatedMatch.status, 200);
    assert.deepEqual(await repeatedMatch.json(), alice);
    const conflictingActivity = await request("/v1/matchmaking", "alice", {
      body: JSON.stringify({ activity: "coop" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(conflictingActivity.status, 409);
    assert.deepEqual(await request("/v1/social", "alice").then((response) => response.json()), {
      friends: [],
      incoming: [],
      outgoing: [],
    });

    aliceSocket.socket.send(JSON.stringify({
      negotiationId: alice.negotiationId,
      payload: { sdp: VALID_SDP, type: "offer" },
      requestId: opaqueId(40),
      to: "bob",
      type: "signal",
    }));
    assert.deepEqual(await bobSocket.next((message) => message.type === "signal"), {
      from: "alice",
      negotiationId: alice.negotiationId,
      payload: { sdp: VALID_SDP, type: "offer" },
      requestId: opaqueId(40),
      type: "signal",
    });
    assert.deepEqual(await aliceSocket.next((message) => message.requestId === opaqueId(40)), {
      requestId: opaqueId(40),
      type: "signal-accepted",
    });

    aliceSocket.socket.send(JSON.stringify({
      negotiationId: opaqueId(41),
      payload: { type: "hangup" },
      requestId: opaqueId(42),
      to: "bob",
      type: "signal",
    }));
    assert.deepEqual(await aliceSocket.next((message) => message.requestId === opaqueId(42)), {
      code: "FORBIDDEN",
      message: "Signaling requires a friendship or an active match authorization",
      requestId: opaqueId(42),
      type: "error",
    });

    const cancelled = await request("/v1/matchmaking", "alice", { method: "DELETE" });
    assert.equal(cancelled.status, 204);
    assert.deepEqual(await getStatus("alice"), { status: "idle" });
    assert.deepEqual(await getStatus("bob"), { status: "idle" });
  });

  it("keeps an active match when the same identity replaces its WebSocket", async () => {
    const firstAlice = await connect("alice");
    await connect("bob");
    await joinQueue("alice", "pvp");
    await joinQueue("bob", "pvp");
    const before = await waitForStatus("alice", "matched") as MatchedStatus;

    const firstClosed = once(firstAlice.socket, "close");
    await connect("alice");
    const [closeCode] = await firstClosed;
    assert.equal(closeCode, 4000);
    assert.deepEqual(await getStatus("alice"), before);
    assert.equal((await getStatus("bob")).matchId, before.matchId);

    assert.equal((await request("/v1/matchmaking", "alice", { method: "DELETE" })).status, 204);
  });

  it("removes a queue or authorization when the last realtime socket disconnects", async () => {
    await connect("alice");
    const bob = await connect("bob");
    await joinQueue("alice", "coop");
    await joinQueue("bob", "coop");
    await waitForStatus("alice", "matched");

    const bobClosed = once(bob.socket, "close");
    bob.socket.close(1000, "test disconnect");
    await bobClosed;
    assert.deepEqual(await waitForStatus("alice", "idle"), { status: "idle" });
    assert.deepEqual(await getStatus("bob"), { status: "idle" });
  });
});
