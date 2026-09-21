export const SHARED_TURN_PROTOCOL_VERSION = 1 as const;

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_AUTHORIZATION_LENGTH = 2_048;
const MAX_CHECKPOINT_LENGTH = 16_384;
const MAX_ACTORS = 4;
const MAX_REMEMBERED_COMMANDS = 256;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const SEALED_PATTERN = /^[A-Za-z0-9_-]+$/;

type PlainRecord = Record<string, unknown>;

export interface SharedTurnPresentation {
  readonly archetypeId: number;
  readonly conditionCode: number;
  readonly currentResource: number;
  readonly maximumResource: number;
  readonly rank: number;
  readonly variant: number;
}

export interface SharedTurnActorSnapshot {
  readonly actorId: string;
  readonly controllerId?: string;
  readonly presentation: SharedTurnPresentation;
  readonly slot: 0 | 1;
  readonly team: 0 | 1;
}

export interface SharedTurnSnapshot {
  readonly actors: readonly SharedTurnActorSnapshot[];
  readonly exchangeId: string;
  readonly outcome?: "team-0" | "team-1" | "draw";
  readonly pendingActorIds: readonly string[];
  readonly phase: "collecting" | "replacement" | "ended";
  readonly revision: number;
  readonly round: number;
  readonly rulesetId: string;
}

interface SharedTurnCommandBase {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly protocolVersion: typeof SHARED_TURN_PROTOCOL_VERSION;
}

export interface SharedTurnOpenCommand extends SharedTurnCommandBase {
  readonly authorization: string;
  readonly exchangeId: string;
  readonly kind: "turn-open";
  readonly rulesetId: string;
}

export type SharedTurnSelection =
  | Readonly<{
      readonly kind: "option";
      readonly optionIndex: number;
      readonly replacementIndex?: number;
      readonly targetActorId?: string;
    }>
  | Readonly<{ readonly kind: "replacement"; readonly replacementIndex: number }>
  | Readonly<{
      readonly kind: "resource";
      readonly optionIndex?: number;
      readonly resourceId: number;
      readonly targetIndex: number;
    }>;

export interface SharedTurnActionCommand extends SharedTurnCommandBase {
  readonly actorId: string;
  readonly exchangeId: string;
  readonly kind: "turn-action";
  readonly round: number;
  readonly selection: SharedTurnSelection;
}

export type SharedTurnCommand = SharedTurnOpenCommand | SharedTurnActionCommand;

export interface SharedTurnPrivateChoice {
  readonly actorId: string;
  readonly controllerId: string;
  readonly selection: SharedTurnSelection;
}

export interface SharedTurnRememberedCommand {
  readonly appliedRevision: number;
  readonly commandId: string;
  readonly fingerprint: string;
  readonly userId: string;
}

export interface SharedTurnState {
  readonly checkpoint: string;
  readonly choices: readonly SharedTurnPrivateChoice[];
  readonly rememberedCommands: readonly SharedTurnRememberedCommand[];
  readonly snapshot: SharedTurnSnapshot;
}

export interface SharedTurnOpenResolverInput {
  readonly authorization: string;
  readonly exchangeId: string;
  readonly memberIds: readonly string[];
  readonly rulesetId: string;
  readonly userId: string;
}

export interface SharedTurnActionResolverInput {
  readonly checkpoint: string;
  readonly choice: SharedTurnPrivateChoice;
  readonly choices: readonly SharedTurnPrivateChoice[];
  readonly snapshot: SharedTurnSnapshot;
  readonly userId: string;
}

export interface SharedTurnResolveInput {
  readonly checkpoint: string;
  readonly choices: readonly SharedTurnPrivateChoice[];
  readonly snapshot: SharedTurnSnapshot;
}

export interface SharedTurnResolver {
  readonly admit: (input: SharedTurnActionResolverInput) => unknown;
  readonly open: (input: SharedTurnOpenResolverInput) => unknown;
  readonly resolve: (input: SharedTurnResolveInput) => unknown;
}

export type SharedTurnErrorCode =
  | "active-exchange"
  | "actor-control-conflict"
  | "actor-not-pending"
  | "command-id-conflict"
  | "exchange-state-conflict"
  | "invalid-command"
  | "invalid-resolver-result"
  | "resolver-rejected"
  | "resolver-failed"
  | "resolver-reentrant"
  | "revision-exhausted"
  | "revision-conflict";

