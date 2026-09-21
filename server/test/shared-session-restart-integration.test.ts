import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import WebSocket from "ws";
import { createApplication, type ServerApplication } from "../src/app.js";
import { sha256Token } from "../src/auth.js";
import type { ServerConfig } from "../src/config.js";
import { MemoryAccountStore } from "../src/persistence/account-store.js";
import { MemoryFriendStore } from "../src/persistence/friend-store.js";

const ORIGIN = "https://restart-client.example";
const SESSION_ID = Buffer.alloc(16, 72).toString("base64url");
const SECOND_SESSION_ID = Buffer.alloc(16, 73).toString("base64url");
const TOKENS = {
  alice: "alice-restart-token-with-production-entropy",
  bob: "bob-restart-token-with-production-entropy",
} as const;
const compatibility = { applicationId: "IPKE", locale: 3, release: 7 } as const;
const seededProgression = {
  counters: [{ id: "field.progression-revision", value: 0 }],
  milestoneIds: ["field.schema.v1", `field.branch.${"b".repeat(32)}`],
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
  readonly messages: readonly Record<string, unknown>[];
  readonly socket: WebSocket;
  next(predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
}

const wrapSocket = (socket: WebSocket): JsonSocket => {
  const messages: Record<string, unknown>[] = [];
  const waiting: Array<Readonly<{
    predicate: (message: Record<string, unknown>) => boolean;
    resolve: (message: Record<string, unknown>) => void;
  }>> = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
    messages.push(message);
    const waiterIndex = waiting.findIndex(({ predicate }) => predicate(message));
    if (waiterIndex !== -1) waiting.splice(waiterIndex, 1)[0]?.resolve(message);
  });
  return {
    messages,
    socket,
    next(predicate) {
      const existing = messages.find(predicate);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise((resolve) => waiting.push({ predicate, resolve }));
    },
  };
};

const revisionOf = (message: Record<string, unknown>): number | undefined => {
  const snapshot = message.snapshot;
  return snapshot !== null
    && typeof snapshot === "object"
    && "revision" in snapshot
    && typeof snapshot.revision === "number"
    ? snapshot.revision
    : undefined;
};

