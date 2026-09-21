import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  SharedSessionService,
  type SharedEventCommand,
  type SharedEventAcknowledgementCommand,
  type SharedMovementCommand,
  type SharedPlayerProfile,
} from "../src/domain/shared-sessions.js";
import {
  FileSharedSessionStore,
  MemorySharedSessionStore,
  emptySharedSessionState,
  type StoredSharedSessionState,
} from "../src/persistence/shared-session-store.js";

const sessionId = Buffer.alloc(16, 71).toString("base64url");
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
const firstMovement: SharedMovementCommand = {
  commandId: "move:alice:1",
  expectedRevision: 1,
  from: alice.position,
  kind: "movement",
  mode: "walk",
  protocolVersion: 2,
  sequence: 1,
  to: { direction: "east", mapId: 1, x: 2, z: 1 },
};

const firstCampaignEvent: SharedEventCommand = {
  commandId: "event:zephyr:1",
  counters: [{ expectedValue: 0, id: "badges", value: 1 }],
  eventId: "story:zephyr-badge",
  expectedRevision: 1,
  kind: "shared-event",
  milestoneIds: ["story:zephyr-complete"],
  protocolVersion: 2,
};

const aliceEventAcknowledgement: SharedEventAcknowledgementCommand = {
  commandId: "event-ack:alice:zephyr",
  eventId: firstCampaignEvent.eventId,
  eventRevision: 2,
  expectedRevision: 2,
  kind: "event-ack",
  protocolVersion: 2,
};

const temporaryDirectories: string[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "shared-session-store-"));
  temporaryDirectories.push(directory);
  return directory;
};

