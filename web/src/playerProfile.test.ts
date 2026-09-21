import { describe, expect, it, vi } from 'vitest'
import { createHgssSessionRng } from './game/pokemon/hgssSessionRng'
import type { NitroTexturePreview, PlayerTextureFrames, RomInventory, RomMetadata } from './ndsTypes'
import {
  applyPlayerProfileSkin,
  createPlayerProfileForRom,
  initializeHgssNewGamePlayerProfile,
} from './playerProfile'

const metadata: RomMetadata = {
  fileName: 'heartgold.nds',
  fileSize: 1,
  title: 'POKEMON HG',
  gameCode: 'IPKF',
  makerCode: '01',
  unitCode: 0,
}

describe('HGSS player profile', () => {
  it('derives the game version and language from the ROM code', () => {
    expect(createPlayerProfileForRom(metadata)).toEqual({
      gender: 'male',
      name: '',
      language: 3,
      gameVersion: 7,
    })
  })

  it('uses the second post-Oak MTRandom output as the trainer ID', () => {
    const profile = createPlayerProfileForRom(metadata)
    const sessionRng = createHgssSessionRng(5489)

    expect(initializeHgssNewGamePlayerProfile(profile, sessionRng)).toMatchObject({
      friendGroupSeed: 3499211612,
      mailMarillPersonality: 703548663,
      pokewalkerSeeds: [
        3890346734,
        3586334585,
        545404204,
        4161255391,
        3922919429,
        949333985,
        2715962298,
        1323567403,
        418932835,
        2350294565,
      ],
    })
    expect(profile.trainerId).toBe(581869302)
    expect(sessionRng.mt.nextU32()).toBe(1196140740)
  })

  it('propagates Surf to the terrain presentation while selecting the native swimhero cells', () => {
    const texture = (name: string): NitroTexturePreview => ({
      id: name,
      name,
      sourcePath: '/a/0/8/1',
      sourceMemberIndex: 73,
      width: 32,
      height: 32,
      pixels: new Uint8ClampedArray(32 * 32 * 4),
    })
    const directions = ['north', 'south', 'west', 'east'] as const
    const standing = Object.fromEntries(directions.map((direction, index) => [direction, texture(`swimhero.${index + 1}`)])) as PlayerTextureFrames['standing']
    const frames: PlayerTextureFrames = {
      standing,
      walking: Object.fromEntries(directions.map((direction) => [direction, [standing[direction]]])) as PlayerTextureFrames['walking'],
    }
    const setPlayerLocomotion = vi.fn()
    const setPlayerTextureFrames = vi.fn()
    const resolver = vi.fn(() => ({ preview: standing.north, frames }))

    const label = applyPlayerProfileSkin({
      setPlayerTexture: vi.fn(),
      setPlayerTextureFrames,
      setPlayerLocomotion,
    }, { eventTextureResolver: resolver } as unknown as RomInventory, { gender: 'male', name: 'JO' }, 'surfing')

    expect(resolver).toHaveBeenCalledWith(178)
    expect(setPlayerLocomotion).toHaveBeenCalledWith('surfing')
    expect(setPlayerTextureFrames).toHaveBeenCalledWith(frames)
    expect(label).toContain('joueur ROM surfing /a/0/8/1#73/swimhero.1')
  })
})