describe("graceful shared session server restart", () => {
  it("restores positions, seeded progression, pending acknowledgements, and command deduplication", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shared-session-restart-"));
    const accountStore = new MemoryAccountStore();
    const friendStore = new MemoryFriendStore();
    const config: ServerConfig = {
      accountEntitlementPolicy: "open",
      accountSessionTtlMs: 86_400_000,
      accountStorePath: "unused-restart-accounts.json",
      allowLegacyCoopBootstrap: true,
      allowLoopbackOrigins: false,
      allowedOrigins: new Set([ORIGIN]),
      authTokenHashes: new Map(
        Object.entries(TOKENS).map(([userId, token]) => [userId, sha256Token(token)]),
      ),
      coopRendezvousStorePath: join(directory, "coop-rendezvous.json"),
      coopRendezvousTtlMs: 120_000,
      friendStorePath: "unused-restart-friends.json",
      host: "127.0.0.1",
      lanDevelopmentMode: false,
      matchmakingAuthorizationTtlMs: 120_000,
      matchmakingQueueTtlMs: 120_000,
      objectStorePath: join(directory, "objects"),
      port: 0,
      sharedSessionIdleTtlMs: 86_400_000,
      sharedSessionStorePath: join(directory, "shared-sessions.json"),
      ticketTtlMs: 30_000,
    };
    let application: ServerApplication | undefined;
    let baseUrl = "";

    const start = async (): Promise<void> => {
      application = await createApplication(config, { accountStore, friendStore });
      const address = await application.listen();
      baseUrl = `http://${address.host}:${address.port}`;
    };
    const request = (
      path: string,
      user: keyof typeof TOKENS,
      init: RequestInit = {},
    ): Promise<Response> => fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKENS[user]}`,
        Origin: ORIGIN,
        ...init.headers,
      },
    });
    const connect = async (user: keyof typeof TOKENS): Promise<JsonSocket> => {
      const ticketResponse = await request("/v1/realtime-ticket", user, { method: "POST" });
      assert.equal(ticketResponse.status, 201);
      const { ticket } = await ticketResponse.json() as { ticket: string };
      const socket = new WebSocket(
        `${baseUrl.replace("http://", "ws://")}/v1/shared-sessions/realtime?ticket=${encodeURIComponent(ticket)}`,
        "authoritative-session.v1",
        { origin: ORIGIN },
      );
      const wrapped = wrapSocket(socket);
      await once(socket, "open");
      await wrapped.next((message) => message.type === "ready");
      return wrapped;
    };

    try {
      await start();
      assert.equal((await request("/v1/friend-requests", "alice", {
        body: JSON.stringify({ userId: "bob" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })).status, 201);
      assert.equal((await request("/v1/friend-requests/alice/accept", "bob", { method: "POST" })).status, 200);
      assert.equal((await request("/v1/shared-sessions", "alice", {
        body: JSON.stringify({
          compatibility,
          peerUserId: "bob",
          player: alicePlayer,
          sessionId: SESSION_ID,
          sharedProgression: seededProgression,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })).status, 201);

      const firstAlice = await connect("alice");
      firstAlice.socket.send(JSON.stringify({
        requestId: Buffer.alloc(16, 1).toString("base64url"),
        sessionId: SESSION_ID,
        type: "attach",
      }));
      await firstAlice.next((message) => message.type === "attached");
      const firstJoin = request(`/v1/shared-sessions/${SESSION_ID}/join`, "bob", {
        body: JSON.stringify({ compatibility, player: bobPlayer }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const joinAdmission = await firstAlice.next((message) =>
        message.type === "join-admission-request");
      firstAlice.socket.send(JSON.stringify({
        admissionId: joinAdmission.admissionId,
        decision: { kind: "accept" },
        type: "admission-response",
      }));
      assert.equal((await firstJoin).status, 200);

      const firstBob = await connect("bob");
      firstBob.socket.send(JSON.stringify({
        requestId: Buffer.alloc(16, 2).toString("base64url"),
        sessionId: SESSION_ID,
        type: "attach",
      }));
      await firstBob.next((message) => message.type === "attached");

      const firstMove = {
        commandId: "move:alice:1",
        expectedRevision: 1,
        from: alicePlayer.position,
        kind: "movement",
        mode: "walk",
        protocolVersion: 2,
        sequence: 1,
        to: { direction: "east", mapId: 1, x: 2, z: 1 },
      } as const;
      firstAlice.socket.send(JSON.stringify({
        command: firstMove,
        requestId: Buffer.alloc(16, 3).toString("base64url"),
        type: "command",
      }));
      const acknowledged = await firstAlice.next((message) => message.type === "command-accepted");
      assert.equal(acknowledged.appliedRevision, 2);

      const campaignEvent = {
        commandId: "shared-event:restart",
        counters: [
          { expectedValue: 0, id: "field.progression-revision", value: 1 },
          { expectedValue: null, id: "field.variable.1234", value: 27 },
        ],
        eventId: "field-event.1.IPKE.7.3.1.o.7.2bf",
        expectedRevision: 2,
        kind: "shared-event",
        milestoneIds: ["field.flag.0010"],
        protocolVersion: 2,
      } as const;
      firstAlice.socket.send(JSON.stringify({
        command: campaignEvent,
        requestId: Buffer.alloc(16, 7).toString("base64url"),
        type: "command",
      }));
      const eventAdmission = await firstAlice.next((message) =>
        message.type === "admission-request" && message.playerId === "alice");
      assert.deepEqual(eventAdmission.command, campaignEvent);
      firstAlice.socket.send(JSON.stringify({
        admissionId: eventAdmission.admissionId,
        decision: { kind: "accept" },
        type: "admission-response",
      }));
      const eventCommitted = await firstAlice.next((message) => message.type === "command-accepted"
        && message.requestId === Buffer.alloc(16, 7).toString("base64url"));
      assert.equal(eventCommitted.appliedRevision, 3);
      const aliceEventAck = {
        commandId: "shared-event-ack:alice:restart",
        eventId: campaignEvent.eventId,
        eventRevision: 3,
        expectedRevision: 3,
        kind: "event-ack",
        protocolVersion: 2,
      } as const;
      firstAlice.socket.send(JSON.stringify({
        command: aliceEventAck,
        requestId: Buffer.alloc(16, 8).toString("base64url"),
        type: "command",
      }));
      const eventAcknowledged = await firstAlice.next((message) => message.type === "command-accepted"
        && message.requestId === Buffer.alloc(16, 8).toString("base64url"));
      assert.equal(eventAcknowledged.appliedRevision, 4);
      assert.deepEqual((eventAcknowledged.snapshot as {
        pendingEvents: Array<{ pendingPlayerIds: string[] }>;
      }).pendingEvents[0]?.pendingPlayerIds, ["bob"]);

      const aliceClosed = once(firstAlice.socket, "close");
      const bobClosed = once(firstBob.socket, "close");
      let firstCloseSettled = false;
      const firstClose = application!.close().finally(() => {
        firstCloseSettled = true;
      });
      await application!.close();
      assert.equal(firstCloseSettled, true);
      await firstClose;
      application = undefined;
      const [[aliceCloseCode], [bobCloseCode]] = await Promise.all([aliceClosed, bobClosed]);
      assert.equal(aliceCloseCode, 1001);
      assert.equal(bobCloseCode, 1001);
      assert.equal(firstAlice.messages.some(({ type }) => type === "session-ended"), false);
      assert.equal(firstBob.messages.some(({ type }) => type === "session-ended"), false);

      await start();
      const duplicateAfterRestart = await request("/v1/shared-sessions", "alice", {
        body: JSON.stringify({
          compatibility,
          peerUserId: "bob",
          player: alicePlayer,
          sessionId: SECOND_SESSION_ID,
          sharedProgression: {
            counters: [
              { id: "field.progression-revision", value: 1 },
              { id: "field.variable.1234", value: 27 },
            ],
            milestoneIds: [
              "field.schema.v1",
              `field.branch.${"b".repeat(32)}`,
              campaignEvent.eventId,
              "field.flag.0010",
            ],
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      assert.equal(duplicateAfterRestart.status, 409);
      assert.equal((await duplicateAfterRestart.json() as {
        error: { code: string };
      }).error.code, "continuity-active");
      const restoredAlice = await connect("alice");
      const restoredBob = await connect("bob");
      restoredAlice.socket.send(JSON.stringify({
        requestId: Buffer.alloc(16, 4).toString("base64url"),
        sessionId: SESSION_ID,
        type: "attach",
      }));
      const aliceAttached = await restoredAlice.next((message) => message.type === "attached");
      restoredBob.socket.send(JSON.stringify({
        requestId: Buffer.alloc(16, 5).toString("base64url"),
        sessionId: SESSION_ID,
        type: "attach",
      }));
      const bobAttached = await restoredBob.next((message) => message.type === "attached");
      assert.equal(revisionOf(aliceAttached), 6);
      assert.equal(revisionOf(bobAttached), 7);
      const restoredPlayers = (bobAttached.snapshot as { players: Array<{
        playerId: string;
        position: unknown;
      }> }).players;
      assert.deepEqual(
        restoredPlayers.find(({ playerId }) => playerId === "alice")?.position,
        firstMove.to,
      );
      assert.deepEqual(
        restoredPlayers.find(({ playerId }) => playerId === "bob")?.position,
        bobPlayer.position,
      );
      const restoredCampaign = bobAttached.snapshot as {
        pendingEvents: Array<{
          eventId: string;
          eventRevision: number;
          pendingPlayerIds: string[];
        }>;
        sharedProgression: unknown;
      };
      assert.deepEqual(restoredCampaign.pendingEvents, [{
        eventId: campaignEvent.eventId,
        eventRevision: 3,
        pendingPlayerIds: ["bob"],
      }]);
      assert.deepEqual(restoredCampaign.sharedProgression, {
        counters: [
          { id: "field.progression-revision", value: 1 },
          { id: "field.variable.1234", value: 27 },
        ],
        milestoneIds: [
          "field.schema.v1",
          `field.branch.${"b".repeat(32)}`,
          campaignEvent.eventId,
          "field.flag.0010",
        ],
      });

      restoredAlice.socket.send(JSON.stringify({
        command: campaignEvent,
        requestId: Buffer.alloc(16, 9).toString("base64url"),
        type: "command",
      }));
      const replayedEvent = await restoredAlice.next((message) => message.type === "command-accepted"
        && message.requestId === Buffer.alloc(16, 9).toString("base64url"));
      assert.equal(replayedEvent.replayed, true);
      assert.equal(replayedEvent.appliedRevision, 3);

      restoredBob.socket.send(JSON.stringify({
        command: {
          ...aliceEventAck,
          commandId: "shared-event-ack:bob:restart",
          expectedRevision: 7,
        },
        requestId: Buffer.alloc(16, 10).toString("base64url"),
        type: "command",
      }));
      const completedEvent = await restoredBob.next((message) => message.type === "command-accepted"
        && message.requestId === Buffer.alloc(16, 10).toString("base64url"));
      assert.equal(completedEvent.appliedRevision, 8);
      assert.deepEqual((completedEvent.snapshot as { pendingEvents: unknown[] }).pendingEvents, []);

      restoredAlice.socket.send(JSON.stringify({
        command: {
          commandId: "move:alice:2",
          expectedRevision: 8,
          from: firstMove.to,
          kind: "movement",
          mode: "run",
          protocolVersion: 2,
          sequence: 2,
          to: { direction: "east", mapId: 1, x: 3, z: 1 },
        },
        requestId: Buffer.alloc(16, 6).toString("base64url"),
        type: "command",
      }));
      const continued = await restoredAlice.next((message) => message.type === "command-accepted"
        && message.requestId === Buffer.alloc(16, 6).toString("base64url"));
      assert.equal(continued.appliedRevision, 9);
      restoredAlice.socket.close();
      restoredBob.socket.close();

      await application!.close();
      application = undefined;
      const unopened = await createApplication(config, { accountStore, friendStore });
      await unopened.close();
      await assert.rejects(() => unopened.listen(), /current state/);
    } finally {
      await application?.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
