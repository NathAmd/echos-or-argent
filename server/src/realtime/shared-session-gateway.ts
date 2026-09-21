import { randomBytes } from "node:crypto";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import {
  SharedSessionService,
  type SharedCompatibility,
  type SharedEventCommand,
  type SharedJoinInput,
  type SharedMovementCommand,
  type SharedPlayerProfile,
  type SharedPosition,
  type SharedSessionCommand,
  type SharedSessionErrorCode,
  type SharedSessionEvent,
  type SharedSessionResult,
  type SharedSessionSnapshot,
} from "../domain/shared-sessions.js";
import { ServiceError } from "../errors.js";
import { FixedWindowRateLimiter } from "../rate-limit.js";
import { AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE } from "./authentication-session.js";
import { parseSharedSessionClientMessage } from "./shared-session-protocol.js";

const MAX_REMEMBERED_REQUESTS = 256;
const ADMISSION_TIMEOUT_MS = 5_000;

interface AttachmentState {
  readonly attachmentId: string;
  readonly sessionId: string;
  readonly unsubscribe: () => void;
}

interface LatestAttachment {
  readonly attachmentId: string;
  readonly authenticationSessionId?: string;
}

interface ConnectionState {
  alive: boolean;
  attachment: AttachmentState | undefined;
  readonly authenticationSessionId?: string;
  readonly rateLimiter: FixedWindowRateLimiter;
  readonly requestIds: Set<string>;
  readonly requestOrder: string[];
  readonly userId: string;
}

interface PendingCommandAdmission {
  readonly admissionId: string;
  readonly command: SharedAdmissionCommand;
  readonly kind: "command";
  readonly moverSocket: WebSocket;
  readonly playerId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly timeout: NodeJS.Timeout;
  readonly verifierSocket: WebSocket;
}

interface PendingJoinAdmission {
  readonly admissionId: string;
  readonly authenticationSessionId?: string;
  readonly authorizationKind: SharedJoinAuthorizationKind;
  readonly input: SharedJoinInput;
  readonly kind: "join";
  readonly ownerUserId: string;
  readonly playerId: string;
  readonly reject: (error: unknown) => void;
  readonly resolve: (result: SharedSessionResult<SharedSessionSnapshot>) => void;
  readonly sessionId: string;
  readonly timeout: NodeJS.Timeout;
  readonly verifierSocket: WebSocket;
}

type PendingAdmission = PendingCommandAdmission | PendingJoinAdmission;

type SharedAdmissionCommand = SharedMovementCommand | SharedEventCommand;

export interface SharedJoinAuthorizationInput {
  readonly guestUserId: string;
  readonly ownerUserId: string;
  readonly sessionId: string;
}

export type SharedJoinAuthorizationKind = "direct-coop" | "legacy-coop" | "unrestricted";

export interface SharedSessionGatewayOptions {
  readonly authenticationSessionIsActive?: (
    userId: string,
    authenticationSessionId: string,
  ) => boolean;
  readonly authorizeJoin?: (
    input: SharedJoinAuthorizationInput,
  ) => SharedJoinAuthorizationKind | false;
}

export interface SharedSessionGatewayJoinInput extends SharedJoinInput {
  readonly authenticationSessionId?: string;
}

type ServerMessage =
  | Readonly<{
      readonly admissionId: string;
      readonly command: SharedAdmissionCommand;
      readonly playerId: string;
      readonly sessionId: string;
      readonly snapshot: SharedSessionSnapshot;
      readonly type: "admission-request";
    }>
  | Readonly<{
      readonly admissionId: string;
      readonly compatibility: SharedCompatibility;
      readonly player: SharedPlayerProfile;
      readonly playerId: string;
      readonly sessionId: string;
      readonly snapshot: SharedSessionSnapshot;
      readonly type: "join-admission-request";
    }>
  | Readonly<{
      readonly attachmentId: string;
      readonly requestId: string;
      readonly snapshot: unknown;
      readonly type: "attached";
    }>
  | Readonly<{
      readonly requestId: string;
      readonly snapshot: unknown;
      readonly type: "snapshot-response";
    }>
  | Readonly<{
      readonly appliedRevision: number;
      readonly replayed: boolean;
      readonly requestId: string;
      readonly snapshot: unknown;
      readonly type: "command-accepted";
    }>
  | Readonly<{ readonly requestId: string; readonly type: "detached" }>
  | Readonly<{
      readonly code: string;
      readonly message: string;
      readonly requestId?: string;
      readonly type: "error";
    }>
  | Readonly<{ readonly snapshot: unknown; readonly type: "snapshot" }>
  | Readonly<{
      readonly reason: Extract<SharedSessionEvent, { type: "ended" }>["reason"];
      readonly sessionId: string;
      readonly type: "session-ended";
    }>
  | Readonly<{ readonly type: "ready"; readonly userId: string; readonly version: 1 }>;

