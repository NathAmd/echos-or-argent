import { randomBytes, randomInt } from "node:crypto";
import { ServiceError } from "../errors.js";

export const MATCHMAKING_ACTIVITIES = ["trade", "pvp", "coop"] as const;
export type MatchmakingActivity = (typeof MATCHMAKING_ACTIVITIES)[number];
export type MatchmakingRole = "offerer" | "answerer";

export type MatchmakingStatus =
  | Readonly<{ status: "idle" }>
  | Readonly<{
      activity: MatchmakingActivity;
      expiresAt: number;
      joinedAt: number;
      status: "queued";
    }>
  | Readonly<{
      activity: MatchmakingActivity;
      expiresAt: number;
      matchId: string;
      negotiationId: string;
      peerUserId: string;
      role: MatchmakingRole;
      status: "matched";
    }>;

type QueueEntry = Readonly<{
  activity: MatchmakingActivity;
  expiresAt: number;
  joinedAt: number;
  kind: "queued";
  userId: string;
}>;

type MatchRecord = Readonly<{
  activity: MatchmakingActivity;
  expiresAt: number;
  matchId: string;
  negotiationId: string;
  participants: readonly [string, string];
}>;

type MatchedEntry = Readonly<{
  kind: "matched";
  matchId: string;
}>;

type UserEntry = QueueEntry | MatchedEntry;

export interface MatchmakingServiceOptions {
  readonly authorizationTtlMs: number;
  readonly idFactory?: () => string;
  readonly maintenanceIntervalMs?: number;
  readonly maximumMatches?: number;
  readonly maximumQueued?: number;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
  readonly queueTtlMs: number;
  readonly randomIndex?: (upperBound: number) => number;
}

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 250;
const DEFAULT_MAXIMUM_MATCHES = 500;
const DEFAULT_MAXIMUM_QUEUED = 1_000;

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
};

export const isMatchmakingActivity = (value: unknown): value is MatchmakingActivity =>
  typeof value === "string" && MATCHMAKING_ACTIVITIES.includes(value as MatchmakingActivity);

export class MatchmakingService {
  private readonly authorizationTtlMs: number;
  private readonly idFactory: () => string;
  private readonly matches = new Map<string, MatchRecord>();
  private readonly maximumMatches: number;
  private readonly maximumQueued: number;
  private readonly now: () => number;
  private readonly onError: (error: unknown) => void;
  private readonly queueTtlMs: number;
  private readonly queues = new Map<MatchmakingActivity, string[]>(
    MATCHMAKING_ACTIVITIES.map((activity) => [activity, []]),
  );
  private readonly randomIndex: (upperBound: number) => number;
  private readonly states = new Map<string, UserEntry>();
  private readonly timer: NodeJS.Timeout;
  private closed = false;

  constructor(options: MatchmakingServiceOptions) {
    this.authorizationTtlMs = positiveInteger(options.authorizationTtlMs, "authorizationTtlMs");
    this.queueTtlMs = positiveInteger(options.queueTtlMs, "queueTtlMs");
    this.maximumMatches = positiveInteger(
      options.maximumMatches ?? DEFAULT_MAXIMUM_MATCHES,
      "maximumMatches",
    );
    this.maximumQueued = positiveInteger(
      options.maximumQueued ?? DEFAULT_MAXIMUM_QUEUED,
      "maximumQueued",
    );
    this.now = options.now ?? Date.now;
    this.randomIndex = options.randomIndex ?? randomInt;
    this.idFactory = options.idFactory ?? (() => randomBytes(16).toString("base64url"));
    this.onError = options.onError ?? (() => undefined);
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
  }

  join(userId: string, activity: MatchmakingActivity): MatchmakingStatus {
    this.requireOpen();
    this.expire(this.now());
    const current = this.states.get(userId);
    if (current !== undefined) {
      const status = this.snapshot(userId);
      if (status.status !== "idle" && status.activity === activity) {
        return status;
      }
      throw new ServiceError(409, "CONFLICT", "Identity is already in another matchmaking activity");
    }
    if (this.queuedCount() >= this.maximumQueued) {
      throw new ServiceError(503, "UNAVAILABLE", "Matchmaking queue capacity reached");
    }
    const joinedAt = this.now();
    const entry: QueueEntry = Object.freeze({
      activity,
      expiresAt: joinedAt + this.queueTtlMs,
      joinedAt,
      kind: "queued",
      userId,
    });
    this.states.set(userId, entry);
    this.queues.get(activity)!.push(userId);
    return this.snapshot(userId);
  }

  cancel(userId: string): boolean {
    if (this.closed) return false;
    this.expire(this.now());
    const entry = this.states.get(userId);
    if (entry === undefined) return false;
    if (entry.kind === "queued") {
      this.removeQueued(entry);
    } else {
      const match = this.matches.get(entry.matchId);
      if (match !== undefined) this.removeMatch(match);
      else this.states.delete(userId);
    }
    return true;
  }

  disconnect(userId: string): void {
    this.cancel(userId);
  }

  /**
   * Returns whether this account currently owns a queue slot or a live match.
   *
   * The application uses this read immediately before a synchronous Coop
   * mutation, so two HTTP clients authenticated as the same account cannot
   * enter both online activities during the same event-loop turn.
   */
  hasEngagement(userId: string): boolean {
    if (this.closed) return false;
    this.expire(this.now());
    return this.states.has(userId);
  }

