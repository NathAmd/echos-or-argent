import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceError } from "../src/errors.js";
import { parseSharedSessionClientMessage } from "../src/realtime/shared-session-protocol.js";

const requestId = Buffer.alloc(16, 71).toString("base64url");
const sessionId = Buffer.alloc(16, 72).toString("base64url");
const position = { direction: "south", mapId: 1, x: 4, z: 8 } as const;

const requireBadRequest = (value: unknown): void => {
  assert.throws(
    () => parseSharedSessionClientMessage(JSON.stringify(value)),
    (error) => error instanceof ServiceError && error.code === "BAD_REQUEST",
  );
};

describe("shared session realtime protocol", () => {
  it("parses each strict client envelope", () => {
    assert.deepEqual(parseSharedSessionClientMessage(JSON.stringify({
      requestId,
      sessionId,
      type: "attach",
    })), { requestId, sessionId, type: "attach" });
    assert.deepEqual(parseSharedSessionClientMessage(JSON.stringify({
      requestId,
      type: "request-snapshot",
    })), { requestId, type: "request-snapshot" });
    assert.deepEqual(parseSharedSessionClientMessage(JSON.stringify({
      requestId,
      type: "detach",
    })), { requestId, type: "detach" });
    assert.deepEqual(parseSharedSessionClientMessage(JSON.stringify({
      admissionId: requestId,
      decision: { arrival: { direction: "north", mapId: 2, x: 9, z: 10 }, kind: "accept" },
      type: "admission-response",
    })), {
      admissionId: requestId,
      decision: { arrival: { direction: "north", mapId: 2, x: 9, z: 10 }, kind: "accept" },
      type: "admission-response",
    });
    assert.deepEqual(parseSharedSessionClientMessage(JSON.stringify({
      admissionId: requestId,
      decision: { kind: "accept" },
      type: "admission-response",
    })), {
      admissionId: requestId,
      decision: { kind: "accept" },
      type: "admission-response",
    });
    assert.deepEqual(parseSharedSessionClientMessage(JSON.stringify({
      admissionId: requestId,
      decision: { code: "player-declined", kind: "reject" },
      type: "admission-response",
    })), {
      admissionId: requestId,
      decision: { code: "player-declined", kind: "reject" },
      type: "admission-response",
    });

    const command = {
      arrival: { direction: "north", mapId: 2, x: 9, z: 10 },
      commandId: "move:1",
      expectedRevision: 3,
      from: position,
      kind: "movement",
      mode: "walk",
      protocolVersion: 2,
      sequence: 2,
      to: { direction: "east", mapId: 1, x: 5, z: 8 },
    } as const;
    assert.deepEqual(parseSharedSessionClientMessage(JSON.stringify({
      command,
      requestId,
      type: "command",
    })), { command, requestId, type: "command" });

    const campaignEvent = {
      commandId: "event:story:1",
      counters: [{ expectedValue: null, id: "badges", value: 1 }],
      eventId: "story:first-badge",
      expectedRevision: 3,
      kind: "shared-event",
      milestoneIds: ["story:first-badge-complete"],
      protocolVersion: 2,
    } as const;
    assert.deepEqual(parseSharedSessionClientMessage(JSON.stringify({
      command: campaignEvent,
      requestId,
      type: "command",
    })), { command: campaignEvent, requestId, type: "command" });
    const acknowledgement = {
      commandId: "event-ack:story:1",
      eventId: campaignEvent.eventId,
      eventRevision: 4,
      expectedRevision: 4,
      kind: "event-ack",
      protocolVersion: 2,
    } as const;
    assert.deepEqual(parseSharedSessionClientMessage(JSON.stringify({
      command: acknowledgement,
      requestId,
      type: "command",
    })), { command: acknowledgement, requestId, type: "command" });
  });

  it("rejects extra fields, malformed identifiers and ambiguous arrival", () => {
    requireBadRequest({ extra: true, requestId, sessionId, type: "attach" });
    requireBadRequest({ requestId: "predictable", sessionId, type: "attach" });
    requireBadRequest({ requestId, sessionId: "not-opaque", type: "attach" });
    requireBadRequest({
      command: {
        arrival: { direction: "east", mapId: 1, x: 5, z: 8 },
        commandId: "move:1",
        expectedRevision: 0,
        from: position,
        kind: "movement",
        mode: "walk",
        protocolVersion: 2,
        sequence: 1,
        to: { direction: "east", mapId: 1, x: 5, z: 8 },
      },
      requestId,
      type: "command",
    });
    requireBadRequest({ requestId, type: "unknown" });
    requireBadRequest({
      command: {
        commandId: "event:legacy",
        counters: [],
        eventId: "story:legacy",
        expectedRevision: 0,
        kind: "shared-event",
        milestoneIds: [],
        protocolVersion: 1,
      },
      requestId,
      type: "command",
    });
    requireBadRequest({
      command: {
        commandId: "event:duplicates",
        counters: [
          { expectedValue: null, id: "badges", value: 1 },
          { expectedValue: null, id: "badges", value: 2 },
        ],
        eventId: "story:duplicates",
        expectedRevision: 0,
        kind: "shared-event",
        milestoneIds: [],
        protocolVersion: 2,
      },
      requestId,
      type: "command",
    });
    requireBadRequest({
      command: {
        commandId: "event:too-many-effects",
        counters: [],
        eventId: "story:too-many-effects",
        expectedRevision: 0,
        kind: "shared-event",
        milestoneIds: Array.from({ length: 33 }, (_, index) => `milestone:${index}`),
        protocolVersion: 2,
      },
      requestId,
      type: "command",
    });
    requireBadRequest({
      command: {
        commandId: "event-ack:extra",
        eventId: "story:first-badge",
        eventRevision: 1,
        expectedRevision: 1,
        extra: true,
        kind: "event-ack",
        protocolVersion: 2,
      },
      requestId,
      type: "command",
    });
    requireBadRequest({
      admissionId: requestId,
      decision: { code: "free text is forbidden", kind: "reject" },
      type: "admission-response",
    });
    requireBadRequest({
      admissionId: requestId,
      decision: { extra: true, kind: "accept" },
      type: "admission-response",
    });
    requireBadRequest({
      admissionId: requestId,
      decision: { arrival: position, code: "no", kind: "reject" },
      type: "admission-response",
    });
  });
});
