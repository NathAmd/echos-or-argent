import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  isObjectId,
  MAX_CIPHERTEXT_BYTES,
  MAX_OBJECTS_PER_USER,
  type OpaqueObjectEnvelope,
  parseOpaqueObjectEnvelope,
} from "../src/domain/opaque-objects.js";
import { ServiceError } from "../src/errors.js";
import { FileOpaqueObjectStore } from "../src/persistence/file-opaque-object-store.js";

const envelope = (size = 32, fill = 1): OpaqueObjectEnvelope => ({
  algorithm: "A256GCM",
  ciphertext: Buffer.alloc(size, fill).toString("base64url"),
  iv: Buffer.alloc(12, fill).toString("base64url"),
  version: 1,
});

const objectId = (fill: number): string => Buffer.alloc(16, fill).toString("base64url");

const isServiceError = (status: number, code: string) => (error: unknown): boolean =>
  error instanceof ServiceError && error.status === status && error.code === code;

describe("opaque object envelope", () => {
  it("accepts only the exact bounded encrypted shape", () => {
    assert.deepEqual(parseOpaqueObjectEnvelope(envelope()), envelope());
    assert.throws(
      () => parseOpaqueObjectEnvelope({ ...envelope(), metadata: "not accepted" }),
      isServiceError(400, "BAD_REQUEST"),
    );
    assert.throws(
      () => parseOpaqueObjectEnvelope({ ...envelope(), iv: Buffer.alloc(11).toString("base64url") }),
      isServiceError(400, "BAD_REQUEST"),
    );
    assert.throws(
      () => parseOpaqueObjectEnvelope({ ...envelope(), ciphertext: "AQ==" }),
      isServiceError(400, "BAD_REQUEST"),
    );
    assert.throws(
      () => parseOpaqueObjectEnvelope(envelope(MAX_CIPHERTEXT_BYTES + 1)),
      isServiceError(413, "PAYLOAD_TOO_LARGE"),
    );
  });

  it("accepts only canonical opaque 128-bit object identifiers", () => {
    assert.equal(isObjectId(objectId(1)), true);
    assert.equal(isObjectId("primary"), false);
    assert.equal(isObjectId(`${objectId(1)}=`), false);
    assert.equal(isObjectId("______________________"), false);
  });
});

