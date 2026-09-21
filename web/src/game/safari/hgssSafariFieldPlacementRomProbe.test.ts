import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { getMapGroundHeight, getMapOrigin } from '../world/mapCoordinates'
import {
  createHgssSafariDecoratorStep,
  getHgssSafariDecoratorEligibility,
} from './hgssSafariFieldCommands'
import {
  createHgssSafariState,
  setHgssSafariObjectUnlockLevel,
} from './hgssSafariState'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('ancres du décorateur dans le terrain Safari de la ROM', () => {
  probe('verrouille les quatre empreintes terre et la fontaine Surf sur la BDHC native', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const source = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 357)
    expect(source).toBeDefined()

    const state = setHgssSafariObjectUnlockLevel(createHgssSafariState(0), 4)
    const map = inventory.mapVariantResolver?.(source!, {
      weekday: 1,
      rocketHideoutCleared: false,
      safariZone: state,
      playerGender: 'male',
    })
    expect(map?.terrain).toBeDefined()
    const origin = getMapOrigin(map!)
    expect(origin).toEqual({ x: 32, z: 32 })

    const walkingHeight = getMapGroundHeight(map!, 1, 1)
    expect(walkingHeight).toBe(1)
    const walking = createHgssSafariDecoratorStep(map!, state, {
      x: 33,
      z: 33,
      direction: 'south',
      state: 0,
      groundHeight: walkingHeight,
    }, 0)
    const byId = (objectId: number) => walking.candidates.find((candidate) => candidate.objectId === objectId)
    expect(byId(0)?.placement).toEqual({ objectId: 0, x: 1, y: 16, z: 2 })
    expect(byId(12)?.placement).toEqual({ objectId: 12, x: 1, y: 16, z: 2 })
    expect(byId(16)?.placement).toEqual({ objectId: 16, x: 1, y: 16, z: 3 })
    expect(byId(3)?.placement).toEqual({ objectId: 3, x: 1, y: 16, z: 3 })
    expect(byId(10)).toEqual({ objectId: 10, unavailableReason: 2 })

    const surfingHeight = getMapGroundHeight(map!, 52, 4)
    expect(surfingHeight).toBe(0.5)
    const surfingPlayer = {
      x: 84,
      z: 36,
      direction: 'east' as const,
      state: 2,
      groundHeight: surfingHeight,
    }
    const surfing = createHgssSafariDecoratorStep(map!, state, surfingPlayer, 0)
    expect(surfing.candidates.find(({ objectId }) => objectId === 10)?.placement).toEqual({
      objectId: 10,
      x: 21,
      y: 8,
      z: 5,
    })
    expect(surfing.candidates.find(({ objectId }) => objectId === 0)).toEqual({ objectId: 0, unavailableReason: 3 })
    expect(getHgssSafariDecoratorEligibility(map!, state, surfingPlayer, 0)).toBe(0)
  }, 120_000)
})
