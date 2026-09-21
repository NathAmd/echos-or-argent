import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type WebSocket from "ws";
import {
  ACCOUNT_ENTITLEMENTS,
  AccountService,
  type AccountEntitlement,
  type AccountEntitlementProvider,
  type PublicAccount,
  type ScryptParameters,
  normalizeUsername,
} from "./accounts.js";
import { TokenAuthenticator } from "./auth.js";
import { isBrowserOriginAllowed, type ServerConfig } from "./config.js";
import {
  CoopRendezvousService,
  isCoopRendezvousSessionId,
} from "./domain/coop-rendezvous.js";
import { FriendService } from "./domain/friends.js";
import { admitFieldSharedEvent } from "./domain/field-shared-event-policy.js";
import { fieldSharedSessionContinuityPolicy } from "./domain/field-shared-session-continuity-policy.js";
import { isMatchmakingActivity, MatchmakingService } from "./domain/matchmaking.js";
import {
  formatObjectEtag,
  formatObjectMutation,
  MAX_CONCURRENT_OBJECT_REQUESTS,
  MAX_CONCURRENT_OBJECT_REQUESTS_PER_USER,
  OPAQUE_OBJECT_MEDIA_TYPE,
  type OpaqueObjectStore,
  type OpaqueObjectWriteCondition,
  parseObjectEtag,
  parseOpaqueObjectEnvelope,
  requireObjectId,
} from "./domain/opaque-objects.js";
import {
  isSharedSessionId,
  parseSharedCompatibility,
  parseSharedPlayerProfile,
  parseSharedProgression,
  SharedSessionService,
  type SharedSessionError,
} from "./domain/shared-sessions.js";
import { describeUnknownError, ServiceError } from "./errors.js";
import { EngagementLeaseRegistry } from "./engagement-leases.js";
import { FileOpaqueObjectStore } from "./persistence/file-opaque-object-store.js";
import { FileAccountStore, type AccountStore } from "./persistence/account-store.js";
import { FileFriendStore, type FriendStore } from "./persistence/friend-store.js";
import {
  FileCoopRendezvousStore,
  type CoopRendezvousStore,
} from "./persistence/coop-rendezvous-store.js";
import {
  FileSharedSessionStore,
  type SharedSessionStore,
} from "./persistence/shared-session-store.js";
import { ConcurrentRequestLimiter, FixedWindowRateLimiter } from "./rate-limit.js";
import { RealtimeGateway } from "./realtime/gateway.js";
import { AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE } from "./realtime/authentication-session.js";
import { SharedSessionGateway } from "./realtime/shared-session-gateway.js";
import { RealtimeTicketService } from "./realtime/tickets.js";
import { requireExactObject, requireUserId } from "./validation.js";

const MAX_BODY_BYTES = 4 * 1024;
const MAX_SHARED_SESSION_CREATE_BODY_BYTES = 128 * 1024;
const MAX_OPAQUE_OBJECT_BODY_BYTES = 1536 * 1024;
const REALTIME_PROTOCOL = "social-signaling.v1";
const SHARED_SESSION_PROTOCOL = "authoritative-session.v1";

export interface ApplicationLogger {
  error(event: string, fields: Readonly<Record<string, unknown>>): void;
  info(event: string, fields: Readonly<Record<string, unknown>>): void;
}

export interface ApplicationDependencies {
  readonly accountEntitlementProvider?: AccountEntitlementProvider;
  readonly accountScryptParameters?: ScryptParameters;
  readonly accountStore?: AccountStore;
  readonly coopRendezvousService?: CoopRendezvousService;
  readonly coopRendezvousStore?: CoopRendezvousStore;
  readonly friendStore?: FriendStore;
  readonly logger?: ApplicationLogger;
  readonly objectStore?: OpaqueObjectStore;
  readonly sharedSessionService?: SharedSessionService;
  readonly sharedSessionStore?: SharedSessionStore;
}

export interface RunningAddress {
  readonly host: string;
  readonly port: number;
}

export interface ServerApplication {
  close(gracePeriodMs?: number): Promise<void>;
  listen(): Promise<RunningAddress>;
}

const silentLogger: ApplicationLogger = {
  error: () => undefined,
  info: () => undefined,
};

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

const sendJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): void => {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    ...jsonHeaders,
    "Content-Length": Buffer.byteLength(serialized, "utf8"),
    ...extraHeaders,
  });
  response.end(serialized);
};

const sendEmpty = (
  response: ServerResponse,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): void => {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": "0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end();
};

const readBodyText = async (request: IncomingMessage, maximumBytes = MAX_BODY_BYTES): Promise<string> => {
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      throw new ServiceError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    }
  }
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    receivedBytes += buffer.length;
    if (receivedBytes > maximumBytes) {
      throw new ServiceError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const readJsonBody = async (
  request: IncomingMessage,
  maximumBytes = MAX_BODY_BYTES,
): Promise<unknown> => {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new ServiceError(400, "BAD_REQUEST", "Content-Type must be application/json");
  }
  const text = await readBodyText(request, maximumBytes);
  if (text === "") {
    throw new ServiceError(400, "BAD_REQUEST", "Request body is required");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ServiceError(400, "BAD_REQUEST", "Request body must be valid JSON");
  }
};

const readOpaqueObjectBody = async (request: IncomingMessage): Promise<unknown> => {
  if (
    countRawHeaders(request, "content-type") !== 1 ||
    request.headers["content-type"]?.toLowerCase() !== OPAQUE_OBJECT_MEDIA_TYPE
  ) {
    throw new ServiceError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      `Content-Type must be ${OPAQUE_OBJECT_MEDIA_TYPE}`,
    );
  }
  const text = await readBodyText(request, MAX_OPAQUE_OBJECT_BODY_BYTES);
  if (text === "") {
    throw new ServiceError(400, "BAD_REQUEST", "Request body is required");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ServiceError(400, "BAD_REQUEST", "Request body must be valid JSON");
  }
};

