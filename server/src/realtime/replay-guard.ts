const IDENTITY_SEPARATOR = "\u0000";

interface ReplayRecord {
  readonly expiresAt: number;
  readonly requestId: string;
  readonly userId: string;
}

export class RealtimeReplayGuard {
  private readonly records = new Map<string, ReplayRecord>();
  private readonly requestsByUser = new Map<string, Set<string>>();

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly maximumPerUser = 4_096,
    private readonly maximumTotal = 65_536,
    private readonly now: () => number = Date.now,
  ) {
    if (ttlMs <= 0 || maximumPerUser <= 0 || maximumTotal < maximumPerUser) {
      throw new Error("Replay guard limits are invalid");
    }
  }

  accept(userId: string, requestId: string): boolean {
    const now = this.now();
    this.purgeExpired(now);
    const key = this.key(userId, requestId);
    if (this.records.has(key)) {
      return false;
    }

    const requests = this.requestsByUser.get(userId) ?? new Set<string>();
    while (requests.size >= this.maximumPerUser) {
      const oldestRequestId = requests.values().next().value as string | undefined;
      if (oldestRequestId === undefined) break;
      this.delete(userId, oldestRequestId);
    }
    while (this.records.size >= this.maximumTotal) {
      const oldest = this.records.values().next().value as ReplayRecord | undefined;
      if (oldest === undefined) break;
      this.delete(oldest.userId, oldest.requestId);
    }

    requests.add(requestId);
    this.requestsByUser.set(userId, requests);
    this.records.set(key, { expiresAt: now + this.ttlMs, requestId, userId });
    return true;
  }

  private delete(userId: string, requestId: string): void {
    this.records.delete(this.key(userId, requestId));
    const requests = this.requestsByUser.get(userId);
    requests?.delete(requestId);
    if (requests?.size === 0) {
      this.requestsByUser.delete(userId);
    }
  }

  private key(userId: string, requestId: string): string {
    return `${userId}${IDENTITY_SEPARATOR}${requestId}`;
  }

  private purgeExpired(now: number): void {
    for (const record of this.records.values()) {
      if (record.expiresAt > now) break;
      this.delete(record.userId, record.requestId);
    }
  }
}
