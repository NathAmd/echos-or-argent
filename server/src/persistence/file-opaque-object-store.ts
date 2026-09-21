import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  ciphertextByteLength,
  isObjectId,
  isObjectMutation,
  isObjectRevision,
  LEGACY_OBJECT_MUTATION,
  MAX_OBJECTS_PER_USER,
  MAX_USER_CIPHERTEXT_BYTES,
  type OpaqueObjectEnvelope,
  type OpaqueObjectStore,
  type OpaqueObjectWriteCondition,
  type OpaqueObjectWriteResult,
  parseOpaqueObjectEnvelope,
  type StoredOpaqueObject,
} from "../domain/opaque-objects.js";
import { ServiceError } from "../errors.js";
import { isUserId, requireExactObject } from "../validation.js";

const MAX_STORED_RECORD_BYTES = 1536 * 1024;
// Les temporaires sont filtrés séparément : le quota métier complet doit rester
// lisible afin que le 64e objet puisse encore être remplacé ou supprimé.
const MAX_DIRECTORY_ENTRIES = MAX_OBJECTS_PER_USER;
const RECORD_SUFFIX = ".json";
const TEMPORARY_FILE_PATTERN = /^\.tmp-[0-9]+-[0-9a-f-]{36}$/;
const CLOCK_FILE = ".opaque-mutation-clock.json";
const MAX_CLOCK_RECORD_BYTES = 256;

interface PersistedMutationClock {
  readonly lastMutation: string;
  readonly storageVersion: 1;
}

interface PersistedOpaqueObjectV1 {
  readonly envelope: OpaqueObjectEnvelope;
  readonly revision: string;
  readonly storageVersion: 1;
}

interface PersistedOpaqueObjectV2 {
  readonly envelope: OpaqueObjectEnvelope;
  readonly mutation: string;
  readonly revision: string;
  readonly storageVersion: 2;
}

type PersistedOpaqueObject = PersistedOpaqueObjectV1 | PersistedOpaqueObjectV2;

const parsePersistedObject = (value: unknown): PersistedOpaqueObject => {
  try {
    const record = requireExactObject(value, ["storageVersion", "revision", "envelope", "mutation"]);
    const versionOne = record.storageVersion === 1
      && Object.keys(record).length === 3
      && !Object.hasOwn(record, "mutation");
    const versionTwo = record.storageVersion === 2
      && Object.keys(record).length === 4
      && isObjectMutation(record.mutation);
    if (!versionOne && !versionTwo) {
      throw new Error("Stored object has an unsupported format");
    }
    if (!isObjectRevision(record.revision)) {
      throw new Error("Stored object has an invalid revision");
    }
    const envelope = parseOpaqueObjectEnvelope(record.envelope);
    const revision = record.revision;
    return versionTwo
      ? { envelope, mutation: record.mutation as string, revision, storageVersion: 2 }
      : { envelope, revision, storageVersion: 1 };
  } catch {
    throw new Error("Object store contains an invalid record");
  }
};

const cloneStoredObject = (record: PersistedOpaqueObject): StoredOpaqueObject => ({
  envelope: { ...record.envelope },
  mutation: record.storageVersion === 2 ? record.mutation : LEGACY_OBJECT_MUTATION,
  revision: record.revision,
});

const preconditionFailed = (): ServiceError =>
  new ServiceError(412, "PRECONDITION_FAILED", "Object revision condition failed");

