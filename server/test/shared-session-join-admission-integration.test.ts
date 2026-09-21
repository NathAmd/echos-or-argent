import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createApplication, type ServerApplication } from "../src/app.js";
import { sha256Token } from "../src/auth.js";
import type { ServerConfig } from "../src/config.js";
import { CoopRendezvousService } from "../src/domain/coop-rendezvous.js";
import type { SharedPlayerProfile } from "../src/domain/shared-sessions.js";
import { MemoryAccountStore } from "../src/persistence/account-store.js";
import { MemoryCoopRendezvousStore } from "../src/persistence/coop-rendezvous-store.js";
import { MemoryFriendStore } from "../src/persistence/friend-store.js";

const ORIGIN = "https://join-admission.example";
const SESSION_ID = Buffer.alloc(16, 91).toString("base64url");
const requestId = (seed: number): string => Buffer.alloc(16, seed).toString("base64url");
const TOKENS = {
  alice: "alice-join-admission-token-with-entropy",
  bob: "bob-join-admission-token-with-entropy",
} as const;
const compatibility = { applicationId: "IPKE", locale: 3, release: 7 } as const;
const alicePlayer = {
  displayName: "ALICE",
  gender: "female",
  position: { direction: "south", mapId: 1, x: 1, z: 1 },
  spriteId: 97,
} as const;
const bobPlayer = {
  displayName: "BOB",
  gender: "male",
  position: { direction: "west", mapId: 1, x: 4, z: 1 },
  spriteId: 0,
} as const;

interface JsonSocket {
  readonly socket: WebSocket;
  next(predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
}

const wrapSocket = (socket: WebSocket): JsonSocket => {
  const buffered: Record<string, unknown>[] = [];
  const waiting: Array<Readonly<{
    predicate: (message: Record<string, unknown>) => boolean;
    resolve: (message: Record<string, unknown>) => void;
  }>> = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
    const index = waiting.findIndex(({ predicate }) => predicate(message));
    if (index === -1) {
      buffered.push(message);
      return;
    }
    waiting.splice(index, 1)[0]?.resolve(message);
  });
  return {
    socket,
    next(predicate) {
      const index = buffered.findIndex(predicate);
      if (index !== -1) return Promise.resolve(buffered.splice(index, 1)[0]!);
      return new Promise((resolve) => waiting.push({ predicate, resolve }));
    },
  };
};

const snapshotRevision = (message: Record<string, unknown>): number | undefined => {
  const snapshot = message.snapshot;
  return snapshot !== null && typeof snapshot === "object" && "revision" in snapshot
    && typeof snapshot.revision === "number"
    ? snapshot.revision
    : undefined;
};

