import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  fieldSharedSessionContinuityPolicy,
} from "../src/domain/field-shared-session-continuity-policy.js";
import {
  SharedSessionService,
  type SharedEventCommand,
  type SharedPlayerProfile,
  type SharedProgression,
} from "../src/domain/shared-sessions.js";
import {
  FileSharedSessionStore,
  MemorySharedSessionStore,
  type LegacyStoredSharedSessionState,
  type StoredSharedSessionState,
} from "../src/persistence/shared-session-store.js";

const compatibility = { applicationId: "IPKE", locale: 1, release: 7 } as const;
const branchA = `field.branch.${"a".repeat(32)}`;
const branchB = `field.branch.${"b".repeat(32)}`;
const sessionId = (byte: number): string => Buffer.alloc(16, byte).toString("base64url");
const alice: SharedPlayerProfile = {
  displayName: "ALICE",
  gender: "female",
  position: { direction: "south", mapId: 1, x: 1, z: 1 },
  spriteId: 97,
};
const carol: SharedPlayerProfile = {
  displayName: "CAROL",
  gender: "female",
  position: { direction: "south", mapId: 1, x: 3, z: 1 },
  spriteId: 98,
};

const progression = (
  branchId = branchA,
  revision = 0,
  extraMilestoneIds: readonly string[] = [],
): SharedProgression => ({
  counters: [{ id: "field.progression-revision", value: revision }],
  milestoneIds: ["field.schema.v1", branchId, ...extraMilestoneIds],
});

const create = (
  service: SharedSessionService,
  id: string,
  sharedProgression: SharedProgression,
  ownerId = "alice",
  peerUserId = "bob",
  player = alice,
) => service.create({
  compatibility,
  ownerId,
  peerUserId,
  player,
  sessionId: id,
  sharedProgression,
});

const advanceEvent = (expectedRevision = 0): SharedEventCommand => ({
  commandId: "shared-event:continuity:1",
  counters: [{
    expectedValue: expectedRevision,
    id: "field.progression-revision",
    value: expectedRevision + 1,
  }],
  eventId: "field-event.1.IPKE.7.1.1.o.1.1",
  expectedRevision: 0,
  kind: "shared-event",
  milestoneIds: ["field.flag.0001"],
  protocolVersion: 2,
});

const serviceWithPolicy = (
  store: MemorySharedSessionStore = new MemorySharedSessionStore(),
  options: Partial<ConstructorParameters<typeof SharedSessionService>[0]> = {},
): SharedSessionService => new SharedSessionService({
  continuityPolicy: fieldSharedSessionContinuityPolicy,
  store,
  ...options,
});

