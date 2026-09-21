import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { HgssSplEmitterSimulation, HgssSplRandom } from '../../game/battle/splParticleSimulation'
import { decodeConfirmedHgssGenericEmitterCallback } from '../../game/battle/battleAnimationPlayback'
import { readArm9OverlayFromRom } from '../arm9Overlay'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

const expectedArchives = [
  ['/a/0/0/0', 501],
  ['/a/0/0/1', 297],
  ['/a/0/0/2', 508],
  ['/a/0/0/4', 2_964],
  ['/a/0/0/5', 1_976],
  ['/a/0/0/7', 351],
  ['/a/0/0/8', 346],
  ['/a/0/1/0', 501],
  ['/a/0/1/1', 471],
  ['/a/0/1/7', 514],
  ['/a/0/1/8', 797],
  ['/a/0/2/0', 551],
  ['/a/0/2/2', 37],
  ['/a/0/2/3', 39],
  ['/a/0/2/4', 37],
  ['/a/0/2/5', 37],
  ['/a/0/2/9', 486],
  ['/a/0/2/7', 829],
  ['/a/0/3/0', 277],
  ['/a/0/3/3', 508],
  ['/a/0/3/4', 508],
  ['/a/0/3/7', 142],
  ['/a/0/5/5', 738],
  ['/a/0/5/6', 738],
  ['/a/0/6/8', 123],
  ['/a/0/6/9', 497],
  ['/a/0/6/1', 50],
  ['/a/0/7/4', 102],
  ['/a/0/7/5', 2],
  ['/a/1/3/3', 3_962],
  ['/a/1/3/8', 1],
  ['/a/1/6/1', 4],
  ['/a/1/6/4', 4],
] as const

