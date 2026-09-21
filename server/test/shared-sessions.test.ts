import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSharedEventCommand,
  parseSharedEventAcknowledgementCommand,
  parseSharedMovementCommand,
  SharedSessionService,
  type SharedEventCommand,
  type SharedEventAcknowledgementCommand,
  type SharedMovementCommand,
  type SharedPlayerProfile,
} from "../src/domain/shared-sessions.js";
import {
  MemorySharedSessionStore,
  type SharedSessionStore,
} from "../src/persistence/shared-session-store.js";

const sessionId = Buffer.alloc(16, 41).toString("base64url");
const compatibility = { applicationId: "FIELD", locale: 3, release: 7 } as const;
const alice: SharedPlayerProfile = {
  displayName: "ALICE",
  gender: "female",
  position: { direction: "south", mapId: 1, x: 1, z: 1 },
  spriteId: 97,
};
const bob: SharedPlayerProfile = {
  displayName: "BOB",
  gender: "male",
  position: { direction: "west", mapId: 1, x: 4, z: 1 },
  spriteId: 0,
};

const movement = (
  overrides: Partial<SharedMovementCommand> = {},
): SharedMovementCommand => ({
  commandId: "move:alice:1",
  expectedRevision: 1,
  from: alice.position,
  kind: "movement",
  mode: "walk",
  protocolVersion: 2,
  sequence: 1,
  to: { direction: "east", mapId: 1, x: 2, z: 1 },
  ...overrides,
});

const campaignEvent = (
  overrides: Partial<SharedEventCommand> = {},
): SharedEventCommand => ({
  commandId: "event:alice:1",
  counters: [{ expectedValue: null, id: "badges", value: 1 }],
  eventId: "story:zephyr-badge",
  expectedRevision: 1,
  kind: "shared-event",
  milestoneIds: ["story:zephyr-badge"],
  protocolVersion: 2,
  ...overrides,
});

const eventAcknowledgement = (
  overrides: Partial<SharedEventAcknowledgementCommand> = {},
): SharedEventAcknowledgementCommand => ({
  commandId: "event-ack:alice:1",
  eventId: "story:zephyr-badge",
  eventRevision: 2,
  expectedRevision: 2,
  kind: "event-ack",
  protocolVersion: 2,
  ...overrides,
});

const createJoinedService = (options: ConstructorParameters<typeof SharedSessionService>[0] = {}) => {
  const service = new SharedSessionService(options);
  assert.equal(service.create({
    compatibility,
    ownerId: "alice",
    peerUserId: "bob",
    player: alice,
    sessionId,
  }).ok, true);
  assert.equal(service.join({ compatibility, player: bob, sessionId, userId: "bob" }).ok, true);
  return service;
};

