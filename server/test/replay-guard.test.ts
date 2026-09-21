import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RealtimeReplayGuard } from "../src/realtime/replay-guard.js";

describe("realtime replay guard", () => {
  it("rejects a repeated request per identity until it expires", () => {
    let now = 1_000;
    const guard = new RealtimeReplayGuard(5_000, 4, 8, () => now);

    assert.equal(guard.accept("alice", "request-a"), true);
    assert.equal(guard.accept("alice", "request-a"), false);
    assert.equal(guard.accept("bob", "request-a"), true);

    now = 6_000;
    assert.equal(guard.accept("alice", "request-a"), true);
  });

  it("bounds retained IDs per identity and globally", () => {
    const guard = new RealtimeReplayGuard(60_000, 2, 3, () => 1_000);

    assert.equal(guard.accept("alice", "request-a"), true);
    assert.equal(guard.accept("alice", "request-b"), true);
    assert.equal(guard.accept("alice", "request-c"), true);
    assert.equal(guard.accept("alice", "request-a"), true);

    assert.equal(guard.accept("bob", "request-d"), true);
    assert.equal(guard.accept("carol", "request-e"), true);
    assert.equal(guard.accept("alice", "request-c"), true);
  });
});