export interface SharedTurnError {
  readonly code: SharedTurnErrorCode;
  readonly message: string;
}

export type SharedTurnTransitionResult =
  | Readonly<{ readonly appliedRevision: number; readonly replayed: boolean; readonly state: SharedTurnState; readonly ok: true }>
  | Readonly<{ readonly error: SharedTurnError; readonly ok: false }>;

const activeResolvers = new WeakSet<object>();
const reenteredResolvers = new WeakSet<object>();

const isSharedTurnResolver = (value: unknown): value is SharedTurnResolver => {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  try {
    return typeof Reflect.get(value, "open") === "function"
      && typeof Reflect.get(value, "admit") === "function"
      && typeof Reflect.get(value, "resolve") === "function";
  } catch {
    return false;
  }
};

const isPlainRecord = (value: unknown): value is PlainRecord => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    });
};

const hasExactKeys = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is PlainRecord => {
  if (!isPlainRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
};

const isInteger = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;

const parseIdentifier = (value: unknown): string | undefined =>
  typeof value === "string"
    && value.length <= MAX_IDENTIFIER_LENGTH
    && IDENTIFIER_PATTERN.test(value)
    ? value
    : undefined;

const parseSealed = (value: unknown, maximum: number): string | undefined =>
  typeof value === "string" && value.length >= 1 && value.length <= maximum && SEALED_PATTERN.test(value)
    ? value
    : undefined;

export const parseSharedTurnCheckpoint = (value: unknown): string | undefined =>
  parseSealed(value, MAX_CHECKPOINT_LENGTH);

const isDenseArray = (value: unknown, maximum: number): value is unknown[] =>
  Array.isArray(value)
  && Object.getPrototypeOf(value) === Array.prototype
  && value.length <= maximum
  && Object.keys(value).length === value.length
  && Reflect.ownKeys(value).every((key) => key === "length"
    || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)))
  && value.every((_entry, index) => Object.hasOwn(value, index));

const deepFreeze = <Value>(value: Value): Value => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key));
  return Object.freeze(value);
};

export const parseSharedTurnSelection = (value: unknown): SharedTurnSelection | undefined => {
  if (!isPlainRecord(value)) return undefined;
  if (value.kind === "option") {
    if (!hasExactKeys(value, ["kind", "optionIndex"], ["replacementIndex", "targetActorId"])) return undefined;
    const targetActorId = Object.hasOwn(value, "targetActorId")
      ? parseIdentifier(value.targetActorId)
      : undefined;
    if (!isInteger(value.optionIndex, 255)
      || (Object.hasOwn(value, "replacementIndex") && !isInteger(value.replacementIndex, 255))
      || (Object.hasOwn(value, "targetActorId") && targetActorId === undefined)) return undefined;
    return deepFreeze({
      kind: "option" as const,
      optionIndex: value.optionIndex,
      ...(Object.hasOwn(value, "replacementIndex") ? { replacementIndex: value.replacementIndex as number } : {}),
      ...(targetActorId === undefined ? {} : { targetActorId }),
    });
  }
  if (value.kind === "replacement") {
    return hasExactKeys(value, ["kind", "replacementIndex"]) && isInteger(value.replacementIndex, 255)
      ? deepFreeze({ kind: "replacement" as const, replacementIndex: value.replacementIndex })
      : undefined;
  }
  if (value.kind === "resource") {
    if (!hasExactKeys(value, ["kind", "resourceId", "targetIndex"], ["optionIndex"])
      || !isInteger(value.resourceId, 65_535)
      || !isInteger(value.targetIndex, 255)
      || (Object.hasOwn(value, "optionIndex") && !isInteger(value.optionIndex, 255))) return undefined;
    return deepFreeze({
      kind: "resource" as const,
      resourceId: value.resourceId,
      targetIndex: value.targetIndex,
      ...(Object.hasOwn(value, "optionIndex") ? { optionIndex: value.optionIndex as number } : {}),
    });
  }
  return undefined;
};