describe("generic shared session authority", () => {
  it("validates direct inputs instead of trusting typed callers", () => {
    const service = new SharedSessionService();
    try {
      const invalid = service.create({
        compatibility,
        ownerId: "bad identity",
        peerUserId: "bob",
        player: alice,
        sessionId,
      });
      assert.equal(invalid.ok, false);
      if (!invalid.ok) assert.equal(invalid.error.code, "invalid-input");

      const malformedProfile = { ...alice, displayName: "TOO-LONG" } as SharedPlayerProfile;
      const malformed = service.create({
        compatibility,
        ownerId: "alice",
        peerUserId: "bob",
        player: malformedProfile,
        sessionId: Buffer.alloc(16, 42).toString("base64url"),
      });
      assert.equal(malformed.ok, false);
      if (!malformed.ok) assert.equal(malformed.error.code, "invalid-input");
    } finally {
      service.shutdown();
    }
    assert.throws(() => new SharedSessionService({ idleTtlMs: 999 }), /idleTtlMs/);
    assert.throws(() => new SharedSessionService({ maximumSessions: 0 }), /maximumSessions/);
    assert.throws(
      () => new SharedSessionService({ maximumSessionsPerUser: 17 }),
      /maximumSessionsPerUser/,
    );
  });

  it("inspects an invited non-member without mutation and only bypasses an exact rejoin", () => {
    const backingStore = new MemorySharedSessionStore();
    let saveCount = 0;
    const store: SharedSessionStore = {
      load: () => backingStore.load(),
      save: (state) => {
        saveCount += 1;
        backingStore.save(state);
      },
    };
    const service = new SharedSessionService({ store });
    try {
      const created = service.create({
        compatibility,
        ownerId: "alice",
        peerUserId: "bob",
        player: alice,
        sessionId,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const savesAfterCreate = saveCount;

      const inspection = service.inspectJoin({
        compatibility,
        player: bob,
        sessionId,
        userId: "bob",
      });
      assert.equal(inspection.ok, true);
      if (!inspection.ok) return;
      assert.equal(inspection.value.kind, "requires-admission");
      assert.equal(inspection.value.ownerId, "alice");
      assert.equal(inspection.value.snapshot, created.value);
      assert.equal(inspection.value.snapshot.revision, 0);
      assert.equal(inspection.value.snapshot.players.length, 1);
      assert.equal(saveCount, savesAfterCreate);

      const stranger = service.inspectJoin({
        compatibility,
        player: bob,
        sessionId,
        userId: "carol",
      });
      assert.equal(stranger.ok, false);
      if (!stranger.ok) assert.equal(stranger.error.code, "peer-mismatch");
      assert.equal(saveCount, savesAfterCreate);

      const joined = service.join({ compatibility, player: bob, sessionId, userId: "bob" });
      assert.equal(joined.ok, true);
      const exactRejoin = service.inspectJoin({
        compatibility,
        player: bob,
        sessionId,
        userId: "bob",
      });
      assert.equal(exactRejoin.ok, true);
      if (exactRejoin.ok) assert.equal(exactRejoin.value.kind, "already-member");

      const movedProfile = service.inspectJoin({
        compatibility,
        player: {
          ...bob,
          position: { ...bob.position, x: bob.position.x + 1 },
        },
        sessionId,
        userId: "bob",
      });
      assert.equal(movedProfile.ok, true);
      if (movedProfile.ok) {
        assert.equal(movedProfile.value.kind, "already-member");
        assert.deepEqual(
          movedProfile.value.snapshot.players.find(({ playerId }) => playerId === "bob")?.position,
          bob.position,
        );
      }
      const resumed = service.join({
        compatibility,
        player: { ...bob, position: { ...bob.position, x: bob.position.x + 1 } },
        sessionId,
        userId: "bob",
      });
      assert.equal(resumed.ok, true);
      if (resumed.ok) {
        assert.deepEqual(
          resumed.value.players.find(({ playerId }) => playerId === "bob")?.position,
          bob.position,
        );
      }
    } finally {
      service.shutdown();
    }
  });

  it("resumes only the exact owner route without replacing the durable snapshot", () => {
    const service = createJoinedService();
    try {
      const moved = service.submitMovement(sessionId, "alice", movement());
      assert.equal(moved.ok, true);
      if (!moved.ok) return;

      const resumed = service.resumeOwner({
        compatibility,
        ownerId: "alice",
        peerUserId: "bob",
        sessionId,
      });
      assert.equal(resumed.ok, true);
      if (resumed.ok) assert.deepEqual(resumed.value, moved.value.snapshot);

      const wrongOwner = service.resumeOwner({
        compatibility,
        ownerId: "bob",
        peerUserId: "alice",
        sessionId,
      });
      assert.equal(wrongOwner.ok, false);
      if (!wrongOwner.ok) assert.equal(wrongOwner.error.code, "peer-mismatch");

      const wrongPeer = service.resumeOwner({
        compatibility,
        ownerId: "alice",
        peerUserId: "carol",
        sessionId,
      });
      assert.equal(wrongPeer.ok, false);
      if (!wrongPeer.ok) assert.equal(wrongPeer.error.code, "peer-mismatch");

      const wrongCompatibility = service.resumeOwner({
        compatibility: { ...compatibility, release: compatibility.release + 1 },
        ownerId: "alice",
        peerUserId: "bob",
        sessionId,
      });
      assert.equal(wrongCompatibility.ok, false);
      if (!wrongCompatibility.ok) {
        assert.equal(wrongCompatibility.error.code, "compatibility-mismatch");
      }
    } finally {
      service.shutdown();
    }
  });

  it("serializes movements, accepts stale revisions, and deduplicates commands", () => {
    const admitted: SharedMovementCommand[] = [];
    const service = createJoinedService({
      movementAdmission: ({ command }) => {
        admitted.push(command);
        return { kind: "accept" };
      },
    });
    try {
      const firstCommand = movement();
      const first = service.submitMovement(sessionId, "alice", firstCommand);
      assert.equal(first.ok, true);
      if (!first.ok) return;
      assert.equal(first.value.appliedRevision, 2);
      assert.equal(first.value.replayed, false);
      assert.deepEqual(first.value.snapshot.players[0]?.position, firstCommand.to);

      const replay = service.submitMovement(sessionId, "alice", firstCommand);
      assert.equal(replay.ok, true);
      if (replay.ok) {
        assert.equal(replay.value.appliedRevision, 2);
        assert.equal(replay.value.replayed, true);
        assert.equal(replay.value.snapshot.revision, 2);
      }
      assert.equal(admitted.length, 1);

      const conflictingId = service.submitMovement(sessionId, "alice", {
        ...firstCommand,
        mode: "run",
      });
      assert.equal(conflictingId.ok, false);
      if (!conflictingId.ok) assert.equal(conflictingId.error.code, "command-id-conflict");

      const staleBob = service.submitMovement(sessionId, "bob", movement({
        commandId: "move:bob:1",
        expectedRevision: 1,
        from: bob.position,
        sequence: 1,
        to: { direction: "west", mapId: 1, x: 3, z: 1 },
      }));
      assert.equal(staleBob.ok, true);
      if (staleBob.ok) assert.equal(staleBob.value.snapshot.revision, 3);

      const transition = movement({
        arrival: { direction: "south", mapId: 2, x: 10, z: 10 },
        commandId: "move:alice:2",
        expectedRevision: 3,
        from: firstCommand.to,
        sequence: 2,
        to: { direction: "south", mapId: 1, x: 2, z: 2 },
      });
      assert.deepEqual(parseSharedMovementCommand(transition), transition);
      const transitioned = service.submitMovement(sessionId, "alice", transition);
      assert.equal(transitioned.ok, true);
      if (transitioned.ok) {
        assert.deepEqual(
          transitioned.value.snapshot.players.find(({ playerId }) => playerId === "alice")?.position,
          transition.arrival,
        );
      }
    } finally {
      service.shutdown();
    }
  });

  it("seeds owner progression at revision zero without allowing join to replace it", () => {
    const service = new SharedSessionService();
    try {
      const created = service.create({
        compatibility,
        ownerId: "alice",
        peerUserId: "bob",
        player: alice,
        sessionId,
        sharedProgression: {
          counters: [{ id: "badges", value: 3 }],
          milestoneIds: ["story:starter"],
        },
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      assert.equal(created.value.revision, 0);
      assert.deepEqual(created.value.sharedProgression, {
        counters: [{ id: "badges", value: 3 }],
        milestoneIds: ["story:starter"],
      });
      const joined = service.join({ compatibility, player: bob, sessionId, userId: "bob" });
      assert.equal(joined.ok, true);
      if (joined.ok) assert.deepEqual(joined.value.sharedProgression, created.value.sharedProgression);
    } finally {
      service.shutdown();
    }
  });

  it("commits campaign progression durably in revision order and tracks per-player acknowledgements", () => {
    const service = createJoinedService();
    const events: unknown[] = [];
    try {
      assert.equal(service.subscribe(sessionId, "alice", (event) => events.push(event)).ok, true);
      const command = campaignEvent();
      assert.deepEqual(parseSharedEventCommand(command), command);
      const committed = service.submitCommand(sessionId, "alice", command);
      assert.equal(committed.ok, true);
      if (!committed.ok) return;
      assert.equal(committed.value.appliedRevision, 2);
      assert.deepEqual(committed.value.snapshot.sharedProgression, {
        counters: [{ id: "badges", value: 1 }],
        milestoneIds: ["story:zephyr-badge"],
      });
      assert.deepEqual(committed.value.snapshot.pendingEvents, [{
        eventId: command.eventId,
        eventRevision: 2,
        pendingPlayerIds: ["alice", "bob"],
      }]);

      const stale = service.submitSharedEvent(sessionId, "bob", campaignEvent({
        commandId: "event:bob:stale",
        counters: [],
        eventId: "story:stale",
        milestoneIds: [],
      }));
      assert.equal(stale.ok, false);
      if (!stale.ok) assert.equal(stale.error.code, "revision-conflict");

      const counterConflict = service.submitSharedEvent(sessionId, "bob", campaignEvent({
        commandId: "event:bob:counter-conflict",
        counters: [{ expectedValue: 0, id: "badges", value: 2 }],
        eventId: "story:counter-conflict",
        expectedRevision: 2,
        milestoneIds: [],
      }));
      assert.equal(counterConflict.ok, false);
      if (!counterConflict.ok) {
        assert.equal(counterConflict.error.code, "progression-counter-conflict");
        assert.equal(counterConflict.error.counterId, "badges");
      }

      const aliceAck = eventAcknowledgement();
      assert.deepEqual(parseSharedEventAcknowledgementCommand(aliceAck), aliceAck);
      const acknowledged = service.submitEventAcknowledgement(sessionId, "alice", aliceAck);
      assert.equal(acknowledged.ok, true);
      if (!acknowledged.ok) return;
      assert.equal(acknowledged.value.appliedRevision, 3);
      assert.deepEqual(acknowledged.value.snapshot.pendingEvents[0]?.pendingPlayerIds, ["bob"]);

      const replayed = service.submitEventAcknowledgement(sessionId, "alice", aliceAck);
      assert.equal(replayed.ok, true);
      if (replayed.ok) {
        assert.equal(replayed.value.replayed, true);
        assert.equal(replayed.value.appliedRevision, 3);
        assert.equal(replayed.value.snapshot.revision, 3);
      }
      const alreadyAcknowledged = service.submitEventAcknowledgement(sessionId, "alice", {
        ...aliceAck,
        commandId: "event-ack:alice:again",
        expectedRevision: 3,
      });
      assert.equal(alreadyAcknowledged.ok, false);
      if (!alreadyAcknowledged.ok) {
        assert.equal(alreadyAcknowledged.error.code, "event-already-acknowledged");
      }

      const wrongEventRevision = service.submitEventAcknowledgement(sessionId, "bob", {
        ...aliceAck,
        commandId: "event-ack:bob:wrong-revision",
        eventRevision: 3,
        expectedRevision: 3,
      });
      assert.equal(wrongEventRevision.ok, false);
      if (!wrongEventRevision.ok) assert.equal(wrongEventRevision.error.code, "event-revision-conflict");

      const bobAck = service.submitEventAcknowledgement(sessionId, "bob", {
        ...aliceAck,
        commandId: "event-ack:bob:1",
        expectedRevision: 3,
      });
      assert.equal(bobAck.ok, true);
      if (bobAck.ok) {
        assert.equal(bobAck.value.snapshot.revision, 4);
        assert.deepEqual(bobAck.value.snapshot.pendingEvents, []);
        assert.deepEqual(bobAck.value.snapshot.sharedProgression, committed.value.snapshot.sharedProgression);
      }
      const duplicateEvent = service.submitSharedEvent(sessionId, "alice", campaignEvent({
        commandId: "event:alice:duplicate",
        counters: [],
        expectedRevision: 4,
        milestoneIds: [],
      }));
      assert.equal(duplicateEvent.ok, false);
      if (!duplicateEvent.ok) assert.equal(duplicateEvent.error.code, "event-already-committed");
      assert.equal(events.length, 3);
    } finally {
      service.shutdown();
    }
  });

  it("runs an injected shared-event policy before any durable mutation", () => {
    const admitted: SharedEventCommand[] = [];
    let service: SharedSessionService;
    service = createJoinedService({
      sharedEventAdmission: (candidate) => {
        admitted.push(candidate.command);
        assert.deepEqual(candidate.compatibility, compatibility);
        assert.equal(candidate.playerId, "alice");
        assert.equal(candidate.snapshot.revision, 1);
        const reentrant = service.leave(sessionId, "bob");
        assert.equal(reentrant.ok, false);
        if (!reentrant.ok) assert.equal(reentrant.error.code, "session-mutation-in-progress");
        return { code: "event-policy-rejected", kind: "reject", message: "Rejected by policy" };
      },
    });
    try {
      const rejected = service.submitSharedEvent(sessionId, "alice", campaignEvent());
      assert.equal(rejected.ok, false);
      if (!rejected.ok) {
        assert.equal(rejected.error.code, "port-rejected");
        assert.equal(rejected.error.portCode, "event-policy-rejected");
      }
      assert.equal(admitted.length, 1);
      const current = service.read(sessionId, "alice");
      assert.equal(current.ok, true);
      if (current.ok) {
        assert.equal(current.value.revision, 1);
        assert.deepEqual(current.value.pendingEvents, []);
        assert.deepEqual(current.value.sharedProgression, { counters: [], milestoneIds: [] });
      }
    } finally {
      service.shutdown();
    }
  });

  it("preserves progression and pending deliveries through movement and member departure", () => {
    const service = createJoinedService();
    try {
      const committed = service.submitSharedEvent(sessionId, "alice", campaignEvent());
      assert.equal(committed.ok, true);
      const moved = service.submitMovement(sessionId, "alice", movement({ expectedRevision: 2 }));
      assert.equal(moved.ok, true);
      if (!moved.ok) return;
      assert.equal(moved.value.snapshot.revision, 3);
      assert.deepEqual(moved.value.snapshot.sharedProgression.counters, [{ id: "badges", value: 1 }]);
      assert.deepEqual(moved.value.snapshot.pendingEvents[0]?.pendingPlayerIds, ["alice", "bob"]);
      const left = service.leave(sessionId, "bob");
      assert.equal(left.ok, true);
      const current = service.read(sessionId, "alice");
      assert.equal(current.ok, true);
      if (current.ok) {
        assert.deepEqual(current.value.pendingEvents[0]?.pendingPlayerIds, ["alice"]);
        assert.deepEqual(current.value.sharedProgression.milestoneIds, ["story:zephyr-badge"]);
      }
    } finally {
      service.shutdown();
    }
  });

  it("bounds pending events and aggregate progression without partial mutation", () => {
    const pendingService = createJoinedService();
    try {
      for (let index = 0; index < 128; index += 1) {
        const result = pendingService.submitSharedEvent(sessionId, "alice", campaignEvent({
          commandId: `event:pending:${index}`,
          counters: [],
          eventId: `story:pending:${index}`,
          expectedRevision: index + 1,
          milestoneIds: [],
        }));
        assert.equal(result.ok, true);
      }
      const overflow = pendingService.submitSharedEvent(sessionId, "alice", campaignEvent({
        commandId: "event:pending:overflow",
        counters: [],
        eventId: "story:pending:overflow",
        expectedRevision: 129,
        milestoneIds: [],
      }));
      assert.equal(overflow.ok, false);
      if (!overflow.ok) assert.equal(overflow.error.code, "event-capacity-reached");
      const snapshot = pendingService.read(sessionId, "alice");
      assert.equal(snapshot.ok, true);
      if (snapshot.ok) {
        assert.equal(snapshot.value.revision, 129);
        assert.equal(snapshot.value.pendingEvents.length, 128);
      }
    } finally {
      pendingService.shutdown();
    }

    const counterService = new SharedSessionService();
    try {
      assert.equal(counterService.create({
        compatibility,
        ownerId: "alice",
        peerUserId: "bob",
        player: alice,
        sessionId,
        sharedProgression: {
          counters: Array.from({ length: 256 }, (_, index) => ({ id: `counter:${index}`, value: index })),
          milestoneIds: [],
        },
      }).ok, true);
      assert.equal(counterService.join({ compatibility, player: bob, sessionId, userId: "bob" }).ok, true);
      const overflow = counterService.submitSharedEvent(sessionId, "alice", campaignEvent({
        commandId: "event:counter:overflow",
        counters: [{ expectedValue: null, id: "counter:overflow", value: 1 }],
        eventId: "story:counter:overflow",
        milestoneIds: [],
      }));
      assert.equal(overflow.ok, false);
      if (!overflow.ok) assert.equal(overflow.error.code, "progression-capacity-reached");
      const snapshot = counterService.read(sessionId, "alice");
      assert.equal(snapshot.ok, true);
      if (snapshot.ok) {
        assert.equal(snapshot.value.revision, 1);
        assert.equal(snapshot.value.sharedProgression.counters.length, 256);
        assert.deepEqual(snapshot.value.pendingEvents, []);
      }
    } finally {
      counterService.shutdown();
    }
  });

  it("rejects invalid steps, occupied source/final tiles, and admission failures atomically", () => {
    const rejectingService = createJoinedService({
      movementAdmission: () => ({ code: "surface-blocked", kind: "reject", message: "Blocked" }),
    });
    try {
      const rejected = rejectingService.submitMovement(sessionId, "alice", movement());
      assert.equal(rejected.ok, false);
      if (!rejected.ok) {
        assert.equal(rejected.error.code, "port-rejected");
        assert.equal(rejected.error.portCode, "surface-blocked");
      }
      const snapshot = rejectingService.read(sessionId, "alice");
      assert.equal(snapshot.ok, true);
      if (snapshot.ok) {
        assert.equal(snapshot.value.revision, 1);
        assert.deepEqual(snapshot.value.players[0]?.position, alice.position);
      }
    } finally {
      rejectingService.shutdown();
    }

    const service = createJoinedService();
    try {
      const diagonal = service.submitMovement(sessionId, "alice", movement({
        to: { direction: "south", mapId: 1, x: 2, z: 2 },
      }));
      assert.equal(diagonal.ok, false);
      if (!diagonal.ok) assert.equal(diagonal.error.code, "movement-step-conflict");

      const occupiedArrival = service.submitMovement(sessionId, "alice", movement({
        arrival: bob.position,
      }));
      assert.equal(occupiedArrival.ok, false);
      if (!occupiedArrival.ok) assert.equal(occupiedArrival.error.code, "movement-destination-occupied");
    } finally {
      service.shutdown();
    }
  });

  it("blocks reentrant mutations while the admission port is evaluating", () => {
    let service: SharedSessionService;
    service = createJoinedService({
      movementAdmission: () => {
        const nested = service.leave(sessionId, "bob");
        assert.equal(nested.ok, false);
        if (!nested.ok) assert.equal(nested.error.code, "session-mutation-in-progress");
        return { kind: "accept" };
      },
    });
    try {
      const result = service.submitMovement(sessionId, "alice", movement());
      assert.equal(result.ok, true);
      const snapshot = service.read(sessionId, "bob");
      assert.equal(snapshot.ok, true);
      if (snapshot.ok) assert.equal(snapshot.value.players.length, 2);
    } finally {
      service.shutdown();
    }
  });

  it("never applies an unattested transition without an explicit port", () => {
    const service = createJoinedService();
    const transition = movement({
      arrival: { direction: "south", mapId: 2, x: 10, z: 10 },
      to: { direction: "east", mapId: 1, x: 2, z: 1 },
    });
    try {
      const unattested = service.submitMovement(sessionId, "alice", transition);
      assert.equal(unattested.ok, false);
      if (!unattested.ok) assert.equal(unattested.error.code, "transition-unattested");

      const mismatched = service.submitMovement(sessionId, "alice", transition, {
        arrivalAttestation: { direction: "south", mapId: 2, x: 11, z: 10 },
      });
      assert.equal(mismatched.ok, false);
      if (!mismatched.ok) assert.equal(mismatched.error.code, "transition-attestation-mismatch");

      const accepted = service.submitMovement(sessionId, "alice", transition, {
        arrivalAttestation: transition.arrival!,
      });
      assert.equal(accepted.ok, true);
      if (accepted.ok) {
        assert.deepEqual(accepted.value.snapshot.players[0]?.position, transition.arrival);
      }
    } finally {
      service.shutdown();
    }
  });

  it("keeps connected sessions alive then expires an abandoned room", () => {
    let now = 0;
    const service = createJoinedService({ idleTtlMs: 1_000, now: () => now });
    const events: unknown[] = [];
    try {
      const subscribed = service.subscribe(sessionId, "alice", (event) => events.push(event));
      assert.equal(subscribed.ok, true);
      assert.equal(service.connect(sessionId, "alice").ok, true);
      now = 5_000;
      assert.equal(service.purgeExpired(), 0);

      const disconnected = service.disconnect(sessionId, "alice");
      assert.equal(disconnected.ok, true);
      if (disconnected.ok) {
        assert.equal(disconnected.value.players[0]?.state, "away");
      }
      now = 5_999;
      assert.equal(service.purgeExpired(), 0);
      now = 6_000;
      assert.equal(service.purgeExpired(), 1);
      assert.deepEqual(events.at(-1), {
        reason: "idle-timeout",
        sessionId,
        type: "ended",
      });
      const missing = service.read(sessionId, "alice");
      assert.equal(missing.ok, false);
      if (!missing.ok) assert.equal(missing.error.code, "session-not-found");
    } finally {
      service.shutdown();
    }
  });

  it("rebases an abandoned room when the runtime wall clock moves backwards", () => {
    let now = 100_000;
    const service = createJoinedService({ idleTtlMs: 1_000, now: () => now });
    now = 0;
    assert.equal(service.purgeExpired(), 0);
    now = 999;
    assert.equal(service.purgeExpired(), 0);
    now = 1_000;
    assert.equal(service.purgeExpired(), 1);
    service.shutdown();
  });

  it("rejects every operation after shutdown", () => {
    const service = createJoinedService();
    service.shutdown();
    assert.throws(() => service.read(sessionId, "alice"), /shut down/);
    assert.throws(() => service.purgeExpired(), /shut down/);
    assert.throws(
      () => service.create({
        compatibility,
        ownerId: "alice",
        peerUserId: "bob",
        player: alice,
        sessionId: Buffer.alloc(16, 99).toString("base64url"),
      }),
      /shut down/,
    );
  });
});
