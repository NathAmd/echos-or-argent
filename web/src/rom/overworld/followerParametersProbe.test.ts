import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { resolveHgssPokeathlonBasePerformance } from '../pokemon/pokeathlonPerformance'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const followerAudit = process.env.RUN_FOLLOWER_AUDIT === '1' && existsSync(romPath) ? it : it.skip

describe('follower ROM audit', () => {
  followerAudit('decodes the native starter model indexes, parameters, and opening map modes', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))
    const followers = inventory.pokemonCatalog.followers
    const pokeathlon = inventory.pokeathlonPerformanceCatalog

    expect(pokeathlon.performances).toHaveLength(554)
    expect(pokeathlon.memberIndexBySpecies).toHaveLength(494)
    expect(pokeathlon.memberIndexBySpecies[155]).toBe(154)
    expect(resolveHgssPokeathlonBasePerformance(pokeathlon, 155, 0)).toEqual({
      memberIndex: 154,
      stats: {
        power: { base: 1, minimum: 0, maximum: 3 },
        skill: { base: 0, minimum: 0, maximum: 2 },
        speed: { base: 2, minimum: 0, maximum: 2 },
        jump: { base: 2, minimum: 1, maximum: 2 },
        stamina: { base: 3, minimum: 1, maximum: 4 },
      },
    })
    expect(inventory.resolvedMapCatalog.maps.find(({ id }) => id === 280)?.header.mapSection).toBe(225)
    expect(inventory.followerReactionCatalog.sectionRules[225]
      ?.filter((rule) => rule.conditions.pokeathlonStatClass !== 0)
      .map((rule) => ({ class: rule.conditions.pokeathlonStatClass, reaction: rule.reactionId }))).toEqual([
      { class: 1, reaction: 292 },
      { class: 2, reaction: 265 },
      { class: 5, reaction: 200 },
      { class: 3, reaction: 286 },
      { class: 4, reaction: 353 },
    ])
    const reactionSoundCounts = new Map<number, number>()
    for (const reaction of inventory.followerReactionCatalog.reactions) {
      for (const { soundId } of reaction.steps) {
        reactionSoundCounts.set(soundId, (reactionSoundCounts.get(soundId) ?? 0) + 1)
      }
    }
    expect([...reactionSoundCounts].sort(([left], [right]) => left - right)).toEqual([
      [0, 760],
      [2379, 671],
      [2380, 128],
    ])

    expect(followers.modelIndexBySpecies[152]).toBe(153)
    expect(followers.modelIndexBySpecies[155]).toBe(157)
    expect(followers.modelIndexBySpecies[158]).toBe(160)
    expect(followers.parameters).toHaveLength(566)
    for (const speciesId of [152, 155, 158]) {
      const parameter = followers.parameters[followers.modelIndexBySpecies[speciesId]!]!
      expect(parameter.values).toHaveLength(4)
      expect(parameter.size).toBe(parameter.values[1])
    }
    for (const expected of [
      { speciesId: 152, parameterIndex: 153, memberIndex: 450 },
      { speciesId: 155, parameterIndex: 157, memberIndex: 454 },
      { speciesId: 158, parameterIndex: 160, memberIndex: 457 },
    ]) {
      expect(followers.modelIndexBySpecies[expected.speciesId]).toBe(expected.parameterIndex)
      const textures = inventory.followerTextureResolver?.(expected.parameterIndex)
      expect(textures?.preview.sourcePath).toBe('/a/0/8/1')
      expect(textures?.preview.sourceMemberIndex).toBe(expected.memberIndex)
      expect(textures?.preview.pixels.some((channel, index) => index % 4 === 3 && channel !== 0)).toBe(true)
      expect(textures?.textures.map(({ name }) => name)).toEqual([
        'tsure_poke.1',
        'tsure_poke.10',
        'tsure_poke.11',
        'tsure_poke.12',
        'tsure_poke.13',
        'tsure_poke.14',
        'tsure_poke.15',
        'tsure_poke.16',
      ])
      expect(textures?.textures.every(({ pixels }) => pixels.some((channel, index) => index % 4 === 3 && channel !== 0))).toBe(true)
      const shinyTextures = inventory.followerTextureResolver?.(expected.parameterIndex, true)
      expect(shinyTextures?.preview.paletteName).toBe('tsure_poke1')
      expect(shinyTextures?.preview.pixels).not.toEqual(textures?.preview.pixels)
      expect(Object.fromEntries(Object.entries(textures?.animationFrames ?? {}).map(([direction, frames]) => [
        direction,
        {
          frameCount: frames.length,
          textureNames: [...new Set(frames.map(({ name }) => name))],
        },
      ]))).toEqual({
        north: { frameCount: 20, textureNames: ['tsure_poke.1', 'tsure_poke.10'] },
        south: { frameCount: 20, textureNames: ['tsure_poke.11', 'tsure_poke.12'] },
        west: { frameCount: 20, textureNames: ['tsure_poke.13', 'tsure_poke.14'] },
        east: { frameCount: 20, textureNames: ['tsure_poke.15', 'tsure_poke.16'] },
      })
    }
    expect(Object.fromEntries(inventory.resolvedMapCatalog.maps
      .filter(({ id }) => id >= 60 && id <= 66)
      .map(({ id, header }) => [id, header.followMode]))).toEqual({
      60: 2,
      61: 1,
      62: 1,
      63: 1,
      64: 1,
      65: 1,
      66: 1,
    })
    const staticAbra = inventory.eventTextureResolver?.(1012)
    expect(staticAbra?.preview?.sourceMemberIndex).toBe(361)
    expect(staticAbra?.preview?.paletteName).toBe('tsure_poke0')
    expect(staticAbra?.frames?.walking.south).toHaveLength(20)
  }, 180000)
})