export const parseSharedTurnCommand = (value: unknown): SharedTurnCommand | undefined => {
  if (!isPlainRecord(value) || value.protocolVersion !== SHARED_TURN_PROTOCOL_VERSION) return undefined;
  const commandId = parseIdentifier(value.commandId);
  if (commandId === undefined || !isInteger(value.expectedRevision)) return undefined;
  const base = { commandId, expectedRevision: value.expectedRevision, protocolVersion: SHARED_TURN_PROTOCOL_VERSION };
  if (value.kind === "turn-open") {
    if (!hasExactKeys(value, ["authorization", "commandId", "exchangeId", "expectedRevision", "kind", "protocolVersion", "rulesetId"])) return undefined;
    const authorization = parseSealed(value.authorization, MAX_AUTHORIZATION_LENGTH);
    const exchangeId = parseIdentifier(value.exchangeId);
    const rulesetId = parseIdentifier(value.rulesetId);
    return authorization && exchangeId && rulesetId
      ? deepFreeze({ ...base, authorization, exchangeId, kind: "turn-open" as const, rulesetId })
      : undefined;
  }
  if (value.kind === "turn-action") {
    if (!hasExactKeys(value, ["actorId", "commandId", "exchangeId", "expectedRevision", "kind", "protocolVersion", "round", "selection"])) return undefined;
    const actorId = parseIdentifier(value.actorId);
    const exchangeId = parseIdentifier(value.exchangeId);
    const selection = parseSharedTurnSelection(value.selection);
    return actorId && exchangeId && isInteger(value.round) && selection
      ? deepFreeze({ ...base, actorId, exchangeId, kind: "turn-action" as const, round: value.round, selection })
      : undefined;
  }
  return undefined;
};

const parsePresentation = (value: unknown): SharedTurnPresentation | undefined => {
  if (!hasExactKeys(value, ["archetypeId", "conditionCode", "currentResource", "maximumResource", "rank", "variant"])) return undefined;
  if (!isInteger(value.archetypeId, 65_535) || !isInteger(value.conditionCode, 0xffff_ffff)
    || !isInteger(value.currentResource, 65_535) || !isInteger(value.maximumResource, 65_535)
    || value.currentResource > value.maximumResource || !isInteger(value.rank, 255)
    || !isInteger(value.variant, 255)) return undefined;
  return deepFreeze({
    archetypeId: value.archetypeId,
    conditionCode: value.conditionCode,
    currentResource: value.currentResource,
    maximumResource: value.maximumResource,
    rank: value.rank,
    variant: value.variant,
  });
};

export const parseSharedTurnSnapshot = (
  value: unknown,
  memberIds?: ReadonlySet<string>,
): SharedTurnSnapshot | undefined => {
  if (!hasExactKeys(value, ["actors", "exchangeId", "pendingActorIds", "phase", "revision", "round", "rulesetId"], ["outcome"])) return undefined;
  const exchangeId = parseIdentifier(value.exchangeId);
  const rulesetId = parseIdentifier(value.rulesetId);
  if (!exchangeId || !rulesetId || !isInteger(value.revision) || !isInteger(value.round)
    || (value.phase !== "collecting" && value.phase !== "replacement" && value.phase !== "ended")
    || !isDenseArray(value.actors, MAX_ACTORS) || value.actors.length < 1
    || !isDenseArray(value.pendingActorIds, MAX_ACTORS)) return undefined;
  const actors: SharedTurnActorSnapshot[] = [];
  const actorIds = new Set<string>();
  const positions = new Set<string>();
  for (const entry of value.actors) {
    if (!hasExactKeys(entry, ["actorId", "presentation", "slot", "team"], ["controllerId"])) return undefined;
    const actorId = parseIdentifier(entry.actorId);
    const controllerId = Object.hasOwn(entry, "controllerId") ? parseIdentifier(entry.controllerId) : undefined;
    const presentation = parsePresentation(entry.presentation);
    if (!actorId || !presentation || (entry.slot !== 0 && entry.slot !== 1)
      || (entry.team !== 0 && entry.team !== 1) || actorIds.has(actorId)
      || positions.has(`${entry.team}:${entry.slot}`)
      || (Object.hasOwn(entry, "controllerId") && (!controllerId || memberIds && !memberIds.has(controllerId)))) return undefined;
    actorIds.add(actorId);
    positions.add(`${entry.team}:${entry.slot}`);
    actors.push(deepFreeze({ actorId, ...(controllerId ? { controllerId } : {}), presentation, slot: entry.slot, team: entry.team }));
  }
  const pendingActorIds: string[] = [];
  for (const entry of value.pendingActorIds) {
    const actorId = parseIdentifier(entry);
    const actor = actorId ? actors.find((candidate) => candidate.actorId === actorId) : undefined;
    if (!actor?.controllerId || pendingActorIds.includes(actor.actorId)) return undefined;
    pendingActorIds.push(actor.actorId);
  }
  const ended = value.phase === "ended";
  const hasOutcome = Object.hasOwn(value, "outcome");
  if (ended !== hasOutcome || ended && pendingActorIds.length !== 0
    || !ended && pendingActorIds.length === 0
    || hasOutcome && value.outcome !== "team-0" && value.outcome !== "team-1" && value.outcome !== "draw") return undefined;
  return deepFreeze({
    actors,
    exchangeId,
    ...(hasOutcome ? { outcome: value.outcome as Exclude<SharedTurnSnapshot["outcome"], undefined> } : {}),
    pendingActorIds,
    phase: value.phase,
    revision: value.revision,
    round: value.round,
    rulesetId,
  });
};