  status(userId: string): MatchmakingStatus {
    if (this.closed) return Object.freeze({ status: "idle" });
    this.expire(this.now());
    return this.snapshot(userId);
  }

  isSignalAuthorized(first: string, second: string, negotiationId: string): boolean {
    return this.isSignalAuthorizedForActivity(first, second, negotiationId);
  }

  isSignalAuthorizedForActivity(
    first: string,
    second: string,
    negotiationId: string,
    activity?: MatchmakingActivity,
  ): boolean {
    if (this.closed || first === second) return false;
    this.expire(this.now());
    const entry = this.states.get(first);
    if (entry?.kind !== "matched") return false;
    const match = this.matches.get(entry.matchId);
    return match !== undefined
      && match.negotiationId === negotiationId
      && (activity === undefined || match.activity === activity)
      && match.participants.includes(second);
  }

  maintain(): void {
    if (this.closed) return;
    this.expire(this.now());
    for (const activity of MATCHMAKING_ACTIVITIES) {
      this.compactQueue(activity);
      const queue = this.queues.get(activity)!;
      while (queue.length >= 2 && this.matches.size < this.maximumMatches) {
        const firstIndex = this.pickIndex(queue.length);
        let secondIndex = this.pickIndex(queue.length - 1);
        if (secondIndex >= firstIndex) secondIndex += 1;
        const first = queue[firstIndex]!;
        const second = queue[secondIndex]!;
        const reserved = new Set<string>();
        const matchId = this.nextId(reserved);
        reserved.add(matchId);
        const negotiationId = this.nextId(reserved);
        const expiresAt = this.now() + this.authorizationTtlMs;
        const participants = first < second ? [first, second] : [second, first];
        const match: MatchRecord = Object.freeze({
          activity,
          expiresAt,
          matchId,
          negotiationId,
          participants: Object.freeze(participants) as readonly [string, string],
        });
        queue.splice(Math.max(firstIndex, secondIndex), 1);
        queue.splice(Math.min(firstIndex, secondIndex), 1);
        this.matches.set(matchId, match);
        this.states.set(first, Object.freeze({ kind: "matched", matchId }));
        this.states.set(second, Object.freeze({ kind: "matched", matchId }));
      }
    }
  }

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.matches.clear();
    this.states.clear();
    for (const queue of this.queues.values()) queue.length = 0;
  }

  private compactQueue(activity: MatchmakingActivity): void {
    const queue = this.queues.get(activity)!;
    const valid = queue.filter((userId) => {
      const entry = this.states.get(userId);
      return entry?.kind === "queued" && entry.activity === activity;
    });
    queue.splice(0, queue.length, ...valid);
  }

  private expire(now: number): void {
    for (const entry of this.states.values()) {
      if (entry.kind !== "queued" || entry.expiresAt > now) continue;
      this.removeQueued(entry);
    }
    for (const match of this.matches.values()) {
      if (match.expiresAt <= now) this.removeMatch(match);
    }
  }

  private isIdInUse(id: string): boolean {
    for (const match of this.matches.values()) {
      if (match.matchId === id || match.negotiationId === id) return true;
    }
    return false;
  }

  private nextId(additionalReserved: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = this.idFactory();
      if (!OPAQUE_ID_PATTERN.test(id)) {
        throw new Error("Matchmaking ID factory returned a non-canonical opaque ID");
      }
      if (!additionalReserved.has(id) && !this.isIdInUse(id)) return id;
    }
    throw new ServiceError(503, "UNAVAILABLE", "Unable to allocate a unique matchmaking ID");
  }

  private pickIndex(upperBound: number): number {
    const index = this.randomIndex(upperBound);
    if (!Number.isSafeInteger(index) || index < 0 || index >= upperBound) {
      throw new Error("Matchmaking random index is outside its requested bound");
    }
    return index;
  }

  private queuedCount(): number {
    let count = 0;
    for (const entry of this.states.values()) {
      if (entry.kind === "queued") count += 1;
    }
    return count;
  }

  private removeMatch(match: MatchRecord): void {
    this.matches.delete(match.matchId);
    for (const userId of match.participants) {
      const entry = this.states.get(userId);
      if (entry?.kind === "matched" && entry.matchId === match.matchId) {
        this.states.delete(userId);
      }
    }
  }

  private removeQueued(entry: QueueEntry): void {
    this.states.delete(entry.userId);
    const queue = this.queues.get(entry.activity)!;
    const index = queue.indexOf(entry.userId);
    if (index !== -1) queue.splice(index, 1);
  }

  private requireOpen(): void {
    if (this.closed) {
      throw new ServiceError(503, "UNAVAILABLE", "Matchmaking service is stopped");
    }
  }

  private snapshot(userId: string): MatchmakingStatus {
    const entry = this.states.get(userId);
    if (entry === undefined) return Object.freeze({ status: "idle" });
    if (entry.kind === "queued") {
      return Object.freeze({
        activity: entry.activity,
        expiresAt: entry.expiresAt,
        joinedAt: entry.joinedAt,
        status: "queued",
      });
    }
    const match = this.matches.get(entry.matchId);
    if (match === undefined) return Object.freeze({ status: "idle" });
    const offerer = match.participants[0];
    const peerUserId = offerer === userId ? match.participants[1] : offerer;
    return Object.freeze({
      activity: match.activity,
      expiresAt: match.expiresAt,
      matchId: match.matchId,
      negotiationId: match.negotiationId,
      peerUserId,
      role: offerer === userId ? "offerer" : "answerer",
      status: "matched",
    });
  }
}
