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
import {
  MAX_CONCURRENT_OBJECT_REQUESTS_PER_USER,
  OPAQUE_OBJECT_MEDIA_TYPE,
  type OpaqueObjectStore,
} from "../src/domain/opaque-objects.js";
import { MemoryFriendStore } from "../src/persistence/friend-store.js";
import { MemorySharedSessionStore } from "../src/persistence/shared-session-store.js";

const ORIGIN = "https://client.example";
const OBJECT_ID = Buffer.alloc(16, 11).toString("base64url");
const opaqueSignalId = (seed: number): string => Buffer.alloc(16, seed).toString("base64url");
const SIGNAL_NEGOTIATION_ID = opaqueSignalId(21);
const SIGNAL_REQUEST_ID = opaqueSignalId(22);
const BLOCKED_NEGOTIATION_ID = opaqueSignalId(23);
const BLOCKED_REQUEST_ID = opaqueSignalId(24);
const REPLAY_FOLLOWUP_REQUEST_ID = opaqueSignalId(25);
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
const TOKENS = {
  alice: "alice-token-with-high-entropy-in-production",
  bob: "bob-token-with-high-entropy-in-production",
  carol: "carol-token-with-high-entropy-in-production",
} as const;
const TEST_SCRYPT = {
  blockSize: 8,
  cost: 2 ** 10,
  keyLength: 32,
  maxmem: 8 * 1024 * 1024,
  parallelization: 1,
} as const;

interface JsonSocket {
  readonly socket: WebSocket;
  next(predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
}

const wrapSocket = (socket: WebSocket): JsonSocket => {
  const buffered: Record<string, unknown>[] = [];
  const waiting: {
    predicate: (message: Record<string, unknown>) => boolean;
    resolve: (message: Record<string, unknown>) => void;
  }[] = [];
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
      if (index !== -1) {
        return Promise.resolve(buffered.splice(index, 1)[0] as Record<string, unknown>);
      }
      return new Promise((resolve) => waiting.push({ predicate, resolve }));
    },
  };
};