probe('locks the battle and Pokedex audit to the exact French HeartGold ROM', async () => {
  const romBuffer = await readFile(romPath)
  const rom = new Uint8Array(romBuffer.buffer, romBuffer.byteOffset, romBuffer.byteLength)
  const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))

  expect(createHash('sha256').update(romBuffer).digest('hex')).toBe('ee540ea4eff5268e8b7a85bc63db654c627dd82c25ebe921211870646b25356a')
  expect(inventory.metadata).toMatchObject({
    title: 'POKEMON HG',
    gameCode: 'IPKF',
    fileSize: 134_217_728,
  })
  expect(inventory.files).toHaveLength(513)

  for (const [path, memberCount] of expectedArchives) {
    const archive = inventory.files.find((file) => file.path === path)
    expect(archive, `Archive ROM requise absente : ${path}`).toBeDefined()
    expect(archive!.archiveMembers, `Nombre de membres invalide : ${path}`).toHaveLength(memberCount)
  }

  expect(inventory.files.find((file) => file.path === '/a/0/0/2')!.archiveMembers.every((member) => member.size === 44)).toBe(true)
  expect(inventory.files.find((file) => file.path === '/a/0/1/1')!.archiveMembers.every((member) => member.size === 16)).toBe(true)
  expect(inventory.files.find((file) => file.path === '/a/0/1/7')!.archiveMembers.every((member) => member.size === 34)).toBe(true)
  expect(inventory.files.find((file) => file.path === '/a/0/3/4')!.archiveMembers.every((member) => member.size === 44)).toBe(true)
  expect(inventory.files.find((file) => file.path === '/a/0/3/7')!.archiveMembers.every((member) => member.size === 196)).toBe(true)
  expect(inventory.files.find((file) => file.path === '/a/0/5/5')!.archiveMembers.every((member) => member.size === 20)).toBe(true)

  expect(readArm9OverlayFromRom(rom, 10)).toHaveLength(62_560)
  expect(readArm9OverlayFromRom(rom, 12)).toHaveLength(226_176)
  expect(readArm9OverlayFromRom(rom, 13)).toHaveLength(178_816)
  expect(readArm9OverlayFromRom(rom, 18)).toHaveLength(90_496)

  expect(inventory.trainerCatalog).toHaveLength(738)
  expect(inventory.trainerBattleSpriteResolver(5)).toMatchObject({ width: 80, height: 80, colorDepth: 4 })
  expect(inventory.trainerBattleSpriteResolver(23)).toMatchObject({ width: 80, height: 80, colorDepth: 4 })
  for (const trainerClass of new Set(inventory.trainerCatalog.map((trainer) => trainer.trainerClass))) {
    expect(() => inventory.trainerBattleSpriteResolver(trainerClass), `Sprite de classe de dresseur HGSS ${trainerClass}`).not.toThrow()
  }
  expect(inventory.wildEncounterCatalog).toHaveLength(142)
  expect(inventory.battleAnimationCatalog.moveScripts).toHaveLength(501)
  expect(inventory.battleAnimationCatalog.moveScripts[33]).toMatchObject({ id: 33, byteLength: 340 })
  expect([...inventory.battleAnimationCatalog.moveScripts[33]!.words.slice(0, 4)]).toEqual([56, 57, 0, 57])
  expect(inventory.battleAnimationCatalog.moveScripts[33]!.instructions.slice(0, 3).map(({ name }) => name)).toEqual([
    'InitPokemonSpriteManager',
    'LoadPokemonSpriteDummyResources',
    'LoadPokemonSpriteDummyResources',
  ])
  expect(inventory.battleAnimationCatalog.battleScripts.filter((script) => script.byteLength === 0)).toHaveLength(7)
  const tackleParticles = inventory.battleAnimationCatalog.particleResourceResolver(64)
  expect(tackleParticles).toMatchObject({
    memberId: 64,
    version: ' APS12_1',
    emitters: [
      { id: 0, flags: 0x01014701, emissionType: 1, drawType: 0, childResource: {}, behaviors: [{ kind: 'gravity' }] },
      { id: 1, flags: 0x00006f00, emissionType: 0, drawType: 0, behaviors: [] },
    ],
    textures: [
      { id: 0, format: 'a5i3', width: 16, height: 16 },
      { id: 1, format: 'a5i3', width: 16, height: 16 },
      { id: 2, format: 'a5i3', width: 32, height: 32 },
    ],
  })
  for (let memberId = 0; memberId < 486; memberId += 1) {
    expect(() => inventory.battleAnimationCatalog.particleResourceResolver(memberId)).not.toThrow()
  }
  const tackleRandom = new HgssSplRandom(0)
  const tackleEmitters = tackleParticles.emitters.map((emitter) => new HgssSplEmitterSimulation(emitter, tackleRandom))
  for (let frame = 0; frame < 240 && tackleEmitters.some((emitter) => !emitter.complete); frame += 1) {
    for (const emitter of tackleEmitters) emitter.step()
  }
  expect(tackleEmitters.every((emitter) => emitter.complete)).toBe(true)
  const growlParticles = inventory.battleAnimationCatalog.particleResourceResolver(76)
  expect(inventory.battleAnimationCatalog.moveScripts[45]!.instructions
    .filter((instruction) => instruction.name === 'PlayPokemonCry')
    .map((instruction) => [...instruction.operands])).toEqual([
      [9, 0xffffff8b, 100],
      [10, 0xffffff8b, 127],
    ])
  expect(growlParticles.emitters).toMatchObject([
    { id: 0, emissionType: 0, drawType: 0 },
    { id: 1, emissionType: 3, drawType: 1 },
  ])
  const growlRandom = new HgssSplRandom(0)
  const growlEmitters = growlParticles.emitters.map((emitter) => new HgssSplEmitterSimulation(emitter, growlRandom))
  for (let frame = 0; frame < 240 && growlEmitters.some((emitter) => !emitter.complete); frame += 1) {
    for (const emitter of growlEmitters) emitter.step()
  }
  expect(growlEmitters.every((emitter) => emitter.complete)).toBe(true)
  const scratchScript = inventory.battleAnimationCatalog.moveScripts[10]!
  expect(scratchScript.instructions.find((instruction) => instruction.name === 'LoadParticleSystem')?.operands).toEqual(Uint32Array.from([0, 41]))
  expect(scratchScript.instructions.find((instruction) => instruction.name === 'CallFunc' && instruction.operands[0] === 78)?.operands)
    .toEqual(Uint32Array.from([78, 1, 0]))
  expect(scratchScript.instructions.find((instruction) => instruction.name === 'PlayPannedSoundEffect')?.operands)
    .toEqual(Uint32Array.from([1908, 117]))
  expect(scratchScript.instructions.filter((instruction) => instruction.name === 'CreateEmitter').map((instruction) => [...instruction.operands]))
    .toEqual([[0, 0, 4], [0, 1, 4]])
  const scratchParticles = inventory.battleAnimationCatalog.particleResourceResolver(41)
  expect(scratchParticles.emitters).toMatchObject([
    { id: 0, emissionType: 0, drawType: 0, childResource: {} },
    { id: 1, emissionType: 1, drawType: 0, childResource: {}, behaviors: [{ kind: 'gravity' }] },
  ])
  const scratchRandom = new HgssSplRandom(0)
  const scratchEmitters = scratchParticles.emitters.map((emitter) => new HgssSplEmitterSimulation(emitter, scratchRandom))
  for (let frame = 0; frame < 240 && scratchEmitters.some((emitter) => !emitter.complete); frame += 1) {
    for (const emitter of scratchEmitters) emitter.step()
  }
  expect(scratchEmitters.every((emitter) => emitter.complete)).toBe(true)
  const leerScript = inventory.battleAnimationCatalog.moveScripts[43]!
  expect(leerScript.instructions.find((instruction) => instruction.name === 'LoadParticleSystem')?.operands).toEqual(Uint32Array.from([0, 74]))
  const leerCreateIndexes = leerScript.instructions
    .map((instruction, index) => instruction.name === 'CreateEmitter' ? index : -1)
    .filter((index) => index >= 0)
    .slice(0, 3)
  expect(leerCreateIndexes).toHaveLength(3)
  for (const [emitterId, instructionIndex] of leerCreateIndexes.entries()) {
    expect(leerScript.instructions[instructionIndex]!.operands).toEqual(Uint32Array.from([0, emitterId, 17]))
    expect(decodeConfirmedHgssGenericEmitterCallback(leerScript.instructions, instructionIndex)).toEqual({
      consumedInstructions: 2,
      disableSideFlip: false,
      offsetFx32: [-4128, 0, 0],
    })
  }
  const leerParticles = inventory.battleAnimationCatalog.particleResourceResolver(74)
  expect(leerParticles.emitters).toMatchObject([
    { id: 0, emissionType: 0, drawType: 0, childResource: {} },
    { id: 1, emissionType: 0, drawType: 0, childResource: {} },
    { id: 2, emissionType: 0, drawType: 0, childResource: {} },
  ])
  const leerRandom = new HgssSplRandom(0)
  const leerEmitters = leerParticles.emitters.map((emitter) => new HgssSplEmitterSimulation(emitter, leerRandom))
  for (let frame = 0; frame < 240 && leerEmitters.some((emitter) => !emitter.complete); frame += 1) {
    for (const emitter of leerEmitters) emitter.step()
  }
  expect(leerEmitters.every((emitter) => emitter.complete)).toBe(true)
  const spriteResource = inventory.battleAnimationCatalog.spriteResourceResolver({
    characterMemberId: 0,
    paletteMemberId: 0,
    cellMemberId: 0,
    animationMemberId: 0,
  })
  expect(spriteResource).toMatchObject({ graphic: { colorDepth: 4 } })
  expect(spriteResource.animation!.declaredFrameCount).toBeGreaterThan(0)
  expect(spriteResource.animation!.sequences.length).toBeGreaterThan(0)
  for (let resourceId = 0; resourceId < 37; resourceId += 1) {
    expect(() => inventory.battleAnimationCatalog.spriteResourceResolver({
      characterMemberId: resourceId,
      paletteMemberId: resourceId,
      cellMemberId: resourceId,
      animationMemberId: resourceId,
    }), `Ressource de sprite d'animation HGSS ${resourceId}`).not.toThrow()
  }
  expect(inventory.pokedexCatalog.johtoDexNumbers).toMatchObject({ 152: 1, 155: 4, 158: 7 })
  expect(inventory.pokedexCatalog.weightsTenthsKg).toMatchObject({ 152: 64, 155: 79, 158: 95 })
  expect(inventory.pokedexCatalog.uiMessages).toMatchObject({ 0: 'VUS', 1: 'PRIS', 8: 'INFO' })
  expect(inventory.pokedexCatalog.heartGoldDescriptions[155]?.length).toBeGreaterThan(0)
}, 120_000)
