import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { getHgssTmHmMoveId } from '../items/itemData'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

probe('decode les evolutions des starters depuis la ROM HeartGold francaise', async () => {
  const rom = await readFile(romPath)
  const inventory = await readRomInventory(new File([rom], basename(romPath)))

  expect(inventory.pokemonCatalog.evolutions[152]).toContainEqual({ method: 4, parameter: 16, targetSpeciesId: 153 })
  expect(inventory.pokemonCatalog.evolutions[153]).toContainEqual({ method: 4, parameter: 32, targetSpeciesId: 154 })
  expect(inventory.pokemonCatalog.evolutions[155]).toContainEqual({ method: 4, parameter: 14, targetSpeciesId: 156 })
  expect(inventory.pokemonCatalog.evolutions[158]).toContainEqual({ method: 4, parameter: 18, targetSpeciesId: 159 })

  // Les deux CT du dernier rapport (CT09 et CT39) utilisent la table ARM9
  // native et les bits de compatibilité de personal.narc.
  expect(getHgssTmHmMoveId(336)).toBe(331)
  expect(getHgssTmHmMoveId(366)).toBe(317)
  expect((inventory.pokemonCatalog.personalData[152]!.tmHmCompatibility[0] & (1 << 8)) !== 0).toBe(true)
  expect((inventory.pokemonCatalog.personalData[95]!.tmHmCompatibility[1] & (1 << 6)) !== 0).toBe(true)
}, 120_000)