const createJoined = (
  store: FileSharedSessionStore | MemorySharedSessionStore,
  now: () => number,
  idleTtlMs = 60_000,
): SharedSessionService => {
  const service = new SharedSessionService({ idleTtlMs, now, store });
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("durable shared session authority", () => {
  it("persists an acknowledged movement and its deduplication before a restart", async () => {
    const directory = temporaryDirectory();
    const filePath = join(directory, "sessions.json");
    let now = 10_000;
    const firstService = createJoined(new FileSharedSessionStore(filePath), () => now);
    const events: unknown[] = [];
    assert.equal(firstService.subscribe(sessionId, "alice", (event) => events.push(event)).ok, true);

    const acknowledged = firstService.submitMovement(sessionId, "alice", firstMovement);
    assert.equal(acknowledged.ok, true);
    if (acknowledged.ok) {
      assert.equal(acknowledged.value.appliedRevision, 2);
      assert.equal(acknowledged.value.replayed, false);
    }
    assert.deepEqual(readdirSync(directory), ["sessions.json", "sessions.json.journal"]);
    // Simulate an abrupt process stop: the checkpoint is intentionally not
    // compacted, so recovery must replay the fsynced journal.
    firstService.shutdown();
    assert.equal(events.some((event) => (event as { type?: string }).type === "ended"), false);

    now = 10_500;
    const restored = new SharedSessionService({
      idleTtlMs: 60_000,
      now: () => now,
      store: new FileSharedSessionStore(filePath),
    });
    try {
      const snapshot = restored.read(sessionId, "alice");
      assert.equal(snapshot.ok, true);
      if (snapshot.ok) {
        assert.equal(snapshot.value.revision, 3);
        assert.equal(snapshot.value.players.every(({ state }) => state === "away"), true);
        assert.deepEqual(
          snapshot.value.players.find(({ playerId }) => playerId === "alice")?.position,
          firstMovement.to,
        );
      }
      const replayed = restored.submitMovement(sessionId, "alice", firstMovement);
      assert.equal(replayed.ok, true);
      if (replayed.ok) {
        assert.equal(replayed.value.appliedRevision, 2);
        assert.equal(replayed.value.replayed, true);
      }
    } finally {
      await restored.close();
    }
    assert.deepEqual(readdirSync(directory), ["sessions.json"]);
  });

  it("serializes coalesced checkpoints while accepting a newer durable journal write", async () => {
    class PausedCheckpointStore extends FileSharedSessionStore {
      checkpointWrites = 0;
      private announceCheckpoint!: () => void;
      private releaseCheckpoint!: () => void;
      private pause = true;
      readonly checkpointStarted = new Promise<void>((resolve) => {
        this.announceCheckpoint = resolve;
      });
      private readonly checkpointReleased = new Promise<void>((resolve) => {
        this.releaseCheckpoint = resolve;
      });

      resumeCheckpoint(): void {
        this.pause = false;
        this.releaseCheckpoint();
      }

      protected override async writeCheckpoint(state: StoredSharedSessionState): Promise<void> {
        this.checkpointWrites += 1;
        if (this.pause) {
          this.announceCheckpoint();
          await this.checkpointReleased;
        }
        await super.writeCheckpoint(state);
      }
    }

    const directory = temporaryDirectory();
    const filePath = join(directory, "sessions.json");
    const store = new PausedCheckpointStore(filePath);
    const service = createJoined(store, () => 1_000);
    const firstFlush = store.flush();
    const coalescedFlush = store.flush();
    await store.checkpointStarted;

    const moved = service.submitMovement(sessionId, "alice", firstMovement);
    assert.equal(moved.ok, true);
    store.resumeCheckpoint();
    await Promise.all([firstFlush, coalescedFlush]);
    assert.equal(store.checkpointWrites, 1);

    const recoveredDuringCompaction = new FileSharedSessionStore(filePath).load();
    assert.equal(recoveredDuringCompaction.version, 3);
    if (recoveredDuringCompaction.version === 3) {
      assert.equal(recoveredDuringCompaction.sessions[0]?.snapshot.revision, 2);
      assert.deepEqual(
        recoveredDuringCompaction.sessions[0]?.snapshot.players[0]?.position,
        firstMovement.to,
      );
    }

    await service.close();
    assert.equal(store.checkpointWrites, 2);
    assert.equal(existsSync(`${filePath}.journal`), false);
    assert.equal(new FileSharedSessionStore(filePath).load().version, 3);
  });

  it("compacts a bounded journal automatically and coalesces an explicit flush", async () => {
    class CountingCheckpointStore extends FileSharedSessionStore {
      checkpointWrites = 0;

      protected override async writeCheckpoint(state: StoredSharedSessionState): Promise<void> {
        this.checkpointWrites += 1;
        await super.writeCheckpoint(state);
      }
    }

    const filePath = join(temporaryDirectory(), "sessions.json");
    const store = new CountingCheckpointStore(filePath, { journalCompactionBytes: 1 });
    const service = createJoined(store, () => 1_000);
    await store.flush();

    assert.equal(store.checkpointWrites, 1);
    assert.equal(existsSync(`${filePath}.journal`), false);
    const persisted = new FileSharedSessionStore(filePath).load();
    assert.equal(persisted.version, 3);
    if (persisted.version === 3) assert.equal(persisted.sessions[0]?.snapshot.revision, 1);
    await service.close();
  });

  it("rolls back the command and journal tail when fsync fails before acknowledgement", async () => {
    class FailingJournalSyncStore extends FileSharedSessionStore {
      failNextSync = false;

      protected override syncJournal(descriptor: number): void {
        if (this.failNextSync) {
          this.failNextSync = false;
          throw new Error("simulated journal fsync failure");
        }
        super.syncJournal(descriptor);
      }
    }

    const filePath = join(temporaryDirectory(), "sessions.json");
    const store = new FailingJournalSyncStore(filePath);
    const service = createJoined(store, () => 1_000);
    await store.flush();
    const events: unknown[] = [];
    assert.equal(service.subscribe(sessionId, "alice", (event) => events.push(event)).ok, true);
    store.failNextSync = true;

    assert.throws(
      () => service.submitMovement(sessionId, "alice", firstMovement),
      /journal fsync failure/,
    );
    assert.deepEqual(events, []);
    const afterFailure = new FileSharedSessionStore(filePath).load();
    assert.equal(afterFailure.version, 3);
    if (afterFailure.version === 3) {
      assert.equal(afterFailure.sessions[0]?.snapshot.revision, 1);
      assert.deepEqual(afterFailure.sessions[0]?.snapshot.players[0]?.position, alice.position);
    }

    assert.equal(service.submitMovement(sessionId, "alice", firstMovement).ok, true);
    await service.close();
  });

  it("keeps close pending through checkpoint fsync and permits a retry after failure", async () => {
    class ControlledCheckpointStore extends FileSharedSessionStore {
      checkpointCompleted = false;
      failNextCheckpoint = true;
      private announceCheckpoint!: () => void;
      private releaseCheckpoint!: () => void;
      readonly checkpointStarted = new Promise<void>((resolve) => {
        this.announceCheckpoint = resolve;
      });
      private readonly checkpointReleased = new Promise<void>((resolve) => {
        this.releaseCheckpoint = resolve;
      });

      resumeCheckpoint(): void {
        this.releaseCheckpoint();
      }

      protected override async writeCheckpoint(state: StoredSharedSessionState): Promise<void> {
        this.announceCheckpoint();
        await this.checkpointReleased;
        if (this.failNextCheckpoint) {
          this.failNextCheckpoint = false;
          throw new Error("simulated checkpoint failure");
        }
        await super.writeCheckpoint(state);
        this.checkpointCompleted = true;
      }
    }

    const filePath = join(temporaryDirectory(), "sessions.json");
    const store = new ControlledCheckpointStore(filePath);
    const service = createJoined(store, () => 1_000);
    let settled = false;
    const closing = service.close();
    void closing.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await store.checkpointStarted;
    await Promise.resolve();
    assert.equal(settled, false);
    store.resumeCheckpoint();
    await assert.rejects(closing, /checkpoint failure/);
    assert.equal(settled, true);
    assert.equal(existsSync(`${filePath}.journal.checkpoint`), true);

    const recovered = new FileSharedSessionStore(filePath).load();
    assert.equal(recovered.version, 3);
    if (recovered.version === 3) assert.equal(recovered.sessions[0]?.snapshot.revision, 1);
    await service.close();
    assert.equal(store.checkpointCompleted, true);
    assert.equal(existsSync(`${filePath}.journal`), false);
    assert.equal(existsSync(`${filePath}.journal.checkpoint`), false);
  });

  it("recovers when a crash leaves a completed checkpoint beside its stale frozen journal", async () => {
    class CrashAfterCheckpointStore extends FileSharedSessionStore {
      protected override async writeCheckpoint(state: StoredSharedSessionState): Promise<void> {
        await super.writeCheckpoint(state);
        throw new Error("simulated crash after checkpoint rename");
      }
    }

    const filePath = join(temporaryDirectory(), "sessions.json");
    const crashingStore = new CrashAfterCheckpointStore(filePath);
    const crashingService = createJoined(crashingStore, () => 1_000);
    await assert.rejects(crashingStore.flush(), /crash after checkpoint rename/);
    assert.equal(existsSync(`${filePath}.journal.checkpoint`), true);
    crashingService.shutdown();

    const recoveredStore = new FileSharedSessionStore(filePath);
    const recovered = recoveredStore.load();
    assert.equal(recovered.version, 3);
    if (recovered.version === 3) assert.equal(recovered.sessions[0]?.snapshot.revision, 1);
    await recoveredStore.close();
    assert.equal(existsSync(`${filePath}.journal.checkpoint`), false);
  });

  it("fails closed on truncated and out-of-order journal tails", () => {
    const truncatedPath = join(temporaryDirectory(), "truncated.json");
    const truncated = createJoined(new FileSharedSessionStore(truncatedPath), () => 1_000);
    truncated.shutdown();
    appendFileSync(`${truncatedPath}.journal`, "{\"sequence\":", "utf8");
    assert.throws(
      () => new FileSharedSessionStore(truncatedPath).load(),
      /truncated tail/,
    );

    const reorderedPath = join(temporaryDirectory(), "reordered.json");
    const reordered = createJoined(new FileSharedSessionStore(reorderedPath), () => 1_000);
    reordered.shutdown();
    const journalPath = `${reorderedPath}.journal`;
    const lines = readFileSync(journalPath, "utf8").trimEnd().split("\n");
    const duplicate = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
    duplicate.sequence = 3;
    appendFileSync(journalPath, `${JSON.stringify(duplicate)}\n`, "utf8");
    assert.throws(
      () => new FileSharedSessionStore(reorderedPath).load(),
      /out of order/,
    );

    const corruptedPath = join(temporaryDirectory(), "corrupted.json");
    const corrupted = createJoined(new FileSharedSessionStore(corruptedPath), () => 1_000);
    corrupted.shutdown();
    const corruptedJournalPath = `${corruptedPath}.journal`;
    const corruptedLines = readFileSync(corruptedJournalPath, "utf8").trimEnd().split("\n");
    const corruptedRecord = JSON.parse(corruptedLines[1] ?? "{}") as Record<string, unknown>;
    corruptedRecord.resultDigest = "0".repeat(64);
    writeFileSync(
      corruptedJournalPath,
      `${corruptedLines[0]}\n${JSON.stringify(corruptedRecord)}\n`,
      "utf8",
    );
    assert.throws(
      () => new FileSharedSessionStore(corruptedPath).load(),
      /digest does not match/,
    );
  });

  it("restores seeded progression, pending audiences, acknowledgements, and event deduplication", async () => {
    const directory = temporaryDirectory();
    const filePath = join(directory, "sessions.json");
    let now = 20_000;
    const firstService = new SharedSessionService({
      idleTtlMs: 60_000,
      now: () => now,
      store: new FileSharedSessionStore(filePath),
    });
    assert.equal(firstService.create({
      compatibility,
      ownerId: "alice",
      peerUserId: "bob",
      player: alice,
      sessionId,
      sharedProgression: {
        counters: [{ id: "badges", value: 0 }],
        milestoneIds: ["story:starter"],
      },
    }).ok, true);
    assert.equal(firstService.join({ compatibility, player: bob, sessionId, userId: "bob" }).ok, true);
    const committed = firstService.submitSharedEvent(sessionId, "alice", firstCampaignEvent);
    assert.equal(committed.ok, true);
    if (!committed.ok) return;
    assert.equal(committed.value.appliedRevision, 2);
    const acknowledged = firstService.submitEventAcknowledgement(
      sessionId,
      "alice",
      aliceEventAcknowledgement,
    );
    assert.equal(acknowledged.ok, true);
    if (!acknowledged.ok) return;
    assert.equal(acknowledged.value.appliedRevision, 3);
    assert.deepEqual(acknowledged.value.snapshot.pendingEvents[0]?.pendingPlayerIds, ["bob"]);
    await firstService.close();

    now = 20_500;
    const restored = new SharedSessionService({
      idleTtlMs: 60_000,
      now: () => now,
      store: new FileSharedSessionStore(filePath),
    });
    try {
      const snapshot = restored.read(sessionId, "alice");
      assert.equal(snapshot.ok, true);
      if (!snapshot.ok) return;
      assert.equal(snapshot.value.revision, 4);
      assert.deepEqual(snapshot.value.sharedProgression, {
        counters: [{ id: "badges", value: 1 }],
        milestoneIds: ["story:starter", "story:zephyr-badge", "story:zephyr-complete"],
      });
      assert.deepEqual(snapshot.value.pendingEvents, [{
        eventId: firstCampaignEvent.eventId,
        eventRevision: 2,
        pendingPlayerIds: ["bob"],
      }]);
      assert.equal(restored.connect(sessionId, "alice").ok, true);
      assert.equal(restored.connect(sessionId, "bob").ok, true);
      const replayed = restored.submitSharedEvent(sessionId, "alice", firstCampaignEvent);
      assert.equal(replayed.ok, true);
      if (replayed.ok) {
        assert.equal(replayed.value.replayed, true);
        assert.equal(replayed.value.appliedRevision, 2);
        assert.equal(replayed.value.snapshot.revision, 6);
      }
      const bobAcknowledgement: SharedEventAcknowledgementCommand = {
        ...aliceEventAcknowledgement,
        commandId: "event-ack:bob:zephyr",
        expectedRevision: 6,
      };
      const completed = restored.submitEventAcknowledgement(sessionId, "bob", bobAcknowledgement);
      assert.equal(completed.ok, true);
      if (completed.ok) {
        assert.equal(completed.value.snapshot.revision, 7);
        assert.deepEqual(completed.value.snapshot.pendingEvents, []);
      }
      const duplicate = restored.submitSharedEvent(sessionId, "alice", {
        ...firstCampaignEvent,
        commandId: "event:zephyr:duplicate",
        counters: [],
        expectedRevision: 7,
        milestoneIds: [],
      });
      assert.equal(duplicate.ok, false);
      if (!duplicate.ok) assert.equal(duplicate.error.code, "event-already-committed");
    } finally {
      await restored.close();
    }
    const persisted = JSON.parse(readFileSync(filePath, "utf8")) as { version: number };
    assert.equal(persisted.version, 3);
  });

  it("expires abandoned sessions on startup without extending their stored activity", async () => {
    const filePath = join(temporaryDirectory(), "sessions.json");
    const firstService = createJoined(new FileSharedSessionStore(filePath), () => 0, 1_000);
    await firstService.close();

    const restored = new SharedSessionService({
      idleTtlMs: 1_000,
      now: () => 1_000,
      store: new FileSharedSessionStore(filePath),
    });
    try {
      const missing = restored.read(sessionId, "alice");
      assert.equal(missing.ok, false);
      if (!missing.ok) assert.equal(missing.error.code, "session-not-found");
    } finally {
      await restored.close();
    }
    const persisted = JSON.parse(readFileSync(filePath, "utf8")) as { sessions: unknown[] };
    assert.deepEqual(persisted.sessions, []);
  });

  it("rebases a future activity timestamp after a wall-clock rollback", async () => {
    const filePath = join(temporaryDirectory(), "sessions.json");
    let now = 100_000;
    const firstService = createJoined(new FileSharedSessionStore(filePath), () => now, 1_000);
    await firstService.close();

    now = 0;
    const restored = new SharedSessionService({
      idleTtlMs: 1_000,
      now: () => now,
      store: new FileSharedSessionStore(filePath),
    });
    try {
      await restored.close();
      const rebased = JSON.parse(readFileSync(filePath, "utf8")) as {
        sessions: Array<{ lastActivityAt: number }>;
      };
      assert.equal(rebased.sessions[0]?.lastActivityAt, 0);
      const resumedStore = new FileSharedSessionStore(filePath);
      const resumed = new SharedSessionService({ idleTtlMs: 1_000, now: () => now, store: resumedStore });
      now = 999;
      assert.equal(resumed.purgeExpired(), 0);
      now = 1_000;
      assert.equal(resumed.purgeExpired(), 1);
      await resumed.close();
    } finally {
      await restored.close();
    }
  });

  it("rolls memory back and publishes nothing when the durable commit fails", () => {
    class FailingStore extends MemorySharedSessionStore {
      fail = false;

      override save(state: Parameters<MemorySharedSessionStore["save"]>[0]): void {
        if (this.fail) throw new Error("simulated durable write failure");
        super.save(state);
      }
    }

    const store = new FailingStore();
    const service = createJoined(store, () => 1_000);
    const events: unknown[] = [];
    assert.equal(service.subscribe(sessionId, "alice", (event) => events.push(event)).ok, true);
    store.fail = true;
    assert.throws(
      () => service.submitMovement(sessionId, "alice", firstMovement),
      /simulated durable write failure/,
    );
    assert.deepEqual(events, []);
    store.fail = false;
    const snapshot = service.read(sessionId, "alice");
    assert.equal(snapshot.ok, true);
    if (snapshot.ok) {
      assert.equal(snapshot.value.revision, 1);
      assert.deepEqual(snapshot.value.players[0]?.position, alice.position);
      assert.equal(snapshot.value.players[0]?.movementSequence, 0);
    }
    service.shutdown();
  });

  it("does not acknowledge or publish a shared event before its durable commit", () => {
    class FailingStore extends MemorySharedSessionStore {
      fail = false;

      override save(state: Parameters<MemorySharedSessionStore["save"]>[0]): void {
        if (this.fail) throw new Error("simulated campaign write failure");
        super.save(state);
      }
    }

    const store = new FailingStore();
    const service = new SharedSessionService({ now: () => 1_000, store });
    assert.equal(service.create({
      compatibility,
      ownerId: "alice",
      peerUserId: "bob",
      player: alice,
      sessionId,
      sharedProgression: { counters: [{ id: "badges", value: 0 }], milestoneIds: [] },
    }).ok, true);
    assert.equal(service.join({ compatibility, player: bob, sessionId, userId: "bob" }).ok, true);
    const events: unknown[] = [];
    assert.equal(service.subscribe(sessionId, "alice", (event) => events.push(event)).ok, true);
    store.fail = true;
    assert.throws(
      () => service.submitSharedEvent(sessionId, "alice", firstCampaignEvent),
      /simulated campaign write failure/,
    );
    assert.deepEqual(events, []);
    store.fail = false;
    const snapshot = service.read(sessionId, "alice");
    assert.equal(snapshot.ok, true);
    if (snapshot.ok) {
      assert.equal(snapshot.value.revision, 1);
      assert.deepEqual(snapshot.value.pendingEvents, []);
      assert.deepEqual(snapshot.value.sharedProgression, {
        counters: [{ id: "badges", value: 0 }],
        milestoneIds: [],
      });
    }
    const retry = service.submitSharedEvent(sessionId, "alice", firstCampaignEvent);
    assert.equal(retry.ok, true);
    assert.equal(events.length, 1);
    service.shutdown();
  });

  it("rolls a member departure and its pending audience back on write failure", () => {
    class FailingStore extends MemorySharedSessionStore {
      fail = false;

      override save(state: Parameters<MemorySharedSessionStore["save"]>[0]): void {
        if (this.fail) throw new Error("simulated leave write failure");
        super.save(state);
      }
    }

    const store = new FailingStore();
    const service = new SharedSessionService({ now: () => 1_000, store });
    assert.equal(service.create({
      compatibility,
      ownerId: "alice",
      peerUserId: "bob",
      player: alice,
      sessionId,
      sharedProgression: { counters: [{ id: "badges", value: 0 }], milestoneIds: [] },
    }).ok, true);
    assert.equal(service.join({ compatibility, player: bob, sessionId, userId: "bob" }).ok, true);
    assert.equal(service.submitSharedEvent(sessionId, "alice", firstCampaignEvent).ok, true);
    const events: unknown[] = [];
    assert.equal(service.subscribe(sessionId, "alice", (event) => events.push(event)).ok, true);
    store.fail = true;
    assert.throws(() => service.leave(sessionId, "bob"), /simulated leave write failure/);
    assert.deepEqual(events, []);
    store.fail = false;
    const snapshot = service.read(sessionId, "alice");
    assert.equal(snapshot.ok, true);
    if (snapshot.ok) {
      assert.equal(snapshot.value.players.length, 2);
      assert.deepEqual(snapshot.value.pendingEvents[0]?.pendingPlayerIds, ["alice", "bob"]);
    }
    service.shutdown();
  });

  it("migrates an event-free V1 store explicitly and rejects ambiguous legacy pending events", async () => {
    const directory = temporaryDirectory();
    const filePath = join(directory, "legacy.json");
    const original = createJoined(new FileSharedSessionStore(filePath), () => 1_000);
    assert.equal(original.submitMovement(sessionId, "alice", firstMovement).ok, true);
    await original.close();

    const legacy = JSON.parse(readFileSync(filePath, "utf8")) as {
      continuityHeads?: unknown[];
      version: number;
      sessions: Array<{
        commandCaches: Array<{ commands: Array<{ fingerprint: string }> }>;
        snapshot: Record<string, unknown>;
      }>;
    };
    legacy.version = 1;
    delete legacy.continuityHeads;
    for (const session of legacy.sessions) {
      session.snapshot.protocolVersion = 1;
      session.snapshot.pendingEventIds = [];
      delete session.snapshot.pendingEvents;
      for (const cache of session.commandCaches) {
        for (const command of cache.commands) {
          const decoded = JSON.parse(command.fingerprint) as Record<string, unknown>;
          decoded.protocolVersion = 1;
          command.fingerprint = JSON.stringify(decoded);
        }
      }
    }
    writeFileSync(filePath, JSON.stringify(legacy), "utf8");

    const migrated = new SharedSessionService({
      now: () => 1_500,
      store: new FileSharedSessionStore(filePath),
    });
    try {
      const replayed = migrated.submitMovement(sessionId, "alice", firstMovement);
      assert.equal(replayed.ok, true);
      if (replayed.ok) {
        assert.equal(replayed.value.replayed, true);
        assert.equal(replayed.value.appliedRevision, 2);
      }
    } finally {
      await migrated.close();
    }
    const upgraded = JSON.parse(readFileSync(filePath, "utf8")) as {
      version: number;
      sessions: Array<{ snapshot: Record<string, unknown> }>;
    };
    assert.equal(upgraded.version, 3);
    assert.equal(upgraded.sessions[0]?.snapshot.protocolVersion, 2);
    assert.deepEqual(upgraded.sessions[0]?.snapshot.pendingEvents, []);
    assert.equal(Object.hasOwn(upgraded.sessions[0]?.snapshot ?? {}, "pendingEventIds"), false);

    legacy.sessions[0]!.snapshot.pendingEventIds = ["legacy:unknown-event"];
    writeFileSync(filePath, JSON.stringify(legacy), "utf8");
    assert.throws(
      () => new FileSharedSessionStore(filePath).load(),
      /cannot be migrated safely/,
    );
  });

  it("rejects persisted event graphs that contradict receipts or acknowledgements", async () => {
    const filePath = join(temporaryDirectory(), "event-graph.json");
    const service = new SharedSessionService({
      now: () => 1_000,
      store: new FileSharedSessionStore(filePath),
    });
    assert.equal(service.create({
      compatibility,
      ownerId: "alice",
      peerUserId: "bob",
      player: alice,
      sessionId,
      sharedProgression: { counters: [{ id: "badges", value: 0 }], milestoneIds: [] },
    }).ok, true);
    assert.equal(service.join({ compatibility, player: bob, sessionId, userId: "bob" }).ok, true);
    assert.equal(service.submitSharedEvent(sessionId, "alice", firstCampaignEvent).ok, true);
    assert.equal(service.submitEventAcknowledgement(
      sessionId,
      "alice",
      aliceEventAcknowledgement,
    ).ok, true);
    await service.close();

    type Persisted = {
      sessions: Array<{
        snapshot: {
          pendingEvents: Array<{ eventId: string; eventRevision: number; pendingPlayerIds: string[] }>;
          sharedProgression: { counters: unknown[]; milestoneIds: string[] };
        };
      }>;
    };
    const valid = JSON.parse(readFileSync(filePath, "utf8")) as Persisted;
    const missingReceipt = structuredClone(valid);
    missingReceipt.sessions[0]!.snapshot.sharedProgression.milestoneIds = [];
    writeFileSync(filePath, JSON.stringify(missingReceipt), "utf8");
    assert.throws(() => new FileSharedSessionStore(filePath).load(), /pending event/);

    const acknowledgedAgain = structuredClone(valid);
    acknowledgedAgain.sessions[0]!.snapshot.pendingEvents[0]!.pendingPlayerIds = ["alice", "bob"];
    writeFileSync(filePath, JSON.stringify(acknowledgedAgain), "utf8");
    assert.throws(() => new FileSharedSessionStore(filePath).load(), /fingerprint is not canonical/);

    const impossibleRevision = structuredClone(valid);
    impossibleRevision.sessions[0]!.snapshot.pendingEvents[0]!.eventRevision = 0;
    writeFileSync(filePath, JSON.stringify(impossibleRevision), "utf8");
    assert.throws(() => new FileSharedSessionStore(filePath).load(), /pending event/);
  });

  it("fails closed on corruption, unsupported payload fields, and symbolic links", async () => {
    const directory = temporaryDirectory();
    const filePath = join(directory, "sessions.json");
    const service = createJoined(new FileSharedSessionStore(filePath), () => 1_000);
    await service.close();

    const state = JSON.parse(readFileSync(filePath, "utf8")) as {
      sessions: Array<{
        commandCaches: Array<{ commands: unknown[] }>;
        snapshot: Record<string, unknown>;
      }>;
      version: 2;
    };
    const decoratedSessions = structuredClone(state);
    Object.defineProperty(decoratedSessions.sessions, "unsupported", {
      enumerable: true,
      value: true,
    });
    assert.throws(
      () => new MemorySharedSessionStore(
        decoratedSessions as unknown as ReturnType<typeof emptySharedSessionState>,
      ),
      /sessions are invalid/,
    );
    const decoratedCommands = structuredClone(state);
    Object.defineProperty(decoratedCommands.sessions[0]!.commandCaches[0]!.commands, "unsupported", {
      enumerable: true,
      value: true,
    });
    assert.throws(
      () => new MemorySharedSessionStore(
        decoratedCommands as unknown as ReturnType<typeof emptySharedSessionState>,
      ),
      /command cache 0 is invalid/,
    );
    state.sessions[0]!.snapshot.savePayload = "not-server-data";
    writeFileSync(filePath, JSON.stringify(state), "utf8");
    assert.throws(
      () => new SharedSessionService({ store: new FileSharedSessionStore(filePath) }),
      /invalid shape/,
    );

    const realFile = join(directory, "real.json");
    writeFileSync(realFile, JSON.stringify(emptySharedSessionState()), "utf8");
    const linkedFile = join(directory, "linked.json");
    symlinkSync(realFile, linkedFile);
    assert.throws(() => new FileSharedSessionStore(linkedFile).load(), /non-symlink/);

    const realDirectory = join(directory, "real-directory");
    const linkedDirectory = join(directory, "linked-directory");
    new FileSharedSessionStore(join(realDirectory, "seed.json")).save(emptySharedSessionState());
    symlinkSync(realDirectory, linkedDirectory, "dir");
    assert.throws(
      () => new FileSharedSessionStore(join(linkedDirectory, "seed.json")).load(),
      /non-symlink directory/,
    );
    assert.throws(
      () => new FileSharedSessionStore(join(linkedDirectory, "state.json")).save(emptySharedSessionState()),
      /non-symlink directory/,
    );

    class DisguisedState {
      readonly sessions = [];
      readonly version = 1 as const;

      toJSON() {
        return emptySharedSessionState();
      }
    }
    const disguised = new DisguisedState() as unknown as ReturnType<typeof emptySharedSessionState>;
    assert.throws(() => new MemorySharedSessionStore(disguised), /plain object/);
    assert.throws(
      () => new FileSharedSessionStore(join(directory, "disguised.json")).save(disguised),
      /plain object/,
    );
  });
});
