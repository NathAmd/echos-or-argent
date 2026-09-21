import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  admitFieldSharedEvent,
  FIELD_SHARED_EVENT_REJECTION_CODES,
} from "../src/domain/field-shared-event-policy.js";
import type {
  SharedEventAdmissionInput,
  SharedEventCommand,
  SharedSessionSnapshot,
} from "../src/domain/shared-sessions.js";

const EVENT_ID = "field-event.1.IPKE.7.2.1p.o.7.2bf";
const REVISION_COUNTER = "field.progression-revision";
const MAXIMUM_ENCODED_COORDINATE = 2_000_000;

const command = (overrides: Partial<SharedEventCommand> = {}): SharedEventCommand => ({
  commandId: "field-event-command:alice:1",
  counters: [
    { expectedValue: 8, id: REVISION_COUNTER, value: 9 },
    { expectedValue: null, id: "field.variable.1234", value: 27 },
    { expectedValue: null, id: "field.flag.0010", value: 0 },
  ],
  eventId: EVENT_ID,
  expectedRevision: 4,
  kind: "shared-event",
  milestoneIds: ["field.flag.0020"],
  protocolVersion: 2,
  ...overrides,
});

const snapshot = (
  overrides: Partial<SharedSessionSnapshot> = {},
): SharedSessionSnapshot => ({
  pendingEvents: [],
  players: [{
    displayName: "ALICE",
    gender: "female",
    movementSequence: 0,
    playerId: "alice",
    position: { direction: "south", mapId: 61, x: 1, z: 1 },
    spriteId: 97,
    state: "active",
  }],
  protocolVersion: 2,
  revision: 4,
  sessionId: Buffer.alloc(16, 41).toString("base64url"),
  sharedProgression: {
    counters: [{ id: REVISION_COUNTER, value: 8 }],
    milestoneIds: ["field.schema.v1", `field.branch.${"a".repeat(32)}`],
  },
  ...overrides,
});

const input = (
  commandOverrides: Partial<SharedEventCommand> = {},
  inputOverrides: Partial<SharedEventAdmissionInput> = {},
): SharedEventAdmissionInput => ({
  command: command(commandOverrides),
  compatibility: { applicationId: "IPKE", locale: 2, release: 7 },
  playerId: "alice",
  sessionId: Buffer.alloc(16, 41).toString("base64url"),
  snapshot: snapshot(),
  ...inputOverrides,
});

const rejectionCode = (candidate: SharedEventAdmissionInput): string | undefined => {
  const decision = admitFieldSharedEvent(candidate);
  return decision.kind === "reject" ? decision.code : undefined;
};

