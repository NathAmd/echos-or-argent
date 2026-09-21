import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { calculatePokemonStats, type PokemonStatValues } from '../../game/pokemon/pokemonFormulas'
import { decodeSwarWave, resolveSbnkInstrument } from '../audio/nitroSamples'
import { decodeSdat, readSdatFile } from '../audio/sdat'
import { decodeSseqTimeline } from '../audio/sseq'
import { getHgssFollowerRuleOrder } from '../overworld/followerReactions'
import { calculateLevelFromExperience, getExperienceForLevel } from './growthTable'
import { deriveInitialMoveIds } from './levelUpLearnset'
import { decodePokemonMoveDataFromArchive } from './moveData'
import { decodePokemonPersonalDataFromArchive } from './personalData'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip
const zeroStatValues: PokemonStatValues = { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 }

describe('Pokemon ROM registry', () => {
  probe('resolves proven archives and decodes the three HGSS starters', async () => {
    const romBuffer = await readFile(romPath)
    const rom = new Uint8Array(romBuffer.buffer, romBuffer.byteOffset, romBuffer.byteLength)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const personalArchive = inventory.resourceCatalog.pokemonArchives.find((entry) => entry.role === 'personalData')?.file
    const movesArchive = inventory.resourceCatalog.pokemonArchives.find((entry) => entry.role === 'moves')?.file
    expect(personalArchive).toBeDefined()
    expect(movesArchive).toBeDefined()
    if (!personalArchive || !movesArchive) return

    const starters = [
      { speciesId: 152, baseStats: { hp: 45, attack: 49, defense: 65, speed: 45, specialAttack: 49, specialDefense: 65 }, types: [12, 12], catchRate: 45, level5MoveIds: [33, 45], level5ZeroIvStats: { hp: 19, attack: 9, defense: 11, speed: 9, specialAttack: 9, specialDefense: 11 } },
      { speciesId: 155, baseStats: { hp: 39, attack: 52, defense: 43, speed: 65, specialAttack: 60, specialDefense: 50 }, types: [10, 10], catchRate: 45, level5MoveIds: [33, 43], level5ZeroIvStats: { hp: 18, attack: 10, defense: 9, speed: 11, specialAttack: 11, specialDefense: 10 } },
      { speciesId: 158, baseStats: { hp: 50, attack: 65, defense: 64, speed: 43, specialAttack: 44, specialDefense: 48 }, types: [11, 11], catchRate: 45, level5MoveIds: [10, 43], level5ZeroIvStats: { hp: 20, attack: 11, defense: 11, speed: 9, specialAttack: 9, specialDefense: 9 } },
    ] as const
    const sdat = decodeSdat(inventory.soundArchive.bytes)
    const crySequence = sdat.sequences[2]
    expect(crySequence).toBeDefined()
    if (!crySequence) return
    const cryNote = decodeSseqTimeline(readSdatFile(sdat, crySequence.fileId, 'SSEQ')).notes[0]
    expect(cryNote).toBeDefined()
    if (!cryNote) return

    for (const expected of starters) {
      const cryBank = sdat.banks[expected.speciesId]
      expect(cryBank).toBeDefined()
      if (!cryBank) return
      const cryInstrument = resolveSbnkInstrument(readSdatFile(sdat, cryBank.fileId, 'SBNK'), cryNote.program, cryNote.note)
      expect(cryInstrument.type).toBe('pcm')
      if (cryInstrument.type !== 'pcm') return
      const cryWaveArchiveId = cryBank.waveArchiveIds[cryInstrument.waveArchiveSlot]
      const cryWaveArchive = cryWaveArchiveId === undefined ? undefined : sdat.waveArchives[cryWaveArchiveId]
      expect(cryWaveArchive).toBeDefined()
      if (!cryWaveArchive) return
      expect(decodeSwarWave(readSdatFile(sdat, cryWaveArchive.fileId, 'SWAR'), cryInstrument.waveId).samples.length).toBeGreaterThan(0)
      const { level5MoveIds, level5ZeroIvStats, ...expectedPersonalData } = expected
      expect(decodePokemonPersonalDataFromArchive(rom, personalArchive, expected.speciesId)).toMatchObject(expectedPersonalData)
      const personalData = inventory.pokemonCatalog.personalData[expected.speciesId]!
      expect(personalData).toMatchObject(expectedPersonalData)
      expect(personalData.growthRate).toBe(3)
      const growthTable = inventory.pokemonCatalog.growthTables[personalData.growthRate]!
      expect(getExperienceForLevel(growthTable, 5)).toBe(135)
      expect(calculateLevelFromExperience(growthTable, 135)).toBe(5)
      expect(calculatePokemonStats(personalData, 5, zeroStatValues, zeroStatValues, 0)).toEqual(level5ZeroIvStats)
      const moveIds = deriveInitialMoveIds(inventory.pokemonCatalog.levelUpLearnsets[expected.speciesId]!, 5)
      expect(moveIds).toEqual(level5MoveIds)
      expect(moveIds.map((moveId) => inventory.pokemonCatalog.moves[moveId]!.pp)).toEqual(
        level5MoveIds.map((moveId) => decodePokemonMoveDataFromArchive(rom, movesArchive, moveId).pp),
      )
    }

    // sub_02006A0C redirige Shaymin Céleste (espèce 492, forme 1) vers cette
    // banque interne, distincte de l'identifiant d'espèce public.
    const skyShayminCryBank = sdat.banks[494]
    expect(skyShayminCryBank).toBeDefined()
    if (!skyShayminCryBank) return
    const skyShayminCryInstrument = resolveSbnkInstrument(
      readSdatFile(sdat, skyShayminCryBank.fileId, 'SBNK'),
      cryNote.program,
      cryNote.note,
    )
    expect(skyShayminCryInstrument.type).toBe('pcm')
    if (skyShayminCryInstrument.type !== 'pcm') return
    const skyShayminWaveArchiveId = skyShayminCryBank.waveArchiveIds[skyShayminCryInstrument.waveArchiveSlot]
    const skyShayminWaveArchive = skyShayminWaveArchiveId === undefined ? undefined : sdat.waveArchives[skyShayminWaveArchiveId]
    expect(skyShayminWaveArchive).toBeDefined()
    if (!skyShayminWaveArchive) return
    expect(decodeSwarWave(
      readSdatFile(sdat, skyShayminWaveArchive.fileId, 'SWAR'),
      skyShayminCryInstrument.waveId,
    ).samples.length).toBeGreaterThan(0)

    expect(inventory.pokemonCatalog.speciesNames[152]).toBe('GERMIGNON')
    expect(inventory.pokemonCatalog.speciesNames[155]).toBe('HERICENDRE')
    expect(inventory.pokemonCatalog.speciesNames[158]).toBe('KAIMINUS')
    expect(inventory.pokemonCatalog.moveNames[33]).toBe('Charge')

    expect(inventory.itemCatalog.items[4]).toMatchObject({ itemId: 4, fieldPocket: 2 })
    expect(inventory.itemCatalog.pocketNames).toEqual([
      'OBJETS', 'MEDICAMENTS', 'BALLS', 'CT & CS', 'BAIES', 'LETTRES', 'OBJETS COMBAT', 'OBJETS RARES',
    ])
    expect(inventory.itemCatalog.items[17]).toMatchObject({
      itemId: 17,
      name: 'Potion',
      price: 300,
      fieldPocket: 1,
      partyUse: 1,
      partyParameters: { hpRestore: true, hpRestoreParameter: 20 },
    })
    expect(inventory.itemCatalog.items[23]).toMatchObject({
      partyUse: 1,
      partyParameters: {
        sleepHeal: true,
        poisonHeal: true,
        burnHeal: true,
        freezeHeal: true,
        paralysisHeal: true,
        hpRestore: true,
        hpRestoreParameter: 0xff,
      },
    })
    expect(inventory.itemCatalog.items[28]).toMatchObject({
      partyUse: 1,
      partyParameters: { revive: true, hpRestore: true, hpRestoreParameter: 0xfe },
    })
    expect(inventory.itemCatalog.items[41]).toMatchObject({
      partyUse: 1,
      partyParameters: { ppRestoreAll: true, ppRestoreParameter: 0x7f },
    })
    expect(inventory.itemCatalog.items[44]).toMatchObject({
      partyUse: 1,
      partyParameters: { reviveAll: true },
    })
    expect(inventory.itemCatalog.items[149]).toMatchObject({ itemId: 149, fieldPocket: 4 })
    expect(inventory.itemCatalog.items[17]?.description.length).toBeGreaterThan(0)
    const potionIcon = inventory.itemIconResolver(17)
    expect(potionIcon).toMatchObject({ width: 32, height: 32, colorDepth: 4 })
    expect(potionIcon.pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
    for (const [speciesId, memberIndex, paletteIndex] of [[152, 159, 1], [155, 162, 1], [158, 165, 2]] as const) {
      const icon = inventory.pokemonIconResolver(speciesId)
      expect(icon).toMatchObject({ memberIndex, paletteIndex })
      expect(icon.frames).toHaveLength(2)
      expect(icon.frames[0]).toMatchObject({ width: 32, height: 32, colorDepth: 4 })
      expect(icon.frames[0]!.pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
    }
    const bedroom = inventory.resolvedMapCatalog.maps.find((map) => map.id === 64)
    const newBarkTown = inventory.resolvedMapCatalog.maps.find((map) => map.id === 60)
    expect(bedroom?.label).toBe(newBarkTown?.label)
    expect(bedroom?.label).not.toMatch(/^Carte /)
    expect(inventory.phoneContactNames).toHaveLength(75)
    expect(inventory.phoneContactNames.slice(0, 2)).toEqual(['Maman', 'Orme'])
    expect(inventory.phoneContactMessages[1]?.[33]).toContain('Reviens vite!')

    expect(inventory.followerReactionCatalog.globalRules).toHaveLength(70)
    expect(inventory.followerReactionCatalog.sectionRules).toHaveLength(235)
    expect(inventory.followerReactionCatalog.sectionRules[126]).toHaveLength(30)
    expect(inventory.followerReactionCatalog.reactions).toHaveLength(1023)
    expect(inventory.followerReactionCatalog.movements).toHaveLength(108)
    expect(inventory.followerReactionCatalog.speciesReactionClasses).toHaveLength(493)
    expect(inventory.followerReactionCatalog.speciesReactionClasses.slice(151, 158)).toEqual([30, 93, 201, 31, 94, 200, 32])
    expect(inventory.followerReactionCatalog.globalRules[0]).toMatchObject({
      conditionBits: 0,
      reactionId: 472,
      probability: 100,
      requiredFlag: 0,
    })
    expect(inventory.followerReactionCatalog.sectionRules[126]?.[0]).toMatchObject({
      conditionBits: 1,
      reactionId: 495,
      probability: 80,
      requiredFlag: 0,
    })
    expect(inventory.followerReactionCatalog.reactions[0]).toMatchObject({
      reactionId: 1,
      steps: [{ movementId: 3, messageId: 6, soundId: 0, emoteId: 5, delay: 0 }],
      terminated: true,
    })
    expect(inventory.followerReactionCatalog.reactions[1017]).toMatchObject({
      reactionId: 1018,
      steps: [{ movementId: 3 }, { movementId: 44 }, { movementId: 44 }, { movementId: 3 }, { movementId: 3 }],
      terminated: false,
    })
    expect(inventory.followerReactionCatalog.movements[2]).toMatchObject({
      movementId: 3,
      terminated: true,
    })
    expect(inventory.followerReactionCatalog.movements[2]?.segments).toHaveLength(9)
    expect(inventory.followerReactionCatalog.movements[2]?.segments.slice(0, 2)).toMatchObject([
      { durationFrames: 0, heightAdjustment: 0, triggerStepSound: false },
      { durationFrames: 1, heightAdjustment: 5, triggerStepSound: true },
    ])
    const followerEmotes = Array.from({ length: 14 }, (_, index) => inventory.followerEmoteResolver?.(index + 1))
    expect(followerEmotes.every(Boolean)).toBe(true)
    for (const [index, emote] of followerEmotes.entries()) {
      expect(emote).toMatchObject({
        emoteId: index + 1,
        timeline: {
          durations: [0, 4, 8, 12],
          textureIndexes: [0, 1, 0, 1],
          paletteIndexes: [0, 0, 0, 0],
        },
        soundId: 1501,
      })
      expect(emote?.textures).toHaveLength(2)
      expect(emote?.textures[0]).toMatchObject({ sourcePath: '/a/1/0/3', sourceMemberIndex: index + 2 })
      expect(emote?.textures.every((texture) => texture.width > 0 && texture.height > 0 && texture.pixels.some((value, pixel) => pixel % 4 === 3 && value > 0))).toBe(true)
    }
    expect(Object.keys(inventory.followerReactionCatalog.interactionMessages).length).toBeGreaterThan(0)
    expect(Object.keys(inventory.followerReactionCatalog.auxiliaryMessages).length).toBeGreaterThan(0)
    const followerRuleOrder = getHgssFollowerRuleOrder(inventory.followerReactionCatalog, 126)
    expect(followerRuleOrder).toHaveLength(100)
    expect(followerRuleOrder[0]).toBe(inventory.followerReactionCatalog.globalRules[0])
    expect(followerRuleOrder[12]).toBe(inventory.followerReactionCatalog.sectionRules[126]?.[0])
    expect(followerRuleOrder[42]).toBe(inventory.followerReactionCatalog.globalRules[12])

    expect(inventory.pokemonCatalog.moves[10]).toMatchObject({ moveId: 10, power: 40, type: 0, accuracy: 100, pp: 35 })
    expect(inventory.pokemonCatalog.moves[33]).toMatchObject({ moveId: 33, power: 35, type: 0, accuracy: 95, pp: 35 })
    expect(inventory.pokemonCatalog.moves[43]).toMatchObject({ moveId: 43, power: 0, type: 0, accuracy: 100, pp: 30 })
    expect(inventory.pokemonCatalog.moves[45]).toMatchObject({ moveId: 45, power: 0, type: 0, accuracy: 100, pp: 40 })
    expect(inventory.pokemonCatalog.growthTables.map((table) => getExperienceForLevel(table, 100))).toEqual([
      1_000_000,
      600_000,
      1_640_000,
      1_059_860,
      800_000,
      1_250_000,
      1_000_000,
      1_000_000,
    ])
  }, 60_000)
})
