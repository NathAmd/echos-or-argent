import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

probe('inventorie les libellés ROM du résumé de Pokémon', async () => {
  const bytes = await readFile(romPath)
  const inventory = await readRomInventory(new File([bytes], basename(romPath)))
  expect(inventory.uiMessageBanks[302]).toMatchObject({
    109: 'APTITUDES', 110: 'PV', 111: 'Attaque', 112: 'Défense',
    113: 'Atq. Spé.', 114: 'Déf. Spé.', 115: 'Vitesse', 116: 'Cap. Spé.',
  })
}, 120_000)
