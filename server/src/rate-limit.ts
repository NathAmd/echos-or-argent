export class FixedWindowRateLimiter {
  private count = 0;
  private windowStartedAt = 0;

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(): boolean {
    const current = this.now();
    if (current - this.windowStartedAt >= this.windowMs) {
      this.count = 0;
      this.windowStartedAt = current;
    }
    if (this.count >= this.maximum) {
      return false;
    }
    this.count += 1;
    return true;
  }
}

/** Plafonne le travail simultane et rend une fonction de liberation idempotente. */
export class ConcurrentRequestLimiter<Key> {
  private active = 0;
  private readonly activeByKey = new Map<Key, number>();

  constructor(
    private readonly maximum: number,
    private readonly maximumPerKey: number,
  ) {
    if (
      !Number.isSafeInteger(maximum) ||
      !Number.isSafeInteger(maximumPerKey) ||
      maximum < 1 ||
      maximumPerKey < 1 ||
      maximumPerKey > maximum
    ) {
      throw new Error("Concurrent request limits are invalid");
    }
  }

  acquire(key: Key): (() => void) | undefined {
    const activeForKey = this.activeByKey.get(key) ?? 0;
    if (this.active >= this.maximum || activeForKey >= this.maximumPerKey) {
      return undefined;
    }
    this.active += 1;
    this.activeByKey.set(key, activeForKey + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const remainingForKey = (this.activeByKey.get(key) ?? 1) - 1;
      if (remainingForKey === 0) this.activeByKey.delete(key);
      else this.activeByKey.set(key, remainingForKey);
    };
  }
}
