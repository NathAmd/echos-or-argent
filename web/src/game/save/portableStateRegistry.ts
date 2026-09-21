import {
  isJsonSaveValue,
  type JsonSaveValue,
} from './versionedSaveExtensions'

export const PORTABLE_STATE_FORMAT = 'portable-state' as const
export const PORTABLE_STATE_WIRE_VERSION = 1 as const
export const MAX_PORTABLE_STATE_CONTRIBUTORS = 64
export const MAX_PORTABLE_STATE_KEY_LENGTH = 64

export type PortableStateEntry = Readonly<{
  version: number
  value: JsonSaveValue
}>

export type PortableStateWire = Readonly<{
  format: typeof PORTABLE_STATE_FORMAT
  version: typeof PORTABLE_STATE_WIRE_VERSION
  entries: Readonly<Record<string, PortableStateEntry>>
}>

declare const portableStateDocumentBrand: unique symbol

/** Document produit et décodé par un registre allowlisté dans cette session. */
export type PortableStateDocument = PortableStateWire & {
  readonly [portableStateDocumentBrand]: true
}

type PortableStateRegistryProof = Readonly<{ registry: 'portable-state-registry' }>

const portableStateDocumentProofs = new WeakMap<object, PortableStateRegistryProof>()

/** Une copie JSON structurellement valide ne possède volontairement pas cette provenance. */
export function isPortableStateDocument(value: unknown): value is PortableStateDocument {
  return value !== null && typeof value === 'object' && portableStateDocumentProofs.has(value)
}

export type PortableStateContributor<TProjectContext, THydrateContext> = Readonly<{
  key: string
  version: number
  project: (context: TProjectContext) => JsonSaveValue | undefined
  decode: (value: JsonSaveValue) => JsonSaveValue
  hydrate: (context: THydrateContext, value: JsonSaveValue) => void
}>

export type PortableStateContributorDefinition<
  TProjectContext,
  THydrateContext,
  TValue extends JsonSaveValue,
> = Readonly<{
  key: string
  version: number
  project: (context: TProjectContext) => TValue | undefined
  /** Must reject unknown fields and every unsupported representation. */
  decode: (value: JsonSaveValue) => TValue
  hydrate: (context: THydrateContext, value: TValue) => void
}>

export type PortableStateRegistry<TProjectContext, THydrateContext> = Readonly<{
  keys: readonly string[]
  project: (context: TProjectContext) => PortableStateDocument
  validate: (value: unknown) => value is PortableStateWire
  decode: (value: unknown) => PortableStateDocument
  owns: (value: unknown) => value is PortableStateDocument
  /**
   * Applique les contributeurs uniquement à un brouillon isolé. Un hydrateur peut
   * échouer après un précédent : l’appelant ne doit publier le brouillon qu’après succès.
   */
  hydrateDraft: (draft: THydrateContext, value: unknown) => void
}>

const portableStateKeyPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function requireContributorIdentity(key: string, version: number): void {
  if (
    key.length > MAX_PORTABLE_STATE_KEY_LENGTH
    || !portableStateKeyPattern.test(key)
  ) {
    throw new Error(`La clé d’état portable « ${key} » est invalide.`)
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`La version du contributeur d’état portable « ${key} » est invalide.`)
  }
}

function cloneAndFreezeJson(value: JsonSaveValue): JsonSaveValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreezeJson(entry)))
  }
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneAndFreezeJson(entry)]),
    ))
  }
  return value
}

function decodeContributorValue<TProjectContext, THydrateContext>(
  contributor: PortableStateContributor<TProjectContext, THydrateContext>,
  value: JsonSaveValue,
): JsonSaveValue {
  const isolatedValue = cloneAndFreezeJson(value)
  let decoded: JsonSaveValue
  try {
    decoded = contributor.decode(isolatedValue)
  } catch {
    throw new Error(`La valeur d’état portable « ${contributor.key} » est invalide.`)
  }
  if (!isJsonSaveValue(decoded)) {
    throw new Error(`La valeur décodée d’état portable « ${contributor.key} » est invalide.`)
  }
  return cloneAndFreezeJson(decoded)
}

export function definePortableStateContributor<
  TProjectContext,
  THydrateContext,
  TValue extends JsonSaveValue,
>(
  definition: PortableStateContributorDefinition<TProjectContext, THydrateContext, TValue>,
): PortableStateContributor<TProjectContext, THydrateContext> {
  requireContributorIdentity(definition.key, definition.version)
  return Object.freeze({
    key: definition.key,
    version: definition.version,
    project: definition.project,
    decode: (value: JsonSaveValue): JsonSaveValue => definition.decode(value),
    hydrate: (context: THydrateContext, value: JsonSaveValue): void => {
      definition.hydrate(context, value as TValue)
    },
  })
}

type DecodedPortableState<TProjectContext, THydrateContext> = Readonly<{
  wire: PortableStateDocument
  entries: readonly Readonly<{
    contributor: PortableStateContributor<TProjectContext, THydrateContext>
    value: JsonSaveValue
  }>[]
}>

function freezeWire(entries: readonly Readonly<{
  key: string
  version: number
  value: JsonSaveValue
}>[], proof: PortableStateRegistryProof): PortableStateDocument {
  const entriesRecord = Object.freeze(Object.fromEntries(entries.map((entry) => [
    entry.key,
    Object.freeze({ version: entry.version, value: entry.value }),
  ])))
  const document = Object.freeze({
    format: PORTABLE_STATE_FORMAT,
    version: PORTABLE_STATE_WIRE_VERSION,
    entries: entriesRecord,
  }) as PortableStateDocument
  portableStateDocumentProofs.set(document, proof)
  return document
}