describe("shared session join admission", () => {
  let application: ServerApplication;
  let baseUrl: string;
  let coopRendezvousService: CoopRendezvousService;
  let directory: string;
  const sockets: WebSocket[] = [];

  const request = (path: string, user: keyof typeof TOKENS, init: RequestInit = {}): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKENS[user]}`,
        Origin: ORIGIN,
        ...init.headers,
      },
    });

  const joinSession = (player: SharedPlayerProfile = bobPlayer): Promise<Response> => request(
    `/v1/shared-sessions/${SESSION_ID}/join`,
    "bob",
    {
      body: JSON.stringify({ compatibility, player }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  const connect = async (user: keyof typeof TOKENS): Promise<JsonSocket> => {
    const ticketResponse = await request("/v1/realtime-ticket", user, { method: "POST" });
    assert.equal(ticketResponse.status, 201);
    const { ticket } = await ticketResponse.json() as { ticket: string };
    const socket = new WebSocket(
      `${baseUrl.replace("http://", "ws://")}/v1/shared-sessions/realtime?ticket=${encodeURIComponent(ticket)}`,
      "authoritative-session.v1",
      { origin: ORIGIN },
    );
    sockets.push(socket);
    const wrapped = wrapSocket(socket);
    await once(socket, "open");
    await wrapped.next((message) => message.type === "ready");
    return wrapped;
  };

  const attachOwner = async (socket: JsonSocket, seed: number): Promise<void> => {
    const id = requestId(seed);
    socket.socket.send(JSON.stringify({ requestId: id, sessionId: SESSION_ID, type: "attach" }));
    await socket.next((message) => message.type === "attached" && message.requestId === id);
  };

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "join-admission-"));
    const config: ServerConfig = {
      accountEntitlementPolicy: "open",
      accountSessionTtlMs: 86_400_000,
      accountStorePath: "unused-join-admission-accounts.json",
      allowLegacyCoopBootstrap: true,
      allowLoopbackOrigins: false,
      allowedOrigins: new Set([ORIGIN]),
      authTokenHashes: new Map(
        Object.entries(TOKENS).map(([userId, token]) => [userId, sha256Token(token)]),
      ),
      coopRendezvousStorePath: join(directory, "coop-rendezvous.json"),
      coopRendezvousTtlMs: 120_000,
      friendStorePath: "unused-join-admission-friends.json",
      host: "127.0.0.1",
      lanDevelopmentMode: false,
      matchmakingAuthorizationTtlMs: 120_000,
      matchmakingQueueTtlMs: 120_000,
      objectStorePath: directory,
      port: 0,
      sharedSessionIdleTtlMs: 86_400_000,
      sharedSessionStorePath: join(directory, "shared-sessions.json"),
      ticketTtlMs: 30_000,
    };
    coopRendezvousService = new CoopRendezvousService({
      activeTtlMs: 120_000,
      areFriends: (first, second) => [first, second].sort().join(":") === "alice:bob",
      idFactory: () => SESSION_ID,
      maintenanceIntervalMs: 60_000,
      queueTtlMs: 120_000,
      readyTtlMs: 120_000,
      store: new MemoryCoopRendezvousStore(),
    });
    application = await createApplication(config, {
      accountStore: new MemoryAccountStore(),
      coopRendezvousService,
      friendStore: new MemoryFriendStore(),
    });
    const address = await application.listen();
    baseUrl = `http://${address.host}:${address.port}`;

    assert.equal((await request("/v1/friend-requests", "alice", {
      body: JSON.stringify({ userId: "bob" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })).status, 201);
    assert.equal((await request("/v1/friend-requests/alice/accept", "bob", {
      method: "POST",
    })).status, 200);
    const invitation = await request("/v1/coop-rendezvous/invitations", "alice", {
      body: JSON.stringify({ peerUserId: "bob" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(invitation.status, 200);
    assert.equal((await invitation.json() as { current: { sessionId: string } }).current.sessionId,
      SESSION_ID);
    assert.equal((await request(
      `/v1/coop-rendezvous/invitations/${SESSION_ID}/accept`,
      "bob",
      { method: "POST" },
    )).status, 200);
    assert.equal((await request("/v1/shared-sessions", "alice", {
      body: JSON.stringify({
        compatibility,
        peerUserId: "bob",
        player: alicePlayer,
        sessionId: SESSION_ID,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })).status, 201);
  });

  after(async () => {
    for (const socket of sockets) socket.close();
    await application.close();
    await rm(directory, { force: true, recursive: true });
  });

  it("commits only an owner-accepted join and closes every admission race", async () => {
    const unavailable = await joinSession();
    assert.equal(unavailable.status, 409);
    assert.equal((await unavailable.json() as { error: { code: string } }).error.code, "join-unattested");
    const beforeAdmission = await request(`/v1/shared-sessions/${SESSION_ID}`, "alice");
    assert.equal(beforeAdmission.status, 200);
    assert.equal((await beforeAdmission.json() as { snapshot: { players: unknown[]; revision: number } })
      .snapshot.players.length, 1);

    let owner = await connect("alice");
    const guestSocket = await connect("bob");
    await attachOwner(owner, 1);

    const malformedDecisionJoin = joinSession();
    const admission = await owner.next((message) => message.type === "join-admission-request");
    assert.equal(admission.sessionId, SESSION_ID);
    assert.equal(admission.playerId, "bob");
    assert.deepEqual(admission.compatibility, compatibility);
    assert.deepEqual(admission.player, bobPlayer);
    assert.equal(snapshotRevision(admission), 0);

    owner.socket.send(JSON.stringify({
      command: {
        commandId: "move:blocked-by-join",
        expectedRevision: 0,
        from: alicePlayer.position,
        kind: "movement",
        mode: "walk",
        protocolVersion: 2,
        sequence: 1,
        to: { direction: "east", mapId: 1, x: 2, z: 1 },
      },
      requestId: requestId(2),
      type: "command",
    }));
    const blocked = await owner.next((message) => message.requestId === requestId(2));
    assert.equal(blocked.code, "session-mutation-in-progress");

    const concurrent = await joinSession();
    assert.equal(concurrent.status, 409);
    assert.equal((await concurrent.json() as { error: { code: string } }).error.code,
      "session-mutation-in-progress");

    guestSocket.socket.send(JSON.stringify({
      admissionId: admission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    assert.equal((await guestSocket.next((message) => message.code === "forbidden")).code, "forbidden");

    owner.socket.send(JSON.stringify({
      admissionId: admission.admissionId,
      decision: { arrival: bobPlayer.position, kind: "accept" },
      type: "admission-response",
    }));
    assert.equal((await owner.next((message) => message.code === "admission-decision-mismatch")).code,
      "admission-decision-mismatch");
    const malformed = await malformedDecisionJoin;
    assert.equal(malformed.status, 409);
    assert.equal((await malformed.json() as { error: { code: string } }).error.code, "join-unattested");

    owner.socket.send(JSON.stringify({
      admissionId: admission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    assert.equal((await owner.next((message) => message.code === "admission-not-found")).code,
      "admission-not-found");

    owner.socket.send(JSON.stringify({ requestId: requestId(3), type: "request-snapshot" }));
    const unchanged = await owner.next((message) => message.requestId === requestId(3));
    assert.equal(snapshotRevision(unchanged), 0);
    assert.equal((unchanged.snapshot as { players: unknown[] }).players.length, 1);

    const rejectedJoin = joinSession();
    const rejectedAdmission = await owner.next((message) => message.type === "join-admission-request");
    owner.socket.send(JSON.stringify({
      admissionId: rejectedAdmission.admissionId,
      decision: { code: "player-declined", kind: "reject" },
      type: "admission-response",
    }));
    const rejected = await rejectedJoin;
    assert.equal(rejected.status, 409);
    const rejectedBody = await rejected.json() as { error: { code: string; portCode?: string } };
    assert.equal(rejectedBody.error.code, "join-rejected");
    assert.equal(rejectedBody.error.portCode, "player-declined");

    const acceptedJoin = joinSession();
    const acceptedAdmission = await owner.next((message) => message.type === "join-admission-request");
    owner.socket.send(JSON.stringify({
      admissionId: acceptedAdmission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    const accepted = await acceptedJoin;
    assert.equal(accepted.status, 200);
    const acceptedSnapshot = (await accepted.json() as {
      snapshot: { players: unknown[]; revision: number };
    }).snapshot;
    assert.equal(acceptedSnapshot.revision, 1);
    assert.equal(acceptedSnapshot.players.length, 2);

    const ownerClosed = once(owner.socket, "close");
    owner.socket.close(1000);
    await ownerClosed;
    const disconnectDeadline = Date.now() + 2_000;
    while (Date.now() < disconnectDeadline) {
      const current = await request(`/v1/shared-sessions/${SESSION_ID}`, "alice");
      assert.equal(current.status, 200);
      const revision = (await current.json() as { snapshot: { revision: number } }).snapshot.revision;
      if (revision >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const exactRejoin = await joinSession();
    assert.equal(exactRejoin.status, 200);
    assert.equal((await exactRejoin.json() as { snapshot: { revision: number } }).snapshot.revision, 2);
    const changedRejoin = await joinSession({
      ...bobPlayer,
      position: { ...bobPlayer.position, x: bobPlayer.position.x + 1 },
    });
    assert.equal(changedRejoin.status, 200);
    const changedRejoinSnapshot = (await changedRejoin.json() as {
      snapshot: { players: Array<{ playerId: string; position: { x: number } }> };
    }).snapshot;
    assert.equal(
      changedRejoinSnapshot.players.find(({ playerId }) => playerId === "bob")?.position.x,
      bobPlayer.position.x,
    );

    assert.equal((await request(`/v1/shared-sessions/${SESSION_ID}/members/me`, "bob", {
      method: "DELETE",
    })).status, 204);
    owner = await connect("alice");
    await attachOwner(owner, 4);

    const timedOutJoin = joinSession();
    await owner.next((message) => message.type === "join-admission-request");
    const timedOut = await timedOutJoin;
    assert.equal(timedOut.status, 409);
    assert.equal((await timedOut.json() as { error: { code: string } }).error.code, "join-unattested");
    owner.socket.send(JSON.stringify({ requestId: requestId(5), type: "request-snapshot" }));
    const afterTimeout = await owner.next((message) => message.requestId === requestId(5));
    assert.equal((afterTimeout.snapshot as { players: unknown[] }).players.length, 1);

    const disconnectedJoin = joinSession();
    await owner.next((message) => message.type === "join-admission-request");
    const disconnectedOwner = once(owner.socket, "close");
    owner.socket.close(1000);
    await disconnectedOwner;
    const disconnected = await disconnectedJoin;
    assert.equal(disconnected.status, 409);
    assert.equal((await disconnected.json() as { error: { code: string } }).error.code, "join-unattested");

    owner = await connect("alice");
    await attachOwner(owner, 6);

    const revokedJoin = joinSession();
    const revokedAdmission = await owner.next(
      (message) => message.type === "join-admission-request",
    );
    coopRendezvousService.cancelCurrent("bob");
    owner.socket.send(JSON.stringify({
      admissionId: revokedAdmission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    const revoked = await revokedJoin;
    assert.equal(revoked.status, 403);
    assert.equal((await revoked.json() as { error: { code: string } }).error.code, "peer-mismatch");
    const stillPresent = await request(`/v1/shared-sessions/${SESSION_ID}`, "alice");
    assert.equal(stillPresent.status, 200);
    assert.equal((await stillPresent.json() as { snapshot: { players: unknown[] } })
      .snapshot.players.length, 1);

    coopRendezvousService.inviteFriend("alice", "bob");
    coopRendezvousService.acceptInvitation("bob", SESSION_ID);
    assert.equal((await request("/v1/shared-sessions", "alice", {
      body: JSON.stringify({
        compatibility,
        peerUserId: "bob",
        player: alicePlayer,
        sessionId: SESSION_ID,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })).status, 200);

    const endedJoin = joinSession();
    const endedAdmission = await owner.next((message) => message.type === "join-admission-request");
    const ended = request("/v1/coop-rendezvous/current", "bob", {
      method: "DELETE",
    });
    const endedResponse = await ended;
    assert.equal(endedResponse.status, 200);
    assert.deepEqual((await endedResponse.json() as { current: unknown }).current, { status: "idle" });
    const endedJoinResponse = await endedJoin;
    assert.equal(endedJoinResponse.status, 404);
    assert.equal((await endedJoinResponse.json() as { error: { code: string } }).error.code,
      "session-not-found");
    owner.socket.send(JSON.stringify({
      admissionId: endedAdmission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    assert.equal((await owner.next((message) => message.code === "admission-not-found")).code,
      "admission-not-found");
    assert.equal((await owner.next((message) => message.type === "session-ended")).reason, "owner-left");
    assert.equal((await request(`/v1/shared-sessions/${SESSION_ID}`, "alice")).status, 404);
    const coopAfterCancellation = await request("/v1/coop-rendezvous", "alice")
      .then((response) => response.json()) as { current: unknown };
    assert.deepEqual(coopAfterCancellation.current, { status: "idle" });
  });
});
