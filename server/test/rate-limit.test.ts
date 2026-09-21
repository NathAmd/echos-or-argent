import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConcurrentRequestLimiter } from "../src/rate-limit.js";

describe("concurrent request limiter", () => {
  it("enforces global and per-key capacity and releases idempotently", () => {
    const limiter = new ConcurrentRequestLimiter<string>(3, 2);
    const releaseAliceOne = limiter.acquire("alice");
    const releaseAliceTwo = limiter.acquire("alice");

    assert.equal(typeof releaseAliceOne, "function");
    assert.equal(typeof releaseAliceTwo, "function");
    assert.equal(limiter.acquire("alice"), undefined);

    const releaseBob = limiter.acquire("bob");
    assert.equal(typeof releaseBob, "function");
    assert.equal(limiter.acquire("carol"), undefined);

    releaseAliceOne?.();
    releaseAliceOne?.();
    const releaseCarol = limiter.acquire("carol");
    assert.equal(typeof releaseCarol, "function");

    releaseAliceTwo?.();
    releaseBob?.();
    releaseCarol?.();
    assert.equal(typeof limiter.acquire("alice"), "function");
  });

  it("rejects incoherent limits", () => {
    assert.throws(() => new ConcurrentRequestLimiter(0, 1), /limits are invalid/);
    assert.throws(() => new ConcurrentRequestLimiter(2, 3), /limits are invalid/);
  });
});
