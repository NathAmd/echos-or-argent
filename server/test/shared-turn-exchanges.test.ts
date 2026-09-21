import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSharedTurnCommand,
  parseSharedTurnCheckpoint,
  parseSharedTurnSnapshot,
  parseSharedTurnState,
  transitionSharedTurnExchange,
  type SharedTurnActionCommand,
  type SharedTurnOpenCommand,
  type SharedTurnResolver,
  type SharedTurnSnapshot,
  type SharedTurnState,
} from "../src/domain/shared-turn-exchanges.js";

const members = ["alice", "bob"] as const;

const snapshot = (overrides: Partial<SharedTurnSnapshot> = {}): SharedTurnSnapshot => ({
  actors: [
    {
      actorId: "actor:alice",
      controllerId: "alice",
      presentation: { archetypeId: 25, conditionCode: 0, currentResource: 40, maximumResource: 40, rank: 12, variant: 0 },
      slot: 0,
      team: 0,
    },
    {
      actorId: "actor:bob",
      controllerId: "bob",
      presentation: { archetypeId: 133, conditionCode: 0, currentResource: 38, maximumResource: 38, rank: 12, variant: 0 },
      slot: 1,
      team: 0,
    },
    {
      actorId: "actor:remote",
      presentation: { archetypeId: 16, conditionCode: 0, currentResource: 25, maximumResource: 25, rank: 10, variant: 0 },
      slot: 0,
      team: 1,
    },
  ],
  exchangeId: "exchange:test",
  pendingActorIds: ["actor:alice", "actor:bob"],
  phase: "collecting",
  revision: 1,
  round: 0,
  rulesetId: "rules:v1",
  ...overrides,
});

const openCommand = (overrides: Partial<SharedTurnOpenCommand> = {}): SharedTurnOpenCommand => ({
  authorization: "opaque_authorization",
  commandId: "command:open",
  exchangeId: "exchange:test",
  expectedRevision: 0,
  kind: "turn-open",
  protocolVersion: 1,
  rulesetId: "rules:v1",
  ...overrides,
});

const actionCommand = (overrides: Partial<SharedTurnActionCommand> = {}): SharedTurnActionCommand => ({
  actorId: "actor:alice",
  commandId: "command:alice:0",
  exchangeId: "exchange:test",
  expectedRevision: 1,
  kind: "turn-action",
  protocolVersion: 1,
  round: 0,
  selection: { kind: "option", optionIndex: 0, targetActorId: "actor:remote" },
  ...overrides,
});

const resolver = (overrides: Partial<SharedTurnResolver> = {}): SharedTurnResolver => ({
  admit: () => ({ checkpoint: "checkpoint_admitted" }),
  open: () => ({ checkpoint: "checkpoint_open", snapshot: snapshot() }),
  resolve: ({ snapshot: current }) => ({
    checkpoint: "checkpoint_resolved",
    snapshot: snapshot({
      actors: current.actors,
      pendingActorIds: ["actor:alice", "actor:bob"],
      revision: current.revision + 1,
      round: current.round + 1,
    }),
  }),
  ...overrides,
});

const open = (customResolver = resolver()): SharedTurnState => {
  const result = transitionSharedTurnExchange({
    command: openCommand(),
    memberIds: members,
    resolver: customResolver,
    userId: "alice",
  });
  assert.equal(result.ok, true);
  return result.state;
};

