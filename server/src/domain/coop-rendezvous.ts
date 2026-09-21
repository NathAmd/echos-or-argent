import { randomBytes } from "node:crypto";
import { ServiceError } from "../errors.js";
import {
  type CoopRendezvousStore,
  type StoredCoopRendezvousSession,
  type StoredCoopRendezvousState,
} from "../persistence/coop-rendezvous-store.js";

export const COOP_RENDEZVOUS_PROTOCOL_VERSION = 1 as const;
export type CoopRendezvousMode = "friend" | "random";
export type CoopRendezvousRole = "guest" | "host";
export type CoopRendezvousSessionStatus = "active" | "offered" | "ready";

export type CoopRendezvousCurrent =
  | Readonly<{ status: "idle" }>
  | Readonly<{
      expiresAt: number;
      joinedAt: number;
      mode: "random";
      status: "queued";
    }>
  | Readonly<{
      expiresAt: number;
      mode: "friend";
      peerUserId: string;
      role: "host";
      sessionId: string;
      status: "offered";
    }>
  | Readonly<{
      expiresAt: number;
      mode: CoopRendezvousMode;
      peerUserId: string;
      role: CoopRendezvousRole;
      sessionId: string;
      status: "active" | "ready";
    }>;

export interface CoopRendezvousInvitation {
  readonly expiresAt: number;
  readonly fromUserId: string;
  readonly intent: "coop";
  readonly sessionId: string;
}

export interface CoopRendezvousSnapshot {
  readonly current: CoopRendezvousCurrent;
  readonly invitations: readonly CoopRendezvousInvitation[];
  readonly protocolVersion: typeof COOP_RENDEZVOUS_PROTOCOL_VERSION;
}

export interface CoopRendezvousAuthorization {
  readonly guestUserId: string;
  readonly hostUserId: string;
  readonly mode: CoopRendezvousMode;
  readonly sessionId: string;
  readonly status: "active" | "ready";
}

export interface CoopRendezvousServiceOptions {
  readonly activeTtlMs: number;
  readonly areFriends: (firstUserId: string, secondUserId: string) => boolean;
  readonly idFactory?: () => string;
  readonly maintenanceIntervalMs?: number;
  readonly maximumQueued?: number;
  readonly maximumSessions?: number;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
  readonly queueTtlMs: number;
  readonly readyTtlMs: number;
  readonly store: CoopRendezvousStore;
}

const OPAQUE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 1_000;
const DEFAULT_MAXIMUM_QUEUED = 1_000;
const DEFAULT_MAXIMUM_SESSIONS = 1_000;

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
};

export const isCoopRendezvousSessionId = (value: unknown): value is string =>
  typeof value === "string" && OPAQUE_SESSION_ID_PATTERN.test(value);

const cloneState = (state: StoredCoopRendezvousState): StoredCoopRendezvousState => ({
  queued: state.queued.map((entry) => ({ ...entry })),
  sessions: state.sessions.map((session) => ({ ...session })),
  version: 1,
});

const compareQueued = (
  first: StoredCoopRendezvousState["queued"][number],
  second: StoredCoopRendezvousState["queued"][number],
): number => first.joinedAt - second.joinedAt || first.userId.localeCompare(second.userId, "en");

const sessionIncludes = (session: StoredCoopRendezvousSession, userId: string): boolean =>
  session.hostUserId === userId || session.guestUserId === userId;

export class CoopRendezvousService {
  private readonly activeTtlMs: number;
  private readonly areFriends: (firstUserId: string, secondUserId: string) => boolean;
  private readonly idFactory: () => string;
  private readonly maximumQueued: number;
  private readonly maximumSessions: number;
  private readonly now: () => number;
  private readonly onError: (error: unknown) => void;
  private readonly queueTtlMs: number;
  private readonly readyTtlMs: number;
  private state: StoredCoopRendezvousState;
  private readonly timer: NodeJS.Timeout;
  private closed = false;