export const parseSharedTurnPrivateChoice = (
  value: unknown,
  snapshot: SharedTurnSnapshot,
): SharedTurnPrivateChoice | undefined => {
  if (!hasExactKeys(value, ["actorId", "controllerId", "selection"])) return undefined;
  const actorId = parseIdentifier(value.actorId);
  const controllerId = parseIdentifier(value.controllerId);
  const selection = parseSharedTurnSelection(value.selection);
  const actor = actorId ? snapshot.actors.find((entry) => entry.actorId === actorId) : undefined;
  if (!actorId || !controllerId || !selection || actor?.controllerId !== controllerId) return undefined;
  return deepFreeze({ actorId, controllerId, selection });
};

export const parseSharedTurnState = (
  value: unknown,
  memberIds: ReadonlySet<string>,
): SharedTurnState | undefined => {
  if (!hasExactKeys(value, ["checkpoint", "choices", "rememberedCommands", "snapshot"])) return undefined;
  const checkpoint = parseSharedTurnCheckpoint(value.checkpoint);
  const snapshot = parseSharedTurnSnapshot(value.snapshot, memberIds);
  if (!checkpoint || !snapshot || !isDenseArray(value.choices, MAX_ACTORS)
    || !isDenseArray(value.rememberedCommands, MAX_REMEMBERED_COMMANDS)) return undefined;
  const choiceActorIds = new Set<string>();
  const choices: SharedTurnPrivateChoice[] = [];
  for (const entry of value.choices) {
    const choice = parseSharedTurnPrivateChoice(entry, snapshot);
    if (!choice || choiceActorIds.has(choice.actorId) || snapshot.pendingActorIds.includes(choice.actorId)) return undefined;
    choiceActorIds.add(choice.actorId);
    choices.push(choice);
  }
  if (snapshot.phase === "ended" && choices.length !== 0
    || snapshot.phase === "replacement" && choices.some(({ selection }) => selection.kind !== "replacement")
    || snapshot.phase === "collecting" && choices.some(({ selection }) => selection.kind === "replacement")) return undefined;
  const commandIds = new Set<string>();
  const rememberedCommands: SharedTurnRememberedCommand[] = [];
  for (const entry of value.rememberedCommands) {
    if (!hasExactKeys(entry, ["appliedRevision", "commandId", "fingerprint", "userId"])) return undefined;
    const commandId = parseIdentifier(entry.commandId);
    const userId = parseIdentifier(entry.userId);
    if (!commandId || !isInteger(entry.appliedRevision)
      || entry.appliedRevision > snapshot.revision || typeof entry.fingerprint !== "string"
      || entry.fingerprint.length > 4_096 || !userId || !memberIds.has(userId)) return undefined;
    let decoded: unknown;
    try {
      decoded = JSON.parse(entry.fingerprint) as unknown;
    } catch {
      return undefined;
    }
    const command = parseRememberedFingerprint(decoded);
    if (!command || command.commandId !== commandId || fingerprintCommand(command) !== entry.fingerprint) return undefined;
    if (command.exchangeId !== snapshot.exchangeId) return undefined;
    if (command.kind === "turn-open") {
      if (command.rulesetId !== snapshot.rulesetId || command.expectedRevision !== 0
        || entry.appliedRevision !== 1) return undefined;
    } else {
      const actor = snapshot.actors.find(({ actorId }) => actorId === command.actorId);
      if (actor?.controllerId !== userId || command.round > snapshot.round
        || command.expectedRevision === Number.MAX_SAFE_INTEGER
        || entry.appliedRevision !== command.expectedRevision + 1) return undefined;
    }
    const cacheKey = `${userId}\u0000${commandId}`;
    if (commandIds.has(cacheKey)) return undefined;
    commandIds.add(cacheKey);
    rememberedCommands.push(deepFreeze({ appliedRevision: entry.appliedRevision, commandId, fingerprint: entry.fingerprint, userId }));
  }
  return deepFreeze({ checkpoint, choices, rememberedCommands, snapshot });
};