const requireEmptyBody = async (request: IncomingMessage): Promise<void> => {
  if ((await readBodyText(request, 1)).length !== 0) {
    throw new ServiceError(400, "BAD_REQUEST", "This endpoint does not accept a request body");
  }
};

const decodeUserId = (encoded: string): string => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new ServiceError(400, "BAD_REQUEST", "Route user ID is malformed");
  }
  return requireUserId(decoded, "route userId");
};

const decodeObjectId = (encoded: string): string => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new ServiceError(400, "BAD_REQUEST", "Route object ID is malformed");
  }
  return requireObjectId(decoded);
};

const decodeSharedSessionId = (encoded: string): string => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new ServiceError(400, "BAD_REQUEST", "Route session ID is malformed");
  }
  if (!isSharedSessionId(decoded)) {
    throw new ServiceError(400, "BAD_REQUEST", "Route session ID is invalid");
  }
  return decoded;
};

const decodeCoopRendezvousSessionId = (encoded: string): string => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new ServiceError(400, "BAD_REQUEST", "Route session ID is malformed");
  }
  if (!isCoopRendezvousSessionId(decoded)) {
    throw new ServiceError(400, "BAD_REQUEST", "Route session ID is invalid");
  }
  return decoded;
};

const sharedSessionErrorStatus = (error: SharedSessionError): number => {
  switch (error.code) {
    case "invalid-command":
    case "invalid-input":
      return 400;
    case "session-not-found":
      return 404;
    case "peer-mismatch":
    case "player-not-found":
      return 403;
    case "session-limit":
      return 503;
    default:
      return 409;
  }
};

const countRawHeaders = (request: IncomingMessage, headerName: string): number => {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === headerName) {
      count += 1;
    }
  }
  return count;
};

const hasDuplicateAuthorizationHeader = (request: IncomingMessage): boolean => {
  return countRawHeaders(request, "authorization") > 1;
};

const readEngagementLease = (request: IncomingMessage): string | undefined => {
  const count = countRawHeaders(request, "engagement-lease");
  if (count > 1) throw new ServiceError(400, "BAD_REQUEST", "Engagement lease is duplicated");
  const value = count === 1 ? request.headers["engagement-lease"] : undefined;
  if (value !== undefined && (Array.isArray(value) || !/^[A-Za-z0-9_-]{21}[AQgw]$/.test(value))) {
    throw new ServiceError(400, "BAD_REQUEST", "Engagement lease is invalid");
  }
  return typeof value === "string" ? value : undefined;
};

const requirePutCondition = (request: IncomingMessage): OpaqueObjectWriteCondition => {
  const ifMatchCount = countRawHeaders(request, "if-match");
  const ifNoneMatchCount = countRawHeaders(request, "if-none-match");
  if (ifMatchCount > 1 || ifNoneMatchCount > 1 || (ifMatchCount === 1 && ifNoneMatchCount === 1)) {
    throw new ServiceError(400, "BAD_REQUEST", "Exactly one revision condition is allowed");
  }
  if (ifMatchCount === 0 && ifNoneMatchCount === 0) {
    throw new ServiceError(428, "PRECONDITION_REQUIRED", "A revision condition is required");
  }
  if (ifNoneMatchCount === 1) {
    if (request.headers["if-none-match"] !== "*") {
      throw new ServiceError(400, "BAD_REQUEST", "If-None-Match must be * for creation");
    }
    return { kind: "create" };
  }
  const header = request.headers["if-match"];
  const revision = typeof header === "string" ? parseObjectEtag(header) : null;
  if (revision === null) {
    throw new ServiceError(400, "BAD_REQUEST", "If-Match must contain one object ETag");
  }
  return { kind: "match", revision };
};

const requireIfMatchRevision = (request: IncomingMessage): string => {
  if (countRawHeaders(request, "if-none-match") !== 0) {
    throw new ServiceError(400, "BAD_REQUEST", "If-None-Match is not accepted for deletion");
  }
  const count = countRawHeaders(request, "if-match");
  if (count === 0) {
    throw new ServiceError(428, "PRECONDITION_REQUIRED", "If-Match is required");
  }
  const header = request.headers["if-match"];
  const revision = count === 1 && typeof header === "string" ? parseObjectEtag(header) : null;
  if (revision === null) {
    throw new ServiceError(400, "BAD_REQUEST", "If-Match must contain one object ETag");
  }
  return revision;
};

