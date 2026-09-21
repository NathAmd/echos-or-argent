import { ServiceError } from "../errors.js";
import {
  MAX_FRIEND_STORE_RELATIONSHIPS,
  type FriendStore,
  type StoredFriendState,
} from "../persistence/friend-store.js";

const MAX_FRIENDS_PER_USER = 200;
const MAX_PENDING_PER_USER = 100;
const RELATIONSHIP_SEPARATOR = "\u0000";

interface FriendState {
  readonly friends: Map<string, Set<string>>;
  readonly requests: Map<string, { readonly from: string; readonly to: string }>;
}

export interface SocialSnapshot {
  readonly friends: readonly string[];
  readonly incoming: readonly string[];
  readonly outgoing: readonly string[];
}

const friendshipKey = (first: string, second: string): string =>
  first < second
    ? `${first}${RELATIONSHIP_SEPARATOR}${second}`
    : `${second}${RELATIONSHIP_SEPARATOR}${first}`;

const requestKey = (from: string, to: string): string => `${from}${RELATIONSHIP_SEPARATOR}${to}`;

const emptyState = (): FriendState => ({ friends: new Map(), requests: new Map() });

const ensureSet = (map: Map<string, Set<string>>, userId: string): Set<string> => {
  const current = map.get(userId);
  if (current !== undefined) {
    return current;
  }
  const created = new Set<string>();
  map.set(userId, created);
  return created;
};

const cloneState = (state: FriendState): FriendState => ({
  friends: new Map([...state.friends].map(([userId, friends]) => [userId, new Set(friends)])),
  requests: new Map([...state.requests].map(([key, request]) => [key, { ...request }])),
});

const serializeState = (state: FriendState): StoredFriendState => {
  const friendships: [string, string][] = [];
  for (const [userId, friends] of state.friends) {
    for (const friendId of friends) {
      if (userId < friendId) {
        friendships.push([userId, friendId]);
      }
    }
  }
  friendships.sort(([leftA, leftB], [rightA, rightB]) =>
    leftA.localeCompare(rightA) || leftB.localeCompare(rightB),
  );
  const requests = [...state.requests.values()].sort(
    (left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to),
  );
  return { friendships, requests, version: 1 };
};

const hydrateState = (stored: StoredFriendState, knownUsers: ReadonlySet<string>): FriendState => {
  if (
    stored.friendships.length > MAX_FRIEND_STORE_RELATIONSHIPS
    || stored.requests.length > MAX_FRIEND_STORE_RELATIONSHIPS
  ) {
    throw new Error("Friend store exceeds its relationship limit");
  }
  const state = emptyState();
  const seenFriendships = new Set<string>();
  const pendingCounts = new Map<string, number>();
  for (const [first, second] of stored.friendships) {
    if (!knownUsers.has(first) || !knownUsers.has(second) || first === second) {
      throw new Error("Friend store contains an invalid or unknown friendship");
    }
    const key = friendshipKey(first, second);
    if (seenFriendships.has(key)) {
      throw new Error("Friend store contains a duplicate friendship");
    }
    seenFriendships.add(key);
    ensureSet(state.friends, first).add(second);
    ensureSet(state.friends, second).add(first);
  }
  for (const request of stored.requests) {
    if (!knownUsers.has(request.from) || !knownUsers.has(request.to) || request.from === request.to) {
      throw new Error("Friend store contains an invalid or unknown request");
    }
    if (seenFriendships.has(friendshipKey(request.from, request.to))) {
      throw new Error("Friend store contains a request between existing friends");
    }
    const key = requestKey(request.from, request.to);
    if (state.requests.has(key)) {
      throw new Error("Friend store contains a duplicate request");
    }
    state.requests.set(key, { ...request });
    for (const userId of [request.from, request.to]) {
      const count = (pendingCounts.get(userId) ?? 0) + 1;
      if (count > MAX_PENDING_PER_USER) {
        throw new Error(`Pending request limit exceeded for ${userId}`);
      }
      pendingCounts.set(userId, count);
    }
  }
  for (const userId of knownUsers) {
    if ((state.friends.get(userId)?.size ?? 0) > MAX_FRIENDS_PER_USER) {
      throw new Error(`Friend limit exceeded for ${userId}`);
    }
  }
  return state;
};

export class FriendService {
  private mutationTail: Promise<void> = Promise.resolve();

  private constructor(
    private state: FriendState,
    private readonly knownUsers: ReadonlySet<string>,
    private readonly store: FriendStore,
  ) {}

  static async create(store: FriendStore, knownUsers: ReadonlySet<string>): Promise<FriendService> {
    return new FriendService(hydrateState(await store.load(), knownUsers), knownUsers, store);
  }

