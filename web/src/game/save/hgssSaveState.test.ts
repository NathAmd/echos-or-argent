import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createHgssSaveState, restoreHgssSaveState, type HgssSaveStateV1 } from './hgssSaveState'
import { decodeHgssItemData, hgssItemDataSize, hgssItemPocketLabels, type HgssItemCatalog } from '../../rom/items/itemData'
import { placePokemonInFirstStorageSlot } from '../pokemon/pokemonStorage'
import { getPokemonPartyPokeathlonModifiers, setPokemonPartyPokeathlonModifiers } from '../pokemon/pokemonParty'
import { deriveLegacyPokemonInstanceId, isPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { hgssDataOnlySaveAuthority } from './hgssDataOnlySaveDocument'
import { resolveFieldBattleExperienceRecipients } from '../battle/fieldBattleExperienceRecipients'
import { isHgssFriendGroupActive } from '../multiplayer/hgssFriendGroups'
import { parseHgssP2pTradeJournal } from '../multiplayer/hgssP2pTradeJournal'
import { createHgssP2pTradeOfferPair } from '../multiplayer/hgssP2pTradeProtocol'
import { snapshotCanonicalPokemonForP2pTrade } from '../multiplayer/hgssP2pTradePokemonAdapter'
import { createHgssSharedCampaignProgressionSeed } from '../multiplayer/hgssSharedCampaignProgression'
import {
  createHgssSharedCampaignSaveExtension,
  hgssSharedCampaignSaveExtensionKey,
  replaceHgssSharedCampaignSaveExtension,
} from './hgssSharedCampaignSaveExtension'

function createItemCatalog(): HgssItemCatalog {
  return {
    pocketNames: hgssItemPocketLabels,
    items: Array.from({ length: 537 }, (_, itemId) => {
      const payload = new Uint8Array(hgssItemDataSize)
      new DataView(payload.buffer).setUint16(8, (itemId === 328 ? 3 : 0) << 7, true)
      return decodeHgssItemData(payload, itemId, `OBJET ${itemId}`, 'Description')
    }),
  }
}

describe('HGSS save state codec', () => {
  it('round-trip un journal P2P prepared data-only et restaure sa réservation exacte', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(77)
    const localTrainer = { id: 7, name: 'JO', gender: 'male' as const, nameSource: 'user-text' as const, isPlayer: true }
    const remoteTrainer = { id: 9, name: 'AMI', gender: 'female' as const, nameSource: 'user-text' as const, isPlayer: true }
    const outgoing = createCanonicalPokemon(catalog, {
      instanceId: 'pkm:v1:r:11111111111111111111111111111111' as CanonicalPokemon['instanceId'],
      speciesId: 152, level: 12, rng: rng.lc, personality: { kind: 'fixed', value: 1 },
      individualValues: { kind: 'fixed', value: 12 }, originalTrainer: localTrainer,
      origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    const incoming = createCanonicalPokemon(catalog, {
      instanceId: 'pkm:v1:r:22222222222222222222222222222222' as CanonicalPokemon['instanceId'],
      speciesId: 155, level: 12, rng: rng.lc, personality: { kind: 'fixed', value: 2 },
      individualValues: { kind: 'fixed', value: 12 }, originalTrainer: remoteTrainer,
      origin: { language: 2, gameVersion: 8, metLocation: 2, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    outgoing.speciesName = 'ROM_TRADE_CANARY_NEVER_SAVE'
    const outgoingSnapshot = snapshotCanonicalPokemonForP2pTrade(outgoing, { catalog, trainer: localTrainer })
    const incomingSnapshot = snapshotCanonicalPokemonForP2pTrade(incoming, { catalog, trainer: remoteTrainer })
    const journal = parseHgssP2pTradeJournal({
      schemaVersion: 1,
      sessionId: `${'S'.repeat(21)}A`, transactionId: `${'T'.repeat(21)}A`,
      localParticipantId: 'alice', remoteParticipantId: 'bob',
      pair: createHgssP2pTradeOfferPair(
        { participantId: 'alice', revision: 1, pokemonId: outgoing.instanceId },
        { participantId: 'bob', revision: 2, pokemonId: incoming.instanceId },
      ),
      outgoing: outgoingSnapshot, incoming: incomingSnapshot,
      destination: { kind: 'party', slot: 0 }, phase: 'prepared',
    })
    const field = createFieldScriptState('male', 'JO', { party: [outgoing] })
    field.p2pTradeJournals = [journal]
    const saved = createHgssSaveState(
      'IPKF', { gender: 'male', name: 'JO', trainerId: 7, language: 3, gameVersion: 7 }, rng,
      { mapId: 61, tileX: 1, tileZ: 1, direction: 'south' }, field,
    )

    expect(saved.field.p2pTradeJournals).toEqual([journal])
    expect(JSON.stringify(saved)).not.toContain('ROM_TRADE_CANARY_NEVER_SAVE')
    const restored = restoreHgssSaveState(JSON.parse(JSON.stringify(saved)), 'IPKF', catalog, () => new Date())
    expect(restored.field.p2pTradeJournals).toEqual([journal])
    expect(restored.field.p2pTradeJournals[0]).not.toBe(journal)
    expect(Object.isFrozen(restored.field.p2pTradeJournals[0])).toBe(true)

    const legacy = structuredClone(saved)
    delete legacy.field.p2pTradeJournals
    expect(restoreHgssSaveState(legacy, 'IPKF', catalog, () => new Date()).field.p2pTradeJournals).toEqual([])

    const invalid = structuredClone(saved) as HgssSaveStateV1
    Object.assign(invalid.field.p2pTradeJournals![0]!.destination, { romLabel: 'interdit' })
    expect(() => restoreHgssSaveState(invalid, 'IPKF', catalog, () => new Date())).toThrow(/journal|invalide/i)
  })

  it('round-trips the complete pre-battle session through JSON and reattaches ROM move data', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(5489)
    Array.from({ length: 20 }, () => rng.mt.nextU32())
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 155,
      level: 5,
      rng: rng.lc,
      personality: { kind: 'random' },
      individualValues: { kind: 'random' },
      originalTrainer: { id: 0x12345678, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
      ballId: 4,
    })
    pokemon.speciesName = 'ROM_SPECIES_CANARY_NEVER_SYNC'
    pokemon.moves[0]!.data = { ...pokemon.moves[0]!.data, effect: 2_130_706_518 }
    pokemon.nickname = 'FLAMME'
    pokemon.nicknameSource = 'user-text'
    pokemon.currentHp = 3
    pokemon.status = 4
    pokemon.pokerus = 0x23
    pokemon.moves[0]!.pp = 2
    pokemon.heldItemId = 17
    pokemon.mailIdentity = 'kenya'
    pokemon.shinyLeafMask = 0b00101
    pokemon.origin.eggLocation = 2013
    pokemon.origin.eggDate = { year: 2026, month: 3, day: 1 }
    const field = createFieldScriptState('male', 'JO', { party: [pokemon], caughtSpeciesIds: [155], starterChoice: 1, starterStorySpeciesId: 254, followMonActive: true, followMonMovementPaused: true })
    setPokemonPartyPokeathlonModifiers(field.party, 0, [12, -34, 56, -78, 90])
    expect(placePokemonInFirstStorageSlot(field.pokemonStorage, {
      ...pokemon,
      instanceId: 'pkm:v1:r:00000000000000000000000000000002' as CanonicalPokemon['instanceId'],
    })).toEqual({ previousBox: 0, box: 0, slot: 0 })
    field.followerMood = -30
    field.flags.add(0x6a)
    field.variables.set(0x4108, 1)
    field.variables.set(0x4000, 475)
    field.variables.set(0x8000, 751)
    field.variables.set(0x800d, 4)
    field.buffers.set(0, 'TEXTE ROM TEMPORAIRE')
    field.pendingPhoneCall = { callerId: 0, parameter1: 2, parameter2: 0 }
    field.inventory.set(17, 5)
    field.apricornBox = [2, 0, 1, 0, 0, 4, 0]
    field.harvestedApricornTrees.add(30)
    field.apricornTreeDay = '2026-3-12'
    field.phoneContacts.add(1)
    field.phoneCallTriggers.add(0)
    field.fashionPortraits.add(3)
    field.fashionPortraitEasyChatWords.set(0, 496)
    field.fashionAccessories.set(47, 8)
    field.fashionAccessories.set(61, 1)
    field.fashionBackgrounds.add(7)
    field.frontierSession = {
      towerMode: 1, requiredCount: 4, partySlots: [0, 1, 2, 3], resumed: true,
      multiBattleAllyId: 301,
      statTrainerMons: [[{ speciesId: 152, firstMoveId: 33 }, { speciesId: 155, firstMoveId: 45 }]],
    }
    field.friendGroups[0] = {
      groupName: 'JOHTO', groupNameSource: 'user-text', memberName: 'JO', memberNameSource: 'user-text',
      memberGender: 'male', language: 2, groupId: 7, randomValue: 9,
    }
    field.player = { x: 4, z: 7, direction: 'north', groundHeight: 10.5, movement: 48 }
    field.objects.set(2, { x: 7, z: 10, direction: 'west' })
    field.mapProps = [{ modelId: 0x8d, x: 131, y: 0, z: 65 }]
    field.gymmick = { type: 3, data: Uint8Array.from([6, 11, 1, 0, ...Array(28).fill(0)]) }
    field.p2pTradeReceipts = [{
      transactionId: 'AAAAAAAAAAAAAAAAAAAAAA',
      sentPokemonInstanceId: 'pkm:v1:r:00000000000000000000000000000099' as CanonicalPokemon['instanceId'],
      receivedPokemonInstanceId: pokemon.instanceId,
    }]
    field.daycare.mons[0] = { pokemon: { ...pokemon, instanceId: 'pkm:v1:r:00000000000000000000000000000003' as CanonicalPokemon['instanceId'] }, steps: 321 }
    field.daycare.eggPersonality = 0x12345678
    field.daycare.eggCycleCounter = 42
    field.togepiEggIdentity = { personality: 0x24681357, gender: 'female' }
    field.dynamicWarp = { mapId: 374, warpId: 0, x: 8, z: 12, direction: 1 }
    field.mailboxMailIdentities[7] = 'kenya'
    field.roamers.roamers[0] = {
      instanceId: 'pkm:v1:r:00000000000000000000000000000243' as CanonicalPokemon['instanceId'],
      metLocation: 39,
      locationIndex: 6,
      individualValues: { hp: 1, attack: 2, defense: 3, speed: 4, specialAttack: 5, specialDefense: 6 },
      personality: 0x10203040,
      speciesId: 243,
      currentHp: 91,
      level: 40,
      status: 0,
      active: true,
    }
    field.palPark = { catchingShowActive: true, migratedPokemon: [{ ...pokemon, instanceId: 'pkm:v1:r:00000000000000000000000000000004' as CanonicalPokemon['instanceId'] }], catchingPoints: 1200, timePoints: 800, typePoints: 200 }
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 0x12345678, language: 3, gameVersion: 7 },
      rng,
      { mapId: 61, tileX: 4, tileZ: 7, direction: 'north', follower: { tileX: 5, tileZ: 7, direction: 'north', movement: 48 } },
      field,
      { textSpeed: 'fast', battleAnimations: false, localWeather: true },
      { hours: 42, minutes: 17, seconds: 9 },
    )
    expect(saved.field.party[0]).not.toHaveProperty('speciesName')
    expect(saved.field.party[0]?.moves[0]).not.toHaveProperty('data')
    const serializedSave = JSON.stringify(saved)
    expect(serializedSave).not.toContain('ROM_SPECIES_CANARY_NEVER_SYNC')
    expect(serializedSave).not.toContain('TEXTE ROM TEMPORAIRE')
    expect(serializedSave).not.toContain('2130706518')
    expect(saved.field.variables).toEqual([[0x4108, 1]])
    expect(saved.field.buffers).toEqual([])
    expect(saved.field.followMonMovementPaused).toBe(false)
    expect(saved.field.partyPokeathlonModifiers).toEqual([[12, -34, 56, -78, 90]])
    expect(saved.field.party[0]?.pokerus).toBe(0x23)
    const legacyWithoutPokerus = structuredClone(saved)
    delete legacyWithoutPokerus.field.party[0]!.pokerus
    expect(restoreHgssSaveState(legacyWithoutPokerus, 'IPKF', catalog, () => new Date()).field.party.members[0]?.pokerus).toBe(0)
    const invalidPokerus = structuredClone(saved)
    invalidPokerus.field.party[0]!.pokerus = 0x100
    expect(() => restoreHgssSaveState(invalidPokerus, 'IPKF', catalog, () => new Date())).toThrow('pokerus')
    expect(saved.field.player).toEqual({ x: 4, z: 7, direction: 'north' })
    expect(saved.field.starterStorySpeciesId).toBe(254)
    expect(saved.field.pendingPhoneCall).toBeUndefined()
    expect(saved.field.p2pTradeReceipts).toEqual(field.p2pTradeReceipts)
    const restored = restoreHgssSaveState(JSON.parse(JSON.stringify(saved)), 'IPKF', catalog, () => new Date(2026, 2, 12), createItemCatalog())

    expect(restored.profile).toEqual({ gender: 'male', name: 'JO', trainerId: 0x12345678, language: 3, gameVersion: 7 })
    expect(restored.igt).toEqual({ hours: 42, minutes: 17, seconds: 9 })
    expect(restored.options).toEqual({ textSpeed: 'fast', battleAnimations: false, localWeather: true })
    expect(restored.field.starterStorySpeciesId).toBe(254)
    expect(getPokemonPartyPokeathlonModifiers(restored.field.party, 0)).toEqual([12, -34, 56, -78, 90])
    expect([...restored.field.fashionPortraits]).toEqual([3])
    expect([...restored.field.fashionPortraitEasyChatWords]).toEqual([[0, 496]])
    expect([...restored.field.fashionAccessories]).toEqual([[47, 8], [61, 1]])
    expect([...restored.field.fashionBackgrounds]).toEqual([7])
    expect(restored.field.frontierSession).toEqual({
      towerMode: 1, requiredCount: 4, partySlots: [0, 1, 2, 3], resumed: true,
      multiBattleAllyId: 301,
      statTrainerMons: [[{ speciesId: 152, firstMoveId: 33 }, { speciesId: 155, firstMoveId: 45 }]],
    })
    expect(restored.field.friendGroups[0]).toMatchObject({ groupName: 'JOHTO', memberName: 'JO', groupId: 7 })
    expect(restored.world).toEqual({
      mapId: 61,
      tileX: 4,
      tileZ: 7,
      direction: 'north',
      follower: { tileX: 5, tileZ: 7, direction: 'north', movement: 48 },
    })
    expect(restored.field).toMatchObject({
      money: 3000,
      starterChoice: 1,
      followMonActive: true,
      followMonMovementPaused: false,
      followerMood: -30,
      player: { x: 4, z: 7, direction: 'north' },
      togepiEggIdentity: { personality: 0x24681357, gender: 'female' },
      dynamicWarp: { mapId: 374, warpId: 0, x: 8, z: 12, direction: 1 },
    })
    expect([...restored.field.flags]).toEqual([0x6a, 0x11b, 0x11d, 0x11e, 0x9c])
    expect(restored.field.mailboxMailIdentities[7]).toBe('kenya')
    expect(restored.field.roamers.roamers[0]).toMatchObject({ speciesId: 243, metLocation: 39, currentHp: 91, active: true })
    expect(restored.field.palPark.catchingShowActive).toBe(true)
    expect(restored.field.palPark.migratedPokemon[0]).toMatchObject({
      speciesId: 155,
      nickname: 'FLAMME',
      nicknameSource: 'user-text',
    })
    expect([...restored.field.variables]).toEqual([[0x4108, 1]])
    expect([...restored.field.buffers]).toEqual([])
    expect([...restored.field.inventory]).toEqual([[17, 5]])
    expect(restored.field.apricornBox).toEqual([2, 0, 1, 0, 0, 4, 0])
    expect([...restored.field.harvestedApricornTrees]).toEqual([30])
    expect(restored.field.apricornTreeDay).toBe('2026-3-12')
    expect([...restored.field.phoneContacts]).toEqual([0, 1])
    expect([...restored.field.phoneCallTriggers]).toEqual([0])
    expect(restored.field.gymmick.type).toBe(3)
    expect([...restored.field.gymmick.data]).toEqual([6, 11, 1, 0, ...Array(28).fill(0)])
    expect(restored.field.p2pTradeReceipts).toEqual(field.p2pTradeReceipts)
    expect(restored.field.daycare).toMatchObject({
      mons: [{ pokemon: { speciesId: 155, nickname: 'FLAMME', nicknameSource: 'user-text' }, steps: 321 }, undefined],
      eggPersonality: 0x12345678,
      eggCycleCounter: 42,
    })
    expect(restored.field.party.members[0]).toMatchObject({
      speciesName: 'HERICENDRE',
      nickname: 'FLAMME',
      nicknameSource: 'user-text',
      currentHp: 3,
      status: 4,
      pokerus: 0x23,
      heldItemId: 17,
      mailIdentity: 'kenya',
      shinyLeafMask: 0b00101,
      origin: { eggLocation: 2013, eggDate: { year: 2026, month: 3, day: 1 } },
    })
    expect(restored.field.party.members[0]?.moves[0]).toMatchObject({ moveId: 33, pp: 2, data: { moveId: 33, pp: 35 } })
    expect(restored.field.pokemonStorage).toMatchObject({ currentBox: 0 })
    expect(restored.field.pokemonStorage.boxes[0]?.[0]).toMatchObject({ speciesId: 155, speciesName: 'HERICENDRE' })
    expect(restored.field.pokemonRuntime?.rng).toBe(restored.rng.lc)
    expect(Array.from({ length: 16 }, () => restored.rng.mt.nextU32())).toEqual(Array.from({ length: 16 }, () => rng.mt.nextU32()))
    expect(Array.from({ length: 16 }, () => restored.rng.lc.nextU16())).toEqual(Array.from({ length: 16 }, () => rng.lc.nextU16()))
  })

  it('migre un surnom legacy restant comme saisie joueur et le conserve au double round-trip', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(5489)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 155,
      level: 5,
      rng: rng.lc,
      personality: { kind: 'random' },
      individualValues: { kind: 'random' },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
      ballId: 4,
    })
    pokemon.nickname = 'ANCIEN'
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 1, language: 3, gameVersion: 7 },
      rng,
      { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
      createFieldScriptState('male', 'JO', { party: [pokemon] }),
    )
    Object.assign(saved.field.party[0]!, { nickname: 'ANCIEN' })

    const restored = restoreHgssSaveState(
      JSON.parse(JSON.stringify(saved)),
      'IPKF',
      catalog,
      () => new Date(),
    )

    expect(restored.field.party.members[0]).toMatchObject({ nickname: 'ANCIEN', nicknameSource: 'user-text' })
    const canonical = createHgssSaveState('IPKF', restored.profile, restored.rng, restored.world, restored.field)
    expect(canonical.field.party[0]).toMatchObject({ nickname: 'ANCIEN', nicknameSource: 'user-text' })
    expect(() => hgssDataOnlySaveAuthority.project(canonical)).not.toThrow()
    expect(restoreHgssSaveState(canonical, 'IPKF', catalog, () => new Date()).field.party.members[0])
      .toMatchObject({ nickname: 'ANCIEN', nicknameSource: 'user-text' })
  })

  it('migre les libellés legacy d’un échange PNJ et d’un œuf vers des références locales', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(44)
    const npcTradeCatalog = [{
      tradeId: 0, givenSpeciesId: 155, requestedSpeciesId: 152,
      individualValues: { hp: 1, attack: 2, defense: 3, speed: 4, specialAttack: 5, specialDefense: 6 },
      ability: 0, originalTrainerId: 4242, personality: 123, heldItemId: 0,
      originalTrainerGender: 'female' as const, language: 3,
      nickname: 'NOMLOCAL', originalTrainerName: 'OTLOCAL', unusedFlag: 0,
    }]
    const tradePokemon = createCanonicalPokemon(catalog, {
      speciesId: 155, level: 5, rng: rng.lc, personality: { kind: 'random' }, individualValues: { kind: 'random' },
      originalTrainer: { id: 4242, name: 'OTLOCAL', gender: 'female' },
      origin: { language: 3, gameVersion: 7, metLocation: 60, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    const egg = createCanonicalPokemon(catalog, {
      speciesId: 152, level: 1, rng: rng.lc, personality: { kind: 'random' }, individualValues: { kind: 'random' },
      originalTrainer: { id: 7, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 60, metLevel: 1, metTerrain: 0 }, ballId: 4,
    })
    egg.isEgg = true
    const saved = createHgssSaveState(
      'IPKF', { gender: 'male', name: 'JO', trainerId: 7, language: 3, gameVersion: 7 }, rng,
      { mapId: 60, tileX: 1, tileZ: 1, direction: 'south' },
      createFieldScriptState('male', 'JO', { party: [tradePokemon, egg] }),
    )
    Object.assign(saved.field.party[0]!, {
      nickname: 'NOMLOCAL',
      originalTrainer: { id: 4242, name: 'OTLOCAL', gender: 'female' },
    })
    Object.assign(saved.field.party[1]!, { nickname: 'ŒUF' })

    const restoredLegacy = restoreHgssSaveState(
      JSON.parse(JSON.stringify(saved)), 'IPKF', catalog, () => new Date(), undefined, undefined, {}, { npcTradeCatalog },
    )
    expect(restoredLegacy.field.party.members[0]).toMatchObject({
      nickname: 'NOMLOCAL', nicknameSource: 'local-ref', nicknameLocalRef: 1,
      originalTrainer: { name: 'OTLOCAL', nameSource: 'local-ref', localTradeId: 0 },
    })
    expect(restoredLegacy.field.party.members[1]).toMatchObject({
      nickname: 'ŒUF', nicknameSource: 'local-ref', nicknameLocalRef: 0,
    })

    const canonical = createHgssSaveState(
      'IPKF', restoredLegacy.profile, restoredLegacy.rng, restoredLegacy.world, restoredLegacy.field,
    )
    expect(JSON.stringify(canonical)).not.toContain('NOMLOCAL')
    expect(JSON.stringify(canonical)).not.toContain('OTLOCAL')
    expect(canonical.field.party[0]).toMatchObject({ nicknameLocalRef: 1, originalTrainer: { localTradeId: 0 } })
    expect(canonical.field.party[1]).toMatchObject({ nicknameLocalRef: 0 })
    const restoredCanonical = restoreHgssSaveState(
      canonical, 'IPKF', catalog, () => new Date(), undefined, undefined, {}, { npcTradeCatalog },
    )
    expect(restoredCanonical.field.party.members.map((pokemon) => pokemon.nickname)).toEqual(['NOMLOCAL', 'ŒUF'])
  })

  it('quarantaine le nom ambigu d’un OT externe legacy sans bloquer la sauvegarde suivante', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(45)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 155, level: 5, rng: rng.lc, personality: { kind: 'random' }, individualValues: { kind: 'random' },
      originalTrainer: { id: 7, name: 'AMBIGU', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 60, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    const legacy = createHgssSaveState(
      'IPKF', { gender: 'male', name: 'JO', trainerId: 7, language: 3, gameVersion: 7 }, rng,
      { mapId: 60, tileX: 1, tileZ: 1, direction: 'south' },
      createFieldScriptState('male', 'JO', { party: [pokemon] }),
    )
    Object.assign(legacy.field.party[0]!.originalTrainer, { id: 7, name: 'AMBIGU', gender: 'male' })
    delete legacy.field.party[0]!.originalTrainer.isPlayer
    const restoredLegacy = restoreHgssSaveState(legacy, 'IPKF', catalog, () => new Date())
    expect(restoredLegacy.field.party.members[0]?.originalTrainer).toMatchObject({ id: 7, name: 'AMBIGU', isPlayer: false })
    expect(restoredLegacy.field.party.members[0]?.originalTrainer.nameSource).toBeUndefined()
    const tradedKind = (party: CanonicalPokemon[]) => resolveFieldBattleExperienceRecipients({
      party, participantPartyIndexes: new Set([0]), player: { id: 7, name: 'JO', gender: 'male' }, nativeLanguage: 3,
      readHeldItem: () => ({ effect: 0, parameter: 0 }),
    })[0]?.modifiers.traded
    expect(tradedKind(restoredLegacy.field.party.members)).toBe('same-language')

    const rewritten = createHgssSaveState(
      'IPKF', restoredLegacy.profile, restoredLegacy.rng, restoredLegacy.world, restoredLegacy.field,
    )
    expect(rewritten.field.party[0]?.originalTrainer).toEqual({ id: 7, gender: 'male', isPlayer: false })
    expect(JSON.stringify(rewritten)).not.toContain('AMBIGU')
    expect(() => hgssDataOnlySaveAuthority.project(rewritten)).not.toThrow()
    const restoredCanonical = restoreHgssSaveState(rewritten, 'IPKF', catalog, () => new Date())
    expect(restoredCanonical.field.party.members[0]?.originalTrainer).toMatchObject({ name: '', isPlayer: false })
    expect(tradedKind(restoredCanonical.field.party.members)).toBe('same-language')
  })

  it('migre sans perte les noms legacy des groupes amis et profils Maison des Dresseurs', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(46)
    const legacy = createHgssSaveState(
      'IPKF', { gender: 'male', name: 'JO', trainerId: 7, language: 3, gameVersion: 7 }, rng,
      { mapId: 60, tileX: 1, tileZ: 1, direction: 'south' }, createFieldScriptState('male', 'JO'),
    )
    Object.assign(legacy.field.friendGroups![0]!, {
      groupName: 'JOHTO', memberName: 'AMI', memberGender: 'female', language: 3, groupId: 9, randomValue: 10,
    })
    legacy.field.trainerHouseEntries![0] = {
      trainerId: 99, spriteId: 1, language: 3, gameVersion: 7, gender: 'female', name: 'DISTANT',
      introMessage: { bank: 0, messageId: 1, fields: [10, 11] },
      winMessage: { bank: 1, messageId: 2, fields: [12, 13] },
      loseMessage: { bank: 2, messageId: 3, fields: [14, 15] },
      party: [],
    }

    const restoredLegacy = restoreHgssSaveState(legacy, 'IPKF', catalog, () => new Date())
    expect(isHgssFriendGroupActive(restoredLegacy.field.friendGroups[0])).toBe(true)
    expect(restoredLegacy.field.friendGroups[0]).toMatchObject({
      groupName: 'JOHTO', groupNameSource: 'user-text', memberName: 'AMI', memberNameSource: 'user-text',
    })
    expect(restoredLegacy.field.trainerHouseEntries[0]).toMatchObject({ name: 'DISTANT', nameSource: 'user-text' })

    const canonical = createHgssSaveState(
      'IPKF', restoredLegacy.profile, restoredLegacy.rng, restoredLegacy.world, restoredLegacy.field,
    )
    expect(() => hgssDataOnlySaveAuthority.project(canonical)).not.toThrow()
    const restoredCanonical = restoreHgssSaveState(canonical, 'IPKF', catalog, () => new Date())
    expect(isHgssFriendGroupActive(restoredCanonical.field.friendGroups[0])).toBe(true)
    expect(restoredCanonical.field.friendGroups[0]).toMatchObject({ groupName: 'JOHTO', memberName: 'AMI' })
    expect(restoredCanonical.field.trainerHouseEntries[0]).toMatchObject({ name: 'DISTANT', trainerId: 99 })
  })

  it('migre sans perte les noms ami et rival legacy issus de profils/saisie joueur', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(47)
    const legacy = createHgssSaveState(
      'IPKF', { gender: 'male', name: 'JO', trainerId: 7, language: 3, gameVersion: 7 }, rng,
      { mapId: 60, tileX: 1, tileZ: 1, direction: 'south' }, createFieldScriptState('male', 'JO'),
    )
    Object.assign(legacy.field, { friendName: 'LYRA', rivalName: 'ARGENT' })

    const restoredLegacy = restoreHgssSaveState(legacy, 'IPKF', catalog, () => new Date())
    expect(restoredLegacy.field).toMatchObject({
      friendName: 'LYRA', friendNameSource: 'user-text', rivalName: 'ARGENT', rivalNameSource: 'user-text',
    })
    const canonical = createHgssSaveState(
      'IPKF', restoredLegacy.profile, restoredLegacy.rng, restoredLegacy.world, restoredLegacy.field,
    )
    expect(() => hgssDataOnlySaveAuthority.project(canonical)).not.toThrow()
    const restoredCanonical = restoreHgssSaveState(canonical, 'IPKF', catalog, () => new Date())
    expect(restoredCanonical.field).toMatchObject({ friendName: 'LYRA', rivalName: 'ARGENT' })

    delete legacy.field.friendName
    legacy.field.rivalName = 'SILVER'
    const defaultRival = restoreHgssSaveState(legacy, 'IPKF', catalog, () => new Date())
    expect(defaultRival.field.rivalNameSource).toBeUndefined()
    expect(createHgssSaveState('IPKF', defaultRival.profile, defaultRival.rng, defaultRival.world, defaultRival.field).field)
      .not.toHaveProperty('rivalName')
  })

  it('rejects incompatible ROMs and save versions', () => {
    const catalog = createPokemonTestCatalog()
    expect(() => restoreHgssSaveState({ version: 2 }, 'IPKF', catalog, () => new Date())).toThrow('version')
    expect(() => restoreHgssSaveState({ version: 1, romGameCode: 'IPGE' }, 'IPKF', catalog, () => new Date())).toThrow('ne correspond pas')
  })

  it('migrates a retained shiny Pokémon into old Pokédex snapshots', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(7)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 155, level: 5, rng: rng.lc, personality: { kind: 'random' }, individualValues: { kind: 'random' },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 }, ballId: 4,
    })
    pokemon.shiny = true
    const saved = createHgssSaveState('IPKF', { gender: 'male', name: 'JO', trainerId: 1, language: 3, gameVersion: 7 }, rng,
      { mapId: 61, tileX: 1, tileZ: 1, direction: 'south' }, createFieldScriptState('male', 'JO', { party: [pokemon], caughtSpeciesIds: [155] }))
    delete saved.field.pokedex?.caughtShinySpeciesIds
    const restored = restoreHgssSaveState(saved, 'IPKF', catalog, () => new Date())
    expect(restored.field.pokedex.caughtShinySpeciesIds.has(155)).toBe(true)
  })

  it('rejette une pile d’inventaire impossible avant de restaurer la Map', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(1)
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 1, language: 3, gameVersion: 7 },
      rng,
      { mapId: 61, tileX: 1, tileZ: 1, direction: 'south' },
      createFieldScriptState('male', 'JO'),
    )
    saved.field.inventory = [[328, 100]]

    expect(() => restoreHgssSaveState(saved, 'IPKF', catalog, () => new Date(), createItemCatalog())).toThrow('field.inventory[0][1]')
  })

  it('restores a legacy V1 save without a follower snapshot', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(5489)
    const field = createFieldScriptState('male', 'JO', { followMonActive: true, followMonMovementPaused: true })
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 1, language: 3, gameVersion: 7 },
      rng,
      { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
      field,
    )
    delete saved.options
    delete saved.field.followerMood
    delete saved.field.pokemonStorage
    delete saved.field.apricornBox
    delete saved.field.harvestedApricornTrees
    delete saved.field.apricornTreeDay
    delete saved.field.poisonStepCounter
    delete saved.field.friendshipStepCounter
    saved.field.variables.push([0x4000, 475], [0x8000, 99], [0x800d, 4])
    saved.field.followMonMovementPaused = true
    saved.field.followMonInhibited = true
    saved.field.pendingPhoneCall = { callerId: 0, parameter1: 2, parameter2: 0 }
    // Les anciennes sauvegardes du port pouvaient avoir omis Maman, alors
    // que SavePokegear_PhonebookInit l'inscrit toujours dans le slot 0.
    saved.field.phoneContacts = []

    const restored = restoreHgssSaveState(JSON.parse(JSON.stringify(saved)), 'IPKF', catalog, () => new Date())

    expect(restored.world.follower).toBeUndefined()
    expect(restored.field.followMonActive).toBe(true)
    expect(restored.field.followMonMovementPaused).toBe(false)
    expect(restored.field.followMonInhibited).toBe(false)
    expect(restored.field.pendingPhoneCall).toBeUndefined()
    expect([...restored.field.variables]).toEqual([])
    expect(restored.field.followerMood).toBe(0)
    expect([...restored.field.phoneContacts]).toEqual([0])
    expect(restored.field.pokemonStorage.boxes.flat().every((pokemon) => pokemon === undefined)).toBe(true)
    expect(restored.field.apricornBox).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect([...restored.field.harvestedApricornTrees]).toEqual([])
    expect(restored.field.poisonStepCounter).toBe(0)
    expect(restored.field.friendshipStepCounter).toBe(0)
    expect(restored.options).toEqual({ textSpeed: 'normal', battleAnimations: true, localWeather: false })
  })

  it('repairs the native menu unlocks of a progressed legacy V1 save', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(5489)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 155,
      level: 5,
      rng: rng.lc,
      personality: { kind: 'random' },
      individualValues: { kind: 'random' },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
      ballId: 4,
    })
    const field = createFieldScriptState('male', 'JO', { party: [pokemon], starterChoice: 1 })
    field.phoneContacts.add(1)
    field.pokegearCards.add(1)
    field.kenjiActive = true
    field.kenjiWaitDays = 3
    field.kenjiDay = '2026-8-20'
    field.radioMusicSequenceId = 1102
    field.poisonStepCounter = 3
    field.friendshipStepCounter = 127
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 1, language: 3, gameVersion: 7 },
      rng,
      { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
      field,
    )
    saved.field.flags = []

    const restored = restoreHgssSaveState(saved, 'IPKF', catalog, () => new Date())

    expect(restored.field.flags).toEqual(new Set([0x11b, 0x11d, 0x11e, 0x6a, 0x9c]))
    expect(restored.field.party.members).toHaveLength(1)
    expect(restored.field.pokegearCards.has(1)).toBe(true)
    expect(restored.field).toMatchObject({ kenjiActive: true, kenjiWaitDays: 3, kenjiDay: '2026-8-20' })
    expect(restored.field.radioMusicSequenceId).toBe(1102)
    expect(restored.field.poisonStepCounter).toBe(3)
    expect(restored.field.friendshipStepCounter).toBe(127)
  })

  it('restaure la Carte du Pokématos quand la scène ROM de sa remise est déjà terminée', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(5489)
    const field = createFieldScriptState('male', 'JO')
    field.variables.set(0x4073, 2)
    const saved = createHgssSaveState('IPKF', { gender: 'male', name: 'JO', trainerId: 1, language: 3, gameVersion: 7 }, rng, { mapId: 64, tileX: 10, tileZ: 10, direction: 'south' }, field)
    saved.field.pokegearCards = []

    expect(restoreHgssSaveState(saved, 'IPKF', catalog, () => new Date()).field.pokegearCards.has(1)).toBe(true)
  })

  it('does not expose gameplay menus in a legacy save before Maman gives them', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(5489)
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'female', name: 'JO', trainerId: 1, language: 3, gameVersion: 7 },
      rng,
      { mapId: 60, tileX: 6, tileZ: 6, direction: 'south' },
      createFieldScriptState('female', 'JO'),
    )

    const restored = restoreHgssSaveState(saved, 'IPKF', catalog, () => new Date())

    expect(restored.field.flags).toEqual(new Set())
    expect(restored.newGamePlus).toBeUndefined()
  })

  it('round-trips an optional NG+ profile without adding it to normal saves', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(5489)
    const field = createFieldScriptState('male', 'JO')
    const profile = {
      format: 'pokemaster-hgss-new-game-plus' as const,
      version: 1 as const,
      source: { gameCode: 'IPKF', slot: 1 as const, playerName: 'JO', leagueCompletedAt: '2026-08-24T12:00:00.000Z' },
      modules: [{ id: 'carry-money', revision: 1, config: { percentage: 100 } }],
    }
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO+', trainerId: 2, language: 3, gameVersion: 7 },
      rng,
      { mapId: 60, tileX: 6, tileZ: 6, direction: 'south' },
      field,
      undefined,
      undefined,
      undefined,
      profile,
    )

    const restoredProfile = restoreHgssSaveState(JSON.parse(JSON.stringify(saved)), 'IPKF', catalog, () => new Date()).newGamePlus
    expect(restoredProfile).toEqual(saved.newGamePlus)
    expect(restoredProfile?.source).toMatchObject({ gameVersion: 7, language: 3, playerNameSource: 'user-text' })
    expect(restoredProfile?.source).not.toHaveProperty('gameCode')
  })

  it('refuses an NG+ profile linked to another ROM at save and restore boundaries', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(5489)
    const profile = {
      format: 'pokemaster-hgss-new-game-plus' as const,
      version: 1 as const,
      source: { gameCode: 'IPGE', slot: 1 as const, playerName: 'JO', leagueCompletedAt: '2026-08-24T12:00:00.000Z' },
      modules: [{ id: 'carry-money', revision: 1, config: { percentage: 100 } }],
    }
    const argumentsBeforeProfile = [
      'IPKF',
      { gender: 'male' as const, name: 'JO+', trainerId: 2, language: 3, gameVersion: 7 },
      rng,
      { mapId: 60, tileX: 6, tileZ: 6, direction: 'south' as const },
      createFieldScriptState('male', 'JO'),
      undefined,
      undefined,
      undefined,
    ] as const

    expect(() => createHgssSaveState(...argumentsBeforeProfile, profile)).toThrow('ne correspond pas a la ROM')
    const normal = createHgssSaveState(...argumentsBeforeProfile)
    expect(() => restoreHgssSaveState({ ...normal, newGamePlus: profile }, 'IPKF', catalog, () => new Date()))
      .toThrow('ne correspond pas a la ROM')
  })

  it('round-trips the optional versioned extension envelope and rejects malformed entries', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(9)
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 2, language: 3, gameVersion: 7 },
      rng,
      { mapId: 60, tileX: 6, tileZ: 6, direction: 'south' },
      createFieldScriptState('male', 'JO'),
      undefined,
      undefined,
      undefined,
      undefined,
      { 'new-game-plus.nuzlocke': { version: 1, value: {
        format: 'pokemaster-hgss-nuzlocke-state', version: 1, sections: [],
      } } },
    )

    expect(restoreHgssSaveState(JSON.parse(JSON.stringify(saved)), 'IPKF', catalog, () => new Date()).extensions).toEqual(saved.extensions)
    expect(() => restoreHgssSaveState({
      ...saved,
      extensions: { broken: { version: 0, value: null } },
    }, 'IPKF', catalog, () => new Date())).toThrow('extensions')
  })

  it('round-trips a shared campaign checkpoint and rejects a field/progression mismatch', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(10)
    const field = createFieldScriptState('male', 'JO')
    field.flags.add(0x20)
    field.variables.set(0x4010, 4)
    const campaign = createHgssSharedCampaignSaveExtension(
      createHgssSharedCampaignProgressionSeed(
        field,
        '0123456789abcdef0123456789abcdef',
        3,
      ),
      'campaign:save-test',
      [],
      'player:local',
    )
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 2, language: 3, gameVersion: 7 },
      rng,
      { mapId: 60, tileX: 6, tileZ: 6, direction: 'south' },
      field,
      undefined,
      undefined,
      undefined,
      undefined,
      replaceHgssSharedCampaignSaveExtension(undefined, campaign),
    )

    const serialized = JSON.parse(JSON.stringify(saved))
    expect(restoreHgssSaveState(serialized, 'IPKF', catalog, () => new Date()).extensions)
      .toEqual(saved.extensions)

    const value = serialized.extensions[hgssSharedCampaignSaveExtensionKey].value
    value.appliedProgression.milestoneIds.push('field.flag.0030')
    expect(() => restoreHgssSaveState(serialized, 'IPKF', catalog, () => new Date()))
      .toThrow(/base locale|snapshot partagé/)
  })

  it('migre les anciens Pokémon avec des identifiants stables, uniques et sans RNG de gameplay', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(12)
    const createPokemon = (speciesId: number) => createCanonicalPokemon(catalog, {
      speciesId, level: 5, rng: rng.lc, personality: { kind: 'random' }, individualValues: { kind: 'random' },
      originalTrainer: { id: 7, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 60, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 7, language: 3, gameVersion: 7 },
      rng,
      { mapId: 60, tileX: 1, tileZ: 1, direction: 'south' },
      createFieldScriptState('male', 'JO', { party: [createPokemon(152), createPokemon(155)] }),
    )
    delete saved.field.party[0]!.instanceId
    delete saved.field.party[1]!.instanceId
    const first = restoreHgssSaveState(saved, 'IPKF', catalog, () => new Date())
    const second = restoreHgssSaveState(saved, 'IPKF', catalog, () => new Date())
    const firstIds = first.field.party.members.map(({ instanceId }) => instanceId)

    expect(firstIds.every(isPokemonInstanceId)).toBe(true)
    expect(new Set(firstIds).size).toBe(2)
    expect(second.field.party.members.map(({ instanceId }) => instanceId)).toEqual(firstIds)
    expect(Array.from({ length: 8 }, () => first.rng.lc.nextU16())).toEqual(Array.from({ length: 8 }, () => second.rng.lc.nextU16()))
    const canonical = createHgssSaveState('IPKF', first.profile, first.rng, first.world, first.field)
    expect(() => hgssDataOnlySaveAuthority.project(canonical)).not.toThrow()

    saved.field.party[1]!.instanceId = saved.field.party[0]!.instanceId = firstIds[0]
    expect(() => restoreHgssSaveState(saved, 'IPKF', catalog, () => new Date())).toThrow('même identifiant')
  })

  it('répare le flag Game Clear des sauvegardes créées par l’ancien HOFCredits incomplet', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(5489)
    const field = createFieldScriptState('male', 'JO')
    field.flags.add(0x97e)
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 1, language: 3, gameVersion: 7 },
      rng,
      { mapId: 306, tileX: 6, tileZ: 6, direction: 'south' },
      field,
    )

    expect(restoreHgssSaveState(saved, 'IPKF', catalog, () => new Date()).field.flags.has(0x964)).toBe(true)
  })

  it.each([26, 2026])('accepts the legacy and civil met-date year formats (%i)', (year) => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(5489)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 155,
      level: 5,
      rng: rng.lc,
      personality: { kind: 'random' },
      individualValues: { kind: 'random' },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: {
        language: 3,
        gameVersion: 7,
        metLocation: 126,
        metLevel: 5,
        metTerrain: 12,
        metDate: { year, month: 8, day: 15 },
      },
      ballId: 4,
    })
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 1, language: 3, gameVersion: 7 },
      rng,
      { mapId: 61, tileX: 1, tileZ: 1, direction: 'south' },
      createFieldScriptState('male', 'JO', { party: [pokemon] }),
    )

    expect(restoreHgssSaveState(saved, 'IPKF', catalog, () => new Date()).field.party.members[0]?.origin.metDate?.year).toBe(year)
  })

  it.each([
    ['profile.name', (save: HgssSaveStateV1) => { save.profile.name = 'ABCDEFGH' }],
    ['field.playerName', (save: HgssSaveStateV1) => { save.field.playerName = 'ABCDEFGH' }],
    ['field.friendName', (save: HgssSaveStateV1) => { save.field.friendName = 'ABCDEFGH' }],
    ['field.rivalName', (save: HgssSaveStateV1) => { save.field.rivalName = 'ABCDEFGH' }],
    ['field.party[0].nickname', (save: HgssSaveStateV1) => { save.field.party[0]!.nickname = 'ABCDEFGHIJK' }],
    ['field.party[0].originalTrainer.name', (save: HgssSaveStateV1) => { save.field.party[0]!.originalTrainer.name = 'ABCDEFGH' }],
    ['field.party[0].instanceId', (save: HgssSaveStateV1) => {
      save.field.party[0]!.instanceId = deriveLegacyPokemonInstanceId('ROM_PRESENTATION_CANARY', 'party/0')
    }],
    ['field.friendGroups[0].groupName', (save: HgssSaveStateV1) => { save.field.friendGroups![0]!.groupName = 'ABCDEFGH' }],
    ['field.friendGroups[0].memberName', (save: HgssSaveStateV1) => { save.field.friendGroups![0]!.memberName = 'ABCDEFGH' }],
    ['field.trainerHouseEntries[0].name', (save: HgssSaveStateV1) => { save.field.trainerHouseEntries![0]!.name = 'ABCDEFGH' }],
    ['field.photoAlbum.slots[0].playerName', (save: HgssSaveStateV1) => {
      const album = save.field.photoAlbum as { slots: Array<{ playerName?: string }> }
      album.slots[0]!.playerName = 'ABCDEFGH'
    }],
    ['field.photoAlbum.slots[0].leadPokemonNickname', (save: HgssSaveStateV1) => {
      const album = save.field.photoAlbum as { slots: Array<{ leadPokemonNickname?: string }> }
      album.slots[0]!.leadPokemonNickname = 'ABCDEFGHIJK'
    }],
    ['field.safariZone.linkLeader.name', (save: HgssSaveStateV1) => {
      if (!save.field.safariZone || !('linkLeader' in save.field.safariZone)) throw new Error('État Safari moderne attendu.')
      save.field.safariZone.linkLeader.name = 'ABCDEFGH'
    }],
    ['field.frontierSession.statTrainerMons[0][0].resolvedRomName', (save: HgssSaveStateV1) => {
      Object.assign(save.field.frontierSession!.statTrainerMons[0]![0]!, { resolvedRomName: 'ROM_CANARY' })
    }],
    ['field.apricornTreeDay', (save: HgssSaveStateV1) => { save.field.apricornTreeDay = 'TEXTE ROM' }],
    ['field.kenjiDay', (save: HgssSaveStateV1) => { save.field.kenjiDay = '2026-2-31' }],
  ] as const)('refuse le texte hors frontière à %s avant attestation', (_path, poison) => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(88)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 155, level: 5, rng: rng.lc, personality: { kind: 'random' }, individualValues: { kind: 'random' },
      originalTrainer: { id: 7, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 60, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    Object.assign(pokemon, { nickname: 'FLAMME', nicknameSource: 'user-text' as const })
    const field = createFieldScriptState('male', 'JO', { party: [pokemon], friendName: 'LYRA', friendNameSource: 'user-text', rivalName: 'ARGENT', rivalNameSource: 'user-text' })
    field.apricornTreeDay = '2026-3-12'
    field.kenjiDay = '2026-8-20'
    field.friendGroups[0] = {
      groupName: 'JOHTO', groupNameSource: 'user-text', memberName: 'AMI', memberNameSource: 'user-text',
      memberGender: 'female', language: 3, groupId: 9, randomValue: 10,
    }
    field.frontierSession = {
      towerMode: 0, requiredCount: 3, partySlots: [0], resumed: true, multiBattleAllyId: 0,
      statTrainerMons: [[{ speciesId: 152, firstMoveId: 33 }]],
    }
    field.trainerHouseEntries[0] = {
      trainerId: 99, spriteId: 1, language: 3, gameVersion: 7, gender: 'female', name: 'DISTANT', nameSource: 'user-text',
      introMessage: { bank: 0, messageId: 1, fields: [10, 11] },
      winMessage: { bank: 1, messageId: 2, fields: [12, 13] },
      loseMessage: { bank: 2, messageId: 3, fields: [14, 15] }, party: [],
    }
    Object.assign(field.safariZone.linkLeader, { name: 'AMI', nameSource: 'user-text' as const })
    const saved = createHgssSaveState(
      'IPKF', { gender: 'male', name: 'JO', trainerId: 7, language: 3, gameVersion: 7 }, rng,
      { mapId: 60, tileX: 1, tileZ: 1, direction: 'south' }, field,
    )
    if (!saved.field.photoAlbum || saved.field.photoAlbum.schemaVersion !== 2) throw new Error('Album data-only attendu.')
    saved.field.photoAlbum.slots[0] = {
      photoDataId: 37, playerGenderBit: 0, numMons: 1, playerName: 'JO', playerNameSource: 'user-text',
      leadPokemonNickname: 'FLAMME', leadPokemonNameSource: 'user-text', avatarState: 0,
      rtc: { year: 26, month: 8, day: 22, weekday: 6, hour: 18, minute: 45 },
      party: Array.from({ length: 6 }, (_, index) => ({
        speciesId: index === 0 ? 155 : 0, form: 0, shiny: false, genderBit: 0,
      })),
    }
    expect(() => hgssDataOnlySaveAuthority.project(saved)).not.toThrow()

    const poisoned = structuredClone(saved)
    poison(poisoned)
    expect(() => hgssDataOnlySaveAuthority.project(poisoned)).toThrow()
  })

  it.each([
    ['romIdentity.gameVersion', (save: HgssSaveStateV1) => { save.romIdentity!.gameVersion = 8 }],
    ['romIdentity.language', (save: HgssSaveStateV1) => { save.romIdentity!.language = 2 }],
    ['field.playerName', (save: HgssSaveStateV1) => { save.field.playerName = 'AUTRE' }],
    ['field.gender', (save: HgssSaveStateV1) => { save.field.gender = 'female' }],
  ] as const)('refuse une identité canonique incohérente à %s', (_path, poison) => {
    const rng = createHgssSessionRng(89)
    const saved = createHgssSaveState(
      'IPKF', { gender: 'male', name: 'JO', trainerId: 7, language: 3, gameVersion: 7 }, rng,
      { mapId: 60, tileX: 1, tileZ: 1, direction: 'south' }, createFieldScriptState('male', 'JO'),
    )
    poison(saved)
    expect(() => hgssDataOnlySaveAuthority.project(saved)).toThrow('correspond')
  })

  it.each([
    { path: 'world.tileX', corrupt: (save: HgssSaveStateV1) => { (save.world as unknown as { tileX: unknown }).tileX = '4' } },
    { path: 'field.inventory[0][1]', corrupt: (save: HgssSaveStateV1) => { (save.field as unknown as { inventory: unknown }).inventory = [[17, 'five']] } },
    { path: 'field.party[0].moves', corrupt: (save: HgssSaveStateV1) => { (save.field.party[0] as unknown as { moves: unknown }).moves = 'invalid' } },
    { path: 'field.party[0].nicknameSource', corrupt: (save: HgssSaveStateV1) => {
      save.field.party[0]!.nickname = 'FAUX'
      ;(save.field.party[0] as unknown as { nicknameSource: unknown }).nicknameSource = 'rom'
    } },
    { path: 'field.party[0].nicknameSource', corrupt: (save: HgssSaveStateV1) => {
      save.field.party[0]!.nicknameSource = 'user-text'
    } },
    { path: 'field.player.groundHeight', corrupt: (save: HgssSaveStateV1) => {
      ;(save.field.player as unknown as { groundHeight: unknown }).groundHeight = '10.5'
    } },
    { path: 'field.player.movement', corrupt: (save: HgssSaveStateV1) => {
      ;(save.field.player as unknown as { movement: unknown }).movement = '48'
    } },
    { path: 'world.follower.movement', corrupt: (save: HgssSaveStateV1) => { save.world.follower = { tileX: 1, tileZ: 1, direction: 'south', movement: -1 } } },
    { path: 'options.textSpeed', corrupt: (save: HgssSaveStateV1) => { if (save.options) (save.options as unknown as { textSpeed: unknown }).textSpeed = 'instant' } },
    { path: 'field.poisonStepCounter', corrupt: (save: HgssSaveStateV1) => { save.field.poisonStepCounter = 4 } },
    { path: 'field.friendshipStepCounter', corrupt: (save: HgssSaveStateV1) => { save.field.friendshipStepCounter = 128 } },
  ])('rejects a corrupt $path value with its exact save path', ({ path, corrupt }) => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(5489)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 155,
      level: 5,
      rng: rng.lc,
      personality: { kind: 'random' },
      individualValues: { kind: 'random' },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
      ballId: 4,
    })
    const field = createFieldScriptState('male', 'JO', { party: [pokemon] })
    const saved = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 1, language: 3, gameVersion: 7 },
      rng,
      { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
      field,
    )
    const corruptSave = structuredClone(saved)
    corrupt(corruptSave)

    expect(() => restoreHgssSaveState(corruptSave, 'IPKF', catalog, () => new Date())).toThrow(path)
  })

  it('refuse une chaîne injectée à la place de chaque feuille numérique ou booléenne canonique', () => {
    const catalog = createPokemonTestCatalog()
    const rng = createHgssSessionRng(0x71c0ffee)
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 155, level: 5, rng: rng.lc, personality: { kind: 'random' }, individualValues: { kind: 'random' },
      originalTrainer: { id: 7, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 60, metLevel: 5, metTerrain: 0 }, ballId: 4,
    })
    const canonical = hgssDataOnlySaveAuthority.project(createHgssSaveState(
      'IPKF', { gender: 'male', name: 'JO', trainerId: 7, language: 3, gameVersion: 7 }, rng,
      { mapId: 60, tileX: 1, tileZ: 1, direction: 'south' },
      createFieldScriptState('male', 'JO', { party: [pokemon] }),
    ))
    const paths: Array<Array<string | number>> = []
    const visit = (value: unknown, path: Array<string | number>): void => {
      if (typeof value === 'number' || typeof value === 'boolean') {
        paths.push(path)
      } else if (Array.isArray(value)) {
        value.forEach((entry, index) => visit(entry, [...path, index]))
      } else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, entry]) => visit(entry, [...path, key]))
      }
    }
    visit(canonical, [])

    const acceptedPaths: string[] = []
    for (const path of paths) {
      const poisoned = structuredClone(canonical) as unknown as Record<string | number, unknown>
      let parent: Record<string | number, unknown> | unknown[] = poisoned
      for (const segment of path.slice(0, -1)) parent = parent[segment] as Record<string | number, unknown>
      parent[path.at(-1)!] = 'ROM_TYPE_CANARY'
      try {
        hgssDataOnlySaveAuthority.decode(poisoned)
        acceptedPaths.push(path.map((part) => typeof part === 'number' ? `[${part}]` : `.${part}`).join('').slice(1))
      } catch {
        // Chaque substitution doit être rejetée par le schéma exact.
      }
    }

    expect(acceptedPaths).toEqual([])
  }, 15_000)
})
