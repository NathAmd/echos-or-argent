import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { isSurfableMetatile, isWaterfallMetatile } from '../player/hgssPlayerMovement'
import {
  prepareHgssSafariEncounter,
  resolveHgssSafariEncounterTimeByHour,
} from '../safari/hgssSafariEncounters'
import { resolveHgssSafariAreaCellAtWorldPosition } from '../safari/hgssSafariMap'
import { createHgssSafariState } from '../safari/hgssSafariState'
import { baseGameplayExtensionPorts } from '../extensions/gameplayExtensionPorts'
import { resolveHgssVisibleSafariEncounterCandidate } from '../encounters/hgssVisibleSafariEncounterCandidates'
import { getMapOrigin } from '../world/mapCoordinates'
import { createVisibleWildPokemonRuntime } from './modules/visibleWildPokemonRule'
import { visibleWildPokemonModuleId } from './modules/visibleWildPokemonModule'
import { createNewGamePlusDynamicPokemonWorldHost } from './newGamePlusDynamicPokemonWorldHost'
import type { NewGamePlusGameplayRuntime } from './newGamePlusGameplayRuntime'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('deplacement des Pokemon visibles sur le Safari ROM reel', () => {
  probe('reste sur la surface, dans l areaSlot et hors evenements pendant 1 000 ticks', async () => {
    const inventory = await readRomInventory(new File([await readFile(romPath)], basename(romPath)))
    const source = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 357)
    expect(source).toBeDefined()
    const safariZone = createHgssSafariState(0)
    const areaSet = safariZone.areaSets[0]
    const map = inventory.mapVariantResolver?.(source!, {
      weekday: 1, rocketHideoutCleared: false, safariZone, playerGender: 'male',
    })
    expect(map?.terrain).toBeDefined()
    const visible = createVisibleWildPokemonRuntime({
      seed: 'safari-visible-movement-rom-probe', actorsPerMap: 8, includeSafari: true, movement: 'wander',
    })
    const runtime = {
      profile: {} as never,
      ports: baseGameplayExtensionPorts,
      applyFieldStateMigrations: () => undefined,
      snapshotExtensions: () => undefined,
      getModuleRuntime: (moduleId: string) => moduleId === visibleWildPokemonModuleId ? visible : undefined,
    } satisfies NewGamePlusGameplayRuntime
    const host = createNewGamePlusDynamicPokemonWorldHost({
      readRuntime: () => runtime,
      readContext: () => ({
        map: map!, encounterCatalog: inventory.wildEncounterCatalog, hour: 12,
        radioEffect: 'none', massOutbreak: { active: false, randomValue: 0 }, isSafari: true,
        prepareSafariEncounter: (request) => {
          const area = resolveHgssSafariAreaCellAtWorldPosition(areaSet, request.worldTileX, request.worldTileZ)
          if (!area) return undefined
          const native = prepareHgssSafariEncounter(
            inventory.safariEncounterCatalog, areaSet, area.areaSlot, request.method,
            resolveHgssSafariEncounterTimeByHour(request.hour), request.rng,
          )
          return { ...native, method: 'safari', safariMethod: native.method }
        },
        isTileBlocked: () => false,
      }),
      renderActors: () => undefined,
      startPreparedWildEncounter: () => false,
      startQuestWildEncounter: () => false,
    })
    const origin = getMapOrigin(map!)
    const eventTiles = new Set([
      ...(map!.events?.objects ?? []),
      ...(map!.events?.warps ?? []),
      ...(map!.events?.backgrounds ?? []),
      ...(map!.events?.coordinateEvents ?? []),
    ].map(({ x, z }) => `${x - origin.x}:${z - origin.z}`))
    const spawned = host.syncCurrentMap()
    expect(spawned.length).toBeGreaterThan(0)

    for (let tick = 0; tick < 1_000; tick += 1) for (const actor of host.advanceMovement()) {
      const interaction = visible.getInteraction(actor.id)!
      const encounter = resolveHgssVisibleSafariEncounterCandidate(
        { seed: visible.config.seed, map: map! }, interaction.encounterKey,
      )!.prepared.encounter
      if (encounter.method !== 'safari') throw new Error('Rencontre Safari attendue.')
      const attribute = map!.terrain!.attributes[actor.tileZ * map!.terrain!.width + actor.tileX]
      const area = resolveHgssSafariAreaCellAtWorldPosition(
        areaSet, origin.x + actor.tileX, origin.z + actor.tileZ,
      )
      expect(actor.tileX).toBeGreaterThanOrEqual(0)
      expect(actor.tileX).toBeLessThan(map!.terrain!.width)
      expect(actor.tileZ).toBeGreaterThanOrEqual(0)
      expect(actor.tileZ).toBeLessThan(map!.terrain!.height)
      expect(eventTiles.has(`${actor.tileX}:${actor.tileZ}`)).toBe(false)
      expect(area?.areaSlot).toBe(encounter.areaSlot)
      expect(encounter.safariMethod === 'surf'
        ? isSurfableMetatile(attribute) && !isWaterfallMetatile(attribute)
        : !isSurfableMetatile(attribute) && !isWaterfallMetatile(attribute) && (attribute! & 0x8000) === 0)
        .toBe(true)
    }
  }, 180_000)
})