describe("field shared event admission policy", () => {
  it("accepts canonical object and coordinate identities without inspecting source content", () => {
    assert.deepEqual(admitFieldSharedEvent(input()), { kind: "accept" });
    assert.deepEqual(admitFieldSharedEvent(input({
      eventId: "field-event.1.IPKE.7.2.1p.c.0.1.1ekf",
    })), { kind: "accept" });
    assert.deepEqual(admitFieldSharedEvent(input({
      eventId: "field-event.1.IPKE.7.2.1p.o.1ekf.1ekf",
    })), { kind: "accept" });
  });

  it("rejects every non-canonical or out-of-range event identity", () => {
    const tooLargeCoordinate = (MAXIMUM_ENCODED_COORDINATE + 1).toString(36);
    const invalidIds = [
      "field-event.2.IPKE.7.2.1p.o.7.2bf",
      "field-event.1.ipke.7.2.1p.o.7.2bf",
      "field-event.1.IPKE.07.2.1p.o.7.2bf",
      "field-event.1.IPKE.A.2.1p.o.7.2bf",
      "field-event.1.IPKE.74.2.1p.o.7.2bf",
      "field-event.1.IPKE.7.2.1ekg.o.7.2bf",
      "field-event.1.IPKE.7.2.1p.o.1ekg.2bf",
      `field-event.1.IPKE.7.2.1p.c.${tooLargeCoordinate}.0.2bf`,
      "field-event.1.IPKE.7.2.1p.o.7.0",
      "field-event.1.IPKE.7.2.1p.o.7.2bf.extra",
    ];
    for (const eventId of invalidIds) {
      assert.equal(
        rejectionCode(input({ eventId })),
        FIELD_SHARED_EVENT_REJECTION_CODES.identifierInvalid,
        eventId,
      );
    }
  });

  it("binds the full event identity to room compatibility and the sender current map", () => {
    for (const eventId of [
      "field-event.1.IPKF.7.2.1p.o.7.2bf",
      "field-event.1.IPKE.8.2.1p.o.7.2bf",
      "field-event.1.IPKE.7.3.1p.o.7.2bf",
    ]) {
      assert.equal(
        rejectionCode(input({ eventId })),
        FIELD_SHARED_EVENT_REJECTION_CODES.compatibilityMismatch,
      );
    }
    assert.equal(
      rejectionCode(input({ eventId: "field-event.1.IPKE.7.2.1q.o.7.2bf" })),
      FIELD_SHARED_EVENT_REJECTION_CODES.mapMismatch,
    );
    assert.equal(
      rejectionCode(input({}, { playerId: "bob" })),
      FIELD_SHARED_EVENT_REJECTION_CODES.mapMismatch,
    );
  });

  it("allows only canonical field flag milestones", () => {
    for (const milestoneId of [
      "field.badge.0001",
      "field.flag.001",
      "field.flag.00AF",
      "field.flag.0001.extra",
      EVENT_ID,
    ]) {
      assert.equal(
        rejectionCode(input({ milestoneIds: [milestoneId] })),
        FIELD_SHARED_EVENT_REJECTION_CODES.milestoneUnsupported,
        milestoneId,
      );
    }
  });

  it("allows only field revision, flag, and persistent variable counters", () => {
    for (const id of ["field.badge.0001", "field.variable.001", "field.flag.00AF", "other.counter"]) {
      assert.equal(
        rejectionCode(input({
          counters: [
            { expectedValue: 8, id: REVISION_COUNTER, value: 9 },
            { expectedValue: null, id, value: 1 },
          ],
        })),
        FIELD_SHARED_EVENT_REJECTION_CODES.counterUnsupported,
        id,
      );
    }
    for (const id of [
      "field.variable.4000",
      "field.variable.400f",
      "field.variable.8000",
      "field.variable.800f",
    ]) {
      assert.equal(
        rejectionCode(input({
          counters: [
            { expectedValue: 8, id: REVISION_COUNTER, value: 9 },
            { expectedValue: null, id, value: 1 },
          ],
        })),
        FIELD_SHARED_EVENT_REJECTION_CODES.temporaryVariable,
        id,
      );
    }
    for (const id of [
      "field.variable.3fff",
      "field.variable.4010",
      "field.variable.7fff",
      "field.variable.8010",
    ]) {
      assert.deepEqual(admitFieldSharedEvent(input({
        counters: [
          { expectedValue: 8, id: REVISION_COUNTER, value: 9 },
          { expectedValue: null, id, value: 1 },
        ],
      })), { kind: "accept" }, id);
    }
  });

  it("requires exactly one durable revision mutation with exact compare-and-swap values", () => {
    const invalidCounters: SharedEventCommand["counters"][] = [
      [],
      [{ expectedValue: null, id: REVISION_COUNTER, value: 9 }],
      [{ expectedValue: 7, id: REVISION_COUNTER, value: 9 }],
      [{ expectedValue: 8, id: REVISION_COUNTER, value: 8 }],
      [{ expectedValue: 8, id: REVISION_COUNTER, value: 10 }],
      [
        { expectedValue: 8, id: REVISION_COUNTER, value: 9 },
        { expectedValue: 8, id: REVISION_COUNTER, value: 9 },
      ],
    ];
    for (const counters of invalidCounters) {
      assert.equal(
        rejectionCode(input({ counters })),
        FIELD_SHARED_EVENT_REJECTION_CODES.revisionInvalid,
      );
    }
    assert.equal(
      rejectionCode(input({}, {
        snapshot: snapshot({ sharedProgression: { counters: [], milestoneIds: [] } }),
      })),
      FIELD_SHARED_EVENT_REJECTION_CODES.revisionInvalid,
    );
  });
});
