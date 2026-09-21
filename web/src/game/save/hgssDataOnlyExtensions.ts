import { parseAllPokemonAccessibleStateV1 } from '../newGamePlus/modules/allPokemonAccessibleState'
import { decodeEeveeTeamRuntimeState } from '../newGamePlus/modules/eeveeTeamModule'
import { parseHardcoreStateV1 } from '../newGamePlus/modules/hardcoreState'
import { decodeMonotypeRuntimeState } from '../newGamePlus/modules/monotypeModule'
import { parseNuzlockeStateV1 } from '../newGamePlus/modules/nuzlockeState'
import { parsePermanentDeathStateV1 } from '../newGamePlus/modules/permanentDeathState'
import { decodeSoloRunRuntimeState } from '../newGamePlus/modules/soloRunModule'
import { parseVisibleWildPokemonStateV1 } from '../newGamePlus/modules/visibleWildPokemonState'
import { parsePortablePokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { parseHgssSharedCampaignSaveExtensionV1 } from './hgssSharedCampaignSaveExtension'
import type {
  VisibleWildEncounterMethod,
  VisibleWildPokemonStateV1,
} from '../newGamePlus/modules/visibleWildPokemonState'
import {
  isVersionedSaveExtensionsEnvelope,
  type JsonSaveValue,
  type VersionedSaveExtensions,
} from './versionedSaveExtensions'

const visibleWildActorIdPattern = /^ngp-visible-wild:(\d{1,5}):[0-9a-f]{16}$/
const visibleWildEncounterKeyPattern = /^hgss-vw([12]):[0-9a-f]{8}:(\d{1,5}):(\d{1,3}):(l|s):(m|d|n|x):(n|m|l|h|s):(n|a[0-9a-f]{8}):(\d{1,2})$/
const visibleSafariEncounterKeyPattern = /^hgss-vs1:[0-9a-f]{8}:(\d{1,5}):(l|s):(m|d|n):(\d{1,2}):([0-5]):(\d):(\d{1,3}):(\d{1,3}):(-?\d{1,7}):(-?\d{1,7}):[0-9a-f]{8}$/

type VisibleWildMachineKey = Readonly<{
  mapId: number
  encounterMethod: VisibleWildEncounterMethod
  speciesId?: number
  level?: number
}>

function requireCanonicalDecimal(raw: string, minimum: number, maximum: number, path: string): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum || String(value) !== raw) {
    throw new Error(`L’identifiant machine Pokémon visible est invalide à ${path}.`)
  }
  return value
}

function requireVisibleWildMachineKey(value: string, path: string): VisibleWildMachineKey {
  const wild = visibleWildEncounterKeyPattern.exec(value)
  if (wild) {
    const version = Number(wild[1])
    const mapId = requireCanonicalDecimal(wild[2]!, 0, 0xffff, `${path}.mapId`)
    requireCanonicalDecimal(wild[3]!, 0, 0xff, `${path}.encounterBankId`)
    const method = wild[4]!
    const time = wild[5]!
    if (method === 'l' ? time === 'x' : time !== 'x') {
      throw new Error(`La méthode de l’identifiant machine est incohérente à ${path}.`)
    }
    requireCanonicalDecimal(wild[8]!, 0, version === 1 ? 63 : 99, `${path}.logicalSlot`)
    return { mapId, encounterMethod: method === 'l' ? 'land' : 'surfing' }
  }

  const safari = visibleSafariEncounterKeyPattern.exec(value)
  if (safari) {
    const mapId = requireCanonicalDecimal(safari[1]!, 0, 0xffff, `${path}.mapId`)
    requireCanonicalDecimal(safari[4]!, 0, 11, `${path}.areaId`)
    requireCanonicalDecimal(safari[5]!, 0, 5, `${path}.areaSlot`)
    requireCanonicalDecimal(safari[6]!, 0, 9, `${path}.slotIndex`)
    const speciesId = requireCanonicalDecimal(safari[7]!, 1, 493, `${path}.speciesId`)
    const level = requireCanonicalDecimal(safari[8]!, 1, 100, `${path}.level`)
    requireCanonicalDecimal(safari[9]!, -1_000_000, 1_000_000, `${path}.worldTileX`)
    requireCanonicalDecimal(safari[10]!, -1_000_000, 1_000_000, `${path}.worldTileZ`)
    return { mapId, encounterMethod: 'safari', speciesId, level }
  }

  throw new Error(`La clé de rencontre machine est invalide à ${path}.`)
}