export const createApplication = async (
  config: ServerConfig,
  dependencies: ApplicationDependencies = {},
): Promise<ServerApplication> => {
  const logger = dependencies.logger ?? silentLogger;
  const authenticator = new TokenAuthenticator(config.authTokenHashes);
  const knownUserIds = new Set(config.authTokenHashes.keys());
  const accounts = await AccountService.create(
    dependencies.accountStore ?? new FileAccountStore(config.accountStorePath),
    {
      entitlementPolicy: config.accountEntitlementPolicy,
      ...(dependencies.accountEntitlementProvider === undefined
        ? {}
        : { entitlementProvider: dependencies.accountEntitlementProvider }),
      knownUserIds,
      ...(dependencies.accountScryptParameters === undefined
        ? {}
        : { scryptParameters: dependencies.accountScryptParameters }),
      sessionTtlMs: config.accountSessionTtlMs,
    },
  );
  const friends = await FriendService.create(
    dependencies.friendStore ?? new FileFriendStore(config.friendStorePath),
    knownUserIds,
  );
  const coopRendezvous = dependencies.coopRendezvousService ?? new CoopRendezvousService({
    activeTtlMs: config.sharedSessionIdleTtlMs,
    areFriends: (firstUserId, secondUserId) => friends.areFriends(firstUserId, secondUserId),
    onError: (error) => logger.error("coop_rendezvous_maintenance_failed", {
      error: describeUnknownError(error),
    }),
    queueTtlMs: config.coopRendezvousTtlMs,
    readyTtlMs: config.coopRendezvousTtlMs,
    store: dependencies.coopRendezvousStore
      ?? new FileCoopRendezvousStore(config.coopRendezvousStorePath),
  });
  const objects = dependencies.objectStore ?? new FileOpaqueObjectStore(config.objectStorePath);
  const tickets = new RealtimeTicketService(config.ticketTtlMs);
  const matchmaking = new MatchmakingService({
    authorizationTtlMs: config.matchmakingAuthorizationTtlMs,
    onError: (error) => logger.error("matchmaking_maintenance_failed", {
      error: describeUnknownError(error),
    }),
    queueTtlMs: config.matchmakingQueueTtlMs,
  });
  const requireNoMatchmakingEngagement = (userId: string): void => {
    if (matchmaking.hasEngagement(userId)) {
      throw new ServiceError(
        409,
        "CONFLICT",
        "Account is already engaged in realtime matchmaking",
      );
    }
  };
  const requireNoCoopEngagement = (userId: string): void => {
    if (coopRendezvous.hasCurrentEngagement(userId)) {
      throw new ServiceError(
        409,
        "CONFLICT",
        "Account is already engaged in a direct Coop rendezvous",
      );
    }
  };
  const realtime = new RealtimeGateway(friends, matchmaking, {
    authenticationSessionIsActive: (userId, authenticationSessionId) =>
      accounts.hasActiveSession(authenticationSessionId, userId),
  });
  const sharedSessions = dependencies.sharedSessionService ?? new SharedSessionService({
    continuityPolicy: fieldSharedSessionContinuityPolicy,
    idleTtlMs: config.sharedSessionIdleTtlMs,
    sharedEventAdmission: admitFieldSharedEvent,
    store: dependencies.sharedSessionStore ?? new FileSharedSessionStore(config.sharedSessionStorePath),
  });
  const requireNoSharedSessionMembership = (userId: string): void => {
    if (sharedSessions.hasMembership(userId)) {
      throw new ServiceError(
        409,
        "CONFLICT",
        "Account is already a member of an authoritative shared session",
      );
    }
  };
  const sharedSessionRealtime = new SharedSessionGateway(sharedSessions, {
    authenticationSessionIsActive: (userId, authenticationSessionId) =>
      accounts.hasActiveSession(authenticationSessionId, userId),
    authorizeJoin: ({ guestUserId, ownerUserId, sessionId }) => {
      if (coopRendezvous.authorizeGuest(sessionId, guestUserId, ownerUserId) !== null) {
        return "direct-coop";
      }
      return !coopRendezvous.hasSession(sessionId)
        && config.allowLegacyCoopBootstrap
        && (friends.areFriends(ownerUserId, guestUserId)
          || matchmaking.isSignalAuthorizedForActivity(
            ownerUserId,
            guestUserId,
            sessionId,
            "coop",
          ))
        ? "legacy-coop"
        : false;
    },
  });
  const matchmakingLeases = new EngagementLeaseRegistry();
  const coopLeases = new EngagementLeaseRegistry();
  const authenticationSessionIdOf = (principal: AuthenticatedPrincipal): string | undefined =>
    principal.source === "account" ? principal.authenticationSessionId : undefined;
  const matchmakingEngagementId = (status: ReturnType<MatchmakingService["status"]>): string | undefined =>
    status.status === "queued"
      ? `queued:${status.activity}:${status.joinedAt}`
      : status.status === "matched"
        ? `matched:${status.matchId}`
        : undefined;
  const withMatchmakingLease = (
    userId: string,
    principal: AuthenticatedPrincipal,
    status: ReturnType<MatchmakingService["status"]>,
  ) => {
    if (principal.source === "legacy") return status;
    const lease = matchmakingLeases.issue(
      userId,
      matchmakingEngagementId(status),
      authenticationSessionIdOf(principal),
    );
    return lease === undefined ? status : Object.freeze({ ...status, lease });
  };
  const coopEngagementId = (current: ReturnType<CoopRendezvousService["status"]>["current"]): string | undefined =>
    current.status === "queued"
      ? `queued:${current.joinedAt}`
      : current.status === "idle"
        ? undefined
        : `${current.status}:${current.sessionId}`;
  const withCoopLease = (
    userId: string,
    principal: AuthenticatedPrincipal,
    snapshot: ReturnType<CoopRendezvousService["status"]>,
  ) => {
    if (principal.source === "legacy") return snapshot;
    const attachmentId = snapshot.current.status === "active"
      ? sharedSessionRealtime.currentAttachmentId(snapshot.current.sessionId, userId)
      : undefined;
    const lease = coopLeases.issue(
      userId,
      coopEngagementId(snapshot.current),
      authenticationSessionIdOf(principal),
      attachmentId,
    );
    return lease === undefined
      ? snapshot
      : Object.freeze({ ...snapshot, current: Object.freeze({ ...snapshot.current, lease }) });
  };
  const requestLimiters = new Map<string, FixedWindowRateLimiter>();
  const mutationLimiters = new Map<string, FixedWindowRateLimiter>();
  const credentialGlobalLimiter = new FixedWindowRateLimiter(500, 60_000);
  const credentialLimiters = new Map<
    string,
    { readonly limiter: FixedWindowRateLimiter; lastSeenAt: number }
  >();
  const credentialConcurrencyLimiter = new ConcurrentRequestLimiter<string>(4, 1);
  const objectConcurrencyLimiter = new ConcurrentRequestLimiter(
    MAX_CONCURRENT_OBJECT_REQUESTS,
    MAX_CONCURRENT_OBJECT_REQUESTS_PER_USER,
  );
  const sockets = new Set<Socket>();
  let listening = false;
  let closing = false;
  let closeTask: Promise<void> | undefined;

  const applyCors = (request: IncomingMessage, response: ServerResponse): void => {
    const origin = request.headers.origin;
    if (origin === undefined) {
      return;
    }
    if (!isBrowserOriginAllowed(config, origin)) {
      throw new ServiceError(403, "FORBIDDEN", "Origin is not allowed");
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader(
      "Access-Control-Expose-Headers",
      "ETag, Opaque-Mutation, Engagement-Lease, Shared-Attachment",
    );
    response.setHeader("Vary", "Origin");
  };

  type AuthenticatedPrincipal =
    | Readonly<{
        account: PublicAccount;
        authenticationSessionId: string;
        source: "account";
        userId: string;
      }>
    | Readonly<{
        account: PublicAccount;
        source: "legacy";
        userId: string;
      }>;

  const authenticate = (request: IncomingMessage): AuthenticatedPrincipal => {
    if (hasDuplicateAuthorizationHeader(request)) {
      throw new ServiceError(401, "UNAUTHORIZED", "A valid Bearer token is required");
    }
    const accountAuthentication = accounts.authenticateAuthorizationHeader(request.headers.authorization);
    const legacyUserId = accountAuthentication === null
      ? authenticator.authenticateAuthorizationHeader(request.headers.authorization)
      : null;
    const principal: AuthenticatedPrincipal | null = accountAuthentication === null
      ? legacyUserId === null
        ? null
        : {
            account: {
              entitlements: [...ACCOUNT_ENTITLEMENTS],
              id: legacyUserId,
              role: "admin",
              username: legacyUserId,
            },
            source: "legacy",
            userId: legacyUserId,
          }
      : {
          account: accountAuthentication.account,
          authenticationSessionId: accountAuthentication.authenticationSessionId,
          source: "account",
          userId: accountAuthentication.accountId,
        };
    if (principal === null) {
      throw new ServiceError(401, "UNAUTHORIZED", "A valid Bearer token is required");
    }
    const userId = principal.userId;
    const limiter = requestLimiters.get(userId) ?? new FixedWindowRateLimiter(300, 60_000);
    requestLimiters.set(userId, limiter);
    if (!limiter.take()) {
      throw new ServiceError(429, "RATE_LIMITED", "HTTP request rate exceeded");
    }
    return principal;
  };

  const requireEntitlement = (
    principal: AuthenticatedPrincipal,
    entitlement: AccountEntitlement,
  ): void => {
    if (!principal.account.entitlements.includes(entitlement)) {
      throw new ServiceError(403, "ENTITLEMENT_REQUIRED", "This account is not enabled for this capability");
    }
  };

  const acquireCredentialCapacity = (credentialKey: string): (() => void) => {
    if (!credentialGlobalLimiter.take()) {
      throw new ServiceError(429, "RATE_LIMITED", "Too many account attempts");
    }
    const now = Date.now();
    let entry = credentialLimiters.get(credentialKey);
    if (entry === undefined) {
      if (credentialLimiters.size >= 4_096) {
        for (const [address, candidate] of credentialLimiters) {
          if (now - candidate.lastSeenAt >= 5 * 60_000) credentialLimiters.delete(address);
        }
        if (credentialLimiters.size >= 4_096) {
          throw new ServiceError(429, "RATE_LIMITED", "Too many account attempts");
        }
      }
      entry = { lastSeenAt: now, limiter: new FixedWindowRateLimiter(20, 60_000) };
      credentialLimiters.set(credentialKey, entry);
    }
    entry.lastSeenAt = now;
    if (!entry.limiter.take()) {
      throw new ServiceError(429, "RATE_LIMITED", "Too many account attempts");
    }
    const release = credentialConcurrencyLimiter.acquire(credentialKey);
    if (release === undefined) {
      throw new ServiceError(429, "RATE_LIMITED", "Another account attempt is already running");
    }
    return release;
  };

  const requireMutationCapacity = (userId: string): void => {
    const limiter = mutationLimiters.get(userId) ?? new FixedWindowRateLimiter(30, 60_000);
    mutationLimiters.set(userId, limiter);
    if (!limiter.take()) {
      throw new ServiceError(429, "RATE_LIMITED", "Mutation rate exceeded");
    }
  };

  const resolveKnownUserId = (userId: string): string => {
    if (knownUserIds.has(userId)) return userId;
    return normalizeUsername(userId) ?? userId;
  };

  const sendSharedSessionFailure = (
    response: ServerResponse,
    requestId: string,
    error: SharedSessionError,
  ): void => {
    sendJson(response, sharedSessionErrorStatus(error), {
      error,
      requestId,
    });
  };

  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const requestId = randomUUID();
    response.setHeader("X-Request-Id", requestId);
    try {
      applyCors(request, response);
      if (closing) {
        throw new ServiceError(503, "UNAVAILABLE", "Server is shutting down");
      }
      if ((request.url?.length ?? 0) > 2_048) {
        throw new ServiceError(414, "BAD_REQUEST", "Request URL is too long");
      }
      let url: URL;
      try {
        url = new URL(request.url ?? "/", "http://server.invalid");
      } catch {
        throw new ServiceError(400, "BAD_REQUEST", "Request URL is malformed");
      }
      if (url.search !== "" || url.hash !== "") {
        throw new ServiceError(400, "BAD_REQUEST", "Query parameters are not accepted on HTTP routes");
      }

      if (request.method === "OPTIONS") {
        if (request.headers.origin === undefined) {
          throw new ServiceError(400, "BAD_REQUEST", "Origin is required for preflight");
        }
        response.writeHead(204, {
          "Access-Control-Allow-Headers":
            "Authorization, Content-Type, Engagement-Lease, If-Match, If-None-Match, Shared-Attachment",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Max-Age": "600",
          "Cache-Control": "no-store",
        });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { status: closing ? "stopping" : "ok" });
        return;
      }

      if (
        request.method === "POST"
        && (url.pathname === "/v1/accounts/register" || url.pathname === "/v1/accounts/login")
      ) {
        const body = requireExactObject(await readJsonBody(request), ["username", "password"]);
        const release = acquireCredentialCapacity(normalizeUsername(body.username) ?? "invalid");
        try {
          const result = url.pathname.endsWith("/register")
            ? await accounts.register(body.username, body.password)
            : await accounts.login(body.username, body.password);
          sendJson(response, url.pathname.endsWith("/register") ? 201 : 200, result);
          return;
        } finally {
          release();
        }
      }

      if (url.pathname === "/v1/test-device-enrollments") {
        throw new ServiceError(404, "NOT_FOUND", "Route not found");
      }

      const principal = authenticate(request);
      const userId = principal.userId;
      if (request.method === "GET" && url.pathname === "/v1/account") {
        sendJson(response, 200, { account: principal.account });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/accounts/logout") {
        requireMutationCapacity(userId);
        await requireEmptyBody(request);
        if (principal.source === "account") {
          const revoked = await accounts.logout(request.headers.authorization);
          if (revoked) {
            tickets.revokeAuthenticationSession(userId, principal.authenticationSessionId);
            realtime.revokeAuthenticationSession(userId, principal.authenticationSessionId);
            sharedSessionRealtime.revokeAuthenticationSession(
              userId,
              principal.authenticationSessionId,
            );
          }
        }
        sendEmpty(response, 204);
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/me") {
        sendJson(response, 200, { userId });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/matchmaking") {
        requireEntitlement(principal, "online");
        sendJson(response, 200, withMatchmakingLease(userId, principal, matchmaking.status(userId)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/matchmaking") {
        requireEntitlement(principal, "online");
        requireMutationCapacity(userId);
        const body = requireExactObject(await readJsonBody(request), ["activity"]);
        if (!isMatchmakingActivity(body.activity)) {
          throw new ServiceError(400, "BAD_REQUEST", "activity is invalid");
        }
        if (!realtime.isOnline(userId)) {
          throw new ServiceError(
            409,
            "CONFLICT",
            "An active realtime connection is required for matchmaking",
          );
        }
        requireNoCoopEngagement(userId);
        requireNoSharedSessionMembership(userId);
        const status = matchmaking.join(userId, body.activity);
        sendJson(
          response,
          status.status === "queued" ? 202 : 200,
          withMatchmakingLease(userId, principal, status),
        );
        return;
      }
      if (request.method === "DELETE" && url.pathname === "/v1/matchmaking") {
        requireEntitlement(principal, "online");
        requireMutationCapacity(userId);
        await requireEmptyBody(request);
        const status = matchmaking.status(userId);
        const engagementId = matchmakingEngagementId(status);
        if (principal.source === "account" && engagementId !== undefined && !matchmakingLeases.matches(
          userId,
          readEngagementLease(request),
          engagementId,
          authenticationSessionIdOf(principal),
        )) {
          throw new ServiceError(409, "STALE_MATCHMAKING_LEASE", "A newer device owns matchmaking");
        }
        matchmaking.cancel(userId);
        matchmakingLeases.clear(userId);
        sendEmpty(response, 204);
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/coop-rendezvous") {
        requireEntitlement(principal, "online");
        sendJson(response, 200, withCoopLease(userId, principal, coopRendezvous.status(userId)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/coop-rendezvous/random") {
        requireEntitlement(principal, "online");
        requireMutationCapacity(userId);
        await requireEmptyBody(request);
        requireNoMatchmakingEngagement(userId);
        sendJson(response, 200, withCoopLease(userId, principal, coopRendezvous.joinRandom(userId)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/coop-rendezvous/invitations") {
        requireEntitlement(principal, "online");
        requireMutationCapacity(userId);
        const body = requireExactObject(await readJsonBody(request), ["peerUserId"]);
        const peerUserId = resolveKnownUserId(requireUserId(body.peerUserId, "peerUserId"));
        requireNoMatchmakingEngagement(userId);
        sendJson(response, 200, withCoopLease(
          userId,
          principal,
          coopRendezvous.inviteFriend(userId, peerUserId),
        ));
        return;
      }
      const coopInvitationMatch =
        /^\/v1\/coop-rendezvous\/invitations\/([^/]+)(?:\/(accept))?$/.exec(url.pathname);
      if (coopInvitationMatch !== null) {
        requireEntitlement(principal, "online");
        const sessionId = decodeCoopRendezvousSessionId(coopInvitationMatch[1] ?? "");
        const action = coopInvitationMatch[2];
        if (request.method === "POST" && action === "accept") {
          requireMutationCapacity(userId);
          await requireEmptyBody(request);
          if (coopRendezvous.hasPendingInvitation(userId, sessionId)) {
            requireNoMatchmakingEngagement(userId);
          }
          sendJson(response, 200, withCoopLease(
            userId,
            principal,
            coopRendezvous.acceptInvitation(userId, sessionId),
          ));
          return;
        }
        if (request.method === "DELETE" && action === undefined) {
          requireMutationCapacity(userId);
          await requireEmptyBody(request);
          sendJson(response, 200, withCoopLease(
            userId,
            principal,
            coopRendezvous.cancelInvitation(userId, sessionId),
          ));
          return;
        }
      }
      if (request.method === "DELETE" && url.pathname === "/v1/coop-rendezvous/current") {
        requireEntitlement(principal, "online");
        requireMutationCapacity(userId);
        await requireEmptyBody(request);
        const current = coopRendezvous.status(userId).current;
        const engagementId = coopEngagementId(current);
        const attachmentId = current.status === "active"
          ? sharedSessionRealtime.currentAttachmentId(current.sessionId, userId)
          : undefined;
        if (principal.source === "account" && engagementId !== undefined && !coopLeases.matches(
          userId,
          readEngagementLease(request),
          engagementId,
          authenticationSessionIdOf(principal),
          attachmentId,
        )) {
          throw new ServiceError(409, "STALE_COOP_LEASE", "A newer device owns this Coop engagement");
        }
        if (current.status === "ready" || current.status === "active") {
          const ownerUserId = current.role === "host" ? userId : current.peerUserId;
          const ended = sharedSessionRealtime.endSession(current.sessionId, ownerUserId);
          if (!ended.ok && ended.error.code !== "session-not-found") {
            sendSharedSessionFailure(response, requestId, ended.error);
            return;
          }
        }
        const cancelled = coopRendezvous.cancelCurrent(userId);
        coopLeases.clear(userId);
        sendJson(response, 200, withCoopLease(userId, principal, cancelled));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/shared-sessions") {
        requireEntitlement(principal, "online");
        requireMutationCapacity(userId);
        const body = requireExactObject(
          await readJsonBody(request, MAX_SHARED_SESSION_CREATE_BODY_BYTES),
          ["sessionId", "peerUserId", "compatibility", "player", "sharedProgression"],
        );
        if (!isSharedSessionId(body.sessionId)) {
          throw new ServiceError(400, "BAD_REQUEST", "sessionId is invalid");
        }
        const peerUserId = resolveKnownUserId(requireUserId(body.peerUserId, "peerUserId"));
        const coopAuthorization = coopRendezvous.authorizeHost(
          body.sessionId,
          userId,
          peerUserId,
        );
        const knownCoopRendezvous = coopRendezvous.hasSession(body.sessionId);
        const legacyAuthorized = config.allowLegacyCoopBootstrap
          && (friends.areFriends(userId, peerUserId)
            || matchmaking.isSignalAuthorizedForActivity(
              userId,
              peerUserId,
              body.sessionId,
              "coop",
            ));
        if (coopAuthorization === null && (knownCoopRendezvous || !legacyAuthorized)) {
          throw new ServiceError(
            403,
            "FORBIDDEN",
            "Shared session creation requires a ready server Coop rendezvous authorization",
          );
        }
        const compatibility = parseSharedCompatibility(body.compatibility);
        const player = parseSharedPlayerProfile(body.player);
        const sharedProgression = body.sharedProgression === undefined
          ? undefined
          : parseSharedProgression(body.sharedProgression);
        if (
          compatibility === undefined
          || player === undefined
          || (body.sharedProgression !== undefined && sharedProgression === undefined)
        ) {
          throw new ServiceError(400, "BAD_REQUEST", "Shared session input is invalid");
        }
        const resumed = sharedSessions.resumeOwner({
          compatibility,
          ownerId: userId,
          peerUserId,
          sessionId: body.sessionId,
        });
        if (resumed.ok) {
          if (coopAuthorization !== null) {
            coopRendezvous.markActive(body.sessionId, userId, peerUserId);
          }
          sendJson(response, 200, { snapshot: resumed.value });
          return;
        }
        if (resumed.error.code !== "session-not-found") {
          sendSharedSessionFailure(response, requestId, resumed.error);
          return;
        }
        if (coopAuthorization?.status === "active") {
          sendSharedSessionFailure(response, requestId, resumed.error);
          return;
        }
        const created = sharedSessions.create({
          compatibility,
          ownerId: userId,
          peerUserId,
          player,
          sessionId: body.sessionId,
          ...(sharedProgression === undefined ? {} : { sharedProgression }),
        });
        if (!created.ok) {
          sendSharedSessionFailure(response, requestId, created.error);
          return;
        }
        if (coopAuthorization !== null) {
          try {
            coopRendezvous.markActive(body.sessionId, userId, peerUserId);
          } catch (error) {
            try {
              const rolledBack = sharedSessionRealtime.endSession(body.sessionId, userId);
              if (!rolledBack.ok) {
                logger.error("shared_session_activation_rollback_failed", {
                  code: rolledBack.error.code,
                  sessionId: body.sessionId,
                });
              }
            } catch (rollbackError) {
              logger.error("shared_session_activation_rollback_failed", {
                error: describeUnknownError(rollbackError),
                sessionId: body.sessionId,
              });
            }
            throw error;
          }
        }
        sendJson(response, 201, { snapshot: created.value });
        return;
      }
      if (url.pathname === "/v1/shared-sessions/realtime") {
        throw new ServiceError(426, "BAD_REQUEST", "A WebSocket upgrade is required");
      }
      const sharedSessionMatch = /^\/v1\/shared-sessions\/([^/]+)(?:\/(join|members\/me))?$/.exec(
        url.pathname,
      );
      if (sharedSessionMatch !== null) {
        requireEntitlement(principal, "online");
        const sessionId = decodeSharedSessionId(sharedSessionMatch[1] ?? "");
        const action = sharedSessionMatch[2];
        if (request.method === "GET" && action === undefined) {
          const current = sharedSessions.read(sessionId, userId);
          if (!current.ok) {
            sendSharedSessionFailure(response, requestId, current.error);
            return;
          }
          sendJson(response, 200, { snapshot: current.value });
          return;
        }
        if (request.method === "POST" && action === "join") {
          requireMutationCapacity(userId);
          const body = requireExactObject(await readJsonBody(request), ["compatibility", "player"]);
          const compatibility = parseSharedCompatibility(body.compatibility);
          const player = parseSharedPlayerProfile(body.player);
          if (compatibility === undefined || player === undefined) {
            throw new ServiceError(400, "BAD_REQUEST", "Shared session input is invalid");
          }
          if (
            principal.source === "account"
            && !accounts.hasActiveSession(principal.authenticationSessionId, userId)
          ) {
            throw new ServiceError(401, "UNAUTHORIZED", "Account session is no longer active");
          }
          const joined = await sharedSessionRealtime.join({
            ...(principal.source === "account"
              ? { authenticationSessionId: principal.authenticationSessionId }
              : {}),
            compatibility,
            player,
            sessionId,
            userId,
          });
          if (!joined.ok) {
            sendSharedSessionFailure(response, requestId, joined.error);
            return;
          }
          sendJson(response, 200, { snapshot: joined.value });
          return;
        }
        if (request.method === "DELETE" && action === "members/me") {
          requireMutationCapacity(userId);
          await requireEmptyBody(request);
          const attachmentHeaderCount = countRawHeaders(request, "shared-attachment");
          if (attachmentHeaderCount > 1) {
            throw new ServiceError(400, "BAD_REQUEST", "Shared attachment header is duplicated");
          }
          const attachmentId = attachmentHeaderCount === 1
            ? request.headers["shared-attachment"]
            : undefined;
          if (
            attachmentId !== undefined
            && (Array.isArray(attachmentId) || !/^[A-Za-z0-9_-]{16,128}$/.test(attachmentId))
          ) {
            throw new ServiceError(400, "BAD_REQUEST", "Shared attachment header is invalid");
          }
          const left = sharedSessionRealtime.leave(
            sessionId,
            userId,
            principal.source === "account" ? principal.authenticationSessionId : undefined,
            typeof attachmentId === "string" ? attachmentId : undefined,
          );
          if (left === "stale-attachment") {
            throw new ServiceError(
              409,
              "STALE_ATTACHMENT",
              "A newer device owns this shared session membership",
            );
          }
          if (!left.ok) {
            sendSharedSessionFailure(response, requestId, left.error);
            return;
          }
          sendEmpty(response, 204);
          return;
        }
      }
      const objectMatch = /^\/v1\/objects\/([^/]+)$/.exec(url.pathname);
      if (objectMatch !== null) {
        const objectId = decodeObjectId(objectMatch[1] ?? "");
        if (request.method === "GET" || request.method === "PUT" || request.method === "DELETE") {
          requireEntitlement(principal, "cloud-storage");
          const release = objectConcurrencyLimiter.acquire(userId);
          if (release === undefined) {
            throw new ServiceError(429, "RATE_LIMITED", "Object request concurrency exceeded");
          }
          try {
            if (request.method === "GET") {
              const stored = await objects.get(userId, objectId);
              if (stored === null) {
                throw new ServiceError(404, "NOT_FOUND", "Object not found");
              }
              sendJson(response, 200, stored.envelope, {
                "Content-Type": OPAQUE_OBJECT_MEDIA_TYPE,
                ETag: formatObjectEtag(stored.revision),
                "Opaque-Mutation": formatObjectMutation(stored.mutation),
              });
              return;
            }
            if (request.method === "PUT") {
              requireMutationCapacity(userId);
              const condition = requirePutCondition(request);
              const envelope = parseOpaqueObjectEnvelope(await readOpaqueObjectBody(request));
              const result = await objects.put(userId, objectId, envelope, condition);
              sendEmpty(response, result.created ? 201 : 204, {
                ETag: formatObjectEtag(result.revision),
                "Opaque-Mutation": formatObjectMutation(result.mutation),
              });
              return;
            }
            requireMutationCapacity(userId);
            const revision = requireIfMatchRevision(request);
            await requireEmptyBody(request);
            await objects.delete(userId, objectId, revision);
            sendEmpty(response, 204);
            return;
          } finally {
            release();
          }
        }
      }
      if (request.method === "GET" && url.pathname === "/v1/social") {
        requireEntitlement(principal, "online");
        const snapshot = friends.list(userId);
        sendJson(response, 200, {
          friends: snapshot.friends.map((friendId) => ({
            online: realtime.isOnline(friendId),
            userId: friendId,
          })),
          incoming: snapshot.incoming,
          outgoing: snapshot.outgoing,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/friend-requests") {
        requireEntitlement(principal, "online");
        requireMutationCapacity(userId);
        const body = requireExactObject(await readJsonBody(request), ["userId"]);
        const target = resolveKnownUserId(requireUserId(body.userId));
        await friends.sendRequest(userId, target);
        realtime.notifySocialChanged([userId, target]);
        sendJson(response, 201, { ok: true });
        return;
      }
      const requestActionMatch = /^\/v1\/friend-requests\/([^/]+)\/(accept|decline)$/.exec(url.pathname);
      if (request.method === "POST" && requestActionMatch !== null) {
        requireEntitlement(principal, "online");
        requireMutationCapacity(userId);
        await requireEmptyBody(request);
        const target = resolveKnownUserId(decodeUserId(requestActionMatch[1] ?? ""));
        if (requestActionMatch[2] === "accept") {
          await friends.acceptRequest(userId, target);
        } else {
          await friends.declineRequest(userId, target);
        }
        realtime.notifySocialChanged([userId, target]);
        sendJson(response, 200, { ok: true });
        return;
      }
      const cancelRequestMatch = /^\/v1\/friend-requests\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && cancelRequestMatch !== null) {
        requireEntitlement(principal, "online");
        requireMutationCapacity(userId);
        await requireEmptyBody(request);
        const target = resolveKnownUserId(decodeUserId(cancelRequestMatch[1] ?? ""));
        await friends.cancelRequest(userId, target);
        realtime.notifySocialChanged([userId, target]);
        sendJson(response, 200, { ok: true });
        return;
      }
      const removeFriendMatch = /^\/v1\/friends\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && removeFriendMatch !== null) {
        requireEntitlement(principal, "online");
        requireMutationCapacity(userId);
        await requireEmptyBody(request);
        const target = resolveKnownUserId(decodeUserId(removeFriendMatch[1] ?? ""));
        await friends.removeFriend(userId, target);
        realtime.notifySocialChanged([userId, target]);
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/realtime-ticket") {
        requireEntitlement(principal, "online");
        requireMutationCapacity(userId);
        await requireEmptyBody(request);
        const origin = request.headers.origin;
        if (origin === undefined) {
          throw new ServiceError(400, "BAD_REQUEST", "Origin is required for a realtime ticket");
        }
        const authenticationSessionId = principal.source === "account"
          ? principal.authenticationSessionId
          : undefined;
        if (
          authenticationSessionId !== undefined
          && !accounts.hasActiveSession(authenticationSessionId, userId)
        ) {
          throw new ServiceError(401, "UNAUTHORIZED", "Account session is no longer active");
        }
        sendJson(response, 201, tickets.issue(userId, origin, authenticationSessionId));
        return;
      }
      if (url.pathname === "/v1/realtime") {
        throw new ServiceError(426, "BAD_REQUEST", "A WebSocket upgrade is required");
      }
      throw new ServiceError(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      const serviceError =
        error instanceof ServiceError
          ? error
          : new ServiceError(500, "INTERNAL_ERROR", "Internal server error");
      if (!(error instanceof ServiceError)) {
        logger.error("request_failed", { error: describeUnknownError(error), requestId });
      }
      if (serviceError.status === 401) {
        response.setHeader("WWW-Authenticate", 'Bearer realm="social-signaling"');
      }
      sendJson(response, serviceError.status, {
        error: { code: serviceError.code, message: serviceError.message },
        requestId,
      });
    }
  };

  const httpServer = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      logger.error("unhandled_request_failure", { error: describeUnknownError(error) });
      response.destroy();
    });
  });
  httpServer.headersTimeout = 10_000;
  httpServer.requestTimeout = 15_000;
  httpServer.keepAliveTimeout = 5_000;
  httpServer.maxHeadersCount = 50;
  httpServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  httpServer.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  httpServer.on("upgrade", (request, socket, head) => {
    const reject = (status: number, message: string): void => {
      socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
    };
    if (closing) {
      reject(503, "Service Unavailable");
      return;
    }
    const origin = request.headers.origin;
    if (origin === undefined || !isBrowserOriginAllowed(config, origin)) {
      reject(403, "Forbidden");
      return;
    }
    if ((request.url?.length ?? 0) > 2_048) {
      reject(414, "URI Too Long");
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://server.invalid");
    } catch {
      reject(400, "Bad Request");
      return;
    }
    const protocol = request.headers["sec-websocket-protocol"];
    const isSignalingRoute = url.pathname === "/v1/realtime";
    const isSharedSessionRoute = url.pathname === "/v1/shared-sessions/realtime";
    if (!isSignalingRoute && !isSharedSessionRoute) {
      reject(404, "Not Found");
      return;
    }
    if (
      (isSignalingRoute && protocol !== REALTIME_PROTOCOL)
      || (isSharedSessionRoute && protocol !== SHARED_SESSION_PROTOCOL)
    ) {
      reject(400, "Bad Request");
      return;
    }
    const ticketValues = url.searchParams.getAll("ticket");
    if (
      [...url.searchParams.keys()].some((key) => key !== "ticket")
      || ticketValues.length !== 1
    ) {
      reject(404, "Not Found");
      return;
    }
    const realtimeIdentity = tickets.consume(ticketValues[0] ?? "", origin);
    if (
      realtimeIdentity === null
      || (
        realtimeIdentity.authenticationSessionId !== undefined
        && !accounts.hasActiveSession(
          realtimeIdentity.authenticationSessionId,
          realtimeIdentity.userId,
        )
      )
    ) {
      reject(401, "Unauthorized");
      return;
    }
    if (isSignalingRoute) {
      realtime.webSocketServer.handleUpgrade(request, socket, head, (webSocket: WebSocket) => {
        if (
          realtimeIdentity.authenticationSessionId !== undefined
          && !accounts.hasActiveSession(
            realtimeIdentity.authenticationSessionId,
            realtimeIdentity.userId,
          )
        ) {
          webSocket.close(
            AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE,
            "Account session logged out",
          );
          return;
        }
        realtime.attach(
          webSocket,
          realtimeIdentity.userId,
          realtimeIdentity.authenticationSessionId,
        );
      });
      return;
    }
    sharedSessionRealtime.webSocketServer.handleUpgrade(
      request,
      socket,
      head,
      (webSocket: WebSocket) => {
        if (
          realtimeIdentity.authenticationSessionId !== undefined
          && !accounts.hasActiveSession(
            realtimeIdentity.authenticationSessionId,
            realtimeIdentity.userId,
          )
        ) {
          webSocket.close(
            AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE,
            "Account session logged out",
          );
          return;
        }
        sharedSessionRealtime.attach(
          webSocket,
          realtimeIdentity.userId,
          realtimeIdentity.authenticationSessionId,
        );
      },
    );
  });

  return {
    async close(gracePeriodMs = 5_000): Promise<void> {
      if (closeTask !== undefined) return closeTask;
      closing = true;
      closeTask = (async () => {
        coopRendezvous.shutdown();
        sharedSessions.shutdown();
        sharedSessionRealtime.shutdown();
        realtime.shutdown();
        await sharedSessions.close();
        if (!listening) return;
        const closePromise = new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error === undefined ? resolve() : reject(error)));
        });
        const forceTimer = setTimeout(() => {
          for (const socket of sockets) {
            socket.destroy();
          }
        }, gracePeriodMs);
        forceTimer.unref();
        try {
          await closePromise;
        } finally {
          clearTimeout(forceTimer);
          listening = false;
          logger.info("server_stopped", {});
        }
      })().catch((error: unknown) => {
        closeTask = undefined;
        throw error;
      });
      return closeTask;
    },
    async listen(): Promise<RunningAddress> {
      if (listening || closing) {
        throw new Error("Server cannot listen in its current state");
      }
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error);
        httpServer.once("error", onError);
        httpServer.listen(config.port, config.host, () => {
          httpServer.off("error", onError);
          resolve();
        });
      });
      listening = true;
      const address = httpServer.address() as AddressInfo;
      logger.info("server_started", { host: address.address, port: address.port });
      return { host: address.address, port: address.port };
    },
  };
};
