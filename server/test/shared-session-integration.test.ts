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
import { MemoryAccountStore } from "../src/persistence/account-store.js";
import { MemoryFriendStore } from "../src/persistence/friend-store.js";

const ORIGIN = "https://shared-client.example";
const SESSION_ID = Buffer.alloc(16, 61).toString("base64url");
const requestId = (seed: number): string => Buffer.alloc(16, seed).toString("base64url");
const TOKENS = {
  alice: "alice-shared-token-with-production-entropy",
  bob: "bob-shared-token-with-production-entropy",
  carol: "carol-shared-token-with-production-entropy",
} as const;
const compatibility = { applicationId: "IPKE", locale: 3, release: 7 } as const;
const seededProgression = {
  counters: [{ id: "field.progression-revision", value: 0 }],
  milestoneIds: ["field.schema.v1", `field.branch.${"a".repeat(32)}`],
} as const;
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

describe("authenticated shared session HTTP and WebSocket contract", () => {
  let application: ServerApplication;
  let baseUrl: string;
  let objectStoreDirectory: string;
  const openSockets: WebSocket[] = [];

  const request = (path: string, user?: keyof typeof TOKENS, init: RequestInit = {}): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Origin: ORIGIN,
        ...(user === undefined ? {} : { Authorization: `Bearer ${TOKENS[user]}` }),
        ...init.headers,
      },
    });

  const connect = async (user: keyof typeof TOKENS): Promise<JsonSocket> => {
    const ticketResponse = await request("/v1/realtime-ticket", user, { method: "POST" });
    assert.equal(ticketResponse.status, 201);
    const ticketBody = await ticketResponse.json() as { ticket: string };
    const socket = new WebSocket(
      `${baseUrl.replace("http://", "ws://")}/v1/shared-sessions/realtime?ticket=${encodeURIComponent(ticketBody.ticket)}`,
      "authoritative-session.v1",
      { origin: ORIGIN },
    );
    openSockets.push(socket);
    const wrapped = wrapSocket(socket);
    await once(socket, "open");
    assert.deepEqual(await wrapped.next((message) => message.type === "ready"), {
      type: "ready",
      userId: user,
      version: 1,
    });
    return wrapped;
  };

  before(async () => {
    objectStoreDirectory = await mkdtemp(join(tmpdir(), "shared-session-integration-"));
    const config: ServerConfig = {
      accountEntitlementPolicy: "open",
      accountSessionTtlMs: 86_400_000,
      accountStorePath: "unused-shared-accounts.json",
      allowLegacyCoopBootstrap: true,
      allowLoopbackOrigins: false,
      allowedOrigins: new Set([ORIGIN]),
      authTokenHashes: new Map(
        Object.entries(TOKENS).map(([userId, token]) => [userId, sha256Token(token)]),
      ),
      coopRendezvousStorePath: join(objectStoreDirectory, "coop-rendezvous.json"),
      coopRendezvousTtlMs: 120_000,
      friendStorePath: "unused-shared-friends.json",
      host: "127.0.0.1",
      lanDevelopmentMode: false,
      matchmakingAuthorizationTtlMs: 120_000,
      matchmakingQueueTtlMs: 120_000,
      objectStorePath: objectStoreDirectory,
      port: 0,
      sharedSessionIdleTtlMs: 86_400_000,
      sharedSessionStorePath: join(objectStoreDirectory, "shared-sessions.json"),
      ticketTtlMs: 30_000,
    };
    application = await createApplication(config, {
      accountStore: new MemoryAccountStore(),
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

  it("isolates lifecycle by identity and converges two sockets on authoritative revisions", async () => {
    const unauthenticated = await request("/v1/shared-sessions", undefined, {
      body: JSON.stringify({
        compatibility,
        peerUserId: "bob",
        player: alicePlayer,
        sessionId: SESSION_ID,
        sharedProgression: seededProgression,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(unauthenticated.status, 401);

    const friendRequest = await request("/v1/friend-requests", "alice", {
      body: JSON.stringify({ userId: "bob" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(friendRequest.status, 201);
    assert.equal((await request("/v1/friend-requests/alice/accept", "bob", { method: "POST" })).status, 200);

    const forbiddenCreation = await request("/v1/shared-sessions", "carol", {
      body: JSON.stringify({
        compatibility,
        peerUserId: "alice",
        player: { ...alicePlayer, displayName: "CAROL" },
        sessionId: Buffer.alloc(16, 62).toString("base64url"),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(forbiddenCreation.status, 403);

    const invalidSeedSessionId = Buffer.alloc(16, 63).toString("base64url");
    const invalidSeed = await request("/v1/shared-sessions", "alice", {
      body: JSON.stringify({
        compatibility,
        peerUserId: "bob",
        player: alicePlayer,
        sessionId: invalidSeedSessionId,
        sharedProgression: {
          counters: [],
          milestoneIds: ["story:duplicate", "story:duplicate"],
        },
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(invalidSeed.status, 400);
    assert.equal((await invalidSeed.json() as { error: { code: string } }).error.code, "BAD_REQUEST");
    assert.equal((await request(`/v1/shared-sessions/${invalidSeedSessionId}`, "alice")).status, 404);

    const created = await request("/v1/shared-sessions", "alice", {
      body: JSON.stringify({
        compatibility,
        peerUserId: "bob",
        player: alicePlayer,
        sessionId: SESSION_ID,
        sharedProgression: seededProgression,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { snapshot: Record<string, unknown> };
    assert.deepEqual(createdBody.snapshot, {
      pendingEvents: [],
      players: [{ ...alicePlayer, movementSequence: 0, playerId: "alice", state: "active" }],
      protocolVersion: 2,
      revision: 0,
      sessionId: SESSION_ID,
      sharedProgression: seededProgression,
    });

    const isolated = await request(`/v1/shared-sessions/${SESSION_ID}`, "carol");
    assert.equal(isolated.status, 403);
    const isolatedBody = await isolated.json() as { error: { code: string } };
    assert.equal(isolatedBody.error.code, "player-not-found");

    const forbiddenJoinSeed = await request(`/v1/shared-sessions/${SESSION_ID}/join`, "bob", {
      body: JSON.stringify({
        compatibility,
        player: bobPlayer,
        sharedProgression: { counters: [], milestoneIds: ["story:replace"] },
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(forbiddenJoinSeed.status, 400);
    assert.equal((await forbiddenJoinSeed.json() as { error: { code: string } }).error.code, "BAD_REQUEST");

    const mismatched = await request(`/v1/shared-sessions/${SESSION_ID}/join`, "bob", {
      body: JSON.stringify({ compatibility: { ...compatibility, locale: 4 }, player: bobPlayer }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(mismatched.status, 409);
    assert.equal((await mismatched.json() as { error: { code: string } }).error.code, "compatibility-mismatch");

    const occupied = await request(`/v1/shared-sessions/${SESSION_ID}/join`, "bob", {
      body: JSON.stringify({
        compatibility,
        player: { ...bobPlayer, position: alicePlayer.position },
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(occupied.status, 409);
    assert.equal((await occupied.json() as { error: { code: string } }).error.code, "position-occupied");

    const alice = await connect("alice");
    alice.socket.send(JSON.stringify({
      requestId: requestId(1),
      sessionId: SESSION_ID,
      type: "attach",
    }));
    assert.equal(snapshotRevision(await alice.next((message) => message.type === "attached")), 0);

    const joinedRequest = request(`/v1/shared-sessions/${SESSION_ID}/join`, "bob", {
      body: JSON.stringify({ compatibility, player: bobPlayer }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const joinAdmission = await alice.next((message) => message.type === "join-admission-request");
    assert.deepEqual(joinAdmission.compatibility, compatibility);
    assert.deepEqual(joinAdmission.player, bobPlayer);
    alice.socket.send(JSON.stringify({
      admissionId: joinAdmission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    const joined = await joinedRequest;
    assert.equal(joined.status, 200);
    const joinedSnapshot = (await joined.json() as { snapshot: {
      revision: number;
      sharedProgression: unknown;
    } }).snapshot;
    assert.equal(joinedSnapshot.revision, 1);
    assert.deepEqual(joinedSnapshot.sharedProgression, seededProgression);

    const bob = await connect("bob");
    bob.socket.send(JSON.stringify({ requestId: requestId(2), sessionId: SESSION_ID, type: "attach" }));
    assert.equal(snapshotRevision(await bob.next((message) => message.type === "attached")), 1);

    const aliceMovement = {
      commandId: "move:alice:1",
      expectedRevision: 1,
      from: alicePlayer.position,
      kind: "movement",
      mode: "walk",
      protocolVersion: 2,
      sequence: 1,
      to: { direction: "east", mapId: 1, x: 2, z: 1 },
    } as const;
    alice.socket.send(JSON.stringify({ command: aliceMovement, requestId: requestId(3), type: "command" }));
    const aliceAccepted = await alice.next((message) => message.type === "command-accepted"
      && message.requestId === requestId(3));
    assert.equal(aliceAccepted.appliedRevision, 2);
    assert.equal(aliceAccepted.replayed, false);
    assert.equal(snapshotRevision(aliceAccepted), 2);
    assert.equal(snapshotRevision(await bob.next((message) => message.type === "snapshot"
      && snapshotRevision(message) === 2)), 2);

    alice.socket.send(JSON.stringify({ command: aliceMovement, requestId: requestId(4), type: "command" }));
    const replayed = await alice.next((message) => message.type === "command-accepted"
      && message.requestId === requestId(4));
    assert.equal(replayed.appliedRevision, 2);
    assert.equal(replayed.replayed, true);
    assert.equal(snapshotRevision(replayed), 2);

    const bobMovement = {
      commandId: "move:bob:1",
      expectedRevision: 1,
      from: bobPlayer.position,
      kind: "movement",
      mode: "run",
      protocolVersion: 2,
      sequence: 1,
      to: { direction: "west", mapId: 1, x: 3, z: 1 },
    } as const;
    bob.socket.send(JSON.stringify({ command: bobMovement, requestId: requestId(5), type: "command" }));
    const staleAccepted = await bob.next((message) => message.type === "command-accepted"
      && message.requestId === requestId(5));
    assert.equal(staleAccepted.appliedRevision, 3);
    const bothMovementsAtAlice = await alice.next((message) => message.type === "snapshot"
      && snapshotRevision(message) === 3);
    const convergedPlayers = (bothMovementsAtAlice.snapshot as { players: Array<{
      playerId: string;
      position: unknown;
    }> }).players;
    assert.deepEqual(
      convergedPlayers.find(({ playerId }) => playerId === "alice")?.position,
      aliceMovement.to,
    );
    assert.deepEqual(
      convergedPlayers.find(({ playerId }) => playerId === "bob")?.position,
      bobMovement.to,
    );

    const timedOutTransition = {
      arrival: { direction: "south", mapId: 3, x: 20, z: 20 },
      commandId: "move:bob:2",
      expectedRevision: 3,
      from: bobMovement.to,
      kind: "movement",
      mode: "walk",
      protocolVersion: 2,
      sequence: 2,
      to: { direction: "south", mapId: 1, x: 3, z: 2 },
    } as const;
    bob.socket.send(JSON.stringify({
      command: timedOutTransition,
      requestId: requestId(12),
      type: "command",
    }));
    const timedOutAdmission = await alice.next((message) => message.type === "admission-request"
      && message.playerId === "bob");
    assert.deepEqual(timedOutAdmission.command, timedOutTransition);
    const timedOut = await bob.next((message) => message.type === "error"
      && message.requestId === requestId(12));
    assert.equal(timedOut.code, "transition-unattested");

    bob.socket.send(JSON.stringify({ requestId: requestId(13), type: "request-snapshot" }));
    const afterTimeout = await bob.next((message) => message.type === "snapshot-response"
      && message.requestId === requestId(13));
    assert.equal(snapshotRevision(afterTimeout), 3);
    const afterTimeoutSnapshot = afterTimeout.snapshot as { players: Array<{
      playerId: string;
      position: unknown;
    }> };
    assert.deepEqual(
      afterTimeoutSnapshot.players.find(({ playerId }) => playerId === "bob")?.position,
      bobMovement.to,
    );

    const transitionMovement = {
      arrival: { direction: "south", mapId: 2, x: 10, z: 10 },
      commandId: "move:alice:2",
      expectedRevision: 3,
      from: aliceMovement.to,
      kind: "movement",
      mode: "walk",
      protocolVersion: 2,
      sequence: 2,
      to: { direction: "south", mapId: 1, x: 2, z: 2 },
    } as const;
    alice.socket.send(JSON.stringify({ command: transitionMovement, requestId: requestId(6), type: "command" }));
    const admissionRequest = await alice.next((message) => message.type === "admission-request");
    assert.equal(admissionRequest.sessionId, SESSION_ID);
    assert.equal(admissionRequest.playerId, "alice");
    assert.deepEqual(admissionRequest.command, transitionMovement);
    assert.equal(snapshotRevision(admissionRequest), 3);
    const admissionId = admissionRequest.admissionId;
    assert.equal(typeof admissionId, "string");

    bob.socket.send(JSON.stringify({
      admissionId,
      decision: { arrival: transitionMovement.arrival, kind: "accept" },
      type: "admission-response",
    }));
    assert.equal((await bob.next((message) => message.type === "error"
      && message.code === "forbidden")).code, "forbidden");
    alice.socket.send(JSON.stringify({
      admissionId,
      decision: { code: "map-transition-rejected", kind: "reject" },
      type: "admission-response",
    }));
    const rejectedTransition = await alice.next((message) => message.type === "error"
      && message.requestId === requestId(6));
    assert.equal(rejectedTransition.code, "port-rejected");

    alice.socket.send(JSON.stringify({ requestId: requestId(14), type: "request-snapshot" }));
    const afterRejection = await alice.next((message) => message.type === "snapshot-response"
      && message.requestId === requestId(14));
    assert.equal(snapshotRevision(afterRejection), 3);
    const afterRejectionSnapshot = afterRejection.snapshot as { players: Array<{
      playerId: string;
      position: unknown;
    }> };
    assert.deepEqual(
      afterRejectionSnapshot.players.find(({ playerId }) => playerId === "alice")?.position,
      aliceMovement.to,
    );

    alice.socket.send(JSON.stringify({
      command: transitionMovement,
      requestId: requestId(15),
      type: "command",
    }));
    const retriedAdmissionRequest = await alice.next((message) => message.type === "admission-request"
      && message.playerId === "alice");
    assert.equal(retriedAdmissionRequest.sessionId, SESSION_ID);
    assert.deepEqual(retriedAdmissionRequest.command, transitionMovement);
    assert.equal(snapshotRevision(retriedAdmissionRequest), 3);
    assert.equal(typeof retriedAdmissionRequest.admissionId, "string");
    alice.socket.send(JSON.stringify({
      admissionId: retriedAdmissionRequest.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    const crossedMovementAcceptance = await alice.next((message) => message.type === "error"
      && message.requestId === requestId(15));
    assert.equal(crossedMovementAcceptance.code, "transition-attestation-mismatch");
    alice.socket.send(JSON.stringify({
      command: transitionMovement,
      requestId: requestId(26),
      type: "command",
    }));
    const acceptedAdmissionRequest = await alice.next((message) => message.type === "admission-request"
      && message.playerId === "alice");
    alice.socket.send(JSON.stringify({
      admissionId: acceptedAdmissionRequest.admissionId,
      decision: { arrival: transitionMovement.arrival, kind: "accept" },
      type: "admission-response",
    }));
    const transitioned = await alice.next((message) => message.type === "command-accepted"
      && message.requestId === requestId(26));
    assert.equal(transitioned.appliedRevision, 4);
    const transitionedSnapshot = transitioned.snapshot as { players: Array<{
      playerId: string;
      position: unknown;
    }> };
    assert.deepEqual(
      transitionedSnapshot.players.find(({ playerId }) => playerId === "alice")?.position,
      transitionMovement.arrival,
    );
    alice.socket.send(JSON.stringify({
      command: transitionMovement,
      requestId: requestId(11),
      type: "command",
    }));
    const transitionReplay = await alice.next((message) => message.type === "command-accepted"
      && message.requestId === requestId(11));
    assert.equal(transitionReplay.replayed, true);
    assert.equal(transitionReplay.appliedRevision, 4);

    alice.socket.send(JSON.stringify({ requestId: requestId(7), type: "request-snapshot" }));
    const requested = await alice.next((message) => message.type === "snapshot-response"
      && message.requestId === requestId(7));
    assert.equal(snapshotRevision(requested), 4);

    const carol = await connect("carol");
    carol.socket.send(JSON.stringify({ requestId: requestId(8), sessionId: SESSION_ID, type: "attach" }));
    const blockedAttach = await carol.next((message) => message.type === "error"
      && message.requestId === requestId(8));
    assert.equal(blockedAttach.code, "player-not-found");

    const bobClosed = once(bob.socket, "close");
    bob.socket.close(1000);
    await bobClosed;
    const away = await alice.next((message) => message.type === "snapshot"
      && snapshotRevision(message) === 5);
    const awaySnapshot = away.snapshot as { players: Array<{ playerId: string; state: string }> };
    assert.equal(awaySnapshot.players.find(({ playerId }) => playerId === "bob")?.state, "away");

    const reconnectedBob = await connect("bob");
    reconnectedBob.socket.send(JSON.stringify({
      requestId: requestId(9),
      sessionId: SESSION_ID,
      type: "attach",
    }));
    const reattached = await reconnectedBob.next((message) => message.type === "attached"
      && message.requestId === requestId(9));
    assert.equal(snapshotRevision(reattached), 6);
    const reattachedPlayers = (reattached.snapshot as { players: Array<{
      playerId: string;
      position: unknown;
    }> }).players;
    assert.deepEqual(
      reattachedPlayers.find(({ playerId }) => playerId === "alice")?.position,
      transitionMovement.arrival,
    );
    assert.deepEqual(
      reattachedPlayers.find(({ playerId }) => playerId === "bob")?.position,
      bobMovement.to,
    );

    const temporaryVariableEvent = {
      commandId: "shared-event:temporary-variable",
      counters: [
        { expectedValue: 0, id: "field.progression-revision", value: 1 },
        { expectedValue: null, id: "field.variable.4000", value: 1 },
      ],
      eventId: "field-event.1.IPKE.7.3.2.o.7.2be",
      expectedRevision: 6,
      kind: "shared-event",
      milestoneIds: [],
      protocolVersion: 2,
    } as const;
    alice.socket.send(JSON.stringify({
      command: temporaryVariableEvent,
      requestId: requestId(21),
      type: "command",
    }));
    const temporaryVariableAdmission = await alice.next((message) =>
      message.type === "admission-request" && message.playerId === "alice");
    assert.deepEqual(temporaryVariableAdmission.command, temporaryVariableEvent);
    reconnectedBob.socket.send(JSON.stringify({
      admissionId: temporaryVariableAdmission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    assert.equal((await reconnectedBob.next((message) => message.type === "error"
      && message.code === "forbidden")).code, "forbidden");
    alice.socket.send(JSON.stringify({ requestId: requestId(22), type: "request-snapshot" }));
    assert.equal(snapshotRevision(await alice.next((message) => message.type === "snapshot-response"
      && message.requestId === requestId(22))), 6);
    alice.socket.send(JSON.stringify({
      admissionId: temporaryVariableAdmission.admissionId,
      decision: { arrival: transitionMovement.arrival, kind: "accept" },
      type: "admission-response",
    }));
    const crossedEventAcceptance = await alice.next((message) => message.type === "error"
      && message.requestId === requestId(21));
    assert.equal(crossedEventAcceptance.code, "admission-decision-mismatch");
    alice.socket.send(JSON.stringify({ requestId: requestId(23), type: "request-snapshot" }));
    assert.equal(snapshotRevision(await alice.next((message) => message.type === "snapshot-response"
      && message.requestId === requestId(23))), 6);
    alice.socket.send(JSON.stringify({
      command: temporaryVariableEvent,
      requestId: requestId(24),
      type: "command",
    }));
    const policyAdmission = await alice.next((message) =>
      message.type === "admission-request" && message.playerId === "alice");
    alice.socket.send(JSON.stringify({
      admissionId: policyAdmission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    const rejectedFieldEvent = await alice.next((message) => message.type === "error"
      && message.requestId === requestId(24));
    assert.equal(rejectedFieldEvent.code, "port-rejected");
    assert.equal(rejectedFieldEvent.message, "Temporary field variables cannot be shared");
    alice.socket.send(JSON.stringify({ requestId: requestId(25), type: "request-snapshot" }));
    assert.equal(snapshotRevision(await alice.next((message) => message.type === "snapshot-response"
      && message.requestId === requestId(25))), 6);

    const campaignEvent = {
      commandId: "shared-event:zephyr",
      counters: [
        { expectedValue: 0, id: "field.progression-revision", value: 1 },
        { expectedValue: null, id: "field.variable.1234", value: 27 },
      ],
      eventId: "field-event.1.IPKE.7.3.2.o.7.2bf",
      expectedRevision: 6,
      kind: "shared-event",
      milestoneIds: ["field.flag.0010"],
      protocolVersion: 2,
    } as const;
    alice.socket.send(JSON.stringify({
      command: campaignEvent,
      requestId: requestId(16),
      type: "command",
    }));
    const eventAdmission = await alice.next((message) =>
      message.type === "admission-request" && message.playerId === "alice");
    assert.deepEqual(eventAdmission.command, campaignEvent);
    reconnectedBob.socket.send(JSON.stringify({
      command: {
        ...campaignEvent,
        commandId: "shared-event:parallel",
        eventId: "field-event.1.IPKE.7.3.1.o.9.2c0",
      },
      requestId: requestId(27),
      type: "command",
    }));
    const lockedEvent = await reconnectedBob.next((message) => message.type === "error"
      && message.requestId === requestId(27));
    assert.equal(lockedEvent.code, "session-mutation-in-progress");
    alice.socket.send(JSON.stringify({
      admissionId: eventAdmission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    const eventAccepted = await alice.next((message) => message.type === "command-accepted"
      && message.requestId === requestId(16));
    assert.equal(eventAccepted.appliedRevision, 7);
    alice.socket.send(JSON.stringify({
      admissionId: eventAdmission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    assert.equal((await alice.next((message) => message.type === "error"
      && message.code === "admission-not-found")).code, "admission-not-found");
    const eventSnapshot = eventAccepted.snapshot as {
      pendingEvents: Array<{ eventId: string; eventRevision: number; pendingPlayerIds: string[] }>;
      sharedProgression: { counters: unknown[]; milestoneIds: string[] };
    };
    assert.deepEqual(eventSnapshot.pendingEvents, [{
      eventId: campaignEvent.eventId,
      eventRevision: 7,
      pendingPlayerIds: ["alice", "bob"],
    }]);
    assert.deepEqual(eventSnapshot.sharedProgression, {
      counters: [
        { id: "field.progression-revision", value: 1 },
        { id: "field.variable.1234", value: 27 },
      ],
      milestoneIds: [
        "field.schema.v1",
        `field.branch.${"a".repeat(32)}`,
        campaignEvent.eventId,
        "field.flag.0010",
      ],
    });
    await reconnectedBob.next((message) => message.type === "snapshot"
      && snapshotRevision(message) === 7);

    const aliceEventAck = {
      commandId: "shared-event-ack:alice:zephyr",
      eventId: campaignEvent.eventId,
      eventRevision: 7,
      expectedRevision: 7,
      kind: "event-ack",
      protocolVersion: 2,
    } as const;
    alice.socket.send(JSON.stringify({
      command: aliceEventAck,
      requestId: requestId(17),
      type: "command",
    }));
    const aliceEventAcknowledged = await alice.next((message) => message.type === "command-accepted"
      && message.requestId === requestId(17));
    assert.equal(aliceEventAcknowledged.appliedRevision, 8);
    assert.deepEqual((aliceEventAcknowledged.snapshot as {
      pendingEvents: Array<{ pendingPlayerIds: string[] }>;
    }).pendingEvents[0]?.pendingPlayerIds, ["bob"]);

    const bobEventAck = {
      ...aliceEventAck,
      commandId: "shared-event-ack:bob:zephyr",
      expectedRevision: 8,
    };
    reconnectedBob.socket.send(JSON.stringify({
      command: bobEventAck,
      requestId: requestId(18),
      type: "command",
    }));
    const bobEventAcknowledged = await reconnectedBob.next((message) => message.type === "command-accepted"
      && message.requestId === requestId(18));
    assert.equal(bobEventAcknowledged.appliedRevision, 9);
    assert.deepEqual((bobEventAcknowledged.snapshot as { pendingEvents: unknown[] }).pendingEvents, []);

    alice.socket.send(JSON.stringify({
      command: campaignEvent,
      requestId: requestId(19),
      type: "command",
    }));
    const replayedEvent = await alice.next((message) => message.type === "command-accepted"
      && message.requestId === requestId(19));
    assert.equal(replayedEvent.replayed, true);
    assert.equal(replayedEvent.appliedRevision, 7);
    alice.socket.send(JSON.stringify({
      command: {
        ...campaignEvent,
        commandId: "shared-event:zephyr:duplicate",
        counters: [],
        expectedRevision: 9,
        milestoneIds: [],
      },
      requestId: requestId(20),
      type: "command",
    }));
    const duplicateEvent = await alice.next((message) => message.type === "error"
      && message.requestId === requestId(20));
    assert.equal(duplicateEvent.code, "event-already-committed");

    const bobLeftResponse = await request(
      `/v1/shared-sessions/${SESSION_ID}/members/me`,
      "bob",
      { method: "DELETE" },
    );
    assert.equal(bobLeftResponse.status, 204);
    assert.equal(await bobLeftResponse.text(), "");
    assert.deepEqual(
      await reconnectedBob.next((message) => message.type === "session-ended"),
      { reason: "member-left", sessionId: SESSION_ID, type: "session-ended" },
    );
    const ownerOnly = await alice.next((message) => message.type === "snapshot"
      && snapshotRevision(message) === 10);
    assert.equal((ownerOnly.snapshot as { players: unknown[] }).players.length, 1);

    const rejoinRequest = request(`/v1/shared-sessions/${SESSION_ID}/join`, "bob", {
      body: JSON.stringify({ compatibility, player: bobPlayer }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const rejoinAdmission = await alice.next((message) => message.type === "join-admission-request");
    alice.socket.send(JSON.stringify({
      admissionId: rejoinAdmission.admissionId,
      decision: { kind: "accept" },
      type: "admission-response",
    }));
    const rejoined = await rejoinRequest;
    assert.equal(rejoined.status, 200);
    assert.equal((await rejoined.json() as { snapshot: { revision: number } }).snapshot.revision, 11);
    reconnectedBob.socket.send(JSON.stringify({
      requestId: requestId(10),
      sessionId: SESSION_ID,
      type: "attach",
    }));
    assert.equal(snapshotRevision(await reconnectedBob.next((message) => message.type === "attached"
      && message.requestId === requestId(10))), 11);

    const interruptedEvent = {
      commandId: "shared-event:owner-disconnect",
      counters: [{ expectedValue: 1, id: "field.progression-revision", value: 2 }],
      eventId: "field-event.1.IPKE.7.3.1.o.9.2c0",
      expectedRevision: 11,
      kind: "shared-event",
      milestoneIds: [],
      protocolVersion: 2,
    } as const;
    reconnectedBob.socket.send(JSON.stringify({
      command: interruptedEvent,
      requestId: requestId(28),
      type: "command",
    }));
    const interruptedAdmission = await alice.next((message) =>
      message.type === "admission-request" && message.playerId === "bob");
    assert.deepEqual(interruptedAdmission.command, interruptedEvent);
    const aliceClosed = once(alice.socket, "close");
    alice.socket.close(1000);
    await aliceClosed;
    const verifierDisconnected = await reconnectedBob.next((message) => message.type === "error"
      && message.requestId === requestId(28));
    assert.equal(verifierDisconnected.code, "transition-unattested");
    const ownerAway = await reconnectedBob.next((message) => message.type === "snapshot"
      && snapshotRevision(message) === 12);
    assert.equal((ownerAway.snapshot as { sharedProgression: { milestoneIds: string[] } })
      .sharedProgression.milestoneIds.includes(interruptedEvent.eventId), false);

    reconnectedBob.socket.send(JSON.stringify({
      command: { ...interruptedEvent, expectedRevision: 12 },
      requestId: requestId(29),
      type: "command",
    }));
    const ownerUnavailable = await reconnectedBob.next((message) => message.type === "error"
      && message.requestId === requestId(29));
    assert.equal(ownerUnavailable.code, "transition-unattested");
    reconnectedBob.socket.send(JSON.stringify({ requestId: requestId(30), type: "request-snapshot" }));
    const afterUnavailableOwner = await reconnectedBob.next((message) =>
      message.type === "snapshot-response" && message.requestId === requestId(30));
    assert.equal(snapshotRevision(afterUnavailableOwner), 12);
    assert.equal((afterUnavailableOwner.snapshot as {
      sharedProgression: { milestoneIds: string[] };
    }).sharedProgression.milestoneIds.includes(interruptedEvent.eventId), false);

    const ownerLeftResponse = await request(
      `/v1/shared-sessions/${SESSION_ID}/members/me`,
      "alice",
      { method: "DELETE" },
    );
    assert.equal(ownerLeftResponse.status, 204);
    assert.deepEqual(await reconnectedBob.next((message) => message.type === "session-ended"), {
      reason: "owner-left",
      sessionId: SESSION_ID,
      type: "session-ended",
    });
    assert.equal((await request(`/v1/shared-sessions/${SESSION_ID}`, "bob")).status, 404);
  });
});
