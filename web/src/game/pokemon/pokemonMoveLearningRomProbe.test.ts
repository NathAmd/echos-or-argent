import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { formatHgssRomMessage } from '../ui/romMessageFormatting'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

probe('conserve les textes ROM du flux d’apprentissage de capacité', async () => {
  const bytes = await readFile(romPath)
  const inventory = await readRomInventory(new File([bytes], basename(romPath)))
  for (const id of [4, 5, 6, 7, 8, 9, 10, 939, 1182]) expect(inventory.battleMessages[id], `combat ${id}`).toBeTruthy()
  const machine = inventory.uiMessageBanks[300] ?? {}
  for (const id of [53, 56, 59, 60, 61, 62, 63]) expect(machine[id], `équipe ${id}`).toBeTruthy()
  expect(machine[53]?.match(/\{101 0,0\}/g)).toHaveLength(2)
  expect(machine[53]?.match(/\{106 1,0\}/g)).toHaveLength(2)
  expect(formatHgssRomMessage(machine[53]!, ['GERMIGNON', 'MITRA-POING']).match(/GERMIGNON/g)).toHaveLength(2)
  expect(formatHgssRomMessage(machine[53]!, ['GERMIGNON', 'MITRA-POING']).match(/MITRA-POING/g)).toHaveLength(2)
  for (const id of [59, 61, 62, 63]) {
    expect(machine[id]).toMatch(/\{101 [^}]+\}/)
    expect(machine[id]).toMatch(/\{106 [^}]+\}/)
  }
  const teachPrompt = inventory.uiMessageBanks[10]?.[61]
  expect(teachPrompt?.match(/\{106 0,0\}/g)).toHaveLength(2)
  expect(formatHgssRomMessage(teachPrompt!, ['MITRA-POING']).match(/MITRA-POING/g)).toHaveLength(2)
}, 120_000)
