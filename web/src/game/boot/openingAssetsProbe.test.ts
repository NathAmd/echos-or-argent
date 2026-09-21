import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { decodeSdat } from '../../rom/audio/sdat'
import { HgssSplEmitterSimulation, HgssSplRandom } from '../battle/splParticleSimulation'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('native opening presentation assets', () => {
  probe('decodes the five-scene movie, Oak Marill and starter machine from the ROM', async () => {
    const bytes = await readFile(romPath)
    const inventory = await readRomInventory(new File([bytes], basename(romPath)))

    expect(inventory.files.find((file) => file.path === '/a/2/6/2')?.archiveEntries).toBe(106)
    expect(inventory.openingMovieGraphics).toHaveLength(7)
    expect(inventory.openingMovieGraphics?.every((graphic) => graphic.width > 0 && graphic.height > 0)).toBe(true)
    expect(inventory.openingMovieSceneGraphics).toHaveLength(5)
    expect(inventory.openingMovieSceneGraphics?.map((scene) => scene.length)).toEqual([7, 4, 11, 4, 4])
    expect(inventory.openingMovieSprites).toHaveLength(10)
    expect(inventory.openingMovieSprites?.[0].animation.sequences.length).toBeGreaterThanOrEqual(2)
    expect(inventory.openingMovieSprites?.[4].animation.sequences.length).toBeGreaterThanOrEqual(6)
    expect(inventory.openingMovieSprites?.[6].animation.sequences.length).toBeGreaterThanOrEqual(3)
    expect(inventory.openingMovieModels).toHaveLength(3)
    expect(inventory.openingMovieModelFrames).toHaveLength(3)
    expect(inventory.openingMovieModelFrames?.every((frames) => (frames?.length ?? 0) > 1)).toBe(true)
    expect(inventory.openingMovieModelAnimations).toHaveLength(3)
    expect(inventory.openingMovieModelAnimations?.map((animation) => animation.frameCount)).toEqual([101, 101, 121])
    expect(inventory.openingStarterParticleResource?.emitters.length).toBeGreaterThanOrEqual(9)
    expect(inventory.openingStarterParticleResource?.textures.length).toBeGreaterThan(0)
    const particleResource = inventory.openingStarterParticleResource!
    const emitterGroups = [[6, 7, 8], [3, 4, 5], [0, 1, 2]] as const
    expect(emitterGroups.map((ids) => ids.map((id) => particleResource.emitters[id]!.emissionType))).toEqual([
      [7, 2, 0],
      [7, 2, 6],
      [2, 2, 2],
    ])
    const simulateParticleTimings = () => emitterGroups.map((ids) => {
      const random = new HgssSplRandom()
      const simulations = ids.map((id) => new HgssSplEmitterSimulation(particleResource.emitters[id]!, random, [0, 0, .015625]))
      const completedAt = ids.map(() => 0)
      let frames = 0
      while (simulations.some((simulation) => !simulation.complete) && frames < 2_000) {
        for (const [index, simulation] of simulations.entries()) {
          simulation.step()
          if (simulation.complete && completedAt[index] === 0) completedAt[index] = frames + 1
        }
        frames += 1
      }
      return { frames, completedAt }
    })
    const particleTimings = simulateParticleTimings()
    const sparkleSequence = inventory.openingMovieSprites?.[6].animation.sequences[2]
    const sparkleFrames = sparkleSequence?.frames.reduce((sum, frame) => sum + Math.max(1, frame.durationFrames), 0)
    expect(particleTimings).toEqual([
      { frames: 52, completedAt: [46, 52, 29] },
      { frames: 43, completedAt: [37, 40, 43] },
      { frames: 48, completedAt: [33, 46, 48] },
    ])
    expect(simulateParticleTimings()).toEqual(particleTimings)
    expect(sparkleFrames).toBe(24)
    const sound = decodeSdat(inventory.soundArchive.bytes)
    expect(sound.sequenceNames).toContain('SEQ_GS_TITLE')
    expect(sound.sequenceNames).toContain('SEQ_GS_STARTING')
    expect(sound.sequenceNames).toContain('SEQ_GS_STARTING2')
    expect(sound.sequenceNames).toContain('SEQ_GS_POKEMON_THEME')
    expect(inventory.introMarillGraphic?.pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
    expect(inventory.introBoyShrinkGraphics).toHaveLength(5)
    expect(inventory.introGirlShrinkGraphics).toHaveLength(5)
    expect(inventory.introTutorialBackgroundGraphics).toHaveLength(6)
    expect(inventory.introMarillSprite?.animation.sequences.length).toBeGreaterThanOrEqual(4)
    expect(inventory.introMarillSprite?.frames.length).toBeGreaterThan(1)
    for (const portrait of [inventory.introBoyGraphic, inventory.introGirlGraphic]) {
      const visibleColors = new Set<string>()
      if (portrait) for (let offset = 0; offset < portrait.pixels.length; offset += 4) {
        if (portrait.pixels[offset + 3] < 32) continue
        visibleColors.add(`${portrait.pixels[offset]}:${portrait.pixels[offset + 1]}:${portrait.pixels[offset + 2]}`)
      }
      expect(visibleColors.size).toBeGreaterThan(8)
    }
    expect(inventory.starterMachineModel?.vertexCount).toBeGreaterThan(0)
    expect(inventory.starterMachineModel?.surfaces?.length).toBeGreaterThan(0)
  }, 20_000)
})