export class FileOpaqueObjectStore implements OpaqueObjectStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly rootDirectory: string,
    private readonly options: Readonly<{ now?: () => number }> = {},
  ) {
    if (rootDirectory.trim() === "") {
      throw new Error("Object store directory cannot be empty");
    }
  }

  async get(userId: string, objectId: string): Promise<StoredOpaqueObject | null> {
    this.requireKeys(userId, objectId);
    if (!(await this.hasSafeUserDirectory(userId))) {
      return null;
    }
    const record = await this.readRecord(this.recordPath(userId, objectId));
    return record === null ? null : cloneStoredObject(record);
  }

  async put(
    userId: string,
    objectId: string,
    envelope: OpaqueObjectEnvelope,
    condition: OpaqueObjectWriteCondition,
  ): Promise<OpaqueObjectWriteResult> {
    this.requireKeys(userId, objectId);
    const validatedEnvelope = parseOpaqueObjectEnvelope(envelope);
    return this.withMutation(async () => {
      const records = await this.listUserRecords(userId);
      const existing = records.get(objectId) ?? null;
      this.requireWriteCondition(existing, condition);

      const newSize = ciphertextByteLength(validatedEnvelope);
      const currentSize = existing === null ? 0 : ciphertextByteLength(existing.envelope);
      const totalSize = [...records.values()].reduce(
        (total, record) => total + ciphertextByteLength(record.envelope),
        0,
      );
      if (existing === null && records.size >= MAX_OBJECTS_PER_USER) {
        throw new ServiceError(413, "QUOTA_EXCEEDED", "Object count quota exceeded");
      }
      if (totalSize - currentSize + newSize > MAX_USER_CIPHERTEXT_BYTES) {
        throw new ServiceError(413, "QUOTA_EXCEEDED", "Object storage quota exceeded");
      }

      const revision = randomBytes(16).toString("hex");
      const mutation = await this.advanceMutationClock();
      const stored: PersistedOpaqueObjectV2 = {
        envelope: validatedEnvelope,
        mutation,
        revision,
        storageVersion: 2,
      };
      await this.writeRecord(userId, objectId, stored);
      return { created: existing === null, mutation, revision };
    });
  }

  async delete(userId: string, objectId: string, revision: string): Promise<void> {
    this.requireKeys(userId, objectId);
    if (!isObjectRevision(revision)) {
      throw new Error("Object revision is invalid");
    }
    await this.withMutation(async () => {
      const path = this.recordPath(userId, objectId);
      if (!(await this.hasSafeUserDirectory(userId))) {
        throw preconditionFailed();
      }
      const existing = await this.readRecord(path);
      if (existing === null || existing.revision !== revision) {
        throw preconditionFailed();
      }
      await this.advanceMutationClock();
      await unlink(path);
      await this.syncDirectory(this.userDirectory(userId));
    });
  }

  private requireKeys(userId: string, objectId: string): void {
    if (!isUserId(userId) || !isObjectId(objectId)) {
      throw new Error("Object store key is invalid");
    }
  }

  private userDirectory(userId: string): string {
    return join(this.rootDirectory, userId);
  }

  private recordPath(userId: string, objectId: string): string {
    return join(this.userDirectory(userId), `${objectId}${RECORD_SUFFIX}`);
  }

  private async hasSafeUserDirectory(userId: string): Promise<boolean> {
    let metadata;
    try {
      metadata = await lstat(this.userDirectory(userId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Object store user path is not a regular directory");
    }
    return true;
  }

  private async readRecord(path: string): Promise<PersistedOpaqueObject | null> {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_STORED_RECORD_BYTES) {
        throw new Error("Object store record is not a regular bounded file");
      }
      const contents = await handle.readFile({ encoding: "utf8" });
      let parsed: unknown;
      try {
        parsed = JSON.parse(contents) as unknown;
      } catch {
        throw new Error("Object store record contains invalid JSON");
      }
      return parsePersistedObject(parsed);
    } finally {
      await handle.close();
    }
  }

  private async listUserRecords(userId: string): Promise<Map<string, PersistedOpaqueObject>> {
    const directory = this.userDirectory(userId);
    if (!(await this.hasSafeUserDirectory(userId))) {
      return new Map();
    }
    const entries = await readdir(directory, { withFileTypes: true });
    const recordEntries = entries.filter((entry) => !TEMPORARY_FILE_PATTERN.test(entry.name));
    if (recordEntries.length > MAX_DIRECTORY_ENTRIES) {
      throw new Error("Object store user directory has too many entries");
    }
    let removedTemporaryFile = false;
    for (const entry of entries) {
      if (TEMPORARY_FILE_PATTERN.test(entry.name)) {
        await rm(join(directory, entry.name), { force: true });
        removedTemporaryFile = true;
      }
    }
    if (removedTemporaryFile) {
      await this.syncDirectory(directory);
    }
    const records = new Map<string, PersistedOpaqueObject>();
    for (const entry of recordEntries) {
      if (!entry.isFile() || !entry.name.endsWith(RECORD_SUFFIX)) {
        throw new Error("Object store user directory contains an unexpected entry");
      }
      const objectId = entry.name.slice(0, -RECORD_SUFFIX.length);
      if (!isObjectId(objectId) || records.has(objectId)) {
        throw new Error("Object store user directory contains an invalid entry");
      }
      const record = await this.readRecord(join(directory, entry.name));
      if (record === null) {
        throw new Error("Object store changed during a serialized mutation");
      }
      records.set(objectId, record);
    }
    return records;
  }

  private requireWriteCondition(
    existing: PersistedOpaqueObject | null,
    condition: OpaqueObjectWriteCondition,
  ): void {
    if (condition.kind === "create") {
      if (existing !== null) {
        throw preconditionFailed();
      }
      return;
    }
    if (
      condition.kind !== "match" ||
      !isObjectRevision(condition.revision) ||
      existing === null ||
      existing.revision !== condition.revision
    ) {
      throw preconditionFailed();
    }
  }

  private async writeRecord(
    userId: string,
    objectId: string,
    record: PersistedOpaqueObject,
  ): Promise<void> {
    const directory = this.userDirectory(userId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await this.hasSafeUserDirectory(userId))) {
      throw new Error("Object store user directory could not be created");
    }
    const serialized = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_RECORD_BYTES) {
      throw new Error("Object store record exceeds its persisted size limit");
    }
    const temporaryPath = join(directory, `.tmp-${process.pid}-${randomUUID()}`);
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.recordPath(userId, objectId));
      await this.syncDirectory(directory);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async syncDirectory(directory: string): Promise<void> {
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  }

  private async readMutationClock(): Promise<PersistedMutationClock | null> {
    const path = join(this.rootDirectory, CLOCK_FILE);
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_CLOCK_RECORD_BYTES) {
        throw new Error("Object store mutation clock is not a regular bounded file");
      }
      const parsed = JSON.parse(await handle.readFile({ encoding: "utf8" })) as unknown;
      const record = requireExactObject(parsed, ["storageVersion", "lastMutation"]);
      if (
        Object.keys(record).length !== 2
        || record.storageVersion !== 1
        || !isObjectMutation(record.lastMutation)
      ) throw new Error("Object store mutation clock is invalid");
      return { storageVersion: 1, lastMutation: record.lastMutation };
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("Object store mutation clock is invalid");
      throw error;
    } finally {
      await handle.close();
    }
  }

  private async advanceMutationClock(): Promise<string> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.rootDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Object store root is not a regular directory");
    }
    const previous = await this.readMutationClock();
    const previousMutation = previous?.lastMutation ?? LEGACY_OBJECT_MUTATION;
    const previousPhysical = BigInt(`0x${previousMutation.slice(0, 16)}`);
    const previousLogical = BigInt(`0x${previousMutation.slice(16)}`);
    const sampled = this.options.now?.() ?? Date.now();
    if (!Number.isSafeInteger(sampled) || sampled < 0) {
      throw new Error("Object store clock returned an invalid time");
    }
    const sampledPhysical = BigInt(sampled);
    const physical = sampledPhysical > previousPhysical ? sampledPhysical : previousPhysical;
    const logical = sampledPhysical > previousPhysical ? 0n : previousLogical + 1n;
    if (physical > 0xffffffffffffffffn || logical > 0xffffffffffffffffn) {
      throw new Error("Object store mutation clock is exhausted");
    }
    const mutation = `${physical.toString(16).padStart(16, "0")}${logical.toString(16).padStart(16, "0")}`;
    await this.writeMutationClock({ storageVersion: 1, lastMutation: mutation });
    return mutation;
  }

  private async writeMutationClock(record: PersistedMutationClock): Promise<void> {
    const serialized = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_CLOCK_RECORD_BYTES) {
      throw new Error("Object store mutation clock exceeds its size limit");
    }
    const temporaryPath = join(
      this.rootDirectory,
      `.opaque-mutation-clock.tmp-${process.pid}-${randomUUID()}`,
    );
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, join(this.rootDirectory, CLOCK_FILE));
      await this.syncDirectory(this.rootDirectory);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release: () => void = () => undefined;
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
