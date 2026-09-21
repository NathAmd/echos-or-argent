import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

probe('inventorie les commandes natives des Boîtes PC', async () => {
  const bytes = await readFile(romPath)
  const inventory = await readRomInventory(new File([bytes], basename(romPath)))
  expect(inventory.uiMessageBanks[24]).toMatchObject({
    61: 'DEPLACER', 64: 'BOUGER OBJ.', 65: 'RESUME', 68: 'RELACHER',
    69: 'RETIRER', 70: 'DEPOSER', 71: 'RETOUR', 72: 'CONFIRM.', 73: 'ANNULER', 80: 'SAC',
  })
  expect(inventory.uiMessageBanks[191]).toMatchObject({
    62: 'PC DE LEO', 67: 'DEPOSER\nPOKéMON', 68: 'RETIRER\nPOKéMON',
    69: 'DEPLACER\nPOKéMON', 70: 'DEPLACER\nOBJETS', 75: 'ETEINDRE',
  })
}, 120_000)