describe("generic shared turn exchanges", () => {
  it("parses only canonical bounded commands and public snapshots", () => {
    const command = parseSharedTurnCommand(actionCommand());
    assert.deepEqual(command, actionCommand());
    assert.equal(Object.isFrozen(command), true);
    assert.equal(Object.isFrozen(command?.selection), true);
    assert.equal(parseSharedTurnCommand({ ...actionCommand(), extra: true }), undefined);
    assert.equal(parseSharedTurnCommand({ ...actionCommand(), selection: { kind: "option", optionIndex: 256 } }), undefined);
    assert.equal(parseSharedTurnCommand({ ...openCommand(), authorization: "{" }), undefined);
    assert.equal(parseSharedTurnCheckpoint("sealed_checkpoint"), "sealed_checkpoint");
    assert.equal(parseSharedTurnCheckpoint("{"), undefined);

    const parsed = parseSharedTurnSnapshot(snapshot(), new Set(members));
    assert.ok(parsed);
    assert.equal(Object.isFrozen(parsed.actors[0]?.presentation), true);
    assert.equal(parseSharedTurnSnapshot({ ...snapshot(), pendingActorIds: ["actor:remote"] }, new Set(members)), undefined);
    assert.equal(parseSharedTurnSnapshot({ ...snapshot(), actors: [...snapshot().actors, snapshot().actors[0]] }, new Set(members)), undefined);
    assert.equal(parseSharedTurnSnapshot({ ...snapshot(), phase: "ended", pendingActorIds: [] }, new Set(members)), undefined);
    const symbolicActors = [...snapshot().actors];
    Object.defineProperty(symbolicActors, Symbol("hidden"), { value: true });
    assert.equal(parseSharedTurnSnapshot({ ...snapshot(), actors: symbolicActors }, new Set(members)), undefined);
    const decoratedPending = [...snapshot().pendingActorIds];
    Object.defineProperty(decoratedPending, "hidden", { enumerable: false, value: true });
    assert.equal(parseSharedTurnSnapshot({ ...snapshot(), pendingActorIds: decoratedPending }, new Set(members)), undefined);

    const state = open();
    assert.ok(parseSharedTurnState(state, new Set(members)));
    assert.equal(state.rememberedCommands[0]?.fingerprint.includes("opaque_authorization"), false);
    assert.equal(state.rememberedCommands[0]?.fingerprint.includes("authorization"), false);
    assert.equal(parseSharedTurnState({ ...state, choices: [{ actorId: "actor:alice", controllerId: "bob", selection: { kind: "option", optionIndex: 0 } }] }, new Set(members)), undefined);
  });

  it("requires a resolver and validates its opening output", () => {
    assert.deepEqual(transitionSharedTurnExchange({ command: openCommand(), memberIds: members, userId: "alice" }), {
      error: { code: "resolver-failed", message: "A trusted resolver is required" },
      ok: false,
    });
    const invalid = transitionSharedTurnExchange({
      command: openCommand(),
      memberIds: members,
      resolver: resolver({ open: () => ({ checkpoint: "ok", snapshot: snapshot({ revision: 2 }) }) }),
      userId: "alice",
    });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.error.code, "invalid-resolver-result");
  });

  it("keeps choices private until resolution and replays an identical identifier", () => {
    const initial = open();
    const firstCommand = actionCommand();
    const first = transitionSharedTurnExchange({ state: initial, command: firstCommand, memberIds: members, resolver: resolver(), userId: "alice" });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(first.state.snapshot.pendingActorIds, ["actor:bob"]);
    assert.deepEqual(first.state.snapshot.actors, initial.snapshot.actors);
    assert.equal(JSON.stringify(first.state.snapshot).includes("optionIndex"), false);
    assert.deepEqual(first.state.choices, [{ actorId: "actor:alice", controllerId: "alice", selection: firstCommand.selection }]);
    assert.equal(Object.isFrozen(first.state.choices[0]?.selection), true);

    const replay = transitionSharedTurnExchange({ state: first.state, command: firstCommand, memberIds: members, resolver: resolver(), userId: "alice" });
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.replayed, true);
      assert.notEqual(replay.state, first.state);
      assert.deepEqual(replay.state, first.state);
      assert.equal(replay.appliedRevision, 2);
    }
    const conflict = transitionSharedTurnExchange({
      state: first.state,
      command: { ...firstCommand, selection: { kind: "option", optionIndex: 1 } },
      memberIds: members,
      resolver: resolver(),
      userId: "alice",
    });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.error.code, "command-id-conflict");
  });

  it("binds replay to its identity before consulting the cache", () => {
    const initial = open();
    const replayByPeer = transitionSharedTurnExchange({
      state: initial,
      command: openCommand(),
      memberIds: members,
      resolver: resolver(),
      userId: "bob",
    });
    assert.equal(replayByPeer.ok, false);
    if (!replayByPeer.ok) assert.equal(replayByPeer.error.code, "active-exchange");

    const chosen = transitionSharedTurnExchange({ state: initial, command: actionCommand(), memberIds: members, resolver: resolver(), userId: "alice" });
    assert.equal(chosen.ok, true);
    if (!chosen.ok) return;
    const stolen = transitionSharedTurnExchange({ state: chosen.state, command: actionCommand(), memberIds: members, resolver: resolver(), userId: "bob" });
    assert.equal(stolen.ok, false);
    if (!stolen.ok) assert.equal(stolen.error.code, "actor-control-conflict");
  });

  it("binds every restored cache entry to the current graph and controller", () => {
    const initial = open();
    const badRuleset = structuredClone(initial);
    const opened = JSON.parse(badRuleset.rememberedCommands[0]!.fingerprint) as Record<string, unknown>;
    opened.rulesetId = "rules:foreign";
    (badRuleset.rememberedCommands[0] as unknown as Record<string, unknown>).fingerprint = JSON.stringify(opened);
    assert.equal(parseSharedTurnState(badRuleset, new Set(members)), undefined);

    const chosen = transitionSharedTurnExchange({ state: initial, command: actionCommand(), memberIds: members, resolver: resolver(), userId: "alice" });
    assert.equal(chosen.ok, true);
    if (!chosen.ok) return;
    const foreign = structuredClone(chosen.state);
    (foreign.rememberedCommands[1] as unknown as Record<string, unknown>).userId = "bob";
    assert.equal(parseSharedTurnState(foreign, new Set(members)), undefined);

    const foreignExchange = structuredClone(chosen.state);
    const action = JSON.parse(foreignExchange.rememberedCommands[1]!.fingerprint) as Record<string, unknown>;
    action.exchangeId = "exchange:foreign";
    (foreignExchange.rememberedCommands[1] as unknown as Record<string, unknown>).fingerprint = JSON.stringify(action);
    assert.equal(parseSharedTurnState(foreignExchange, new Set(members)), undefined);

    const badRevision = structuredClone(chosen.state);
    (badRevision.rememberedCommands[1] as unknown as Record<string, unknown>).appliedRevision =
      badRevision.rememberedCommands[1]!.appliedRevision + 1;
    assert.equal(parseSharedTurnState(badRevision, new Set(members)), undefined);
  });

  it("replays an earlier-round action only for its original controller", () => {
    const activeResolver = resolver();
    const firstCommand = actionCommand();
    const first = transitionSharedTurnExchange({ state: open(activeResolver), command: firstCommand, memberIds: members, resolver: activeResolver, userId: "alice" });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = transitionSharedTurnExchange({
      state: first.state,
      command: actionCommand({ actorId: "actor:bob", commandId: "command:bob:0", expectedRevision: 2 }),
      memberIds: members,
      resolver: activeResolver,
      userId: "bob",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.state.snapshot.round, 1);
    const replay = transitionSharedTurnExchange({ state: second.state, command: firstCommand, memberIds: members, resolver: activeResolver, userId: "alice" });
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.replayed, true);
    const stolen = transitionSharedTurnExchange({ state: second.state, command: firstCommand, memberIds: members, resolver: activeResolver, userId: "bob" });
    assert.equal(stolen.ok, false);
    if (!stolen.ok) assert.equal(stolen.error.code, "actor-control-conflict");
  });

  it("freezes a parsed clone and never aliases a mutable input state", () => {
    const mutable = structuredClone(open()) as SharedTurnState;
    const before = structuredClone(mutable);
    assert.equal(Object.isFrozen(mutable), false);
    const result = transitionSharedTurnExchange({ state: mutable, command: actionCommand(), memberIds: members, resolver: resolver(), userId: "alice" });
    assert.equal(result.ok, true);
    assert.deepEqual(mutable, before);
    assert.equal(Object.isFrozen(mutable), false);
    if (result.ok) {
      assert.notEqual(result.state, mutable);
      assert.equal(Object.isFrozen(result.state), true);
      assert.equal(Object.isFrozen(result.state.snapshot.actors[0]?.presentation), true);
    }
  });

  it("fails before resolver invocation when the revision cannot advance", () => {
    let calls = 0;
    const exhaustedResolver = resolver({ admit: () => { calls += 1; return { checkpoint: "unused" }; } });
    const initial = open(exhaustedResolver);
    const exhausted: SharedTurnState = {
      ...initial,
      rememberedCommands: [],
      snapshot: { ...initial.snapshot, revision: Number.MAX_SAFE_INTEGER },
    };
    const result = transitionSharedTurnExchange({
      state: exhausted,
      command: actionCommand({ expectedRevision: Number.MAX_SAFE_INTEGER }),
      memberIds: members,
      resolver: exhaustedResolver,
      userId: "alice",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "revision-exhausted");
    assert.equal(calls, 0);
  });

  it("distinguishes exact resolver rejections from faults and invalid output", () => {
    const deniedOpen = transitionSharedTurnExchange({
      command: openCommand(),
      memberIds: members,
      resolver: resolver({ open: () => ({ code: "authorization-denied", kind: "reject", message: "Authorization denied" }) }),
      userId: "alice",
    });
    assert.equal(deniedOpen.ok, false);
    if (!deniedOpen.ok) assert.equal(deniedOpen.error.code, "resolver-rejected");

    const deniedAction = transitionSharedTurnExchange({
      state: open(),
      command: actionCommand(),
      memberIds: members,
      resolver: resolver({ admit: () => ({ code: "choice-denied", kind: "reject", message: "Choice denied" }) }),
      userId: "alice",
    });
    assert.equal(deniedAction.ok, false);
    if (!deniedAction.ok) assert.equal(deniedAction.error.code, "resolver-rejected");
  });

  it("rejects replacement during collection without invoking admission", () => {
    let calls = 0;
    const guarded = resolver({ admit: () => { calls += 1; return { checkpoint: "unused" }; } });
    const result = transitionSharedTurnExchange({
      state: open(guarded),
      command: actionCommand({ selection: { kind: "replacement", replacementIndex: 1 } }),
      memberIds: members,
      resolver: guarded,
      userId: "alice",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "exchange-state-conflict");
    assert.equal(calls, 0);
  });

  it("rejects a terminal resolver output whose round regresses", () => {
    const ending = resolver({ resolve: ({ snapshot: current }) => ({
      checkpoint: "ended_checkpoint",
      snapshot: snapshot({
        actors: current.actors,
        outcome: "team-0",
        pendingActorIds: [],
        phase: "ended",
        revision: current.revision + 1,
        round: 0,
      }),
    }) });
    const roundOne: SharedTurnState = { ...open(ending), snapshot: snapshot({ round: 1 }) };
    const first = transitionSharedTurnExchange({
      state: roundOne,
      command: actionCommand({ round: 1 }),
      memberIds: members,
      resolver: ending,
      userId: "alice",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = transitionSharedTurnExchange({
      state: first.state,
      command: actionCommand({ actorId: "actor:bob", commandId: "command:bob:end", expectedRevision: 2, round: 1 }),
      memberIds: members,
      resolver: ending,
      userId: "bob",
    });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.error.code, "invalid-resolver-result");
  });

  it("fails closed for a primitive resolver without throwing", () => {
    const primitive = 7 as unknown as SharedTurnResolver;
    const result = transitionSharedTurnExchange({
      command: openCommand(),
      memberIds: members,
      resolver: primitive,
      userId: "alice",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "resolver-failed");

    const replay = transitionSharedTurnExchange({
      command: openCommand(),
      memberIds: members,
      resolver: primitive,
      state: open(),
      userId: "alice",
    });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.error.code, "resolver-failed");
  });

  it("enforces controller, revision, round, phase and pending actor invariants", () => {
    const initial = open();
    const cases = [
      [actionCommand(), "bob", "actor-control-conflict"],
      [actionCommand({ expectedRevision: 2 }), "alice", "revision-conflict"],
      [actionCommand({ round: 1 }), "alice", "exchange-state-conflict"],
      [actionCommand({ actorId: "actor:remote" }), "alice", "actor-control-conflict"],
    ] as const;
    for (const [command, userId, code] of cases) {
      const result = transitionSharedTurnExchange({ state: initial, command, memberIds: members, resolver: resolver(), userId });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, code);
    }
    const replacement = { ...initial, snapshot: snapshot({ phase: "replacement" }) };
    const wrongKind = transitionSharedTurnExchange({ state: replacement, command: actionCommand(), memberIds: members, resolver: resolver(), userId: "alice" });
    assert.equal(wrongKind.ok, false);
    if (!wrongKind.ok) assert.equal(wrongKind.error.code, "exchange-state-conflict");
  });

  it("resolves exactly after the final pending choice and clears private choices", () => {
    let resolveCalls = 0;
    const resolving = resolver({ resolve: (input) => {
      resolveCalls += 1;
      assert.equal(input.choices.length, 2);
      return {
        checkpoint: "next_round",
        snapshot: snapshot({ actors: input.snapshot.actors, revision: 3, round: 1 }),
      };
    } });
    const first = transitionSharedTurnExchange({ state: open(resolving), command: actionCommand(), memberIds: members, resolver: resolving, userId: "alice" });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(resolveCalls, 0);
    const second = transitionSharedTurnExchange({
      state: first.state,
      command: actionCommand({ actorId: "actor:bob", commandId: "command:bob:0", expectedRevision: 2 }),
      memberIds: members,
      resolver: resolving,
      userId: "bob",
    });
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(resolveCalls, 1);
      assert.equal(second.state.snapshot.round, 1);
      assert.deepEqual(second.state.choices, []);
    }
  });

  it("returns the original state on resolver faults, invalid output, and nested entry", () => {
    const initial = open();
    for (const custom of [
      resolver({ admit: () => { throw new Error("offline"); } }),
      resolver({ admit: () => ({ checkpoint: "{" }) }),
    ]) {
      const result = transitionSharedTurnExchange({ state: initial, command: actionCommand(), memberIds: members, resolver: custom, userId: "alice" });
      assert.equal(result.ok, false);
      assert.equal(initial.snapshot.revision, 1);
      assert.deepEqual(initial.choices, []);
    }

    let nestedResolver: SharedTurnResolver;
    nestedResolver = resolver({ admit: () => {
      transitionSharedTurnExchange({ state: initial, command: actionCommand(), memberIds: members, resolver: nestedResolver, userId: "alice" });
      return { checkpoint: "nested" };
    } });
    const nested = transitionSharedTurnExchange({ state: initial, command: actionCommand(), memberIds: members, resolver: nestedResolver, userId: "alice" });
    assert.equal(nested.ok, false);
    if (!nested.ok) assert.equal(nested.error.code, "resolver-reentrant");
    assert.equal(initial.snapshot.revision, 1);
  });

  it("rejects an invalid resolved graph without exposing or committing choices", () => {
    const invalidResolver = resolver({ resolve: ({ snapshot: current }) => ({
      checkpoint: "resolved",
      snapshot: snapshot({
        actors: current.actors.map((actor, index) => index === 0 ? { ...actor, controllerId: "bob" } : actor),
        revision: current.revision + 1,
        round: current.round + 1,
      }),
    }) });
    const first = transitionSharedTurnExchange({ state: open(invalidResolver), command: actionCommand(), memberIds: members, resolver: invalidResolver, userId: "alice" });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = transitionSharedTurnExchange({
      state: first.state,
      command: actionCommand({ actorId: "actor:bob", commandId: "command:bob:bad", expectedRevision: 2 }),
      memberIds: members,
      resolver: invalidResolver,
      userId: "bob",
    });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.error.code, "invalid-resolver-result");
    assert.equal(first.state.snapshot.revision, 2);
    assert.equal(first.state.choices.length, 1);
  });
});
