import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceError } from "../src/errors.js";
import { parseClientMessage } from "../src/realtime/protocol.js";
import { RealtimeTicketService } from "../src/realtime/tickets.js";

const opaqueId = (seed: number): string => Buffer.alloc(16, seed).toString("base64url");
const VALID_SDP = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:test",
  "a=ice-pwd:0123456789012345678901",
  "a=fingerprint:sha-256 00",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "",
].join("\r\n");
const VALID_CANDIDATE = "candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host";

describe("realtime protocol", () => {
  it("accepts only typed WebRTC signaling payloads", () => {
    assert.deepEqual(
      parseClientMessage(
        JSON.stringify({
          negotiationId: opaqueId(1),
          payload: { sdp: VALID_SDP, type: "offer" },
          requestId: opaqueId(2),
          to: "bob",
          type: "signal",
        }),
      ),
      {
        negotiationId: opaqueId(1),
        payload: { sdp: VALID_SDP, type: "offer" },
        requestId: opaqueId(2),
        to: "bob",
        type: "signal",
      },
    );
    assert.deepEqual(
      parseClientMessage(
        JSON.stringify({
          negotiationId: opaqueId(1),
          payload: { candidate: VALID_CANDIDATE, sdpMLineIndex: 0, sdpMid: "0", type: "ice" },
          requestId: opaqueId(3),
          to: "bob",
          type: "signal",
        }),
      ).payload,
      { candidate: VALID_CANDIDATE, sdpMLineIndex: 0, sdpMid: "0", type: "ice" },
    );
    assert.deepEqual(
      parseClientMessage(
        JSON.stringify({
          negotiationId: opaqueId(1),
          payload: { type: "hangup" },
          requestId: opaqueId(4),
          to: "bob",
          type: "signal",
        }),
      ).payload,
      { type: "hangup" },
    );
  });

  it("rejects unknown, oversized, or generic relay payloads", () => {
    for (const candidate of [
      { negotiationId: opaqueId(1), payload: { data: "anything", type: "data" }, requestId: opaqueId(2), to: "bob", type: "signal" },
      { payload: { type: "hangup" }, requestId: opaqueId(2), to: "bob", type: "signal" },
      { extra: true, negotiationId: opaqueId(1), payload: { type: "hangup" }, requestId: opaqueId(2), to: "bob", type: "signal" },
      { negotiationId: opaqueId(1), payload: { reason: "game-state", type: "hangup" }, requestId: opaqueId(2), to: "bob", type: "signal" },
      { negotiationId: opaqueId(1), payload: { campaign: "interdit", sdp: VALID_SDP, type: "offer" }, requestId: opaqueId(2), to: "bob", type: "signal" },
      { negotiationId: opaqueId(1), payload: { data: "interdit", candidate: VALID_CANDIDATE, type: "ice" }, requestId: opaqueId(2), to: "bob", type: "signal" },
      { negotiationId: opaqueId(1), payload: { sdp: `v=0\r\n${"x".repeat(25 * 1024)}`, type: "offer" }, requestId: opaqueId(2), to: "bob", type: "signal" },
      { negotiationId: opaqueId(1), payload: { sdp: "v=0\r\n{\"gameplay\":true}\r\n", type: "offer" }, requestId: opaqueId(2), to: "bob", type: "signal" },
      { negotiationId: opaqueId(1), payload: { candidate: "candidate:free-form-data", type: "ice" }, requestId: opaqueId(2), to: "bob", type: "signal" },
      { negotiationId: "campaign-slot-one", payload: { type: "hangup" }, requestId: opaqueId(2), to: "bob", type: "signal" },
      { negotiationId: opaqueId(1), payload: { type: "hangup" }, requestId: "trade-slot-one", to: "bob", type: "signal" },
    ]) {
      assert.throws(
        () => parseClientMessage(JSON.stringify(candidate)),
        (error: unknown) => error instanceof ServiceError && error.status >= 400,
      );
    }
  });
});

describe("realtime tickets", () => {
  it("issues one-time tickets and expires them", () => {
    let now = 1_000;
    const tickets = new RealtimeTicketService(5_000, 10, () => now);
    const first = tickets.issue("alice", "https://client.example", "account-session-a");
    assert.deepEqual(tickets.consume(first.ticket, "https://client.example"), {
      authenticationSessionId: "account-session-a",
      userId: "alice",
    });
    assert.equal(tickets.consume(first.ticket, "https://client.example"), null);

    const wrongOrigin = tickets.issue("alice", "https://client.example");
    assert.equal(tickets.consume(wrongOrigin.ticket, "https://other.example"), null);

    const expired = tickets.issue("bob", "https://client.example");
    now = 6_001;
    assert.equal(tickets.consume(expired.ticket, "https://client.example"), null);
  });

  it("revokes only tickets bound to one exact account session", () => {
    const tickets = new RealtimeTicketService(5_000);
    const first = tickets.issue("alice", "https://client.example", "account-session-a");
    const second = tickets.issue("alice", "https://client.example", "account-session-a");
    const otherSession = tickets.issue(
      "alice",
      "https://client.example",
      "account-session-b",
    );
    const otherUser = tickets.issue("bob", "https://client.example", "account-session-a");
    const legacy = tickets.issue("legacy", "https://client.example");

    assert.equal(tickets.revokeAuthenticationSession("alice", "account-session-a"), 2);
    assert.equal(tickets.consume(first.ticket, "https://client.example"), null);
    assert.equal(tickets.consume(second.ticket, "https://client.example"), null);
    assert.deepEqual(tickets.consume(otherSession.ticket, "https://client.example"), {
      authenticationSessionId: "account-session-b",
      userId: "alice",
    });
    assert.deepEqual(tickets.consume(otherUser.ticket, "https://client.example"), {
      authenticationSessionId: "account-session-a",
      userId: "bob",
    });
    assert.deepEqual(tickets.consume(legacy.ticket, "https://client.example"), {
      userId: "legacy",
    });
  });
});