describe("durable shared session continuity", () => {
  it("leases one active room per branch, keeps the owner immutable, and isolates branches", () => {
    const service = serviceWithPolicy();
    try {
      assert.equal(create(service, sessionId(1), progression()).ok, true);

      const duplicate = create(service, sessionId(2), progression());
      assert.equal(duplicate.ok, false);
      if (!duplicate.ok) assert.equal(duplicate.error.code, "continuity-active");

      const otherOwner = create(
        service,
        sessionId(3),
        progression(),
        "carol",
        "dave",
        carol,
      );
      assert.equal(otherOwner.ok, false);
      if (!otherOwner.ok) assert.equal(otherOwner.error.code, "continuity-owner-conflict");

      assert.equal(create(service, sessionId(4), progression(branchB)).ok, true);
      assert.equal(create(service, sessionId(5), { counters: [], milestoneIds: [] }).ok, true);
      assert.equal(create(service, sessionId(6), { counters: [], milestoneIds: [] }).ok, true);
    } finally {
      service.shutdown();
    }
  });

  it("retains the latest head after owner leave and rejects stale, future, and divergent resumes", () => {
    const service = serviceWithPolicy();
    try {
      const firstId = sessionId(11);
      assert.equal(create(service, firstId, progression()).ok, true);
      const advanced = service.submitSharedEvent(firstId, "alice", advanceEvent());
      assert.equal(advanced.ok, true);
      if (!advanced.ok) return;
      const exact = advanced.value.snapshot.sharedProgression;
      assert.equal(service.leave(firstId, "alice").ok, true);

      const stale = create(service, sessionId(12), progression());
      assert.equal(stale.ok, false);
      if (!stale.ok) {
        assert.equal(stale.error.code, "continuity-stale");
        assert.equal(stale.error.expectedRevision, undefined);
        assert.equal(stale.error.receivedRevision, undefined);
      }

      const future = create(service, sessionId(13), progression(branchA, 2));
      assert.equal(future.ok, false);
      if (!future.ok) assert.equal(future.error.code, "continuity-future");

      const divergent = create(service, sessionId(14), {
        counters: exact.counters,
        milestoneIds: [...exact.milestoneIds, "field.flag.ffff"],
      });
      assert.equal(divergent.ok, false);
      if (!divergent.ok) assert.equal(divergent.error.code, "continuity-divergent");

      const wrongOwner = create(
        service,
        sessionId(15),
        exact,
        "carol",
        "dave",
        carol,
      );
      assert.equal(wrongOwner.ok, false);
      if (!wrongOwner.ok) assert.equal(wrongOwner.error.code, "continuity-owner-conflict");

      assert.equal(create(service, sessionId(16), exact).ok, true);
    } finally {
      service.shutdown();
    }
  });

  it("releases an expired room while preserving its resumable head", () => {
    let now = 0;
    const service = serviceWithPolicy(new MemorySharedSessionStore(), {
      idleTtlMs: 1_000,
      now: () => now,
    });
    try {
      const expiredId = sessionId(21);
      assert.equal(create(service, expiredId, progression()).ok, true);
      now = 1_000;
      assert.equal(create(service, sessionId(22), progression()).ok, true);
      const missing = service.read(expiredId, "alice");
      assert.equal(missing.ok, false);
      if (!missing.ok) assert.equal(missing.error.code, "session-not-found");
    } finally {
      service.shutdown();
    }
  });

  it("commits the progression head and snapshot in one durable write with full rollback", () => {
    class FailingStore extends MemorySharedSessionStore {
      fail = false;

      override save(state: StoredSharedSessionState): void {
        if (this.fail) throw new Error("simulated continuity write failure");
        super.save(state);
      }
    }
    const store = new FailingStore();
    const service = serviceWithPolicy(store);
    try {
      const firstId = sessionId(31);
      assert.equal(create(service, firstId, progression()).ok, true);
      const published: unknown[] = [];
      assert.equal(service.subscribe(firstId, "alice", (event) => published.push(event)).ok, true);
      store.fail = true;
      assert.throws(
        () => service.submitSharedEvent(firstId, "alice", advanceEvent()),
        /simulated continuity write failure/,
      );
      assert.deepEqual(published, []);
      store.fail = false;
      const current = service.read(firstId, "alice");
      assert.equal(current.ok, true);
      if (current.ok) {
        assert.deepEqual(current.value.sharedProgression, progression());
        assert.deepEqual(current.value.pendingEvents, []);
      }
      const retried = service.submitSharedEvent(firstId, "alice", advanceEvent());
      assert.equal(retried.ok, true);
      if (retried.ok) {
        assert.equal(
          retried.value.snapshot.sharedProgression.counters
            .find(({ id }) => id === "field.progression-revision")?.value,
          1,
        );
      }
      assert.equal(published.length, 1);
    } finally {
      service.shutdown();
    }
  });

  it("restores a live lease across restart, then allows an exact resume after owner leave", () => {
    const store = new MemorySharedSessionStore();
    const firstId = sessionId(41);
    const first = serviceWithPolicy(store);
    assert.equal(create(first, firstId, progression()).ok, true);
    first.shutdown();

    const restored = serviceWithPolicy(store);
    try {
      const blocked = create(restored, sessionId(42), progression());
      assert.equal(blocked.ok, false);
      if (!blocked.ok) assert.equal(blocked.error.code, "continuity-active");
      assert.equal(restored.leave(firstId, "alice").ok, true);
      assert.equal(create(restored, sessionId(43), progression()).ok, true);
    } finally {
      restored.shutdown();
    }
  });

  it("fails closed when a V3 session and its durable head disagree", () => {
    const store = new MemorySharedSessionStore();
    const first = serviceWithPolicy(store);
    assert.equal(create(first, sessionId(45), progression()).ok, true);
    first.shutdown();
    const state = store.load();
    assert.equal(state.version, 3);
    if (state.version !== 3) return;
    const corrupted = new MemorySharedSessionStore({
      continuityHeads: state.continuityHeads.map((head) => ({
        ...head,
        fingerprint: "A".repeat(43),
      })),
      sessions: state.sessions,
      version: 3,
    });
    assert.throws(
      () => serviceWithPolicy(corrupted),
      /does not match its durable head/,
    );
  });

  it("migrates one V2 branch, discards identical duplicate leases, and fails on divergence", () => {
    const seedStore = new MemorySharedSessionStore();
    const seed = new SharedSessionService({ store: seedStore });
    assert.equal(create(seed, sessionId(51), progression()).ok, true);
    const v3 = seedStore.load();
    assert.equal(v3.version, 3);
    seed.shutdown();
    if (v3.version !== 3) return;
    const uniqueLegacy: LegacyStoredSharedSessionState = {
      sessions: v3.sessions,
      version: 2,
    };
    const uniqueStore = new MemorySharedSessionStore(uniqueLegacy);
    const unique = serviceWithPolicy(uniqueStore);
    try {
      const blocked = create(unique, sessionId(52), progression());
      assert.equal(blocked.ok, false);
      if (!blocked.ok) assert.equal(blocked.error.code, "continuity-active");
      assert.equal(uniqueStore.load().version, 3);
    } finally {
      unique.shutdown();
    }

    const duplicateSeedStore = new MemorySharedSessionStore();
    const duplicateSeed = new SharedSessionService({ store: duplicateSeedStore });
    assert.equal(create(duplicateSeed, sessionId(53), progression()).ok, true);
    assert.equal(create(duplicateSeed, sessionId(54), progression()).ok, true);
    const duplicateV3 = duplicateSeedStore.load();
    duplicateSeed.shutdown();
    if (duplicateV3.version !== 3) return;
    const duplicateStore = new MemorySharedSessionStore({
      sessions: duplicateV3.sessions,
      version: 2,
    });
    const migratedDuplicate = serviceWithPolicy(duplicateStore);
    try {
      for (const oldId of [sessionId(53), sessionId(54)]) {
        const missing = migratedDuplicate.read(oldId, "alice");
        assert.equal(missing.ok, false);
        if (!missing.ok) assert.equal(missing.error.code, "session-not-found");
      }
      assert.equal(create(migratedDuplicate, sessionId(55), progression()).ok, true);
    } finally {
      migratedDuplicate.shutdown();
    }

    const divergentSeedStore = new MemorySharedSessionStore();
    const divergentSeed = new SharedSessionService({ store: divergentSeedStore });
    assert.equal(create(divergentSeed, sessionId(56), progression()).ok, true);
    assert.equal(create(
      divergentSeed,
      sessionId(57),
      progression(branchA, 0, ["field.flag.0002"]),
    ).ok, true);
    const divergentV3 = divergentSeedStore.load();
    divergentSeed.shutdown();
    if (divergentV3.version !== 3) return;
    const divergentStore = new MemorySharedSessionStore({
      sessions: divergentV3.sessions,
      version: 2,
    });
    assert.throws(() => serviceWithPolicy(divergentStore), /continuities diverge/);
  });

  it("writes a policy-validated V2 file migration as V3 and retains its inactive head", async () => {
    const seedStore = new MemorySharedSessionStore();
    const seed = new SharedSessionService({ store: seedStore });
    const firstId = sessionId(61);
    assert.equal(create(seed, firstId, progression()).ok, true);
    const seeded = seedStore.load();
    seed.shutdown();
    assert.equal(seeded.version, 3);
    if (seeded.version !== 3) return;

    const directory = mkdtempSync(join(tmpdir(), "shared-continuity-v2-"));
    const filePath = join(directory, "sessions.json");
    try {
      writeFileSync(filePath, JSON.stringify({ sessions: seeded.sessions, version: 2 }), "utf8");
      const migrated = new SharedSessionService({
        continuityPolicy: fieldSharedSessionContinuityPolicy,
        store: new FileSharedSessionStore(filePath),
      });
      assert.equal(migrated.leave(firstId, "alice").ok, true);
      await migrated.close();

      const persisted = JSON.parse(readFileSync(filePath, "utf8")) as {
        continuityHeads: Array<Record<string, unknown>>;
        sessions: unknown[];
        version: number;
      };
      assert.equal(persisted.version, 3);
      assert.deepEqual(persisted.sessions, []);
      assert.equal(persisted.continuityHeads.length, 1);
      assert.equal(persisted.continuityHeads[0]?.ownerId, "alice");
      assert.equal(Object.hasOwn(persisted.continuityHeads[0] ?? {}, "activeSessionId"), false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