const failure = (code: SharedTurnErrorCode, message: string): SharedTurnTransitionResult =>
  deepFreeze({ error: { code, message }, ok: false as const });

const callResolver = (resolver: SharedTurnResolver, call: () => unknown): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; reentrant: boolean }> => {
  if ((typeof resolver !== "object" && typeof resolver !== "function") || resolver === null) {
    return { ok: false, reentrant: false };
  }
  if (activeResolvers.has(resolver)) {
    reenteredResolvers.add(resolver);
    return { ok: false, reentrant: true };
  }
  activeResolvers.add(resolver);
  try {
    const value = call();
    if (reenteredResolvers.has(resolver)) return { ok: false, reentrant: true };
    return { ok: true, value };
  } catch {
    return { ok: false, reentrant: false };
  } finally {
    activeResolvers.delete(resolver);
    reenteredResolvers.delete(resolver);
  }
};

const parseResolverEnvelope = (value: unknown, members: ReadonlySet<string>): Readonly<{ checkpoint: string; snapshot: SharedTurnSnapshot }> | undefined => {
  if (!hasExactKeys(value, ["checkpoint", "snapshot"])) return undefined;
  const checkpoint = parseSealed(value.checkpoint, MAX_CHECKPOINT_LENGTH);
  const snapshot = parseSharedTurnSnapshot(value.snapshot, members);
  return checkpoint && snapshot ? deepFreeze({ checkpoint, snapshot }) : undefined;
};

const parseResolverRejection = (value: unknown): Readonly<{ code: string; message: string }> | undefined => {
  if (!hasExactKeys(value, ["code", "kind", "message"]) || value.kind !== "reject") return undefined;
  const code = parseIdentifier(value.code);
  return code && typeof value.message === "string" && value.message.length >= 1 && value.message.length <= 256
    ? deepFreeze({ code, message: value.message })
    : undefined;
};

const sameActorIdentity = (left: SharedTurnSnapshot, right: SharedTurnSnapshot): boolean =>
  left.actors.length === right.actors.length && left.actors.every((actor, index) => {
    const next = right.actors[index];
    return next !== undefined && actor.actorId === next.actorId && actor.controllerId === next.controllerId
      && actor.team === next.team && actor.slot === next.slot;
  });

type RememberedFingerprintCommand = SharedTurnActionCommand | Omit<SharedTurnOpenCommand, "authorization">;

const fingerprintCommand = (command: SharedTurnCommand | RememberedFingerprintCommand): string =>
  JSON.stringify(command.kind === "turn-open"
    ? {
        commandId: command.commandId,
        exchangeId: command.exchangeId,
        expectedRevision: command.expectedRevision,
        kind: command.kind,
        protocolVersion: command.protocolVersion,
        rulesetId: command.rulesetId,
      }
    : command);

const parseRememberedFingerprint = (value: unknown): RememberedFingerprintCommand | undefined => {
  if (isPlainRecord(value) && value.kind === "turn-open") {
    if (!hasExactKeys(value, ["commandId", "exchangeId", "expectedRevision", "kind", "protocolVersion", "rulesetId"])) return undefined;
    const commandId = parseIdentifier(value.commandId);
    const exchangeId = parseIdentifier(value.exchangeId);
    const rulesetId = parseIdentifier(value.rulesetId);
    return commandId && exchangeId && rulesetId && value.protocolVersion === SHARED_TURN_PROTOCOL_VERSION && isInteger(value.expectedRevision)
      ? deepFreeze({ commandId, exchangeId, expectedRevision: value.expectedRevision, kind: "turn-open" as const, protocolVersion: SHARED_TURN_PROTOCOL_VERSION, rulesetId })
      : undefined;
  }
  const command = parseSharedTurnCommand(value);
  return command?.kind === "turn-action" ? command : undefined;
};

