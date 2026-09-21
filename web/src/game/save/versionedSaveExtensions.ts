export type JsonSavePrimitive = null | boolean | number | string
export type JsonSaveArray = readonly JsonSaveValue[]
export type JsonSaveObject = { readonly [key: string]: JsonSaveValue }
export type JsonSaveValue = JsonSavePrimitive | JsonSaveArray | JsonSaveObject

export type VersionedSaveExtensionEntry = Readonly<{
  version: number
  value: JsonSaveValue
}>

export type VersionedSaveExtensions = Readonly<Record<string, VersionedSaveExtensionEntry>>

export type VersionedSaveExtensionContributor<TSaveContext, TLoadContext> = Readonly<{
  key: string
  version: number
  save: (context: TSaveContext) => JsonSaveValue | undefined
  validate: (value: JsonSaveValue) => boolean
  load: (context: TLoadContext, value: JsonSaveValue) => void
}>

export type VersionedSaveExtensionDefinition<
  TSaveContext,
  TLoadContext,
  TValue extends JsonSaveValue,
> = Readonly<{
  key: string
  version: number
  save: (context: TSaveContext) => TValue | undefined
  validate: (value: unknown) => value is TValue
  load: (context: TLoadContext, value: TValue) => void
}>

export type VersionedSaveExtensionRegistry<TSaveContext, TLoadContext> = Readonly<{
  keys: readonly string[]
  save: (context: TSaveContext) => VersionedSaveExtensions
  validate: (value: unknown) => value is VersionedSaveExtensions | undefined
  load: (context: TLoadContext, value: unknown) => void
}>

const extensionKeyPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonSaveValueAt(value: unknown, ancestors: Set<object>): value is JsonSaveValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object') return false
  if (ancestors.has(value)) return false

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false
      const keys = Reflect.ownKeys(value)
      if (keys.length !== value.length + 1 || keys[value.length] !== 'length') return false
      for (let index = 0; index < value.length; index += 1) {
        if (keys[index] !== String(index) || !isJsonSaveValueAt(value[index], ancestors)) return false
      }
      return true
    }

    if (!isPlainRecord(value)) return false
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return false
      if (!isJsonSaveValueAt(descriptor.value, ancestors)) return false
    }
    return true
  } finally {
    ancestors.delete(value)
  }
}

/** Returns true only for values JSON can preserve without coercion or omission. */
export function isJsonSaveValue(value: unknown): value is JsonSaveValue {
  return isJsonSaveValueAt(value, new Set<object>())
}

function requireContributorIdentity(key: string, version: number): void {
  if (!extensionKeyPattern.test(key)) {
    throw new Error(`La clé d’extension de sauvegarde « ${key} » est invalide.`)
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`La version de l’extension de sauvegarde « ${key} » est invalide.`)
  }
}

/** Validation structurelle commune, indépendante des modules installés. */
export function isVersionedSaveExtensionsEnvelope(value: unknown): value is VersionedSaveExtensions {
  if (!isJsonSaveValue(value) || !isPlainRecord(value)) return false
  return Object.entries(value).every(([key, entry]) => {
    if (!extensionKeyPattern.test(key) || !isPlainRecord(entry)) return false
    const keys = Object.keys(entry).sort()
    return keys.length === 2
      && keys[0] === 'value'
      && keys[1] === 'version'
      && Number.isSafeInteger(entry.version)
      && (entry.version as number) >= 1
      && isJsonSaveValue(entry.value)
  })
}

function cloneJsonSaveValue(value: JsonSaveValue): JsonSaveValue {
  if (Array.isArray(value)) return value.map(cloneJsonSaveValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJsonSaveValue(entry)]))
  }
  return value
}

export function cloneVersionedSaveExtensions(value: VersionedSaveExtensions): VersionedSaveExtensions {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, {
    version: entry.version,
    value: cloneJsonSaveValue(entry.value),
  }]))
}

function acceptsValue<TSaveContext, TLoadContext>(
  contributor: VersionedSaveExtensionContributor<TSaveContext, TLoadContext>,
  value: JsonSaveValue,
): boolean {
  try {
    return contributor.validate(value)
  } catch {
    return false
  }
}

export function defineVersionedSaveExtension<
  TSaveContext,
  TLoadContext,
  TValue extends JsonSaveValue,