function parseDataOnlyVisibleWildPokemonState(value: unknown): VisibleWildPokemonStateV1 {
  const state = parseVisibleWildPokemonStateV1(value)
  state.actors.forEach((actor, index) => {
    const actorId = visibleWildActorIdPattern.exec(actor.id)
    if (!actorId) throw new Error(`L’identifiant d’acteur machine est invalide à actors[${index}].id.`)
    const actorMapId = requireCanonicalDecimal(actorId[1]!, 0, 0xffff, `actors[${index}].id.mapId`)
    const encounter = requireVisibleWildMachineKey(actor.encounterKey, `actors[${index}].encounterKey`)
    if (actorMapId !== actor.mapId
      || encounter.mapId !== actor.mapId
      || encounter.encounterMethod !== actor.encounterMethod
      || encounter.speciesId !== undefined && encounter.speciesId !== actor.speciesId
      || encounter.level !== undefined && encounter.level !== actor.level) {
      throw new Error(`L’acteur Pokémon visible est incohérent à actors[${index}].`)
    }
  })
  state.retiredEncounters.forEach((entry, index) => {
    const encounter = requireVisibleWildMachineKey(entry.encounterKey, `retiredEncounters[${index}].encounterKey`)
    if (encounter.mapId !== entry.mapId) {
      throw new Error(`La rencontre Pokémon visible retirée est incohérente à retiredEncounters[${index}].`)
    }
  })
  return state
}

function assertPortablePokemonReferences(value: JsonSaveValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPortablePokemonReferences(entry, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`
    if ((key === 'instanceId' || key === 'encounterInstanceId') && entry !== null) {
      parsePortablePokemonInstanceId(entry)
    } else if (key === 'deadPokemonInstanceIds') {
      if (!Array.isArray(entry)) throw new Error(`La liste d'instances Pokémon est invalide à ${entryPath}.`)
      entry.forEach((instanceId) => parsePortablePokemonInstanceId(instanceId))
    } else {
      assertPortablePokemonReferences(entry, entryPath)
    }
  }
}

const decoders: Readonly<Record<string, (value: unknown) => JsonSaveValue>> = Object.freeze({
  'multiplayer.shared-campaign': (value) => (
    parseHgssSharedCampaignSaveExtensionV1(value) as unknown as JsonSaveValue
  ),
  'new-game-plus.all-pokemon-accessible': (value) => parseAllPokemonAccessibleStateV1(value) as JsonSaveValue,
  'new-game-plus.eevee-team': (value) => decodeEeveeTeamRuntimeState(value) as JsonSaveValue,
  'new-game-plus.hardcore': (value) => parseHardcoreStateV1(value) as JsonSaveValue,
  'new-game-plus.monotype': (value) => decodeMonotypeRuntimeState(value) as JsonSaveValue,
  'new-game-plus.nuzlocke': (value) => parseNuzlockeStateV1(value) as JsonSaveValue,
  'new-game-plus.permanent-death': (value) => parsePermanentDeathStateV1(value) as JsonSaveValue,
  'new-game-plus.solo-run': (value) => decodeSoloRunRuntimeState(value) as JsonSaveValue,
  'new-game-plus.visible-wild-pokemon': (value) => parseDataOnlyVisibleWildPokemonState(value) as JsonSaveValue,
})

/** Refuse les contributeurs non enregistrés et recanonise chaque état connu. */
export function parseHgssDataOnlyExtensions(value: unknown): VersionedSaveExtensions {
  if (!isVersionedSaveExtensionsEnvelope(value)) throw new Error('Le bloc des extensions de sauvegarde est invalide.')
  const parsed: Record<string, { version: number, value: JsonSaveValue }> = {}
  for (const [key, entry] of Object.entries(value)) {
    const decode = decoders[key]
    if (!decode) throw new Error(`L’extension de sauvegarde « ${key} » n’est pas attestée data-only.`)
    if (entry.version !== 1) throw new Error(`La version ${entry.version} de l’extension « ${key} » est inconnue.`)
    const decoded = decode(entry.value)
    assertPortablePokemonReferences(decoded, `extensions.${key}.value`)
    parsed[key] = { version: 1, value: decoded }
  }
  return parsed
}