describe("file opaque object store", () => {
  it("lets a reloaded instance read and CAS-replace an object from the first instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "generic-object-store-reload-test-"));
    try {
      const firstStore = new FileOpaqueObjectStore(directory);
      const id = objectId(1);
      const initialEnvelope = envelope(32, 1);
      const created = await firstStore.put("alice", id, initialEnvelope, { kind: "create" });

      const reloadedStore = new FileOpaqueObjectStore(directory);
      assert.deepEqual(await reloadedStore.get("alice", id), {
        envelope: initialEnvelope,
        mutation: created.mutation,
        revision: created.revision,
      });

      const replacementEnvelope = envelope(48, 2);
      const replaced = await reloadedStore.put("alice", id, replacementEnvelope, {
        kind: "match",
        revision: created.revision,
      });
      assert.equal(replaced.created, false);
      assert.notEqual(replaced.revision, created.revision);
      assert.deepEqual(await firstStore.get("alice", id), {
        envelope: replacementEnvelope,
        mutation: replaced.mutation,
        revision: replaced.revision,
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("persists atomically with optimistic revisions and survives reload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "generic-object-store-test-"));
    try {
      const store = new FileOpaqueObjectStore(directory);
      const id = objectId(1);
      const created = await store.put("alice", id, envelope(), { kind: "create" });
      assert.equal(created.created, true);
      assert.match(created.revision, /^[a-f0-9]{32}$/);
      assert.deepEqual(await store.get("alice", id), {
        envelope: envelope(),
        mutation: created.mutation,
        revision: created.revision,
      });
      assert.equal(await store.get("bob", id), null);

      await assert.rejects(
        store.put("alice", id, envelope(48), { kind: "create" }),
        isServiceError(412, "PRECONDITION_FAILED"),
      );

      const attempts = await Promise.allSettled([
        store.put("alice", id, envelope(48, 2), {
          kind: "match",
          revision: created.revision,
        }),
        store.put("alice", id, envelope(64, 3), {
          kind: "match",
          revision: created.revision,
        }),
      ]);
      assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
      const rejected = attempts.find(({ status }) => status === "rejected");
      assert.equal(rejected?.status, "rejected");
      if (rejected?.status === "rejected") {
        assert.equal(isServiceError(412, "PRECONDITION_FAILED")(rejected.reason), true);
      }

      const reloaded = new FileOpaqueObjectStore(directory);
      const current = await reloaded.get("alice", id);
      assert.notEqual(current, null);
      assert.notEqual(current?.revision, created.revision);
      const entries = await readdir(join(directory, "alice"));
      assert.deepEqual(entries, [`${id}.json`]);

      await reloaded.delete("alice", id, current?.revision ?? "");
      const recreated = await reloaded.put("alice", id, envelope(32, 4), { kind: "create" });
      assert.notEqual(recreated.revision, current?.revision);
      await assert.rejects(
        reloaded.put("alice", id, envelope(), {
          kind: "match",
          revision: current?.revision ?? "",
        }),
        isServiceError(412, "PRECONDITION_FAILED"),
      );

      const maximumEnvelope = envelope(MAX_CIPHERTEXT_BYTES, 5);
      const maximum = await reloaded.put("bob", objectId(2), maximumEnvelope, { kind: "create" });
      assert.equal(maximum.created, true);
      assert.deepEqual((await reloaded.get("bob", objectId(2)))?.envelope, maximumEnvelope);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("enforces the per-user object quota without crossing identity boundaries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "generic-object-quota-test-"));
    try {
      const store = new FileOpaqueObjectStore(directory);
      for (let index = 0; index < MAX_OBJECTS_PER_USER; index += 1) {
        await store.put("alice", objectId(index), envelope(16, index), { kind: "create" });
      }
      await assert.rejects(
        store.put(
          "alice",
          objectId(MAX_OBJECTS_PER_USER),
          envelope(16, MAX_OBJECTS_PER_USER),
          { kind: "create" },
        ),
        isServiceError(413, "QUOTA_EXCEEDED"),
      );
      const existing = await store.get("alice", objectId(0));
      assert.ok(existing);
      await store.put("alice", objectId(0), envelope(16, 99), {
        kind: "match",
        revision: existing.revision,
      });
      const otherUser = await store.put(
        "bob",
        objectId(MAX_OBJECTS_PER_USER),
        envelope(16, MAX_OBJECTS_PER_USER),
        { kind: "create" },
      );
      assert.equal(otherUser.created, true);

      for (let index = 0; index < 7; index += 1) {
        await store.put("carol", objectId(index), envelope(MAX_CIPHERTEXT_BYTES, index), {
          kind: "create",
        });
      }
      await assert.rejects(
        store.put("carol", objectId(7), envelope(MAX_CIPHERTEXT_BYTES, 7), { kind: "create" }),
        isServiceError(413, "QUOTA_EXCEEDED"),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects keys that could escape their bounded namespace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "generic-object-key-test-"));
    try {
      const store = new FileOpaqueObjectStore(directory);
      await assert.rejects(store.get("alice", "../other"), /key is invalid/);
      await assert.rejects(store.get("../alice", objectId(1)), /key is invalid/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps its persisted hybrid logical clock monotonic across a wall-clock rollback and restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "generic-object-clock-test-"));
    try {
      let sampledTime = 5_000;
      const id = objectId(7);
      const first = new FileOpaqueObjectStore(directory, { now: () => sampledTime });
      const created = await first.put("alice", id, envelope(32, 1), { kind: "create" });

      sampledTime = 4_000;
      const replaced = await first.put("alice", id, envelope(32, 2), {
        kind: "match",
        revision: created.revision,
      });
      assert.ok(BigInt(`0x${replaced.mutation}`) > BigInt(`0x${created.mutation}`));

      sampledTime = 3_000;
      const reloaded = new FileOpaqueObjectStore(directory, { now: () => sampledTime });
      const afterRestart = await reloaded.put("alice", id, envelope(32, 3), {
        kind: "match",
        revision: replaced.revision,
      });
      assert.ok(BigInt(`0x${afterRestart.mutation}`) > BigInt(`0x${replaced.mutation}`));

      await reloaded.delete("alice", id, afterRestart.revision);
      sampledTime = 2_000;
      const recreated = await reloaded.put("alice", id, envelope(32, 4), { kind: "create" });
      assert.ok(BigInt(`0x${recreated.mutation}`) > BigInt(`0x${afterRestart.mutation}`));
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reads storageVersion 1 safely and migrates it atomically on the next CAS write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "generic-object-v1-migration-test-"));
    try {
      const id = objectId(8);
      const revision = "1".repeat(32);
      await mkdir(join(directory, "alice"), { recursive: true });
      await writeFile(join(directory, "alice", `${id}.json`), `${JSON.stringify({
        storageVersion: 1,
        revision,
        envelope: envelope(32, 8),
      })}\n`, { encoding: "utf8", mode: 0o600 });

      const store = new FileOpaqueObjectStore(directory, { now: () => 1_000 });
      assert.deepEqual(await store.get("alice", id), {
        envelope: envelope(32, 8),
        mutation: "0".repeat(32),
        revision,
      });
      const migrated = await store.put("alice", id, envelope(48, 9), {
        kind: "match",
        revision,
      });
      const persisted = JSON.parse(
        await readFile(join(directory, "alice", `${id}.json`), "utf8"),
      ) as Record<string, unknown>;
      assert.equal(persisted.storageVersion, 2);
      assert.equal(persisted.mutation, migrated.mutation);

      const reloaded = new FileOpaqueObjectStore(directory, { now: () => 500 });
      assert.equal((await reloaded.get("alice", id))?.mutation, migrated.mutation);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