  list(userId: string): SocialSnapshot {
    this.requireKnownUser(userId);
    const requests = [...this.state.requests.values()];
    return {
      friends: [...(this.state.friends.get(userId) ?? [])].sort(),
      incoming: requests.filter(({ to }) => to === userId).map(({ from }) => from).sort(),
      outgoing: requests.filter(({ from }) => from === userId).map(({ to }) => to).sort(),
    };
  }

  areFriends(first: string, second: string): boolean {
    return this.state.friends.get(first)?.has(second) ?? false;
  }

  async sendRequest(from: string, to: string): Promise<void> {
    await this.mutate((next) => {
      this.requireDistinctKnownUsers(from, to);
      if (next.friends.get(from)?.has(to) === true) {
        throw new ServiceError(409, "CONFLICT", "Users are already friends");
      }
      if (next.requests.has(requestKey(from, to))) {
        throw new ServiceError(409, "CONFLICT", "Friend request already exists");
      }
      if (next.requests.has(requestKey(to, from))) {
        throw new ServiceError(409, "CONFLICT", "An incoming friend request already exists");
      }
      this.requirePendingCapacity(next, from);
      this.requirePendingCapacity(next, to);
      this.requireGlobalRequestCapacity(next);
      next.requests.set(requestKey(from, to), { from, to });
    });
  }

  async acceptRequest(userId: string, from: string): Promise<void> {
    await this.mutate((next) => {
      this.requireDistinctKnownUsers(userId, from);
      const key = requestKey(from, userId);
      if (!next.requests.has(key)) {
        throw new ServiceError(404, "NOT_FOUND", "Incoming friend request not found");
      }
      this.requireFriendCapacity(next, userId);
      this.requireFriendCapacity(next, from);
      this.requireGlobalFriendshipCapacity(next);
      next.requests.delete(key);
      ensureSet(next.friends, userId).add(from);
      ensureSet(next.friends, from).add(userId);
    });
  }

  async declineRequest(userId: string, from: string): Promise<void> {
    await this.mutate((next) => {
      this.requireDistinctKnownUsers(userId, from);
      const key = requestKey(from, userId);
      if (!next.requests.delete(key)) {
        throw new ServiceError(404, "NOT_FOUND", "Incoming friend request not found");
      }
    });
  }

  async cancelRequest(userId: string, to: string): Promise<void> {
    await this.mutate((next) => {
      this.requireDistinctKnownUsers(userId, to);
      if (!next.requests.delete(requestKey(userId, to))) {
        throw new ServiceError(404, "NOT_FOUND", "Outgoing friend request not found");
      }
    });
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    await this.mutate((next) => {
      this.requireDistinctKnownUsers(userId, friendId);
      if (next.friends.get(userId)?.has(friendId) !== true) {
        throw new ServiceError(404, "NOT_FOUND", "Friendship not found");
      }
      next.friends.get(userId)?.delete(friendId);
      next.friends.get(friendId)?.delete(userId);
    });
  }

  private async mutate(operation: (state: FriendState) => void): Promise<void> {
    const run = this.mutationTail.then(async () => {
      const next = cloneState(this.state);
      operation(next);
      await this.store.save(serializeState(next));
      this.state = next;
    });
    this.mutationTail = run.catch(() => undefined);
    return run;
  }

  private requireKnownUser(userId: string): void {
    if (!this.knownUsers.has(userId)) {
      throw new ServiceError(404, "NOT_FOUND", "User not found");
    }
  }

  private requireDistinctKnownUsers(first: string, second: string): void {
    this.requireKnownUser(first);
    this.requireKnownUser(second);
    if (first === second) {
      throw new ServiceError(400, "BAD_REQUEST", "A user cannot target itself");
    }
  }

  private requireFriendCapacity(state: FriendState, userId: string): void {
    if ((state.friends.get(userId)?.size ?? 0) >= MAX_FRIENDS_PER_USER) {
      throw new ServiceError(409, "CONFLICT", "Friend limit reached");
    }
  }

  private requirePendingCapacity(state: FriendState, userId: string): void {
    const count = [...state.requests.values()].filter(
      ({ from, to }) => from === userId || to === userId,
    ).length;
    if (count >= MAX_PENDING_PER_USER) {
      throw new ServiceError(409, "CONFLICT", "Pending friend request limit reached");
    }
  }

  private requireGlobalFriendshipCapacity(state: FriendState): void {
    let memberships = 0;
    for (const friends of state.friends.values()) {
      memberships += friends.size;
    }
    if (memberships / 2 >= MAX_FRIEND_STORE_RELATIONSHIPS) {
      throw new ServiceError(503, "UNAVAILABLE", "Global friendship capacity reached");
    }
  }

  private requireGlobalRequestCapacity(state: FriendState): void {
    if (state.requests.size >= MAX_FRIEND_STORE_RELATIONSHIPS) {
      throw new ServiceError(503, "UNAVAILABLE", "Global friend request capacity reached");
    }
  }
}
