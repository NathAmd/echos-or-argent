import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('native Pokegear phone ROM inventory', () => {
  probe('decodes every contact type and shared outgoing-call message bank', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    expect(inventory.storageBoxNames).toHaveLength(18)
    expect(inventory.storageBoxNames.every((name) => name.trim().length > 0)).toBe(true)
    const grouped = new Map<number, number[]>()
    for (const { id, type } of inventory.phoneBookEntries) grouped.set(type, [...(grouped.get(type) ?? []), id])
    const contactTypes = Object.fromEntries(grouped)
    expect(inventory.phoneBookEntries).toHaveLength(75)
    expect(Object.keys(contactTypes).map(Number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(contactTypes[0]).toHaveLength(45)
    expect(contactTypes[12]).toEqual([17, 18, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39])
    expect(inventory.phoneGreetingMessages[72]).toContain('Système')
    expect(inventory.phoneContactMessages[0]?.[23]).toContain('{137 10,0} $')
    expect(inventory.phoneContactMessages[2]?.[17]).toBe('Montrer le Pokédex')
    expect(inventory.phoneContactMessages[17]?.[5]).toContain('match retour')
  }, 120_000)
})