>(
  definition: VersionedSaveExtensionDefinition<TSaveContext, TLoadContext, TValue>,
): VersionedSaveExtensionContributor<TSaveContext, TLoadContext> {
  requireContributorIdentity(definition.key, definition.version)
  return Object.freeze({
    key: definition.key,
    version: definition.version,
    save: definition.save,
    validate: definition.validate,
    load: (context: TLoadContext, value: JsonSaveValue) => definition.load(context, value as TValue),
  })
}

type DecodedSaveExtension<TSaveContext, TLoadContext> = Readonly<{
  contributor: VersionedSaveExtensionContributor<TSaveContext, TLoadContext>
  value: JsonSaveValue
}>

function decodeExtensions<TSaveContext, TLoadContext>(
  value: unknown,
  contributorsByKey: ReadonlyMap<string, VersionedSaveExtensionContributor<TSaveContext, TLoadContext>>,
): readonly DecodedSaveExtension<TSaveContext, TLoadContext>[] {
  if (!isJsonSaveValue(value) || !isPlainRecord(value)) {
    throw new Error('Le bloc des extensions de sauvegarde est invalide.')
  }

  const decoded: DecodedSaveExtension<TSaveContext, TLoadContext>[] = []
  for (const key of Object.keys(value).sort()) {
    const contributor = contributorsByKey.get(key)
    if (!contributor) throw new Error(`L’extension de sauvegarde « ${key} » est inconnue.`)

    const entry = value[key]
    if (!isPlainRecord(entry)) throw new Error(`L’extension de sauvegarde « ${key} » est invalide.`)
    const entryKeys = Object.keys(entry).sort()
    if (entryKeys.length !== 2 || entryKeys[0] !== 'value' || entryKeys[1] !== 'version') {
      throw new Error(`L’extension de sauvegarde « ${key} » est invalide.`)
    }
    if (entry.version !== contributor.version) {
      throw new Error(`La version ${String(entry.version)} de l’extension de sauvegarde « ${key} » est inconnue.`)
    }
    if (!isJsonSaveValue(entry.value) || !acceptsValue(contributor, entry.value)) {
      throw new Error(`La valeur de l’extension de sauvegarde « ${key} » est invalide.`)
    }
    decoded.push({ contributor, value: entry.value })
  }
  return decoded
}

export function createVersionedSaveExtensionRegistry<TSaveContext, TLoadContext = TSaveContext>(
  contributors: readonly VersionedSaveExtensionContributor<TSaveContext, TLoadContext>[],
): VersionedSaveExtensionRegistry<TSaveContext, TLoadContext> {
  const contributorsByKey = new Map<string, VersionedSaveExtensionContributor<TSaveContext, TLoadContext>>()
  for (const contributor of contributors) {
    requireContributorIdentity(contributor.key, contributor.version)
    if (contributorsByKey.has(contributor.key)) {
      throw new Error(`La clé d’extension de sauvegarde « ${contributor.key} » est déclarée plusieurs fois.`)
    }
    contributorsByKey.set(contributor.key, Object.freeze({ ...contributor }))
  }

  const orderedContributors = [...contributorsByKey.values()].sort((left, right) => (
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  ))
  const keys = Object.freeze(orderedContributors.map((contributor) => contributor.key))

  return Object.freeze({
    keys,
    save(context: TSaveContext): VersionedSaveExtensions {
      const extensions: Record<string, VersionedSaveExtensionEntry> = {}
      for (const contributor of orderedContributors) {
        const value = contributor.save(context)
        if (value === undefined) continue
        if (!isJsonSaveValue(value) || !acceptsValue(contributor, value)) {
          throw new Error(`La valeur produite par l’extension de sauvegarde « ${contributor.key} » est invalide.`)
        }
        extensions[contributor.key] = { version: contributor.version, value }
      }
      return extensions
    },
    validate(value: unknown): value is VersionedSaveExtensions | undefined {
      if (value === undefined) return true
      try {
        decodeExtensions(value, contributorsByKey)
        return true
      } catch {
        return false
      }
    },
    load(context: TLoadContext, value: unknown): void {
      if (value === undefined) return
      const decoded = decodeExtensions(value, contributorsByKey)
      for (const extension of decoded) extension.contributor.load(context, extension.value)
    },
  })
}
