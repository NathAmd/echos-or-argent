import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { getPokemonMachineDisplayName } from './pokemonMachineDisplayName'
import { getHgssPokemonMachine, hgssFirstHmItemId, hgssFirstTmItemId, hgssLastHmItemId } from './usePokemonMachine'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

probe('associe les noms ROM des capacités aux CT et CS du Sac', async () => {
  const bytes = await readFile(romPath)
  const inventory = await readRomInventory(new File([bytes], basename(romPath)))
  for (const itemId of [hgssFirstTmItemId, hgssFirstHmItemId]) {
    const item = inventory.itemCatalog.items[itemId]!
    const machine = getHgssPokemonMachine(itemId)!
    const moveName = inventory.pokemonCatalog.moveNames[machine.moveId]
    expect(item.name).toBeTruthy()
    expect(moveName).toBeTruthy()
    expect(getPokemonMachineDisplayName(item, inventory.pokemonCatalog.moveNames)).toBe(`${item.name} · ${moveName}`)
  }

  // Le Sac de combat respecte la poche ROM : aucune CT/CS HGSS n'y est autorisée.
  for (let itemId = hgssFirstTmItemId; itemId <= hgssLastHmItemId; itemId += 1) {
    expect(inventory.itemCatalog.items[itemId]?.battlePocket).toBe(0)
  }
}, 120_000)