export class SharedSessionGateway {
  readonly webSocketServer = new WebSocketServer({ maxPayload: 16 * 1024, noServer: true });
  private readonly connections = new Map<string, WebSocket>();
  private readonly heartbeatTimer: NodeJS.Timeout;
  private readonly latestAttachments = new Map<string, Map<string, LatestAttachment>>();
  private readonly pendingAdmissions = new Map<string, PendingAdmission>();
  private readonly pendingAdmissionBySession = new Map<string, string>();
  private readonly rateLimiters = new Map<string, FixedWindowRateLimiter>();
  private readonly states = new WeakMap<WebSocket, ConnectionState>();
  private readonly authorizeJoin: (
    input: SharedJoinAuthorizationInput,
  ) => SharedJoinAuthorizationKind | false;
  private readonly authenticationSessionIsActive: (
    userId: string,
    authenticationSessionId: string,
  ) => boolean;

  constructor(
    private readonly sessions: SharedSessionService,
    options: SharedSessionGatewayOptions = {},
  ) {
    this.authorizeJoin = options.authorizeJoin ?? (() => "unrestricted");
    this.authenticationSessionIsActive = options.authenticationSessionIsActive ?? (() => true);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 25_000);
    this.heartbeatTimer.unref();
  }

  attach(socket: WebSocket, userId: string, authenticationSessionId?: string): void {
    if (
      authenticationSessionId !== undefined
      && !this.authenticationSessionIsActive(userId, authenticationSessionId)
    ) {
      socket.close(AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE, "Account session logged out");
      return;
    }
    const previous = this.connections.get(userId);
    if (previous !== undefined) {
      const previousState = this.states.get(previous);
      if (previousState !== undefined) {
        this.states.delete(previous);
        this.releaseAttachment(previousState, previous);
      }
      previous.close(4000, "Replaced by a newer shared session connection");
    }
    const rateLimiter = this.rateLimiters.get(userId) ?? new FixedWindowRateLimiter(120, 10_000);
    this.rateLimiters.set(userId, rateLimiter);
    const state: ConnectionState = {
      alive: true,
      attachment: undefined,
      ...(authenticationSessionId === undefined ? {} : { authenticationSessionId }),
      rateLimiter,
      requestIds: new Set(),
      requestOrder: [],
      userId,
    };
    this.connections.set(userId, socket);
    this.states.set(socket, state);
    this.send(socket, { type: "ready", userId, version: 1 });

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        socket.close(1003, "Text messages only");
        return;
      }
      try {
        this.handleMessage(socket, data.toString("utf8"));
      } catch {
        this.send(socket, {
          code: "authority-unavailable",
          message: "The authoritative session could not commit this request",
          type: "error",
        });
        socket.close(1011, "Authoritative session unavailable");
      }
    });
    socket.once("close", () => this.detach(socket));
    socket.on("pong", () => {
      const current = this.states.get(socket);
      if (current !== undefined) current.alive = true;
    });
    socket.on("error", () => undefined);
  }

  revokeAuthenticationSession(userId: string, authenticationSessionId: string): number {
    for (const pending of [...this.pendingAdmissions.values()]) {
      if (
        pending.kind !== "join"
        || pending.playerId !== userId
        || pending.authenticationSessionId !== authenticationSessionId
      ) continue;
      this.takeAdmission(pending.admissionId);
      pending.resolve(this.joinFailure(
        pending.sessionId,
        pending.playerId,
        "join-unattested",
        "The guest account session logged out before admission completed",
      ));
    }
    let revoked = 0;
    for (const socket of [...this.connections.values()]) {
      const state = this.states.get(socket);
      if (
        state?.userId !== userId
        || state.authenticationSessionId !== authenticationSessionId
      ) continue;
      this.closeRevokedSocket(socket, state);
      revoked += 1;
    }
    return revoked;
  }

  shutdown(): void {
    clearInterval(this.heartbeatTimer);
    for (const pending of [...this.pendingAdmissions.values()]) {
      this.takeAdmission(pending.admissionId);
      if (pending.kind === "join") {
        pending.resolve(this.joinFailure(
          pending.sessionId,
          pending.playerId,
          "join-unattested",
          "The server stopped before the owner admitted this player",
        ));
      }
    }
    for (const socket of this.connections.values()) {
      const state = this.states.get(socket);
      if (state !== undefined) {
        this.states.delete(socket);
        this.releaseAttachment(state, socket);
      }
      socket.close(1001, "Server shutting down");
    }
    this.connections.clear();
    this.webSocketServer.close();
  }

  join(input: SharedSessionGatewayJoinInput): Promise<SharedSessionResult<SharedSessionSnapshot>> {
    if (
      input.authenticationSessionId !== undefined
      && !this.authenticationSessionIsActive(input.userId, input.authenticationSessionId)
    ) {
      return Promise.resolve(this.joinFailure(
        input.sessionId,
        input.userId,
        "join-unattested",
        "The guest account session is no longer active",
      ));
    }
    const inspection = this.sessions.inspectJoin(input);
    if (!inspection.ok) return Promise.resolve(inspection);
    const validatedInput: SharedJoinInput = {
      compatibility: inspection.value.compatibility,
      player: inspection.value.player,
      sessionId: input.sessionId,
      userId: input.userId,
    };
    const authorizationKind = this.authorizeJoin({
      guestUserId: input.userId,
      ownerUserId: inspection.value.ownerId,
      sessionId: input.sessionId,
    });
    if (authorizationKind === false) {
      return Promise.resolve(this.joinFailure(
        input.sessionId,
        input.userId,
        "peer-mismatch",
        "The server Coop rendezvous no longer authorizes this guest",
      ));
    }
    if (inspection.value.kind === "already-member") {
      return Promise.resolve(this.sessions.join(validatedInput));
    }
    if (this.pendingAdmissionBySession.has(input.sessionId)) {
      return Promise.resolve(this.joinFailure(
        input.sessionId,
        input.userId,
        "session-mutation-in-progress",
        "Another owner admission is pending",
      ));
    }
    const verifierSocket = this.connections.get(inspection.value.ownerId);
    const verifierState = verifierSocket === undefined ? undefined : this.states.get(verifierSocket);
    if (
      verifierSocket === undefined
      || verifierSocket.readyState !== verifierSocket.OPEN
      || verifierState?.attachment?.sessionId !== input.sessionId
    ) {
      return Promise.resolve(this.joinFailure(
        input.sessionId,
        input.userId,
        "join-unattested",
        "The session owner is not connected to admit this player",
      ));
    }
    return new Promise((resolve, reject) => {
      const admissionId = this.createAdmissionId();
      const timeout = setTimeout(() => {
        const expired = this.takeAdmission(admissionId);
        if (expired?.kind !== "join") return;
        expired.resolve(this.joinFailure(
          expired.sessionId,
          expired.playerId,
          "join-unattested",
          "The owner admission timed out",
        ));
      }, ADMISSION_TIMEOUT_MS);
      timeout.unref();
      const pending: PendingJoinAdmission = {
        admissionId,
        ...(input.authenticationSessionId === undefined
          ? {}
          : { authenticationSessionId: input.authenticationSessionId }),
        authorizationKind,
        input: validatedInput,
        kind: "join",
        ownerUserId: inspection.value.ownerId,
        playerId: input.userId,
        reject,
        resolve,
        sessionId: input.sessionId,
        timeout,
        verifierSocket,
      };
      this.pendingAdmissions.set(admissionId, pending);
      this.pendingAdmissionBySession.set(input.sessionId, admissionId);
      this.send(verifierSocket, {
        admissionId,
        compatibility: inspection.value.compatibility,
        player: inspection.value.player,
        playerId: input.userId,
        sessionId: input.sessionId,
        snapshot: inspection.value.snapshot,
        type: "join-admission-request",
      });
    });
  }

  endSession(
    sessionId: string,
    ownerUserId: string,
  ): SharedSessionResult<Readonly<{ destroyed: boolean }>> {
    this.cancelAdmissionsForSession(sessionId);
    const result = this.sessions.leave(sessionId, ownerUserId);
    if (result.ok) this.latestAttachments.delete(sessionId);
    return result;
  }

  leave(
    sessionId: string,
    userId: string,
    authenticationSessionId?: string,
    attachmentId?: string,
  ): SharedSessionResult<Readonly<{ destroyed: boolean }>> | "stale-attachment" {
    const latest = this.latestAttachments.get(sessionId)?.get(userId);
    if (latest?.authenticationSessionId !== undefined && (
      authenticationSessionId === undefined
      || attachmentId === undefined
      || latest.authenticationSessionId !== authenticationSessionId
      || latest.attachmentId !== attachmentId
    )) return "stale-attachment";
    const result = this.sessions.leave(sessionId, userId);
    if (!result.ok) return result;
    if (result.value.destroyed) {
      this.latestAttachments.delete(sessionId);
    } else {
      const sessionAttachments = this.latestAttachments.get(sessionId);
      sessionAttachments?.delete(userId);
      if (sessionAttachments?.size === 0) this.latestAttachments.delete(sessionId);
    }
    return result;
  }

  currentAttachmentId(sessionId: string, userId: string): string | undefined {
    return this.latestAttachments.get(sessionId)?.get(userId)?.attachmentId;
  }

  private attachToSession(
    socket: WebSocket,
    state: ConnectionState,
    sessionId: string,
    requestId: string,
  ): void {
    if (state.attachment?.sessionId === sessionId) {
      const current = this.sessions.read(sessionId, state.userId);
      if (!current.ok) {
        this.sendFailure(socket, current.error, requestId);
        return;
      }
      this.send(socket, {
        attachmentId: state.attachment.attachmentId,
        requestId,
        snapshot: current.value,
        type: "attached",
      });
      return;
    }
    this.releaseAttachment(state, socket);
    const connected = this.sessions.connect(sessionId, state.userId);
    if (!connected.ok) {
      this.sendFailure(socket, connected.error, requestId);
      return;
    }
    const subscription = this.sessions.subscribe(sessionId, state.userId, (event) => {
      this.handleSessionEvent(socket, state, event);
    });
    if (!subscription.ok) {
      void this.sessions.disconnect(sessionId, state.userId);
      this.sendFailure(socket, subscription.error, requestId);
      return;
    }
    const attachmentId = randomBytes(16).toString("base64url");
    state.attachment = { attachmentId, sessionId, unsubscribe: subscription.value.unsubscribe };
    const sessionAttachments = this.latestAttachments.get(sessionId) ?? new Map();
    sessionAttachments.set(state.userId, {
      attachmentId,
      ...(state.authenticationSessionId === undefined
        ? {}
        : { authenticationSessionId: state.authenticationSessionId }),
    });
    this.latestAttachments.set(sessionId, sessionAttachments);
    this.send(socket, { attachmentId, requestId, snapshot: connected.value, type: "attached" });
  }

  private detach(socket: WebSocket): void {
    const state = this.states.get(socket);
    if (state === undefined) return;
    this.states.delete(socket);
    if (this.connections.get(state.userId) === socket) this.connections.delete(state.userId);
    this.releaseAttachment(state, socket);
  }

  private handleMessage(socket: WebSocket, rawMessage: string): void {
    const state = this.states.get(socket);
    if (state === undefined) {
      socket.close(1011, "Connection state missing");
      return;
    }
    if (!this.isAuthenticationActive(state)) {
      this.closeRevokedSocket(socket, state);
      return;
    }
    if (!state.rateLimiter.take()) {
      this.send(socket, {
        code: "rate-limited",
        message: "Realtime message rate exceeded",
        type: "error",
      });
      socket.close(1008, "Realtime rate limit exceeded");
      return;
    }
    let message;
    try {
      message = parseSharedSessionClientMessage(rawMessage);
    } catch (error) {
      this.send(socket, {
        code: error instanceof ServiceError ? error.code.toLowerCase().replaceAll("_", "-") : "bad-request",
        message: error instanceof Error ? error.message : "Invalid realtime message",
        type: "error",
      });
      return;
    }
    if (message.type === "admission-response") {
      this.handleAdmissionResponse(socket, state, message.admissionId, message.decision);
      return;
    }
    if (!this.rememberRequestId(state, message.requestId)) {
      this.send(socket, {
        code: "request-id-conflict",
        message: "requestId was already used on this connection",
        requestId: message.requestId,
        type: "error",
      });
      return;
    }
    if (message.type === "attach") {
      this.attachToSession(socket, state, message.sessionId, message.requestId);
      return;
    }
    if (message.type === "detach") {
      this.releaseAttachment(state, socket);
      this.send(socket, { requestId: message.requestId, type: "detached" });
      return;
    }
    const attachment = state.attachment;
    if (attachment === undefined) {
      this.send(socket, {
        code: "session-not-attached",
        message: "Attach a shared session before this request",
        requestId: message.requestId,
        type: "error",
      });
      return;
    }
    if (message.type === "request-snapshot") {
      const current = this.sessions.read(attachment.sessionId, state.userId);
      if (!current.ok) {
        this.sendFailure(socket, current.error, message.requestId);
        return;
      }
      this.send(socket, {
        requestId: message.requestId,
        snapshot: current.value,
        type: "snapshot-response",
      });
      return;
    }
    if (this.pendingAdmissionBySession.has(attachment.sessionId)) {
      this.send(socket, {
        code: "session-mutation-in-progress",
        message: "Another owner admission is pending",
        requestId: message.requestId,
        type: "error",
      });
      return;
    }
    if (message.command.kind === "movement" && message.command.arrival !== undefined) {
      const preliminary = this.sessions.submitMovement(
        attachment.sessionId,
        state.userId,
        message.command,
      );
      if (preliminary.ok) {
        this.sendCommandAccepted(socket, message.requestId, preliminary.value);
        return;
      }
      if (preliminary.error.code !== "transition-unattested") {
        this.sendFailure(socket, preliminary.error, message.requestId);
        return;
      }
      this.requestAdmission(
        socket,
        state,
        attachment.sessionId,
        message.requestId,
        message.command,
      );
      return;
    }
    if (message.command.kind === "shared-event") {
      const current = this.sessions.read(attachment.sessionId, state.userId);
      if (!current.ok) {
        this.sendFailure(socket, current.error, message.requestId);
        return;
      }
      // A committed event cannot mutate again. Let the durable command cache
      // answer an exact replay (or reject a different command) without asking
      // the owner to attest the same source transaction twice.
      if (current.value.sharedProgression.milestoneIds.includes(message.command.eventId)) {
        this.applyCommand(
          socket,
          state.userId,
          attachment.sessionId,
          message.requestId,
          message.command,
        );
        return;
      }
      this.requestAdmission(
        socket,
        state,
        attachment.sessionId,
        message.requestId,
        message.command,
      );
      return;
    }
    this.applyCommand(socket, state.userId, attachment.sessionId, message.requestId, message.command);
  }

  private applyCommand(
    socket: WebSocket,
    playerId: string,
    sessionId: string,
    requestId: string,
    command: SharedSessionCommand,
    arrivalAttestation?: SharedPosition,
  ): void {
    const result = this.sessions.submitCommand(
      sessionId,
      playerId,
      command,
      arrivalAttestation === undefined ? {} : { arrivalAttestation },
    );
    if (!result.ok) {
      this.sendFailure(socket, result.error, requestId);
      return;
    }
    this.sendCommandAccepted(socket, requestId, result.value);
  }

  private sendCommandAccepted(
    socket: WebSocket,
    requestId: string,
    result: Readonly<{
      readonly appliedRevision: number;
      readonly replayed: boolean;
      readonly snapshot: SharedSessionSnapshot;
    }>,
  ): void {
    this.send(socket, {
      appliedRevision: result.appliedRevision,
      replayed: result.replayed,
      requestId,
      snapshot: result.snapshot,
      type: "command-accepted",
    });
  }

  private requestAdmission(
    moverSocket: WebSocket,
    moverState: ConnectionState,
    sessionId: string,
    requestId: string,
    command: SharedAdmissionCommand,
  ): void {
    if (this.pendingAdmissionBySession.has(sessionId)) {
      this.send(moverSocket, {
        code: "session-mutation-in-progress",
        message: "Another owner admission is pending",
        requestId,
        type: "error",
      });
      return;
    }
    const owner = this.sessions.readOwnerId(sessionId, moverState.userId);
    if (!owner.ok) {
      this.sendFailure(moverSocket, owner.error, requestId);
      return;
    }
    const snapshot = this.sessions.read(sessionId, moverState.userId);
    if (!snapshot.ok) {
      this.sendFailure(moverSocket, snapshot.error, requestId);
      return;
    }
    const verifierSocket = this.connections.get(owner.value);
    const verifierState = verifierSocket === undefined ? undefined : this.states.get(verifierSocket);
    if (
      verifierSocket === undefined
      || verifierSocket.readyState !== verifierSocket.OPEN
      || verifierState?.attachment?.sessionId !== sessionId
    ) {
      this.send(moverSocket, {
        code: "transition-unattested",
        message: "The session owner is not available to attest this mutation",
        requestId,
        type: "error",
      });
      return;
    }
    const admissionId = this.createAdmissionId();
    const timeout = setTimeout(() => {
      const expired = this.takeAdmission(admissionId);
      if (expired?.kind !== "command") return;
      this.send(expired.moverSocket, {
        code: "transition-unattested",
        message: "The owner attestation timed out",
        requestId: expired.requestId,
        type: "error",
      });
    }, ADMISSION_TIMEOUT_MS);
    timeout.unref();
    const pending: PendingCommandAdmission = {
      admissionId,
      command,
      kind: "command",
      moverSocket,
      playerId: moverState.userId,
      requestId,
      sessionId,
      timeout,
      verifierSocket,
    };
    this.pendingAdmissions.set(admissionId, pending);
    this.pendingAdmissionBySession.set(sessionId, admissionId);
    this.send(verifierSocket, {
      admissionId,
      command,
      playerId: moverState.userId,
      sessionId,
      snapshot: snapshot.value,
      type: "admission-request",
    });
  }

  private handleAdmissionResponse(
    socket: WebSocket,
    state: ConnectionState,
    admissionId: string,
    decision:
      | Readonly<{ readonly arrival: SharedPosition; readonly kind: "accept" }>
      | Readonly<{ readonly kind: "accept" }>
      | Readonly<{ readonly code: string; readonly kind: "reject" }>,
  ): void {
    const pending = this.pendingAdmissions.get(admissionId);
    if (pending === undefined) {
      this.send(socket, {
        code: "admission-not-found",
        message: "The admission request is absent or expired",
        type: "error",
      });
      return;
    }
    if (
      pending.verifierSocket !== socket
      || state.attachment?.sessionId !== pending.sessionId
    ) {
      this.send(socket, {
        code: "forbidden",
        message: "Only the attached session owner can attest this mutation",
        type: "error",
      });
      return;
    }
    this.takeAdmission(admissionId);
    if (pending.kind === "join") {
      if (decision.kind === "reject") {
        pending.resolve(this.joinFailure(
          pending.sessionId,
          pending.playerId,
          "join-rejected",
          `The session owner rejected this player (${decision.code})`,
          decision.code,
        ));
        return;
      }
      if ("arrival" in decision) {
        this.send(socket, {
          code: "admission-decision-mismatch",
          message: "A join acceptance cannot attest an arrival",
          type: "error",
        });
        pending.resolve(this.joinFailure(
          pending.sessionId,
          pending.playerId,
          "join-unattested",
          "The owner returned an invalid join admission decision",
        ));
        return;
      }
      if (
        pending.authenticationSessionId !== undefined
        && !this.authenticationSessionIsActive(
          pending.playerId,
          pending.authenticationSessionId,
        )
      ) {
        pending.resolve(this.joinFailure(
          pending.sessionId,
          pending.playerId,
          "join-unattested",
          "The guest account session is no longer active",
        ));
        return;
      }
      const authorizationKind = this.authorizeJoin({
        guestUserId: pending.playerId,
        ownerUserId: pending.ownerUserId,
        sessionId: pending.sessionId,
      });
      if (authorizationKind === false || authorizationKind !== pending.authorizationKind) {
        pending.resolve(this.joinFailure(
          pending.sessionId,
          pending.playerId,
          "peer-mismatch",
          "The server Coop rendezvous no longer authorizes this guest",
        ));
        return;
      }
      try {
        pending.resolve(this.sessions.join(pending.input));
      } catch (error) {
        pending.reject(error);
        throw error;
      }
      return;
    }
    if (decision.kind === "reject") {
      const target = pending.command.kind === "movement" ? "movement" : "shared event";
      this.send(pending.moverSocket, {
        code: "port-rejected",
        message: `The owner verifier rejected the ${target} (${decision.code})`,
        requestId: pending.requestId,
        type: "error",
      });
      return;
    }
    if (pending.command.kind === "shared-event") {
      if ("arrival" in decision) {
        this.send(pending.moverSocket, {
          code: "admission-decision-mismatch",
          message: "A shared event acceptance cannot attest an arrival",
          requestId: pending.requestId,
          type: "error",
        });
        return;
      }
      // submitCommand still invokes the production shared-event policy. The
      // owner's source attestation is an additional barrier, never a replacement.
      this.applyCommand(
        pending.moverSocket,
        pending.playerId,
        pending.sessionId,
        pending.requestId,
        pending.command,
      );
      return;
    }
    if (
      !("arrival" in decision)
      || pending.command.arrival === undefined
      || !this.samePosition(pending.command.arrival, decision.arrival)
    ) {
      this.send(pending.moverSocket, {
        code: "transition-attestation-mismatch",
        message: "The attested arrival differs from the requested arrival",
        requestId: pending.requestId,
        type: "error",
      });
      return;
    }
    this.applyCommand(
      pending.moverSocket,
      pending.playerId,
      pending.sessionId,
      pending.requestId,
      pending.command,
      decision.arrival,
    );
  }

  private cancelAdmissionsForSession(sessionId: string): void {
    const admissionId = this.pendingAdmissionBySession.get(sessionId);
    if (admissionId === undefined) return;
    const pending = this.takeAdmission(admissionId);
    if (pending?.kind === "join") {
      pending.resolve(this.joinFailure(
        pending.sessionId,
        pending.playerId,
        "session-not-found",
        "The shared session ended before the owner admitted this player",
      ));
    }
  }

  private cancelAdmissionsForSocket(socket: WebSocket): void {
    for (const pending of [...this.pendingAdmissions.values()]) {
      if (
        pending.verifierSocket !== socket
        && (pending.kind !== "command" || pending.moverSocket !== socket)
      ) continue;
      this.takeAdmission(pending.admissionId);
      if (pending.kind === "join") {
        pending.resolve(this.joinFailure(
          pending.sessionId,
          pending.playerId,
          "join-unattested",
          "The session owner disconnected before admitting this player",
        ));
        continue;
      }
      if (pending.verifierSocket === socket && pending.moverSocket !== socket) {
        this.send(pending.moverSocket, {
          code: "transition-unattested",
          message: "The owner verifier disconnected",
          requestId: pending.requestId,
          type: "error",
        });
      }
    }
  }

  private takeAdmission(admissionId: string): PendingAdmission | undefined {
    const pending = this.pendingAdmissions.get(admissionId);
    if (pending === undefined) return undefined;
    this.pendingAdmissions.delete(admissionId);
    if (this.pendingAdmissionBySession.get(pending.sessionId) === admissionId) {
      this.pendingAdmissionBySession.delete(pending.sessionId);
    }
    clearTimeout(pending.timeout);
    return pending;
  }

  private createAdmissionId(): string {
    let admissionId: string;
    do {
      admissionId = randomBytes(16).toString("base64url");
    } while (this.pendingAdmissions.has(admissionId));
    return admissionId;
  }

  private joinFailure(
    sessionId: string,
    playerId: string,
    code: SharedSessionErrorCode,
    message: string,
    portCode?: string,
  ): SharedSessionResult<never> {
    return {
      error: {
        code,
        message,
        playerId,
        ...(portCode === undefined ? {} : { portCode }),
        sessionId,
      },
      ok: false,
    };
  }

  private samePosition(first: SharedPosition, second: SharedPosition): boolean {
    return first.mapId === second.mapId
      && first.x === second.x
      && first.z === second.z
      && first.direction === second.direction;
  }

  private handleSessionEvent(socket: WebSocket, state: ConnectionState, event: SharedSessionEvent): void {
    if (event.type === "snapshot") {
      this.send(socket, { snapshot: event.snapshot, type: "snapshot" });
      return;
    }
    this.cancelAdmissionsForSession(event.sessionId);
    this.latestAttachments.delete(event.sessionId);
    if (state.attachment?.sessionId === event.sessionId) {
      state.attachment.unsubscribe();
      state.attachment = undefined;
    }
    this.send(socket, {
      reason: event.reason,
      sessionId: event.sessionId,
      type: "session-ended",
    });
  }

  private heartbeat(): void {
    for (const socket of this.connections.values()) {
      const state = this.states.get(socket);
      if (state === undefined) {
        socket.terminate();
        continue;
      }
      if (!this.isAuthenticationActive(state)) {
        this.closeRevokedSocket(socket, state);
        continue;
      }
      if (!state.alive) {
        socket.terminate();
        continue;
      }
      state.alive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }

  private releaseAttachment(state: ConnectionState, socket: WebSocket): void {
    const attachment = state.attachment;
    if (attachment === undefined) return;
    this.cancelAdmissionsForSocket(socket);
    state.attachment = undefined;
    attachment.unsubscribe();
    try {
      this.sessions.disconnect(attachment.sessionId, state.userId);
    } catch {
      // The service already rolled its memory back; startup recovery marks all
      // persisted members away without acknowledging an uncommitted mutation.
    }
  }

  private closeRevokedSocket(socket: WebSocket, state = this.states.get(socket)): void {
    if (state !== undefined) {
      this.states.delete(socket);
      if (this.connections.get(state.userId) === socket) this.connections.delete(state.userId);
      this.releaseAttachment(state, socket);
    }
    socket.close(AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE, "Account session logged out");
  }

  private isAuthenticationActive(state: ConnectionState): boolean {
    return state.authenticationSessionId === undefined
      || this.authenticationSessionIsActive(state.userId, state.authenticationSessionId);
  }

  private rememberRequestId(state: ConnectionState, requestId: string): boolean {
    if (state.requestIds.has(requestId)) return false;
    state.requestIds.add(requestId);
    state.requestOrder.push(requestId);
    if (state.requestOrder.length > MAX_REMEMBERED_REQUESTS) {
      state.requestIds.delete(state.requestOrder.shift()!);
    }
    return true;
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > 512 * 1024) {
      socket.close(1013, "Connection is not consuming messages");
      return;
    }
    socket.send(JSON.stringify(message));
  }

  private sendFailure(
    socket: WebSocket,
    error: Readonly<{ readonly code: string; readonly message: string }>,
    requestId: string,
  ): void {
    this.send(socket, {
      code: error.code,
      message: error.message,
      requestId,
      type: "error",
    });
  }
}
