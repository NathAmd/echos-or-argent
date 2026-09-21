import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import type { FriendService } from "../domain/friends.js";
import type { MatchmakingService } from "../domain/matchmaking.js";
import { ServiceError } from "../errors.js";
import { FixedWindowRateLimiter } from "../rate-limit.js";
import { AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE } from "./authentication-session.js";
import { parseClientMessage, type SignalPayload } from "./protocol.js";
import { RealtimeReplayGuard } from "./replay-guard.js";

interface ConnectionState {
  alive: boolean;
  readonly authenticationSessionId?: string;
  readonly rateLimiter: FixedWindowRateLimiter;
  readonly userId: string;
}

type ServerMessage =
  | { readonly code: string; readonly message: string; readonly requestId?: string; readonly type: "error" }
  | { readonly from: string; readonly negotiationId: string; readonly payload: SignalPayload; readonly requestId: string; readonly type: "signal" }
  | { readonly onlineFriends: readonly string[]; readonly type: "ready"; readonly userId: string; readonly version: 1 }
  | { readonly requestId: string; readonly type: "signal-accepted" }
  | { readonly type: "social-changed" }
  | { readonly online: boolean; readonly type: "presence"; readonly userId: string };

export interface RealtimeGatewayOptions {
  readonly authenticationSessionIsActive?: (
    userId: string,
    authenticationSessionId: string,
  ) => boolean;
}

export class RealtimeGateway {
  readonly webSocketServer = new WebSocketServer({ maxPayload: 32 * 1024, noServer: true });
  private readonly connections = new Map<string, Set<WebSocket>>();
  private readonly rateLimiters = new Map<string, FixedWindowRateLimiter>();
  private readonly replayGuard = new RealtimeReplayGuard();
  private readonly states = new WeakMap<WebSocket, ConnectionState>();
  private readonly heartbeatTimer: NodeJS.Timeout;
  private readonly authenticationSessionIsActive: (
    userId: string,
    authenticationSessionId: string,
  ) => boolean;

