import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMatchmakingActivity,
  MatchmakingService,
  type MatchmakingServiceOptions,
} from "../src/domain/matchmaking.js";
import { ServiceError } from "../src/errors.js";

const opaqueId = (seed: number): string => Buffer.alloc(16, seed).toString("base64url");

const serviceOptions = (
  overrides: Partial<MatchmakingServiceOptions> = {},
): MatchmakingServiceOptions => ({
  authorizationTtlMs: 2_000,
  maintenanceIntervalMs: 60_000,
  queueTtlMs: 1_000,
  ...overrides,
});

describe("matchmaking service", () => {
  it("randomly pairs a bounded queue and assigns one deterministic offerer", () => {
    let serial = 0;
    const selections = [2, 0, 1, 0];
    const service = new MatchmakingService(serviceOptions({
      idFactory: () => opaqueId(++serial),
      randomIndex: (upperBound) => {
        const selected = selections.shift() ?? 0;
        assert.ok(selected < upperBound);
        return selected;
      },
    }));
    try {
      for (const userId of ["alice", "bob", "carol", "dave"]) {
        assert.equal(service.join(userId, "pvp").status, "queued");
      }
      service.maintain();

      const alice = service.status("alice");
      const carol = service.status("carol");
      assert.deepEqual(alice, {
        activity: "pvp",
        expiresAt: alice.status === "matched" ? alice.expiresAt : -1,
        matchId: opaqueId(1),
        negotiationId: opaqueId(2),
        peerUserId: "carol",
        role: "offerer",
        status: "matched",
      });
      assert.deepEqual(carol, {
        ...alice,
        peerUserId: "alice",
        role: "answerer",
      });
      assert.equal(service.status("bob").status, "matched");
      assert.equal(service.status("dave").status, "matched");

      assert.equal(
        service.isSignalAuthorized("alice", "carol", opaqueId(2)),
        true,
      );
      assert.equal(
        service.isSignalAuthorizedForActivity("alice", "carol", opaqueId(2), "pvp"),
        true,
      );
      assert.equal(
        service.isSignalAuthorizedForActivity("alice", "carol", opaqueId(2), "coop"),
        false,
      );
      assert.equal(
        service.isSignalAuthorized("carol", "alice", opaqueId(2)),
        true,
      );
      assert.equal(
        service.isSignalAuthorized("alice", "carol", opaqueId(3)),
        false,
      );
      assert.equal(service.isSignalAuthorized("alice", "bob", opaqueId(2)), false);

      assert.equal(service.cancel("carol"), true);
      assert.deepEqual(service.status("alice"), { status: "idle" });
      assert.deepEqual(service.status("carol"), { status: "idle" });
    } finally {
      service.shutdown();
    }
  });

  it("keeps joins idempotent, isolates activities and cleans up on disconnect", () => {
    let serial = 10;
    const service = new MatchmakingService(serviceOptions({
      idFactory: () => opaqueId(++serial),
      randomIndex: () => 0,
    }));
    try {
      const first = service.join("alice", "trade");
      assert.deepEqual(service.join("alice", "trade"), first);
      assert.throws(
        () => service.join("alice", "coop"),
        (error: unknown) => error instanceof ServiceError && error.status === 409,
      );
      service.join("bob", "trade");
      service.maintain();
      assert.equal(service.status("alice").status, "matched");

      service.disconnect("bob");
      assert.deepEqual(service.status("alice"), { status: "idle" });
      assert.deepEqual(service.status("bob"), { status: "idle" });
      assert.equal(service.cancel("bob"), false);
    } finally {
      service.shutdown();
    }
  });

  it("expires queued searches and matched signaling authorizations", () => {
    let now = 1_000;
    let serial = 20;
    const service = new MatchmakingService(serviceOptions({
      authorizationTtlMs: 200,
      idFactory: () => opaqueId(++serial),
      now: () => now,
      queueTtlMs: 100,
      randomIndex: () => 0,
    }));
    try {
      service.join("alice", "coop");
      assert.equal(service.hasEngagement("alice"), true);
      now = 1_100;
      assert.equal(service.hasEngagement("alice"), false);
      assert.deepEqual(service.status("alice"), { status: "idle" });

      now = 2_000;
      service.join("alice", "coop");
      service.join("bob", "coop");
      service.maintain();
      const matched = service.status("alice");
      assert.equal(matched.status, "matched");
      assert.equal(service.hasEngagement("alice"), true);
      assert.equal(service.hasEngagement("bob"), true);
      if (matched.status !== "matched") assert.fail("Expected a match");
      now = matched.expiresAt;
      assert.equal(service.hasEngagement("alice"), false);
      assert.equal(
        service.isSignalAuthorized("alice", "bob", matched.negotiationId),
        false,
      );
      assert.deepEqual(service.status("bob"), { status: "idle" });
    } finally {
      service.shutdown();
    }
  });

  it("rejects queue overflow and only exposes the three exact activities", () => {
    const service = new MatchmakingService(serviceOptions({ maximumQueued: 2 }));
    try {
      service.join("alice", "trade");
      service.join("bob", "pvp");
      assert.throws(
        () => service.join("carol", "coop"),
        (error: unknown) => error instanceof ServiceError && error.status === 503,
      );
      assert.equal(isMatchmakingActivity("trade"), true);
      assert.equal(isMatchmakingActivity("pvp"), true);
      assert.equal(isMatchmakingActivity("coop"), true);
      assert.equal(isMatchmakingActivity("ranked"), false);
      assert.equal(isMatchmakingActivity({ activity: "pvp" }), false);
    } finally {
      service.shutdown();
    }
  });
});
