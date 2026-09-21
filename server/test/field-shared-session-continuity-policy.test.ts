import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FIELD_SHARED_SESSION_CONTINUITY_REJECTION_CODES,
  inspectFieldSharedSessionContinuity,
} from "../src/domain/field-shared-session-continuity-policy.js";

const compatibility = { applicationId: "IPKE", locale: 1, release: 7 } as const;
const branch = `field.branch.${"a".repeat(32)}`;

describe("field shared session continuity policy", () => {
  it("leaves progression without a branch unclaimed", () => {
    assert.deepEqual(inspectFieldSharedSessionContinuity({
      compatibility,
      sharedProgression: { counters: [], milestoneIds: ["field.schema.v1"] },
    }), { kind: "unclaimed" });
  });

  it("extracts one branch and revision with an order-independent canonical fingerprint", () => {
    const first = inspectFieldSharedSessionContinuity({
      compatibility,
      sharedProgression: {
        counters: [
          { id: "field.variable.0010", value: 4 },
          { id: "field.progression-revision", value: 9 },
        ],
        milestoneIds: [branch, "field.schema.v1", "field.flag.0001"],
      },
    });
    const reordered = inspectFieldSharedSessionContinuity({
      compatibility,
      sharedProgression: {
        counters: [
          { id: "field.progression-revision", value: 9 },
          { id: "field.variable.0010", value: 4 },
        ],
        milestoneIds: ["field.flag.0001", "field.schema.v1", branch],
      },
    });
    assert.equal(first.kind, "claim");
    assert.deepEqual(reordered, first);
    if (first.kind === "claim") {
      assert.equal(first.continuityId, branch);
      assert.equal(first.revision, 9);
      assert.match(first.fingerprint, /^[A-Za-z0-9_-]{43}$/);
      const otherCompatibility = inspectFieldSharedSessionContinuity({
        compatibility: { ...compatibility, release: 8 },
        sharedProgression: {
          counters: [
            { id: "field.variable.0010", value: 4 },
            { id: "field.progression-revision", value: 9 },
          ],
          milestoneIds: [branch, "field.schema.v1", "field.flag.0001"],
        },
      });
      assert.equal(otherCompatibility.kind, "claim");
      if (otherCompatibility.kind === "claim") {
        assert.notEqual(otherCompatibility.fingerprint, first.fingerprint);
      }
    }
  });

  it("rejects ambiguous branches and missing or negative revisions", () => {
    const ambiguous = inspectFieldSharedSessionContinuity({
      compatibility,
      sharedProgression: {
        counters: [{ id: "field.progression-revision", value: 0 }],
        milestoneIds: [branch, `field.branch.${"b".repeat(32)}`],
      },
    });
    assert.equal(ambiguous.kind, "reject");
    if (ambiguous.kind === "reject") {
      assert.equal(
        ambiguous.code,
        FIELD_SHARED_SESSION_CONTINUITY_REJECTION_CODES.branchInvalid,
      );
    }
    for (const counters of [[], [{ id: "field.progression-revision", value: -1 }]]) {
      const invalid = inspectFieldSharedSessionContinuity({
        compatibility,
        sharedProgression: { counters, milestoneIds: [branch] },
      });
      assert.equal(invalid.kind, "reject");
      if (invalid.kind === "reject") {
        assert.equal(
          invalid.code,
          FIELD_SHARED_SESSION_CONTINUITY_REJECTION_CODES.revisionInvalid,
        );
      }
    }
  });
});