const remember = (state: SharedTurnState, command: SharedTurnCommand, revision: number, userId: string): readonly SharedTurnRememberedCommand[] => {
  const entries = [...state.rememberedCommands, deepFreeze({
    appliedRevision: revision,
    commandId: command.commandId,
    fingerprint: fingerprintCommand(command),
    userId,
  })];
  return deepFreeze(entries.slice(-MAX_REMEMBERED_COMMANDS));
};

const success = (state: SharedTurnState, revision: number, replayed: boolean): SharedTurnTransitionResult =>
  deepFreeze({ appliedRevision: revision, ok: true as const, replayed, state });

export const transitionSharedTurnExchange = (input: Readonly<{
  readonly command: unknown;
  readonly memberIds: readonly string[];
  readonly resolver?: SharedTurnResolver;
  readonly state?: SharedTurnState;
  readonly userId: string;
}>): SharedTurnTransitionResult => {
  const command = parseSharedTurnCommand(input.command);
  if (!command || !parseIdentifier(input.userId) || !isDenseArray(input.memberIds, MAX_ACTORS)
    || input.memberIds.some((entry) => !parseIdentifier(entry)) || new Set(input.memberIds).size !== input.memberIds.length) {
    return failure("invalid-command", "The transition input is invalid");
  }
  if (!isSharedTurnResolver(input.resolver)) {
    return failure("resolver-failed", "A trusted resolver is required");
  }
  const members = new Set<string>(input.memberIds as readonly string[]);
  if (!members.has(input.userId)) return failure("actor-control-conflict", "The identity is not a member");
  const parsedState = input.state === undefined ? undefined : parseSharedTurnState(input.state, members);
  if (input.state !== undefined && parsedState === undefined) {
    return failure("exchange-state-conflict", "The current exchange state is invalid");
  }
  const state = parsedState;
  if (state) {
    if (command.kind === "turn-open") {
      if (command.exchangeId !== state.snapshot.exchangeId || command.rulesetId !== state.snapshot.rulesetId) {
        return failure("active-exchange", "An exchange is already active");
      }
    } else {
      const actor = state.snapshot.actors.find((entry) => entry.actorId === command.actorId);
      if (command.exchangeId !== state.snapshot.exchangeId || command.round > state.snapshot.round) {
        return failure("exchange-state-conflict", "The exchange or round differs");
      }
      if (actor?.controllerId !== input.userId) {
        return failure("actor-control-conflict", "The identity does not control the actor");
      }
    }
    const remembered = state.rememberedCommands.find((entry) =>
      entry.commandId === command.commandId && entry.userId === input.userId);
    if (remembered) return remembered.fingerprint === fingerprintCommand(command)
      ? success(state, remembered.appliedRevision, true)
      : failure("command-id-conflict", "The command identifier has different content");
  }
  if (command.kind === "turn-open") {
    if (state) return failure("active-exchange", "An exchange is already active");
    if (command.expectedRevision !== 0) return failure("revision-conflict", "The opening revision differs");
    const called = callResolver(input.resolver, () => input.resolver!.open(deepFreeze({
      authorization: command.authorization,
      exchangeId: command.exchangeId,
      memberIds: [...input.memberIds],
      rulesetId: command.rulesetId,
      userId: input.userId,
    })));
    if (!called.ok) return failure(called.reentrant ? "resolver-reentrant" : "resolver-failed", "The resolver could not open the exchange");
    const rejection = parseResolverRejection(called.value);
    if (rejection) return failure("resolver-rejected", `${rejection.code}: ${rejection.message}`);
    const envelope = parseResolverEnvelope(called.value, members);
    if (!envelope || envelope.snapshot.exchangeId !== command.exchangeId
      || envelope.snapshot.rulesetId !== command.rulesetId || envelope.snapshot.revision !== 1
      || envelope.snapshot.round !== 0 || envelope.snapshot.phase === "ended") {
      return failure("invalid-resolver-result", "The resolver returned an invalid opening state");
    }
    const initial: SharedTurnState = deepFreeze({ checkpoint: envelope.checkpoint, choices: [], rememberedCommands: [], snapshot: envelope.snapshot });
    const next = deepFreeze({ ...initial, rememberedCommands: remember(initial, command, 1, input.userId) });
    return success(next, 1, false);
  }
  if (!state) return failure("exchange-state-conflict", "No exchange is active");
  const snapshot = state.snapshot;
  if (snapshot.revision === Number.MAX_SAFE_INTEGER) {
    return failure("revision-exhausted", "The exchange revision cannot advance");
  }
  if (command.expectedRevision !== snapshot.revision) return failure("revision-conflict", "The expected revision differs");
  if (command.exchangeId !== snapshot.exchangeId || command.round !== snapshot.round || snapshot.phase === "ended") {
    return failure("exchange-state-conflict", "The exchange, round, or phase differs");
  }
  const actor = snapshot.actors.find((entry) => entry.actorId === command.actorId);
  if (actor?.controllerId !== input.userId) return failure("actor-control-conflict", "The identity does not control the actor");
  if (!snapshot.pendingActorIds.includes(command.actorId)) return failure("actor-not-pending", "The actor is not awaiting a choice");
  if (snapshot.phase === "replacement" && command.selection.kind !== "replacement") {
    return failure("exchange-state-conflict", "The phase only accepts replacement choices");
  }
  if (snapshot.phase === "collecting" && command.selection.kind === "replacement") {
    return failure("exchange-state-conflict", "The phase does not accept replacement choices");
  }
  const choice = deepFreeze({ actorId: command.actorId, controllerId: input.userId, selection: command.selection });
  const choices = deepFreeze([...state.choices, choice]);
  const admitted = callResolver(input.resolver, () => input.resolver!.admit(deepFreeze({
    checkpoint: state.checkpoint,
    choice,
    choices,
    snapshot,
    userId: input.userId,
  })));
  if (!admitted.ok) return failure(admitted.reentrant ? "resolver-reentrant" : "resolver-failed", "The resolver could not admit the choice");
  const admissionRejection = parseResolverRejection(admitted.value);
  if (admissionRejection) return failure("resolver-rejected", `${admissionRejection.code}: ${admissionRejection.message}`);
  if (!hasExactKeys(admitted.value, ["checkpoint"]) || !parseSealed(admitted.value.checkpoint, MAX_CHECKPOINT_LENGTH)) {
    return failure("invalid-resolver-result", "The resolver returned an invalid admission");
  }
  const checkpoint = admitted.value.checkpoint as string;
  const remaining = snapshot.pendingActorIds.filter((actorId) => actorId !== command.actorId);
  if (remaining.length > 0) {
    const nextSnapshot = deepFreeze({ ...snapshot, pendingActorIds: remaining, revision: snapshot.revision + 1 });
    const base = deepFreeze({ checkpoint, choices, rememberedCommands: state.rememberedCommands, snapshot: nextSnapshot });
    const next = deepFreeze({ ...base, rememberedCommands: remember(base, command, nextSnapshot.revision, input.userId) });
    return success(next, nextSnapshot.revision, false);
  }
  const resolved = callResolver(input.resolver, () => input.resolver!.resolve(deepFreeze({ checkpoint, choices, snapshot })));
  if (!resolved.ok) return failure(resolved.reentrant ? "resolver-reentrant" : "resolver-failed", "The resolver could not resolve the choices");
  const envelope = parseResolverEnvelope(resolved.value, members);
  if (!envelope || envelope.snapshot.exchangeId !== snapshot.exchangeId
    || envelope.snapshot.rulesetId !== snapshot.rulesetId
    || envelope.snapshot.revision !== snapshot.revision + 1
    || !sameActorIdentity(snapshot, envelope.snapshot)
    || envelope.snapshot.round < snapshot.round) {
    return failure("invalid-resolver-result", "The resolver returned an invalid resolved state");
  }
  const base = deepFreeze({ checkpoint: envelope.checkpoint, choices: [], rememberedCommands: state.rememberedCommands, snapshot: envelope.snapshot });
  const next = deepFreeze({ ...base, rememberedCommands: remember(base, command, envelope.snapshot.revision, input.userId) });
  return success(next, envelope.snapshot.revision, false);
};
