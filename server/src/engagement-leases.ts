import { randomBytes } from "node:crypto";

interface LeaseRecord {
  readonly attachmentId?: string;
  readonly authenticationSessionId?: string;
  readonly engagementId: string;
  readonly lease: string;
}

/** Fencing éphémère: un redémarrage invalide les anciens cancels au lieu de les rejouer. */
export class EngagementLeaseRegistry {
  private readonly records = new Map<string, LeaseRecord>();

  issue(
    userId: string,
    engagementId: string | undefined,
    authenticationSessionId?: string,
    attachmentId?: string,
  ): string | undefined {
    if (engagementId === undefined) {
      this.records.delete(userId);
      return undefined;
    }
    const current = this.records.get(userId);
    if (current?.engagementId === engagementId
      && current.authenticationSessionId === authenticationSessionId
      && current.attachmentId === attachmentId) return current.lease;
    const lease = randomBytes(16).toString("base64url");
    this.records.set(userId, {
      engagementId,
      lease,
      ...(authenticationSessionId === undefined ? {} : { authenticationSessionId }),
      ...(attachmentId === undefined ? {} : { attachmentId }),
    });
    return lease;
  }

  matches(
    userId: string,
    lease: string | undefined,
    engagementId: string,
    authenticationSessionId?: string,
    attachmentId?: string,
  ): boolean {
    const current = this.records.get(userId);
    return lease !== undefined
      && current?.lease === lease
      && current.engagementId === engagementId
      && current.authenticationSessionId === authenticationSessionId
      && current.attachmentId === attachmentId;
  }

  clear(userId: string): void {
    this.records.delete(userId);
  }
}
