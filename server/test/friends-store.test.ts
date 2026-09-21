import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FriendService } from "../src/domain/friends.js";
import { ServiceError } from "../src/errors.js";
import {
  FileFriendStore,
  MAX_FRIEND_STORE_RELATIONSHIPS,
  MemoryFriendStore,
} from "../src/persistence/friend-store.js";

const USERS = new Set(["alice", "bob", "carol"]);

describe("friend service", () => {
  it("persists the request, acceptance and removal lifecycle", async () => {
    const store = new MemoryFriendStore();
    const service = await FriendService.create(store, USERS);

    await service.sendRequest("alice", "bob");
    assert.deepEqual(service.list("alice"), { friends: [], incoming: [], outgoing: ["bob"] });
    assert.deepEqual(service.list("bob"), { friends: [], incoming: ["alice"], outgoing: [] });

    await service.acceptRequest("bob", "alice");
    assert.equal(service.areFriends("alice", "bob"), true);
    assert.deepEqual(service.list("alice").friends, ["bob"]);

    const reloaded = await FriendService.create(store, USERS);
    assert.equal(reloaded.areFriends("alice", "bob"), true);
    await reloaded.removeFriend("alice", "bob");
    assert.equal(reloaded.areFriends("alice", "bob"), false);
  });

  it("distinguishes decline and cancellation and rejects inconsistent operations", async () => {
    const service = await FriendService.create(new MemoryFriendStore(), USERS);
    await service.sendRequest("alice", "bob");

    await assert.rejects(
      service.cancelRequest("bob", "alice"),
      (error: unknown) => error instanceof ServiceError && error.status === 404,
    );
    await service.declineRequest("bob", "alice");
    assert.deepEqual(service.list("alice").outgoing, []);

    await assert.rejects(
      service.sendRequest("alice", "alice"),
      (error: unknown) => error instanceof ServiceError && error.status === 400,
    );
    await assert.rejects(
      service.sendRequest("alice", "unknown"),
      (error: unknown) => error instanceof ServiceError && error.status === 404,
    );
  });

  it("serializes concurrent mutations without losing either request", async () => {
    const store = new MemoryFriendStore();
    const service = await FriendService.create(store, USERS);

    await Promise.all([
      service.sendRequest("alice", "bob"),
      service.sendRequest("alice", "carol"),
    ]);

    const reloaded = await FriendService.create(store, USERS);
    assert.deepEqual(reloaded.list("alice").outgoing, ["bob", "carol"]);
  });

  it("admits only one concurrent friendship at the global capacity boundary", async () => {
    const graphUsers = Array.from(
      { length: 1_000 },
      (_, index) => `user-${index.toString().padStart(4, "0")}`,
    );
    const friendships: [string, string][] = [];
    for (let index = 0; index < graphUsers.length; index += 1) {
      for (let offset = 1; offset <= 100; offset += 1) {
        const first = graphUsers[index] as string;
        const second = graphUsers[(index + offset) % graphUsers.length] as string;
        friendships.push(first < second ? [first, second] : [second, first]);
      }
    }
    friendships.pop();
    assert.equal(friendships.length, MAX_FRIEND_STORE_RELATIONSHIPS - 1);

    const pendingPairs = [
      ["extra-a", "extra-b"],
      ["extra-c", "extra-d"],
    ] as const;
    const knownUsers = new Set([...graphUsers, ...pendingPairs.flat()]);
    const store = new MemoryFriendStore({
      friendships,
      requests: pendingPairs.map(([from, to]) => ({ from, to })),
      version: 1,
    });
    const service = await FriendService.create(store, knownUsers);

    const results = await Promise.allSettled(
      pendingPairs.map(([from, to]) => service.acceptRequest(to, from)),
    );
    assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = results.find(({ status }) => status === "rejected");
    assert.equal(rejected?.status, "rejected");
    if (rejected?.status === "rejected") {
      assert.equal(rejected.reason instanceof ServiceError, true);
      assert.equal((rejected.reason as ServiceError).status, 503);
      assert.equal((rejected.reason as ServiceError).code, "UNAVAILABLE");
    }

    const restarted = await FriendService.create(store, knownUsers);
    const acceptedCount = pendingPairs.filter(([from, to]) => restarted.areFriends(from, to)).length;
    const pendingCount = pendingPairs.filter(([from, to]) =>
      restarted.list(from).outgoing.includes(to)
    ).length;
    assert.equal(acceptedCount, 1);
    assert.equal(pendingCount, 1);
  });

  it("admits only one concurrent request at the global capacity boundary", async () => {
    const senders = Array.from(
      { length: 1_000 },
      (_, index) => `sender-${index.toString().padStart(4, "0")}`,
    );
    const recipients = Array.from(
      { length: 1_000 },
      (_, index) => `recipient-${index.toString().padStart(4, "0")}`,
    );
    const requests: { from: string; to: string }[] = [];
    for (let index = 0; index < senders.length; index += 1) {
      for (let offset = 0; offset < 100; offset += 1) {
        requests.push({
          from: senders[index] as string,
          to: recipients[(index + offset) % recipients.length] as string,
        });
      }
    }
    requests.pop();
    assert.equal(requests.length, MAX_FRIEND_STORE_RELATIONSHIPS - 1);

    const newPairs = [
      ["extra-a", "extra-b"],
      ["extra-c", "extra-d"],
    ] as const;
    const knownUsers = new Set([...senders, ...recipients, ...newPairs.flat()]);
    const store = new MemoryFriendStore({ friendships: [], requests, version: 1 });
    const service = await FriendService.create(store, knownUsers);

    const results = await Promise.allSettled(
      newPairs.map(([from, to]) => service.sendRequest(from, to)),
    );
    assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = results.find(({ status }) => status === "rejected");
    assert.equal(rejected?.status, "rejected");
    if (rejected?.status === "rejected") {
      assert.equal(rejected.reason instanceof ServiceError, true);
      assert.equal((rejected.reason as ServiceError).status, 503);
      assert.equal((rejected.reason as ServiceError).code, "UNAVAILABLE");
    }

    const restarted = await FriendService.create(store, knownUsers);
    const persistedCount = newPairs.filter(([from, to]) =>
      restarted.list(from).outgoing.includes(to)
    ).length;
    assert.equal(persistedCount, 1);
  });
});

