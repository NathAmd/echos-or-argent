import { createHash } from "node:crypto";
import type {
  SharedSessionContinuityInspection,
  SharedSessionContinuityPolicy,
  SharedSessionContinuityInspectionInput,
} from "./shared-sessions.js";

const BRANCH_PATTERN = /^field\.branch\.[0-9a-f]{32}$/;
const PROGRESSION_REVISION_COUNTER = "field.progression-revision";

export const FIELD_SHARED_SESSION_CONTINUITY_POLICY_ID = "field-continuity-v1";

export const FIELD_SHARED_SESSION_CONTINUITY_REJECTION_CODES = Object.freeze({
  branchInvalid: "field-continuity-branch-invalid",
  revisionInvalid: "field-continuity-revision-invalid",
} as const);

const reject = (
  code: typeof FIELD_SHARED_SESSION_CONTINUITY_REJECTION_CODES[
    keyof typeof FIELD_SHARED_SESSION_CONTINUITY_REJECTION_CODES
  ],
  message: string,
): SharedSessionContinuityInspection => Object.freeze({ code, kind: "reject", message });

const fingerprint = (input: SharedSessionContinuityInspectionInput): string => {
  const canonical = JSON.stringify({
    compatibility: {
      applicationId: input.compatibility.applicationId,
      locale: input.compatibility.locale,
      release: input.compatibility.release,
    },
    counters: [...input.sharedProgression.counters]
      .map(({ id, value }) => ({ id, value }))
      .sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0),
    milestoneIds: [...input.sharedProgression.milestoneIds].sort(),
  });
  return createHash("sha256").update(canonical, "utf8").digest("base64url");
};

export const inspectFieldSharedSessionContinuity = (
  input: SharedSessionContinuityInspectionInput,
): SharedSessionContinuityInspection => {
  const branchIds = input.sharedProgression.milestoneIds.filter((id) => BRANCH_PATTERN.test(id));
  if (branchIds.length === 0) return Object.freeze({ kind: "unclaimed" });
  if (branchIds.length !== 1) {
    return reject(
      FIELD_SHARED_SESSION_CONTINUITY_REJECTION_CODES.branchInvalid,
      "The field continuity branch is invalid",
    );
  }
  const revision = input.sharedProgression.counters
    .find(({ id }) => id === PROGRESSION_REVISION_COUNTER)?.value;
  if (revision === undefined || !Number.isSafeInteger(revision) || revision < 0) {
    return reject(
      FIELD_SHARED_SESSION_CONTINUITY_REJECTION_CODES.revisionInvalid,
      "The field continuity revision is invalid",
    );
  }
  return Object.freeze({
    continuityId: branchIds[0]!,
    fingerprint: fingerprint(input),
    kind: "claim",
    revision,
  });
};

export const fieldSharedSessionContinuityPolicy: SharedSessionContinuityPolicy = Object.freeze({
  inspect: inspectFieldSharedSessionContinuity,
  policyId: FIELD_SHARED_SESSION_CONTINUITY_POLICY_ID,
});
