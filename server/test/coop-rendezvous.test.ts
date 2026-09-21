import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CoopRendezvousService,
  type CoopRendezvousServiceOptions,
} from "../src/domain/coop-rendezvous.js";
import { ServiceError } from "../src/errors.js";
import {
  MemoryCoopRendezvousStore,
  type StoredCoopRendezvousState,
} from "../src/persistence/coop-rendezvous-store.js";

const opaqueId = (seed: number): string => Buffer.alloc(16, seed).toString("base64url");

const options = (
  overrides: Partial<CoopRendezvousServiceOptions> = {},
): CoopRendezvousServiceOptions => ({
  activeTtlMs: 10_000,
  areFriends: (first, second) => [first, second].sort().join(":") === "alice:bob",
  maintenanceIntervalMs: 60_000,
  queueTtlMs: 1_000,
  readyTtlMs: 2_000,
  store: new MemoryCoopRendezvousStore(),
  ...overrides,
});

describe("Coop rendezvous service", () => {
  it("attests a friend invitation, keeps its host immutable and accepts idempotently", () => {
    let now = 1_000;
    const service = new CoopRendezvousService(options({
      idFactory: () => opaqueId(1),
      now: () => now,
    }));
    try {
      const offered = service.inviteFriend("alice", "bob");
      assert.deepEqual(offered, {
        current: {
          expiresAt: 3_000,
          mode: "friend",
          peerUserId: "bob",
          role: "host",
          sessionId: opaqueId(1),
          status: "offered",
        },
        invitations: [],
        protocolVersion: 1,
      });
      assert.deepEqual(service.inviteFriend("alice", "bob"), offered);
      assert.equal(service.hasCurrentEngagement("alice"), true);
      assert.equal(service.hasCurrentEngagement("bob"), false);
      assert.equal(service.hasPendingInvitation("bob", opaqueId(1)), true);
      assert.equal(service.hasPendingInvitation("alice", opaqueId(1)), false);
      assert.deepEqual(service.status("bob"), {
        current: { status: "idle" },
        invitations: [{
          expiresAt: 3_000,
          fromUserId: "alice",
          intent: "coop",
          sessionId: opaqueId(1),
        }],
        protocolVersion: 1,
      });
      assert.deepEqual(service.cancelCurrent("bob").invitations, [{
        expiresAt: 3_000,
        fromUserId: "alice",
        intent: "coop",
        sessionId: opaqueId(1),
      }]);

      now = 1_200;
      const accepted = service.acceptInvitation("bob", opaqueId(1));
      assert.deepEqual(accepted.current, {
        expiresAt: 3_200,
        mode: "friend",
        peerUserId: "alice",
        role: "guest",
        sessionId: opaqueId(1),
        status: "ready",
      });
      assert.deepEqual(service.acceptInvitation("bob", opaqueId(1)), accepted);
      assert.equal(service.hasCurrentEngagement("alice"), true);
      assert.equal(service.hasCurrentEngagement("bob"), true);
      assert.equal(service.hasPendingInvitation("bob", opaqueId(1)), false);
      assert.deepEqual(service.authorizeHost(opaqueId(1), "alice", "bob"), {
        guestUserId: "bob",
        hostUserId: "alice",
        mode: "friend",
        sessionId: opaqueId(1),
        status: "ready",
      });
      assert.deepEqual(service.authorizeGuest(opaqueId(1), "bob", "alice"), {
        guestUserId: "bob",
        hostUserId: "alice",
        mode: "friend",
        sessionId: opaqueId(1),
        status: "ready",
      });
      assert.equal(service.authorizeGuest(opaqueId(1), "alice", "bob"), null);
      assert.equal(service.authorizeHost(opaqueId(1), "bob", "alice"), null);

      service.markActive(opaqueId(1), "alice", "bob");
      assert.equal(service.status("alice").current.status, "active");
      assert.equal(service.status("bob").current.status, "active");
      service.markActive(opaqueId(1), "alice", "bob");
    } finally {
      service.shutdown();
    }
  });

  it("pairs the durable random queue and selects the canonical host", () => {
    let now = 5_000;
    const store = new MemoryCoopRendezvousStore();
    let serial = 1;
    const firstService = new CoopRendezvousService(options({
      idFactory: () => opaqueId(serial++),
      now: () => now,
      store,
    }));
    assert.equal(firstService.joinRandom("zoe").current.status, "queued");
    firstService.shutdown();

    now = 5_100;
    const restarted = new CoopRendezvousService(options({
      idFactory: () => opaqueId(serial++),
      now: () => now,
      store,
    }));
    try {
      const amy = restarted.joinRandom("amy");
      assert.deepEqual(amy.current, {
        expiresAt: 7_100,
        mode: "random",
        peerUserId: "zoe",
        role: "host",
        sessionId: opaqueId(1),
        status: "ready",
      });
      assert.deepEqual(restarted.status("zoe").current, {
        ...amy.current,
        peerUserId: "amy",
        role: "guest",
      });
      assert.deepEqual(restarted.joinRandom("amy"), amy);
    } finally {
      restarted.shutdown();
    }
  });

  it("allows only one engagement per account under competing invitations", () => {
    let serial = 10;
    const service = new CoopRendezvousService(options({
      areFriends: () => true,
      idFactory: () => opaqueId(serial++),
    }));
    try {
      service.inviteFriend("alice", "guest");
      assert.throws(
        () => service.inviteFriend("carol", "guest"),
        (error: unknown) => error instanceof ServiceError
          && error.status === 409
          && error.code === "CONFLICT",
      );
      assert.throws(
        () => service.joinRandom("guest"),
        (error: unknown) => error instanceof ServiceError && error.status === 409,
      );
      assert.throws(
        () => service.inviteFriend("alice", "carol"),
        (error: unknown) => error instanceof ServiceError && error.status === 409,
      );
      assert.equal(service.status("guest").invitations[0]?.fromUserId, "alice");
    } finally {
      service.shutdown();
    }
  });

  it("checks friendship, participant identity and invitation stage", () => {
    const service = new CoopRendezvousService(options({ idFactory: () => opaqueId(20) }));
    try {
      assert.throws(
        () => service.inviteFriend("alice", "carol"),
        (error: unknown) => error instanceof ServiceError && error.status === 403,
      );
      service.inviteFriend("alice", "bob");
      assert.throws(
        () => service.acceptInvitation("carol", opaqueId(20)),
        (error: unknown) => error instanceof ServiceError && error.status === 404,
      );
      service.acceptInvitation("bob", opaqueId(20));
      assert.throws(
        () => service.cancelInvitation("alice", opaqueId(20)),
        (error: unknown) => error instanceof ServiceError && error.status === 409,
      );
      assert.deepEqual(service.cancelCurrent("bob"), {
        current: { status: "idle" },
        invitations: [],
        protocolVersion: 1,
      });
      assert.deepEqual(service.status("alice").current, { status: "idle" });
      assert.deepEqual(service.cancelCurrent("bob").current, { status: "idle" });
    } finally {
      service.shutdown();
    }
  });

  it("expires offers and active leases at their exact deadlines", () => {
    let now = 100;
    let serial = 30;
    const service = new CoopRendezvousService(options({
      activeTtlMs: 500,
      idFactory: () => opaqueId(serial++),
      now: () => now,
      readyTtlMs: 200,
    }));
    try {
      service.inviteFriend("alice", "bob");
      now = 300;
      assert.deepEqual(service.status("alice").current, { status: "idle" });

      now = 400;
      service.inviteFriend("alice", "bob");
      service.acceptInvitation("bob", opaqueId(31));
      service.markActive(opaqueId(31), "alice", "bob");
      now = 899;
      assert.equal(service.authorizeHost(opaqueId(31), "alice", "bob")?.status, "active");
      now = 900;
      assert.equal(service.authorizeHost(opaqueId(31), "alice", "bob"), null);
      assert.deepEqual(service.status("bob").current, { status: "idle" });
    } finally {
      service.shutdown();
    }
  });

  it("renews an active lease near half-life without persisting every status poll", () => {
    class CountingStore extends MemoryCoopRendezvousStore {
      saves = 0;

      override save(state: StoredCoopRendezvousState): void {
        super.save(state);
        this.saves += 1;
      }
    }

    let now = 100;
    const store = new CountingStore();
    const service = new CoopRendezvousService(options({
      activeTtlMs: 1_000,
      idFactory: () => opaqueId(40),
      now: () => now,
      store,
    }));
    service.inviteFriend("alice", "bob");
    service.acceptInvitation("bob", opaqueId(40));
    service.markActive(opaqueId(40), "alice", "bob");
    const writesAfterActivation = store.saves;

    now = 599;
    assert.equal(service.status("alice").current.status, "active");
    service.markActive(opaqueId(40), "alice", "bob");
    assert.equal(store.saves, writesAfterActivation);

    now = 600;
    const renewed = service.status("bob").current;
    assert.equal(renewed.status, "active");
    assert.equal(renewed.expiresAt, 1_600);
    assert.equal(store.saves, writesAfterActivation + 1);
    service.status("alice");
    service.markActive(opaqueId(40), "alice", "bob");
    assert.equal(store.saves, writesAfterActivation + 1);
    service.shutdown();

    now = 1_101;
    const restarted = new CoopRendezvousService(options({
      activeTtlMs: 1_000,
      idFactory: () => opaqueId(41),
      now: () => now,
      store,
    }));
    try {
      assert.equal(
        restarted.authorizeGuest(opaqueId(40), "bob", "alice")?.status,
        "active",
      );
    } finally {
      restarted.shutdown();
    }
  });

  it("does not publish an in-memory mutation when persistence fails", () => {
    class FailingStore extends MemoryCoopRendezvousStore {
      override save(_state: StoredCoopRendezvousState): void {
        throw new Error("disk unavailable");
      }
    }
    const service = new CoopRendezvousService(options({ store: new FailingStore() }));
    try {
      assert.throws(() => service.joinRandom("alice"), /disk unavailable/);
      assert.deepEqual(service.status("alice").current, { status: "idle" });
    } finally {
      service.shutdown();
    }
  });
});
