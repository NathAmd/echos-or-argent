import { createHash, randomBytes } from "node:crypto";
import { ServiceError } from "../errors.js";
import type { RealtimeIdentity } from "./authentication-session.js";

interface TicketRecord {
  readonly authenticationSessionId?: string;
  readonly expiresAt: number;
  readonly origin: string;
  readonly userId: string;
}

const ticketDigest = (ticket: string): string => createHash("sha256").update(ticket).digest("hex");

export class RealtimeTicketService {
  private readonly tickets = new Map<string, TicketRecord>();

  constructor(
    private readonly ttlMs: number,
    private readonly maximumOutstanding = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  issue(
    userId: string,
    origin: string,
    authenticationSessionId?: string,
  ): { readonly expiresInMs: number; readonly ticket: string } {
    this.purgeExpired();
    if (this.tickets.size >= this.maximumOutstanding) {
      throw new ServiceError(503, "UNAVAILABLE", "Realtime ticket capacity reached");
    }
    const ticket = randomBytes(32).toString("base64url");
    this.tickets.set(ticketDigest(ticket), {
      ...(authenticationSessionId === undefined ? {} : { authenticationSessionId }),
      expiresAt: this.now() + this.ttlMs,
      origin,
      userId,
    });
    return { expiresInMs: this.ttlMs, ticket };
  }

  consume(ticket: string, origin: string): RealtimeIdentity | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
      return null;
    }
    const key = ticketDigest(ticket);
    const record = this.tickets.get(key);
    this.tickets.delete(key);
    if (record === undefined || record.expiresAt <= this.now() || record.origin !== origin) {
      return null;
    }
    return {
      ...(record.authenticationSessionId === undefined
        ? {}
        : { authenticationSessionId: record.authenticationSessionId }),
      userId: record.userId,
    };
  }

  revokeAuthenticationSession(userId: string, authenticationSessionId: string): number {
    let revoked = 0;
    for (const [key, ticket] of this.tickets) {
      if (
        ticket.userId !== userId
        || ticket.authenticationSessionId !== authenticationSessionId
      ) continue;
      this.tickets.delete(key);
      revoked += 1;
    }
    return revoked;
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const [key, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) {
        this.tickets.delete(key);
      }
    }
  }
}
