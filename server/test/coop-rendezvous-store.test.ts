import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  emptyCoopRendezvousState,
  FileCoopRendezvousStore,
  MemoryCoopRendezvousStore,
  parseStoredCoopRendezvousState,
  type StoredCoopRendezvousState,
} from "../src/persistence/coop-rendezvous-store.js";

const sessionId = Buffer.alloc(16, 7).toString("base64url");

const validState = (): StoredCoopRendezvousState => ({
  queued: [{ expiresAt: 2_000, joinedAt: 1_000, userId: "carol" }],
  sessions: [{
    createdAt: 1_000,
    expiresAt: 3_000,
    guestUserId: "bob",
    hostUserId: "alice",
    mode: "friend",
    sessionId,
    status: "offered",
  }],
  version: 1,
});

describe("Coop rendezvous persistence", () => {
  it("round-trips queues, offers and active sessions through an atomic file", () => {
    const directory = mkdtempSync(join(tmpdir(), "coop-rendezvous-test-"));
    const filePath = join(directory, "nested", "rendezvous.json");
    try {
      const store = new FileCoopRendezvousStore(filePath);
      store.save(validState());
      assert.deepEqual(store.load(), validState());
      assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), validState());

      const active = validState();
      active.sessions[0] = { ...active.sessions[0]!, status: "active" };
      store.save(active);
      assert.equal(new FileCoopRendezvousStore(filePath).load().sessions[0]?.status, "active");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects duplicate identities, forged random roles and extra fields", () => {
    const duplicate = validState();
    duplicate.queued.push({ expiresAt: 4_000, joinedAt: 1_000, userId: "alice" });
    assert.throws(
      () => new MemoryCoopRendezvousStore(duplicate),
      /reuses an engaged identity/,
    );

    const forgedRandom = validState();
    forgedRandom.queued = [];
    forgedRandom.sessions[0] = {
      ...forgedRandom.sessions[0]!,
      guestUserId: "alice",
      hostUserId: "zoe",
      mode: "random",
      status: "ready",
    };
    assert.throws(() => parseStoredCoopRendezvousState(forgedRandom), /invalid/);

    assert.throws(
      () => parseStoredCoopRendezvousState({ ...validState(), attacker: true }),
      /invalid shape/,
    );
  });

  it("fails closed on malformed JSON and symbolic links", () => {
    const directory = mkdtempSync(join(tmpdir(), "coop-rendezvous-test-"));
    try {
      const corruptPath = join(directory, "corrupt.json");
      writeFileSync(corruptPath, "{", "utf8");
      assert.throws(
        () => new FileCoopRendezvousStore(corruptPath).load(),
        /invalid JSON/,
      );

      const realPath = join(directory, "real.json");
      writeFileSync(realPath, JSON.stringify(emptyCoopRendezvousState()), "utf8");
      const linkPath = join(directory, "linked.json");
      symlinkSync(realPath, linkPath);
      assert.throws(
        () => new FileCoopRendezvousStore(linkPath).load(),
        /non-symlink/,
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