describe("HTTP and WebSocket application", () => {
  let application: ServerApplication;
  let baseUrl: string;
  let objectStoreDirectory: string;
  const openSockets: WebSocket[] = [];

  const request = (path: string, token?: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Origin: ORIGIN,
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
        ...init.headers,
      },
    });

  const connectFromOrigin = async (
    userId: keyof typeof TOKENS,
    origin: string,
  ): Promise<JsonSocket> => {
    const ticketResponse = await fetch(`${baseUrl}/v1/realtime-ticket`, {
      headers: { Authorization: `Bearer ${TOKENS[userId]}`, Origin: origin },
      method: "POST",
    });
    assert.equal(ticketResponse.status, 201);
    const ticketBody = (await ticketResponse.json()) as { ticket: string };
    const socket = new WebSocket(
      `${baseUrl.replace("http://", "ws://")}/v1/realtime?ticket=${encodeURIComponent(ticketBody.ticket)}`,
      "social-signaling.v1",
      { origin },
    );
    openSockets.push(socket);
    const wrapped = wrapSocket(socket);
    await once(socket, "open");
    const ready = await wrapped.next((message) => message.type === "ready");
    assert.equal(ready.userId, userId);
    return wrapped;
  };

  const connect = (userId: keyof typeof TOKENS): Promise<JsonSocket> =>
    connectFromOrigin(userId, ORIGIN);

  before(async () => {
    objectStoreDirectory = await mkdtemp(join(tmpdir(), "generic-object-api-test-"));
    const config: ServerConfig = {
      accountEntitlementPolicy: "open",
      accountSessionTtlMs: 86_400_000,
      accountStorePath: "unused-accounts.json",
      allowLegacyCoopBootstrap: true,
      allowLoopbackOrigins: true,
      allowedOrigins: new Set([ORIGIN]),
      authTokenHashes: new Map(
        Object.entries(TOKENS).map(([userId, token]) => [userId, sha256Token(token)]),
      ),
      coopRendezvousStorePath: join(objectStoreDirectory, "coop-rendezvous.json"),
      coopRendezvousTtlMs: 120_000,
      friendStorePath: "unused-in-memory.json",
      host: "127.0.0.1",
      lanDevelopmentMode: true,
      matchmakingAuthorizationTtlMs: 120_000,
      matchmakingQueueTtlMs: 120_000,
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
    for (const socket of openSockets) {
      socket.close();
    }
    await application.close();
    await rm(objectStoreDirectory, { force: true, recursive: true });
  });

  it("exposes health and rejects unauthenticated or disallowed browser requests", async () => {
    const health = await request("/healthz");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const unauthorized = await request("/v1/me");
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), 'Bearer realm="social-signaling"');

    const forbidden = await fetch(`${baseUrl}/v1/me`, {
      headers: { Authorization: `Bearer ${TOKENS.alice}`, Origin: "https://attacker.example" },
    });
    assert.equal(forbidden.status, 403);
  });

  it("applies the development-origin policy to HTTP, preflight and WebSocket", async () => {
    for (const origin of [
      "http://localhost:5173",
      "http://127.0.0.1:4173",
      "http://[::1]:61234",
      "http://192.168.1.42:5173",
      "https://10.0.0.8:5173",
      "https://[fd12:3456::8]:5173",
      "https://pokemaster-studio.local:5174",
    ]) {
      const preflight = await fetch(`${baseUrl}/v1/realtime-ticket`, {
        headers: {
          Origin: origin,
          "Access-Control-Request-Headers": "authorization",
          "Access-Control-Request-Method": "POST",
        },
        method: "OPTIONS",
      });
      assert.equal(preflight.status, 204, origin);
      assert.equal(preflight.headers.get("access-control-allow-origin"), origin);

      const identity = await fetch(`${baseUrl}/v1/me`, {
        headers: { Authorization: `Bearer ${TOKENS.alice}`, Origin: origin },
      });
      assert.equal(identity.status, 200, origin);
      assert.equal(identity.headers.get("access-control-allow-origin"), origin);

      const realtime = await connectFromOrigin("alice", origin);
      assert.equal(realtime.socket.readyState, WebSocket.OPEN, origin);
      const closed = once(realtime.socket, "close");
      realtime.socket.close(1000);
      await closed;
    }
  });

  it("allows browser preflights for engagement leases and shared attachments", async () => {
    for (const { headers, path } of [
      {
        headers: ["authorization", "engagement-lease"],
        path: "/v1/matchmaking",
      },
      {
        headers: ["authorization", "shared-attachment"],
        path: "/v1/shared-sessions/test-session/members/me",
      },
    ]) {
      const preflight = await fetch(`${baseUrl}${path}`, {
        headers: {
          Origin: ORIGIN,
          "Access-Control-Request-Headers": headers.join(", "),
          "Access-Control-Request-Method": "DELETE",
        },
        method: "OPTIONS",
      });

      assert.equal(preflight.status, 204, path);
      assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN, path);
      assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /\bDELETE\b/, path);
      const allowedHeaders = new Set(
        (preflight.headers.get("access-control-allow-headers") ?? "")
          .split(",")
          .map((header) => header.trim().toLowerCase()),
      );
      for (const header of headers) {
        assert.equal(allowedHeaders.has(header), true, `${path}: ${header}`);
      }
    }
  });

  it("does not expose the retired test-device token enrollment route", async () => {
    const enrolled = await request("/v1/test-device-enrollments", undefined, {
      body: JSON.stringify({ code: "a" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    assert.equal(enrolled.status, 404);
    assert.equal(enrolled.headers.get("cache-control"), "no-store");
    assert.equal(enrolled.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(JSON.stringify(await enrolled.json()).includes("accessToken"), false);
  });

  it("manages friendship and relays signaling only between online friends", async () => {
    const createRequest = await request("/v1/friend-requests", TOKENS.alice, {
      body: JSON.stringify({ userId: "bob" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(createRequest.status, 201);

    const incoming = await request("/v1/social", TOKENS.bob);
    assert.deepEqual(await incoming.json(), { friends: [], incoming: ["alice"], outgoing: [] });

    const accepted = await request("/v1/friend-requests/alice/accept", TOKENS.bob, { method: "POST" });
    assert.equal(accepted.status, 200);

    const alice = await connect("alice");
    const bob = await connect("bob");
    assert.deepEqual(
      await alice.next((message) => message.type === "presence" && message.userId === "bob"),
      { online: true, type: "presence", userId: "bob" },
    );

    alice.socket.send(
      JSON.stringify({
        negotiationId: SIGNAL_NEGOTIATION_ID,
        payload: { sdp: VALID_SDP, type: "offer" },
        requestId: SIGNAL_REQUEST_ID,
        to: "bob",
        type: "signal",
      }),
    );
    assert.deepEqual(await bob.next((message) => message.type === "signal"), {
      from: "alice",
      negotiationId: SIGNAL_NEGOTIATION_ID,
      payload: { sdp: VALID_SDP, type: "offer" },
      requestId: SIGNAL_REQUEST_ID,
      type: "signal",
    });
    assert.deepEqual(await alice.next((message) => message.type === "signal-accepted"), {
      requestId: SIGNAL_REQUEST_ID,
      type: "signal-accepted",
    });

    alice.socket.send(
      JSON.stringify({
        negotiationId: SIGNAL_NEGOTIATION_ID,
        payload: { sdp: VALID_SDP, type: "offer" },
        requestId: SIGNAL_REQUEST_ID,
        to: "bob",
        type: "signal",
      }),
    );
    assert.deepEqual(await alice.next((message) => message.requestId === SIGNAL_REQUEST_ID), {
      code: "CONFLICT",
      message: "requestId was already accepted",
      requestId: SIGNAL_REQUEST_ID,
      type: "error",
    });

    alice.socket.send(
      JSON.stringify({
        negotiationId: SIGNAL_NEGOTIATION_ID,
        payload: { type: "hangup" },
        requestId: REPLAY_FOLLOWUP_REQUEST_ID,
        to: "bob",
        type: "signal",
      }),
    );
    assert.deepEqual(await bob.next((message) => message.type === "signal"), {
      from: "alice",
      negotiationId: SIGNAL_NEGOTIATION_ID,
      payload: { type: "hangup" },
      requestId: REPLAY_FOLLOWUP_REQUEST_ID,
      type: "signal",
    });
    assert.deepEqual(await alice.next((message) => message.requestId === REPLAY_FOLLOWUP_REQUEST_ID), {
      requestId: REPLAY_FOLLOWUP_REQUEST_ID,
      type: "signal-accepted",
    });

    const carol = await connect("carol");
    carol.socket.send(
      JSON.stringify({
        negotiationId: BLOCKED_NEGOTIATION_ID,
        payload: { type: "hangup" },
        requestId: BLOCKED_REQUEST_ID,
        to: "alice",
        type: "signal",
      }),
    );
    const blocked = await carol.next((message) => message.type === "error");
    assert.equal(blocked.code, "FORBIDDEN");
    assert.equal(blocked.requestId, BLOCKED_REQUEST_ID);

  });

  it("strictly rejects unsupported HTTP fields", async () => {
    const response = await request("/v1/friend-requests", TOKENS.alice, {
      body: JSON.stringify({ note: "not accepted", userId: "bob" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "BAD_REQUEST");
  });

  it("stores only conditional opaque envelopes isolated by identity", async () => {
    const envelope = {
      algorithm: "A256GCM",
      ciphertext: Buffer.alloc(32, 7).toString("base64url"),
      iv: Buffer.alloc(12, 3).toString("base64url"),
      version: 1,
    };
    assert.equal((await request("/v1/objects/primary", TOKENS.alice)).status, 400);
    const missingCondition = await request(`/v1/objects/${OBJECT_ID}`, TOKENS.alice, {
      body: JSON.stringify(envelope),
      headers: { "Content-Type": OPAQUE_OBJECT_MEDIA_TYPE },
      method: "PUT",
    });
    assert.equal(missingCondition.status, 428);

    const unsupportedMedia = await request(`/v1/objects/${OBJECT_ID}`, TOKENS.alice, {
      body: JSON.stringify(envelope),
      headers: { "Content-Type": "application/json", "If-None-Match": "*" },
      method: "PUT",
    });
    assert.equal(unsupportedMedia.status, 415);

    const oversizedBody = await request(`/v1/objects/${OBJECT_ID}`, TOKENS.alice, {
      body: "x".repeat(1536 * 1024 + 1),
      headers: { "Content-Type": OPAQUE_OBJECT_MEDIA_TYPE, "If-None-Match": "*" },
      method: "PUT",
    });
    assert.equal(oversizedBody.status, 413);

    const unsupportedField = await request(`/v1/objects/${OBJECT_ID}`, TOKENS.alice, {
      body: JSON.stringify({ ...envelope, label: "free-form data is forbidden" }),
      headers: { "Content-Type": OPAQUE_OBJECT_MEDIA_TYPE, "If-None-Match": "*" },
      method: "PUT",
    });
    assert.equal(unsupportedField.status, 400);

    const created = await request(`/v1/objects/${OBJECT_ID}`, TOKENS.alice, {
      body: JSON.stringify(envelope),
      headers: { "Content-Type": OPAQUE_OBJECT_MEDIA_TYPE, "If-None-Match": "*" },
      method: "PUT",
    });
    assert.equal(created.status, 201);
    const firstEtag = created.headers.get("etag");
    const firstMutation = created.headers.get("opaque-mutation");
    assert.match(firstEtag ?? "", /^"r-[a-f0-9]{32}"$/);
    assert.match(firstMutation ?? "", /^m-[a-f0-9]{32}$/);
    assert.equal(
      created.headers.get("access-control-expose-headers"),
      "ETag, Opaque-Mutation, Engagement-Lease, Shared-Attachment",
    );

    const isolated = await request(`/v1/objects/${OBJECT_ID}`, TOKENS.bob);
    assert.equal(isolated.status, 404);

    const fetched = await request(`/v1/objects/${OBJECT_ID}`, TOKENS.alice);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers.get("content-type"), OPAQUE_OBJECT_MEDIA_TYPE);
    assert.equal(fetched.headers.get("etag"), firstEtag);
    assert.equal(fetched.headers.get("opaque-mutation"), firstMutation);
    assert.deepEqual(await fetched.json(), envelope);

    const staleUpdate = await request(`/v1/objects/${OBJECT_ID}`, TOKENS.alice, {
      body: JSON.stringify(envelope),
      headers: {
        "Content-Type": OPAQUE_OBJECT_MEDIA_TYPE,
        "If-Match": '"r-00000000000000000000000000000000"',
      },
      method: "PUT",
    });
    assert.equal(staleUpdate.status, 412);

    const updatedEnvelope = {
      ...envelope,
      ciphertext: Buffer.alloc(48, 9).toString("base64url"),
    };
    const updated = await request(`/v1/objects/${OBJECT_ID}`, TOKENS.alice, {
      body: JSON.stringify(updatedEnvelope),
      headers: { "Content-Type": OPAQUE_OBJECT_MEDIA_TYPE, "If-Match": firstEtag ?? "" },
      method: "PUT",
    });
    assert.equal(updated.status, 204);
    const secondEtag = updated.headers.get("etag");
    const secondMutation = updated.headers.get("opaque-mutation");
    assert.match(secondEtag ?? "", /^"r-[a-f0-9]{32}"$/);
    assert.match(secondMutation ?? "", /^m-[a-f0-9]{32}$/);
    assert.notEqual(secondEtag, firstEtag);
    assert.ok(
      BigInt(`0x${secondMutation?.slice(2) ?? "0"}`)
      > BigInt(`0x${firstMutation?.slice(2) ?? "0"}`),
    );

    const staleDelete = await request(`/v1/objects/${OBJECT_ID}`, TOKENS.alice, {
      headers: { "If-Match": firstEtag ?? "" },
      method: "DELETE",
    });
    assert.equal(staleDelete.status, 412);

    const deleted = await request(`/v1/objects/${OBJECT_ID}`, TOKENS.alice, {
      headers: { "If-Match": secondEtag ?? "" },
      method: "DELETE",
    });
    assert.equal(deleted.status, 204);
    assert.equal((await request(`/v1/objects/${OBJECT_ID}`, TOKENS.alice)).status, 404);
  });

  it("bounds concurrent object requests per identity and releases capacity in finally", async () => {
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let announceCapacityReached: () => void = () => undefined;
    const capacityReached = new Promise<void>((resolve) => {
      announceCapacityReached = resolve;
    });
    let entered = 0;
    const blockingStore: OpaqueObjectStore = {
      async delete() {
        throw new Error("Unexpected delete");
      },
      async get() {
        entered += 1;
        if (entered === MAX_CONCURRENT_OBJECT_REQUESTS_PER_USER) announceCapacityReached();
        await gate;
        return null;
      },
      async put() {
        throw new Error("Unexpected put");
      },
    };
    const limitedConfig: ServerConfig = {
      accountEntitlementPolicy: "open",
      accountSessionTtlMs: 86_400_000,
      accountStorePath: "unused-limited-accounts.json",
      allowLegacyCoopBootstrap: false,
      allowLoopbackOrigins: false,
      allowedOrigins: new Set([ORIGIN]),
      authTokenHashes: new Map(
        Object.entries(TOKENS).map(([userId, token]) => [userId, sha256Token(token)]),
      ),
      coopRendezvousStorePath: "unused-concurrency-coop-rendezvous.json",
      coopRendezvousTtlMs: 120_000,
      friendStorePath: "unused-concurrency-test.json",
      host: "127.0.0.1",
      lanDevelopmentMode: false,
      matchmakingAuthorizationTtlMs: 120_000,
      matchmakingQueueTtlMs: 120_000,
      objectStorePath: "unused-concurrency-objects",
      port: 0,
      sharedSessionIdleTtlMs: 86_400_000,
      sharedSessionStorePath: "unused-concurrency-shared-sessions.json",
      ticketTtlMs: 30_000,
    };
    const limitedApplication = await createApplication(limitedConfig, {
      accountScryptParameters: TEST_SCRYPT,
      friendStore: new MemoryFriendStore(),
      objectStore: blockingStore,
      sharedSessionStore: new MemorySharedSessionStore(),
    });
    const address = await limitedApplication.listen();
    const limitedBaseUrl = `http://${address.host}:${address.port}`;
    const fetchObject = (): Promise<Response> => fetch(`${limitedBaseUrl}/v1/objects/${OBJECT_ID}`, {
      headers: { Authorization: `Bearer ${TOKENS.alice}`, Origin: ORIGIN },
    });

    try {
      const disabledEnrollment = await fetch(`${limitedBaseUrl}/v1/test-device-enrollments`, {
        body: JSON.stringify({ code: "A" }),
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        method: "POST",
      });
      assert.equal(disabledEnrollment.status, 404);

      const active = Array.from(
        { length: MAX_CONCURRENT_OBJECT_REQUESTS_PER_USER },
        () => fetchObject(),
      );
      await capacityReached;

      const limited = await fetchObject();
      assert.equal(limited.status, 429);
      const limitedBody = (await limited.json()) as { error: { code: string; message: string } };
      assert.deepEqual(limitedBody.error, {
        code: "RATE_LIMITED",
        message: "Object request concurrency exceeded",
      });

      releaseGate();
      assert.deepEqual(await Promise.all(active).then((responses) => responses.map(({ status }) => status)), [404, 404, 404, 404]);
      assert.equal((await fetchObject()).status, 404);
    } finally {
      releaseGate();
      await limitedApplication.close();
    }
  });

  it("keeps signaling deterministic by replacing an older socket for the same identity", async () => {
    const first = await connect("alice");
    const firstClosed = once(first.socket, "close");
    const replacement = await connect("alice");
    const [closeCode] = await firstClosed;

    assert.equal(closeCode, 4000);
    assert.equal(replacement.socket.readyState, WebSocket.OPEN);
  });

  it("keeps the realtime quota across reconnects and closes on the first excess", async () => {
    const alice = await connect("alice");
    const closed = once(alice.socket, "close");
    for (let index = 0; index < 121; index += 1) {
      alice.socket.send(JSON.stringify({
        negotiationId: opaqueSignalId(index + 1),
        payload: { type: "hangup" },
        requestId: opaqueSignalId(index + 122),
        to: "bob",
        type: "signal",
      }));
    }
    const [closeCode] = await closed;

    assert.equal(closeCode, 1008);
  });

  it("removes the friendship after realtime checks", async () => {
    const removed = await request("/v1/friends/bob", TOKENS.alice, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const social = await request("/v1/social", TOKENS.alice);
    assert.deepEqual(await social.json(), { friends: [], incoming: [], outgoing: [] });
  });
});