  constructor(options: CoopRendezvousServiceOptions) {
    this.activeTtlMs = positiveInteger(options.activeTtlMs, "activeTtlMs");
    this.queueTtlMs = positiveInteger(options.queueTtlMs, "queueTtlMs");
    this.readyTtlMs = positiveInteger(options.readyTtlMs, "readyTtlMs");
    this.maximumQueued = positiveInteger(
      options.maximumQueued ?? DEFAULT_MAXIMUM_QUEUED,
      "maximumQueued",
    );
    this.maximumSessions = positiveInteger(
      options.maximumSessions ?? DEFAULT_MAXIMUM_SESSIONS,
      "maximumSessions",
    );
    this.areFriends = options.areFriends;
    this.idFactory = options.idFactory ?? (() => randomBytes(16).toString("base64url"));
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => undefined);
    this.state = cloneState(options.store.load());
    this.store = options.store;
    const interval = positiveInteger(
      options.maintenanceIntervalMs ?? DEFAULT_MAINTENANCE_INTERVAL_MS,
      "maintenanceIntervalMs",
    );
    this.timer = setInterval(() => {
      try {
        this.maintain();
      } catch (error) {
        this.onError(error);
      }
    }, interval);
    this.timer.unref();
    this.maintain();
  }

  private readonly store: CoopRendezvousStore;

  status(userId: string): CoopRendezvousSnapshot {
    if (this.closed) return this.idleSnapshot();
    this.maintain();
    const active = this.state.sessions.find((session) =>
      session.status === "active" && sessionIncludes(session, userId));
    if (active !== undefined) this.renewActiveLease(active);
    return this.snapshot(userId);
  }

  joinRandom(userId: string): CoopRendezvousSnapshot {
    this.requireOpen();
    this.maintain();
    const current = this.findSessionByUser(userId);
    if (current !== undefined) {
      if (current.mode === "random") return this.snapshot(userId);
      throw new ServiceError(409, "CONFLICT", "Identity already has a Coop rendezvous");
    }
    const queued = this.state.queued.find((entry) => entry.userId === userId);
    if (queued !== undefined) return this.snapshot(userId);
    if (this.state.queued.length >= this.maximumQueued) {
      throw new ServiceError(503, "UNAVAILABLE", "Coop random queue capacity reached");
    }

    const now = this.now();
    const next = cloneState(this.state);
    const peer = [...next.queued].sort(compareQueued)[0];
    if (peer === undefined) {
      next.queued.push({ expiresAt: now + this.queueTtlMs, joinedAt: now, userId });
    } else {
      if (next.sessions.length >= this.maximumSessions) {
        throw new ServiceError(503, "UNAVAILABLE", "Coop rendezvous capacity reached");
      }
      next.queued = next.queued.filter((entry) => entry.userId !== peer.userId);
      const hostUserId = userId < peer.userId ? userId : peer.userId;
      const guestUserId = hostUserId === userId ? peer.userId : userId;
      next.sessions.push({
        createdAt: now,
        expiresAt: now + this.readyTtlMs,
        guestUserId,
        hostUserId,
        mode: "random",
        sessionId: this.nextSessionId(next),
        status: "ready",
      });
    }
    this.commit(next);
    return this.snapshot(userId);
  }

  inviteFriend(hostUserId: string, guestUserId: string): CoopRendezvousSnapshot {
    this.requireOpen();
    this.maintain();
    if (hostUserId === guestUserId) {
      throw new ServiceError(400, "BAD_REQUEST", "A user cannot invite itself to Coop");
    }
    if (!this.areFriends(hostUserId, guestUserId)) {
      throw new ServiceError(403, "FORBIDDEN", "A Coop invitation requires an active friendship");
    }
    const existing = this.state.sessions.find(
      (session) => session.hostUserId === hostUserId
        && session.guestUserId === guestUserId
        && session.mode === "friend",
    );
    if (existing !== undefined) return this.snapshot(hostUserId);
    if (this.isEngaged(hostUserId) || this.isEngaged(guestUserId)) {
      throw new ServiceError(409, "CONFLICT", "A Coop participant already has a rendezvous");
    }
    if (this.state.sessions.length >= this.maximumSessions) {
      throw new ServiceError(503, "UNAVAILABLE", "Coop rendezvous capacity reached");
    }
    const now = this.now();
    const next = cloneState(this.state);
    next.sessions.push({
      createdAt: now,
      expiresAt: now + this.readyTtlMs,
      guestUserId,
      hostUserId,
      mode: "friend",
      sessionId: this.nextSessionId(next),
      status: "offered",
    });
    this.commit(next);
    return this.snapshot(hostUserId);
  }

  acceptInvitation(guestUserId: string, sessionId: string): CoopRendezvousSnapshot {
    this.requireOpen();
    this.maintain();
    const session = this.state.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined || session.mode !== "friend" || session.guestUserId !== guestUserId) {
      throw new ServiceError(404, "NOT_FOUND", "Coop invitation not found");
    }
    if (session.status === "ready" || session.status === "active") {
      return this.snapshot(guestUserId);
    }
    const now = this.now();
    const next = cloneState(this.state);
    const index = next.sessions.findIndex((candidate) => candidate.sessionId === sessionId);
    next.sessions[index] = {
      ...next.sessions[index]!,
      expiresAt: now + this.readyTtlMs,
      status: "ready",
    };
    this.commit(next);
    return this.snapshot(guestUserId);
  }

  cancelInvitation(userId: string, sessionId: string): CoopRendezvousSnapshot {
    this.requireOpen();
    this.maintain();
    const session = this.state.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) return this.snapshot(userId);
    if (!sessionIncludes(session, userId)) {
      throw new ServiceError(403, "FORBIDDEN", "Coop invitation does not belong to this identity");
    }
    if (session.mode !== "friend" || session.status !== "offered") {
      throw new ServiceError(409, "CONFLICT", "Coop invitation is no longer pending");
    }
    const next = cloneState(this.state);
    next.sessions = next.sessions.filter((candidate) => candidate.sessionId !== sessionId);
    this.commit(next);
    return this.snapshot(userId);
  }

  cancelCurrent(userId: string): CoopRendezvousSnapshot {
    this.requireOpen();
    this.maintain();
    const next = cloneState(this.state);
    const queuedLength = next.queued.length;
    next.queued = next.queued.filter((entry) => entry.userId !== userId);
    const sessionLength = next.sessions.length;
    next.sessions = next.sessions.filter((session) => {
      const isCurrent = session.hostUserId === userId
        || (session.guestUserId === userId && session.status !== "offered");
      return !isCurrent;
    });
    if (queuedLength !== next.queued.length || sessionLength !== next.sessions.length) {
      this.commit(next);
    }
    return this.snapshot(userId);
  }

  authorizeHost(
    sessionId: string,
    hostUserId: string,
    guestUserId: string,
  ): CoopRendezvousAuthorization | null {
    if (this.closed || hostUserId === guestUserId) return null;
    this.maintain();
    return this.authorization(sessionId, hostUserId, guestUserId);
  }

  authorizeGuest(
    sessionId: string,
    guestUserId: string,
    hostUserId: string,
  ): CoopRendezvousAuthorization | null {
    if (this.closed || hostUserId === guestUserId) return null;
    this.maintain();
    return this.authorization(sessionId, hostUserId, guestUserId);
  }

  private authorization(
    sessionId: string,
    hostUserId: string,
    guestUserId: string,
  ): CoopRendezvousAuthorization | null {
    const session = this.state.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (
      session === undefined
      || session.hostUserId !== hostUserId
      || session.guestUserId !== guestUserId
      || (session.status !== "ready" && session.status !== "active")
    ) return null;
    return Object.freeze({
      guestUserId: session.guestUserId,
      hostUserId: session.hostUserId,
      mode: session.mode,
      sessionId: session.sessionId,
      status: session.status,
    });
  }

  hasSession(sessionId: string): boolean {
    if (this.closed) return false;
    this.maintain();
    return this.state.sessions.some((session) => session.sessionId === sessionId);
  }

  /**
   * A received offer is only an invitation, not the guest's current activity.
   * Queues and ready/active sessions engage both members; an offered friend
   * session engages its host until it is accepted or cancelled.
   */
  hasCurrentEngagement(userId: string): boolean {
    if (this.closed) return false;
    this.maintain();
    if (this.state.queued.some((entry) => entry.userId === userId)) return true;
    return this.state.sessions.some((session) => session.hostUserId === userId
      || (session.guestUserId === userId && session.status !== "offered"));
  }

  hasPendingInvitation(guestUserId: string, sessionId: string): boolean {
    if (this.closed) return false;
    this.maintain();
    return this.state.sessions.some((session) => session.sessionId === sessionId
      && session.guestUserId === guestUserId
      && session.mode === "friend"
      && session.status === "offered");
  }

  markActive(sessionId: string, hostUserId: string, guestUserId: string): void {
    this.requireOpen();
    this.maintain();
    const session = this.state.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (
      session === undefined
      || session.hostUserId !== hostUserId
      || session.guestUserId !== guestUserId
      || (session.status !== "ready" && session.status !== "active")
    ) {
      throw new ServiceError(403, "FORBIDDEN", "Coop host authorization is not valid");
    }
    if (session.status === "active") {
      this.renewActiveLease(session);
      return;
    }
    const next = cloneState(this.state);
    const index = next.sessions.findIndex((candidate) => candidate.sessionId === sessionId);
    next.sessions[index] = {
      ...next.sessions[index]!,
      expiresAt: this.now() + this.activeTtlMs,
      status: "active",
    };
    this.commit(next);
  }

  private renewActiveLease(session: StoredCoopRendezvousSession): void {
    const now = this.now();
    const renewalWindowMs = Math.max(1, Math.floor(this.activeTtlMs / 2));
    if (session.expiresAt - now > renewalWindowMs) return;
    const next = cloneState(this.state);
    const index = next.sessions.findIndex((candidate) => candidate.sessionId === session.sessionId);
    if (index === -1 || next.sessions[index]?.status !== "active") return;
    next.sessions[index] = {
      ...next.sessions[index]!,
      expiresAt: now + this.activeTtlMs,
    };
    this.commit(next);
  }

  maintain(): void {
    if (this.closed) return;
    const now = this.now();
    const next = cloneState(this.state);
    next.queued = next.queued.filter((entry) => entry.expiresAt > now);
    next.sessions = next.sessions.filter((session) => session.expiresAt > now);

    next.queued.sort(compareQueued);
    while (next.queued.length >= 2 && next.sessions.length < this.maximumSessions) {
      const first = next.queued.shift()!;
      const second = next.queued.shift()!;
      const hostUserId = first.userId < second.userId ? first.userId : second.userId;
      const guestUserId = hostUserId === first.userId ? second.userId : first.userId;
      next.sessions.push({
        createdAt: now,
        expiresAt: now + this.readyTtlMs,
        guestUserId,
        hostUserId,
        mode: "random",
        sessionId: this.nextSessionId(next),
        status: "ready",
      });
    }
    if (JSON.stringify(next) !== JSON.stringify(this.state)) this.commit(next);
  }

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
  }

  private commit(next: StoredCoopRendezvousState): void {
    this.store.save(next);
    this.state = next;
  }

  private findSessionByUser(userId: string): StoredCoopRendezvousSession | undefined {
    return this.state.sessions.find((session) => sessionIncludes(session, userId));
  }

  private idleSnapshot(): CoopRendezvousSnapshot {
    return Object.freeze({
      current: Object.freeze({ status: "idle" }),
      invitations: Object.freeze([]),
      protocolVersion: COOP_RENDEZVOUS_PROTOCOL_VERSION,
    });
  }

  private isEngaged(userId: string): boolean {
    return this.state.queued.some((entry) => entry.userId === userId)
      || this.findSessionByUser(userId) !== undefined;
  }

  private nextSessionId(state: StoredCoopRendezvousState): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sessionId = this.idFactory();
      if (!isCoopRendezvousSessionId(sessionId)) {
        throw new Error("Coop rendezvous ID factory returned a non-canonical opaque ID");
      }
      if (!state.sessions.some((session) => session.sessionId === sessionId)) return sessionId;
    }
    throw new ServiceError(503, "UNAVAILABLE", "Unable to allocate a Coop rendezvous ID");
  }

  private requireOpen(): void {
    if (this.closed) {
      throw new ServiceError(503, "UNAVAILABLE", "Coop rendezvous service is stopped");
    }
  }

  private snapshot(userId: string): CoopRendezvousSnapshot {
    const session = this.findSessionByUser(userId);
    let current: CoopRendezvousCurrent;
    if (session === undefined) {
      const queued = this.state.queued.find((entry) => entry.userId === userId);
      current = queued === undefined
        ? Object.freeze({ status: "idle" })
        : Object.freeze({
            expiresAt: queued.expiresAt,
            joinedAt: queued.joinedAt,
            mode: "random",
            status: "queued",
          });
    } else if (session.status === "offered" && session.hostUserId === userId) {
      current = Object.freeze({
        expiresAt: session.expiresAt,
        mode: "friend",
        peerUserId: session.guestUserId,
        role: "host",
        sessionId: session.sessionId,
        status: "offered",
      });
    } else if (session.status === "offered") {
      current = Object.freeze({ status: "idle" });
    } else {
      const role: CoopRendezvousRole = session.hostUserId === userId ? "host" : "guest";
      current = Object.freeze({
        expiresAt: session.expiresAt,
        mode: session.mode,
        peerUserId: role === "host" ? session.guestUserId : session.hostUserId,
        role,
        sessionId: session.sessionId,
        status: session.status,
      });
    }
    const invitations = this.state.sessions
      .filter((candidate) => candidate.guestUserId === userId && candidate.status === "offered")
      .map((candidate): CoopRendezvousInvitation => Object.freeze({
        expiresAt: candidate.expiresAt,
        fromUserId: candidate.hostUserId,
        intent: "coop",
        sessionId: candidate.sessionId,
      }))
      .sort((first, second) => first.expiresAt - second.expiresAt
        || first.sessionId.localeCompare(second.sessionId, "en"));
    return Object.freeze({
      current,
      invitations: Object.freeze(invitations),
      protocolVersion: COOP_RENDEZVOUS_PROTOCOL_VERSION,
    });
  }
}
