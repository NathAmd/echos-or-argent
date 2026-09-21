import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../../nds'
import type { VisibleWildWorldActor } from '../../world/dynamicWorldActorRegistry'
import { createWorldMapEntryReachability } from '../../world/worldMapEntryReachability'
import { createWorldSession, type WorldSessionExtensionPorts } from '../../world/worldSession'
import { createAllPokemonQuestWorldLocations } from './allPokemonQuestLocationPlanner'
import {
  createAllPokemonAccessibilityPlan,
  createAllPokemonEncounterMapSources,
  resolveAllPokemonNativeOneShotSpeciesIds,
  resolveAllPokemonRayquazaDisappearanceFlagId,
} from './allPokemonAccessibilityPlanner'

const defaultRomPath = fileURLToPath(new URL('../../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

const approachOffsets = Object.freeze({
  north: Object.freeze({ x: 0, z: 1 }),
  south: Object.freeze({ x: 0, z: -1 }),
  west: Object.freeze({ x: 1, z: 0 }),
  east: Object.freeze({ x: -1, z: 0 }),
})

describe('accessibilité ROM des autels Tous les Pokémon', () => {
  probe('garde chaque autel approchable depuis une entrée et activable par WorldSession', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const nativeOneShots = resolveAllPokemonNativeOneShotSpeciesIds(
      inventory.metadata.gameCode,
      inventory.mapEncounterLandmarks.landmarks,
    )
    expect(nativeOneShots).toEqual([144, 145, 146, 150, 243, 244, 245, 249, 250, 380, 382])
    expect(resolveAllPokemonRayquazaDisappearanceFlagId(
      inventory.mapEncounterLandmarks.landmarks,
    )).toBe(722)
    const accessibilityPlan = createAllPokemonAccessibilityPlan(
      inventory.pokemonCatalog,
      createAllPokemonEncounterMapSources(inventory.resolvedMapCatalog.maps),
      inventory.wildEncounterCatalog,
      {
        knownAccessibleSpeciesIds: nativeOneShots,
        transitiveOneShotEvidence: {
          gameCode: inventory.metadata.gameCode,
          landmarks: inventory.mapEncounterLandmarks.landmarks,
        },
      },
    )
    expect(accessibilityPlan.coveredSpeciesIds).toEqual(
      Array.from({ length: 493 }, (_, index) => index + 1),
    )
    expect(accessibilityPlan.quests.some(({ speciesId }) => speciesId === 384)).toBe(false)
    expect(accessibilityPlan.quests.some(({ speciesId }) => speciesId === 383)).toBe(true)
    const maps = inventory.resolvedMapCatalog.maps
    const locations = createAllPokemonQuestWorldLocations(maps)
    expect(locations).toHaveLength(12)

    const failures = locations.flatMap((location, index) => {
      const offset = approachOffsets[location.direction]
      const approachX = location.tileX + offset.x
      const approachZ = location.tileZ + offset.z
      const reachability = createWorldMapEntryReachability(maps, location.mapId)
      const actor: VisibleWildWorldActor = Object.freeze({
        id: `probe-all-pokemon:${index}`,
        kind: 'visible-wild',
        mapId: location.mapId,
        tileX: location.tileX,
        tileZ: location.tileZ,
        direction: location.direction,
        collision: 'blocking',
        interaction: 'action',
        speciesId: index + 1,
        form: 0,
        level: 5,
      })
      const actors = Object.freeze([actor])
      const extensionPorts: WorldSessionExtensionPorts = Object.freeze({
        dynamicActors: Object.freeze({
          getBlockingActorsAt: (mapId: number, tileX: number, tileZ: number, excludedActorId?: string) => (
            mapId === actor.mapId && tileX === actor.tileX && tileZ === actor.tileZ && excludedActorId !== actor.id
              ? actors
              : []
          ),
          getInteractableActorsAt: (mapId: number, tileX: number, tileZ: number) => (
            mapId === actor.mapId && tileX === actor.tileX && tileZ === actor.tileZ ? actors : []
          ),
        }),
      })
      const session = createWorldSession(
        maps, new Set(), new Set(), new Map(), undefined, new Set(), undefined, undefined, undefined, extensionPorts,
      )
      session.loadMap(location.mapId, approachX, approachZ, location.direction)
      const interaction = session.findDynamicActorInteraction()
      return reachability.isReachable(approachX, approachZ) && interaction?.id === actor.id
        ? []
        : [{ location, approachX, approachZ, entryTiles: reachability.entryTiles }]
    })

    expect(failures).toEqual([])
    expect(locations).not.toContainEqual(expect.objectContaining({ mapId: 7, tileX: 16, tileZ: 16 }))
  }, 120_000)
})