function decodePortableState<TProjectContext, THydrateContext>(
  value: unknown,
  contributorsByKey: ReadonlyMap<string, PortableStateContributor<TProjectContext, THydrateContext>>,
  proof: PortableStateRegistryProof,
): DecodedPortableState<TProjectContext, THydrateContext> {
  if (!isJsonSaveValue(value) || !isPlainRecord(value)) {
    throw new Error('La projection d’état portable est invalide.')
  }
  if (!hasExactKeys(value, ['entries', 'format', 'version'])) {
    throw new Error('Les champs de la projection d’état portable sont invalides.')
  }
  if (value.format !== PORTABLE_STATE_FORMAT || value.version !== PORTABLE_STATE_WIRE_VERSION) {
    throw new Error('La version de la projection d’état portable est inconnue.')
  }
  if (!isPlainRecord(value.entries)) {
    throw new Error('Les entrées de la projection d’état portable sont invalides.')
  }

  const keys = Object.keys(value.entries).sort()
  if (keys.length > MAX_PORTABLE_STATE_CONTRIBUTORS) {
    throw new Error('La projection d’état portable contient trop de contributeurs.')
  }

  const decodedEntries: Array<{
    contributor: PortableStateContributor<TProjectContext, THydrateContext>
    value: JsonSaveValue
  }> = []
  const wireEntries: Array<{ key: string, version: number, value: JsonSaveValue }> = []
  for (const key of keys) {
    requireContributorIdentity(key, 1)
    const contributor = contributorsByKey.get(key)
    if (!contributor) throw new Error(`Le contributeur d’état portable « ${key} » est inconnu.`)

    const entry = value.entries[key]
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ['value', 'version'])) {
      throw new Error(`L’entrée d’état portable « ${key} » est invalide.`)
    }
    if (entry.version !== contributor.version) {
      throw new Error(`La version ${String(entry.version)} du contributeur d’état portable « ${key} » est inconnue.`)
    }
    if (!isJsonSaveValue(entry.value)) {
      throw new Error(`La valeur d’état portable « ${key} » n’est pas du JSON strict.`)
    }

    const decodedValue = decodeContributorValue(contributor, entry.value)
    decodedEntries.push({ contributor, value: decodedValue })
    wireEntries.push({ key, version: contributor.version, value: decodedValue })
  }

  return Object.freeze({
    wire: freezeWire(wireEntries, proof),
    entries: Object.freeze(decodedEntries.map((entry) => Object.freeze(entry))),
  })
}

export function createPortableStateRegistry<TProjectContext, THydrateContext = TProjectContext>(
  contributors: readonly PortableStateContributor<TProjectContext, THydrateContext>[],
): PortableStateRegistry<TProjectContext, THydrateContext> {
  if (contributors.length > MAX_PORTABLE_STATE_CONTRIBUTORS) {
    throw new Error(`Un registre d’état portable accepte au maximum ${MAX_PORTABLE_STATE_CONTRIBUTORS} contributeurs.`)
  }

  const contributorsByKey = new Map<string, PortableStateContributor<TProjectContext, THydrateContext>>()
  for (const contributor of contributors) {
    requireContributorIdentity(contributor.key, contributor.version)
    if (contributorsByKey.has(contributor.key)) {
      throw new Error(`La clé d’état portable « ${contributor.key} » est déclarée plusieurs fois.`)
    }
    contributorsByKey.set(contributor.key, Object.freeze({ ...contributor }))
  }

  const orderedContributors = Object.freeze([...contributorsByKey.values()].sort((left, right) => (
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  )))
  const keys = Object.freeze(orderedContributors.map((contributor) => contributor.key))
  const proof: PortableStateRegistryProof = Object.freeze({ registry: 'portable-state-registry' })

  return Object.freeze({
    keys,
    project(context: TProjectContext): PortableStateDocument {
      const entries: Array<{ key: string, version: number, value: JsonSaveValue }> = []
      for (const contributor of orderedContributors) {
        const projected = contributor.project(context)
        if (projected === undefined) continue
        if (!isJsonSaveValue(projected)) {
          throw new Error(`La valeur projetée d’état portable « ${contributor.key} » n’est pas du JSON strict.`)
        }
        entries.push({
          key: contributor.key,
          version: contributor.version,
          value: decodeContributorValue(contributor, projected),
        })
      }
      return freezeWire(entries, proof)
    },
    validate(value: unknown): value is PortableStateWire {
      try {
        decodePortableState(value, contributorsByKey, proof)
        return true
      } catch {
        return false
      }
    },
    decode(value: unknown): PortableStateDocument {
      return decodePortableState(value, contributorsByKey, proof).wire
    },
    owns(value: unknown): value is PortableStateDocument {
      return value !== null && typeof value === 'object' && portableStateDocumentProofs.get(value) === proof
    },
    hydrateDraft(draft: THydrateContext, value: unknown): void {
      const decoded = decodePortableState(value, contributorsByKey, proof)
      for (const entry of decoded.entries) {
        entry.contributor.hydrate(draft, entry.value)
      }
    },
  })
}
