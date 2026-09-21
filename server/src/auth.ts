import { createHash, timingSafeEqual } from "node:crypto";

const MAX_TOKEN_BYTES = 512;

const digestToken = (token: string): Buffer => createHash("sha256").update(token, "utf8").digest();

export class TokenAuthenticator {
  private readonly identities: readonly { readonly digest: Buffer; readonly userId: string }[];

  constructor(tokenHashes: ReadonlyMap<string, string>) {
    this.identities = [...tokenHashes].map(([userId, digest]) => ({
      digest: Buffer.from(digest, "hex"),
      userId,
    }));
  }

  authenticateAuthorizationHeader(header: string | undefined): string | null {
    if (header === undefined) {
      return null;
    }
    const match = /^Bearer ([^\s]+)$/.exec(header);
    if (match === null) {
      return null;
    }
    const token = match[1];
    if (token === undefined || Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) {
      return null;
    }
    const candidate = digestToken(token);
    let matchedUserId: string | null = null;
    for (const identity of this.identities) {
      if (timingSafeEqual(candidate, identity.digest)) {
        matchedUserId = identity.userId;
      }
    }
    return matchedUserId;
  }
}

export const sha256Token = (token: string): string => digestToken(token).toString("hex");
