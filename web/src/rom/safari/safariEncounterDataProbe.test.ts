import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import {
  HGSS_SAFARI_ENCOUNTER_ARCHIVE_PATH,
  hgssSafariAreaCount,
  hgssSafariBaseSlotCount,
  hgssSafariEncounterMethods,
  hgssSafariEncounterTimes,
} from './safariEncounterData'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('HGSS Safari encounter ROM inventory', () => {
  probe('locks the twelve native area tables and Safari message banks to the loaded ROM', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const archive = inventory.files.find(({ path }) => path === HGSS_SAFARI_ENCOUNTER_ARCHIVE_PATH)

    expect(archive).toBeDefined()
    expect(archive!.archiveMembers).toHaveLength(hgssSafariAreaCount)
    expect(archive!.archiveMembers.map(({ index, size }) => ({ index, size }))).toEqual(
      Array.from({ length: hgssSafariAreaCount }, (_, index) => ({ index, size: 912 })),
    )
    expect(inventory.safariEncounterCatalog).toHaveLength(hgssSafariAreaCount)
    expect(inventory.safariEncounterCatalog.map(({ methods }) => (
      hgssSafariEncounterTimes.map((time) => methods.land.base[time][0]!.speciesId)
    ))).toEqual([
      [19, 19, 20],
      [39, 39, 39],
      [29, 29, 30],
      [74, 74, 74],
      [84, 84, 41],
      [21, 21, 194],
      [69, 69, 69],
      [161, 161, 161],
      [23, 23, 194],
      [115, 115, 22],
      [20, 20, 41],
      [27, 27, 27],
    ])
    expect(inventory.safariEncounterCatalog.every(({ methods }) => (
      hgssSafariEncounterTimes.every((time) => methods.land.base[time][0]!.level === 15)
    ))).toBe(true)

    const invalidSlots: Array<{ areaId: number, method: string, time: string, speciesId: number, level: number }> = []
    inventory.safariEncounterCatalog.forEach((area) => {
      expect(area.areaId).toBeGreaterThanOrEqual(0)
      expect(area.areaId).toBeLessThan(hgssSafariAreaCount)
      hgssSafariEncounterMethods.forEach((method) => {
        const table = area.methods[method]
        expect(table.bonusCount).toBe({ land: 10, surf: 3, oldRod: 2, goodRod: 2, superRod: 2 }[method])
        expect(table.bonusConditions).toHaveLength(table.bonusCount)
        hgssSafariEncounterTimes.forEach((time) => {
          expect(table.base[time]).toHaveLength(hgssSafariBaseSlotCount)
          expect(table.bonus[time]).toHaveLength(table.bonusConditions.length)
          ;[...table.base[time], ...table.bonus[time]].forEach(({ speciesId, level }) => {
            if (!inventory.pokemonCatalog.speciesNames[speciesId] || level < 1 || level > 100) {
              invalidSlots.push({ areaId: area.areaId, method, time, speciesId, level })
            }
          })
        })
        expect(table.bonusConditions.every(({ blockType1, blockType2 }) => blockType1 <= 4 && blockType2 <= 4)).toBe(true)
      })
    })
    expect(invalidSlots).toEqual([])

    for (const bankId of [135, 427, 428, 430]) {
      expect(Object.keys(inventory.uiMessageBanks[bankId] ?? {}).length, `Banque de messages Safari ${bankId}`).toBeGreaterThan(0)
    }
    expect(new Set(Object.values(inventory.uiMessageBanks[428] ?? {}).filter(Boolean)).size).toBeGreaterThanOrEqual(hgssSafariAreaCount)
    expect(Object.keys(inventory.battleMessages).length).toBeGreaterThan(0)
    for (const messageId of [781, 871, 874, 965]) expect(inventory.battleMessages[messageId]).toMatch(/\r$/)
    expect(inventory.battleMessages[867]).toMatch(/^\{202 3\}[\s\S]*\{202 2\}\r$/)
    expect(inventory.battleMessages[1176]).toMatch(/\r/)
    expect(inventory.battleMessages[1177]).toMatch(/\r/)
    console.log(JSON.stringify(inventory.safariEncounterCatalog.map((area) => ({
      areaId: area.areaId,
      areaName: inventory.uiMessageBanks[428]?.[area.areaId],
      firstLandSlots: Object.fromEntries(hgssSafariEncounterTimes.map((time) => {
        const slot = area.methods.land.base[time][0]!
        return [time, `${inventory.pokemonCatalog.speciesNames[slot.speciesId]}:${slot.level}`]
      })),
      bonusCounts: Object.fromEntries(hgssSafariEncounterMethods.map((method) => [method, area.methods[method].bonusCount])),
    })), null, 2))
  }, 180_000)
})