  constructor(
    private readonly friends: FriendService,
    private readonly matchmaking: MatchmakingService,
    options: RealtimeGatewayOptions = {},
  ) {
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
    const previousSockets = this.connections.get(userId);
    const becameOnline = (previousSockets?.size ?? 0) === 0;
    for (const previousSocket of previousSockets ?? []) {
      this.states.delete(previousSocket);
      previousSocket.close(4000, "Replaced by a newer signaling session");
    }
    const sockets = new Set<WebSocket>();
    sockets.add(socket);
    this.connections.set(userId, sockets);
    const rateLimiter = this.rateLimiters.get(userId) ?? new FixedWindowRateLimiter(120, 10_000);
    this.rateLimiters.set(userId, rateLimiter);
    this.states.set(socket, {
      alive: true,
      ...(authenticationSessionId === undefined ? {} : { authenticationSessionId }),
      rateLimiter,
      userId,
    });
    this.send(socket, {
      onlineFriends: this.friends.list(userId).friends.filter((friendId) => this.isOnline(friendId)),
      type: "ready",
      userId,
      version: 1,
    });
    if (becameOnline) {
      this.notifyFriendsOfPresence(userId, true);
    }

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        socket.close(1003, "Text messages only");
        return;
      }
      this.handleMessage(socket, data.toString("utf8"));
    });
    socket.once("close", () => this.detach(socket));
    socket.on("pong", () => {
      const state = this.states.get(socket);
      if (state !== undefined) {
        state.alive = true;
      }
    });
    socket.on("error", () => undefined);
  }

  isOnline(userId: string): boolean {
    return (this.connections.get(userId)?.size ?? 0) > 0;
  }

  revokeAuthenticationSession(userId: string, authenticationSessionId: string): number {
    let revoked = 0;
    for (const sockets of [...this.connections.values()]) {
      for (const socket of [...sockets]) {
        const state = this.states.get(socket);
        if (
          state?.userId !== userId
          || state.authenticationSessionId !== authenticationSessionId
        ) continue;
        this.closeRevokedSocket(socket);
        revoked += 1;
      }
    }
    return revoked;
  }

  notifySocialChanged(userIds: readonly string[]): void {
    for (const userId of new Set(userIds)) {
      this.sendToUser(userId, { type: "social-changed" });
    }
  }

  shutdown(): void {
    clearInterval(this.heartbeatTimer);
    this.matchmaking.shutdown();
    for (const sockets of this.connections.values()) {
      for (const socket of sockets) {
        socket.close(1001, "Server shutting down");
      }
    }
    this.connections.clear();
    this.webSocketServer.close();
  }

  private heartbeat(): void {
    for (const sockets of this.connections.values()) {
      for (const socket of sockets) {
        const state = this.states.get(socket);
        if (state === undefined) {
          socket.terminate();
          continue;
        }
        if (!this.isAuthenticationActive(state)) {
          this.closeRevokedSocket(socket);
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
  }

  private handleMessage(socket: WebSocket, rawMessage: string): void {
    const state = this.states.get(socket);
    if (state === undefined) {
      socket.close(1011, "Connection state missing");
      return;
    }
    if (!this.isAuthenticationActive(state)) {
      this.closeRevokedSocket(socket);
      return;
    }
    if (!state.rateLimiter.take()) {
      this.send(socket, {
        code: "RATE_LIMITED",
        message: "Realtime message rate exceeded",
        type: "error",
      });
      socket.close(1008, "Realtime rate limit exceeded");
      return;
    }
    let message;
    try {
      message = parseClientMessage(rawMessage);
    } catch (error) {
      this.send(socket, {
        code: error instanceof ServiceError ? error.code : "BAD_REQUEST",
        message: error instanceof Error ? error.message : "Invalid realtime message",
        type: "error",
      });
      return;
    }
    if (message.to === state.userId) {
      this.send(socket, {
        code: "BAD_REQUEST",
        message: "Cannot signal the current identity",
        requestId: message.requestId,
        type: "error",
      });
      return;
    }
    if (
      !this.friends.areFriends(state.userId, message.to)
      && !this.matchmaking.isSignalAuthorized(
        state.userId,
        message.to,
        message.negotiationId,
      )
    ) {
      this.send(socket, {
        code: "FORBIDDEN",
        message: "Signaling requires a friendship or an active match authorization",
        requestId: message.requestId,
        type: "error",
      });
      return;
    }
    if (!this.isOnline(message.to)) {
      this.send(socket, {
        code: "PEER_OFFLINE",
        message: "Peer is offline",
        requestId: message.requestId,
        type: "error",
      });
      return;
    }
    if (!this.replayGuard.accept(state.userId, message.requestId)) {
      this.send(socket, {
        code: "CONFLICT",
        message: "requestId was already accepted",
        requestId: message.requestId,
        type: "error",
      });
      return;
    }
    this.sendToUser(message.to, {
      from: state.userId,
      negotiationId: message.negotiationId,
      payload: message.payload,
      requestId: message.requestId,
      type: "signal",
    });
    this.send(socket, { requestId: message.requestId, type: "signal-accepted" });
  }

  private detach(socket: WebSocket): void {
    const state = this.states.get(socket);
    if (state === undefined) {
      return;
    }
    this.states.delete(socket);
    const sockets = this.connections.get(state.userId);
    sockets?.delete(socket);
    if (sockets?.size === 0) {
      this.connections.delete(state.userId);
      this.matchmaking.disconnect(state.userId);
      this.notifyFriendsOfPresence(state.userId, false);
    }
  }

  private closeRevokedSocket(socket: WebSocket): void {
    this.detach(socket);
    socket.close(AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE, "Account session logged out");
  }

  private isAuthenticationActive(state: ConnectionState): boolean {
    return state.authenticationSessionId === undefined
      || this.authenticationSessionIsActive(state.userId, state.authenticationSessionId);
  }

  private notifyFriendsOfPresence(userId: string, online: boolean): void {
    for (const friendId of this.friends.list(userId).friends) {
      this.sendToUser(friendId, { online, type: "presence", userId });
    }
  }

  private sendToUser(userId: string, message: ServerMessage): void {
    for (const socket of this.connections.get(userId) ?? []) {
      this.send(socket, message);
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) {
      if (socket.bufferedAmount > 512 * 1024) {
        socket.close(1013, "Connection is not consuming messages");
        return;
      }
      socket.send(JSON.stringify(message));
    }
  }
}
