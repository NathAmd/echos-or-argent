import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { createCanonicalWildPokemon } from '../../game/encounters/wildPokemonGeneration'
import { createHgssLcrng } from '../../game/pokemon/hgssPokemonRng'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

probe('resolves every map encounter bank and the first reachable route tables from the ROM', async () => {
  const romBuffer = await readFile(romPath)
  const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
  const invalidReferences = inventory.resolvedMapCatalog.maps.flatMap((map) => {
    const bankId = map.header.wildEncounterBank
    return bankId === 0xff || inventory.wildEncounterCatalog[bankId]
      ? []
      : [{ mapId: map.id, bankId }]
  })
  expect(invalidReferences).toEqual([])

  const firstRoutes = [33, 34].map((mapId) => {
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === mapId)
    expect(map, `Carte ROM ${mapId} absente`).toBeDefined()
    const encounters = inventory.wildEncounterCatalog[map!.header.wildEncounterBank]
    expect(encounters, `Banque de rencontres absente pour ${map!.label}`).toBeDefined()
    expect(encounters.rates.walking).toBeGreaterThan(0)
    expect(encounters.land.morning).toHaveLength(12)
    expect(encounters.land.day).toHaveLength(12)
    expect(encounters.land.night).toHaveLength(12)
    const sample = encounters.land.day[0]!
    const generated = createCanonicalWildPokemon({
      speciesId: sample.speciesId,
      level: sample.level,
      catalog: inventory.pokemonCatalog,
      rng: createHgssLcrng(mapId),
      originalTrainer: { id: 0x12345678, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: sample.level, metTerrain: 0 },
    })
    expect(generated.moves.every(({ data }) => data.moveId >= 0)).toBe(true)
    expect(generated.currentHp).toBeGreaterThan(0)
    return {
      mapId,
      label: map!.label,
      bankId: encounters.bankId,
      walkingRate: encounters.rates.walking,
      grassTiles: map!.terrain
        ? Array.from(map!.terrain.attributes.entries())
          .filter(([, attribute]) => (attribute & 0xff) === 2 || (attribute & 0xff) === 3)
          .slice(0, 12)
          .map(([index, attribute]) => ({
            x: index % map!.terrain!.width,
            z: Math.floor(index / map!.terrain!.width),
            behavior: attribute & 0xff,
          }))
        : [],
      morning: encounters.land.morning.map((slot) => `${inventory.pokemonCatalog.speciesNames[slot.speciesId]} N.${slot.level}`),
      day: encounters.land.day.map((slot) => `${inventory.pokemonCatalog.speciesNames[slot.speciesId]} N.${slot.level}`),
      night: encounters.land.night.map((slot) => `${inventory.pokemonCatalog.speciesNames[slot.speciesId]} N.${slot.level}`),
      generated: {
        species: generated.speciesName,
        level: generated.level,
        nature: generated.nature,
        heldItemId: generated.heldItemId,
        moveIds: generated.moves.map(({ moveId }) => moveId),
      },
    }
  })
  console.log(JSON.stringify(firstRoutes, null, 2))
}, 120000)