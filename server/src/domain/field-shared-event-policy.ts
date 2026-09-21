import type {
  SharedEventAdmissionDecision,
  SharedEventAdmissionInput,
} from "./shared-sessions.js";

const MAXIMUM_BYTE = 0xff;
const MAXIMUM_FIELD_IDENTIFIER = 0xffff;
const MAXIMUM_COORDINATE = 1_000_000;
const MAXIMUM_COUNTER_VALUE = 1_000_000_000;
const PROGRESSION_REVISION_COUNTER = "field.progression-revision";
const GAME_CODE_PATTERN = /^[A-Z0-9]{4}$/;
const CANONICAL_BASE_36_PATTERN = /^(?:0|[1-9a-z][0-9a-z]*)$/;
const FLAG_EFFECT_PATTERN = /^field\.flag\.[0-9a-f]{4}$/;
const VARIABLE_EFFECT_PATTERN = /^field\.variable\.([0-9a-f]{4})$/;

export const FIELD_SHARED_EVENT_REJECTION_CODES = Object.freeze({
  compatibilityMismatch: "field-event-compatibility-mismatch",
  counterUnsupported: "field-event-counter-unsupported",
  identifierInvalid: "field-event-identifier-invalid",
  mapMismatch: "field-event-map-mismatch",
  milestoneUnsupported: "field-event-milestone-unsupported",
  revisionInvalid: "field-event-revision-invalid",
  temporaryVariable: "field-event-temporary-variable",
} as const);

interface FieldEventIdentity {
  readonly gameCode: string;
  readonly gameVersion: number;
  readonly language: number;
  readonly mapId: number;
}

const accept = (): SharedEventAdmissionDecision => Object.freeze({ kind: "accept" });

const reject = (
  code: typeof FIELD_SHARED_EVENT_REJECTION_CODES[keyof typeof FIELD_SHARED_EVENT_REJECTION_CODES],
  message: string,
): SharedEventAdmissionDecision => Object.freeze({ code, kind: "reject", message });

const parseBase36 = (value: string | undefined, maximum: number, minimum = 0): number | undefined => {
  if (value === undefined || !CANONICAL_BASE_36_PATTERN.test(value)) return undefined;
  const parsed = Number.parseInt(value, 36);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
};

const parseCoordinate = (value: string | undefined): number | undefined => {
  const encoded = parseBase36(value, MAXIMUM_COORDINATE * 2);
  if (encoded === undefined) return undefined;
  return encoded % 2 === 0 ? encoded / 2 : -(encoded + 1) / 2;
};

const parseFieldEventId = (value: string): FieldEventIdentity | undefined => {
  if (value.length > 128) return undefined;
  const segments = value.split(".");
  if (segments[0] !== "field-event" || segments[1] !== "1") return undefined;
  const gameCode = segments[2];
  const gameVersion = parseBase36(segments[3], MAXIMUM_BYTE);
  const language = parseBase36(segments[4], MAXIMUM_BYTE);
  const mapId = parseBase36(segments[5], MAXIMUM_FIELD_IDENTIFIER);
  const sourceKind = segments[6];
  const sourceIsValid = sourceKind === "o" && segments.length === 9
    ? parseBase36(segments[7], MAXIMUM_FIELD_IDENTIFIER) !== undefined
    : sourceKind === "c" && segments.length === 10
      ? parseCoordinate(segments[7]) !== undefined && parseCoordinate(segments[8]) !== undefined
      : false;
  const scriptId = parseBase36(
    sourceKind === "o" ? segments[8] : sourceKind === "c" ? segments[9] : undefined,
    MAXIMUM_FIELD_IDENTIFIER,
    1,
  );
  if (
    gameCode === undefined
    || !GAME_CODE_PATTERN.test(gameCode)
    || gameVersion === undefined
    || language === undefined
    || mapId === undefined
    || !sourceIsValid
    || scriptId === undefined
  ) return undefined;
  return Object.freeze({ gameCode, gameVersion, language, mapId });
};

const isTemporaryVariable = (identifier: number): boolean =>
  (identifier >= 0x4000 && identifier <= 0x400f)
  || (identifier >= 0x8000 && identifier <= 0x800f);

export const admitFieldSharedEvent = (
  input: SharedEventAdmissionInput,
): SharedEventAdmissionDecision => {
  const identity = parseFieldEventId(input.command.eventId);
  if (identity === undefined) {
    return reject(
      FIELD_SHARED_EVENT_REJECTION_CODES.identifierInvalid,
      "The field event identifier is not canonical",
    );
  }
  if (
    identity.gameCode !== input.compatibility.applicationId
    || identity.gameVersion !== input.compatibility.release
    || identity.language !== input.compatibility.locale
  ) {
    return reject(
      FIELD_SHARED_EVENT_REJECTION_CODES.compatibilityMismatch,
      "The field event identity differs from the session compatibility",
    );
  }
  const player = input.snapshot.players.find(({ playerId }) => playerId === input.playerId);
  if (player === undefined || identity.mapId !== player.position.mapId) {
    return reject(
      FIELD_SHARED_EVENT_REJECTION_CODES.mapMismatch,
      "The field event map differs from the sender current map",
    );
  }
  if (input.command.milestoneIds.some((identifier) => !FLAG_EFFECT_PATTERN.test(identifier))) {
    return reject(
      FIELD_SHARED_EVENT_REJECTION_CODES.milestoneUnsupported,
      "The field event contains an unsupported milestone effect",
    );
  }
  let revisionMutation: SharedEventAdmissionInput["command"]["counters"][number] | undefined;
  for (const mutation of input.command.counters) {
    if (mutation.id === PROGRESSION_REVISION_COUNTER) {
      if (revisionMutation !== undefined) {
        return reject(
          FIELD_SHARED_EVENT_REJECTION_CODES.revisionInvalid,
          "The field progression revision must advance exactly once from the current value",
        );
      }
      revisionMutation = mutation;
      continue;
    }
    if (FLAG_EFFECT_PATTERN.test(mutation.id)) continue;
    const variable = VARIABLE_EFFECT_PATTERN.exec(mutation.id);
    if (variable === null) {
      return reject(
        FIELD_SHARED_EVENT_REJECTION_CODES.counterUnsupported,
        "The field event contains an unsupported counter effect",
      );
    }
    const identifier = Number.parseInt(variable[1]!, 16);
    if (isTemporaryVariable(identifier)) {
      return reject(
        FIELD_SHARED_EVENT_REJECTION_CODES.temporaryVariable,
        "Temporary field variables cannot be shared",
      );
    }
  }
  const currentRevision = input.snapshot.sharedProgression.counters
    .find(({ id }) => id === PROGRESSION_REVISION_COUNTER)?.value;
  if (
    revisionMutation === undefined
    || currentRevision === undefined
    || currentRevision < 0
    || currentRevision >= MAXIMUM_COUNTER_VALUE
    || revisionMutation.expectedValue !== currentRevision
    || revisionMutation.value !== currentRevision + 1
  ) {
    return reject(
      FIELD_SHARED_EVENT_REJECTION_CODES.revisionInvalid,
      "The field progression revision must advance exactly once from the current value",
    );
  }
  return accept();
};
