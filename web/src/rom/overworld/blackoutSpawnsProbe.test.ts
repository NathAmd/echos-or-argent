import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createHgssBlackoutResolvers } from './blackoutSpawns'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('points de blackout de la ROM HGSS', () => {
  probe('résout les destinations de soin depuis la table ARM9 française', async () => {
    const resolvers = createHgssBlackoutResolvers(new Uint8Array(await readFile(romPath)))
    const resolver = resolvers.destination

    expect(resolver(1)).toEqual({ spawnId: 1, mapId: 63, x: 6, z: 8, direction: 'north', followup: 'mom' })
    expect(resolver(2)).toMatchObject({ spawnId: 2, x: 8, z: 13, direction: 'north', followup: 'pokemonCenter' })
    expect(resolvers.spawnForMap(63)).toBe(1)
    expect(resolvers.spawnForMap(resolver(2).mapId)).toBe(2)
    expect(resolvers.spawnForMap(33)).toBeUndefined()
  }, 30_000)
})