describe("file friend store", () => {
  it("round-trips validated state through the atomic file adapter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "social-server-test-"));
    const path = join(directory, "nested", "friends.json");
    try {
      const service = await FriendService.create(new FileFriendStore(path), USERS);
      await service.sendRequest("alice", "bob");
      const contents = JSON.parse(await readFile(path, "utf8")) as unknown;
      assert.deepEqual(contents, {
        friendships: [],
        requests: [{ from: "alice", to: "bob" }],
        version: 1,
      });

      const reloaded = await FriendService.create(new FileFriendStore(path), USERS);
      assert.deepEqual(reloaded.list("bob").incoming, ["alice"]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a corrupt persisted relationship graph", async () => {
    const directory = await mkdtemp(join(tmpdir(), "social-server-test-"));
    const path = join(directory, "friends.json");
    try {
      await writeFile(
        path,
        JSON.stringify({ friendships: [["alice", "unknown"]], requests: [], version: 1 }),
        "utf8",
      );
      await assert.rejects(
        FriendService.create(new FileFriendStore(path), USERS),
        /unknown friendship/,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("accepts the exact relationship boundary and preserves it after a rejected overflow", async () => {
    const directory = await mkdtemp(join(tmpdir(), "social-server-test-"));
    const path = join(directory, "friends.json");
    const atCapacity = {
      friendships: Array.from(
        { length: MAX_FRIEND_STORE_RELATIONSHIPS },
        () => ["alice", "bob"] as const,
      ),
      requests: [],
      version: 1 as const,
    };
    try {
      const store = new FileFriendStore(path);
      await store.save(atCapacity);
      await assert.rejects(
        store.save({
          ...atCapacity,
          friendships: [...atCapacity.friendships, ["alice", "carol"]],
        }),
        /relationship limit/,
      );

      const restarted = new FileFriendStore(path);
      const reloaded = await restarted.load();
      assert.equal(reloaded.friendships.length, MAX_FRIEND_STORE_RELATIONSHIPS);
      assert.deepEqual(reloaded.friendships.at(-1), ["alice", "bob"]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
