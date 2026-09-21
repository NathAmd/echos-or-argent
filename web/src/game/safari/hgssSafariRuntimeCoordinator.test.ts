import { describe, expect, it, vi } from 'vitest'
import type { HgssSafariAreaEncounterData, HgssSafariEncounterCatalog, HgssSafariEncounterMethodData } from '../../rom/safari/safariEncounterData'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonParty } from '../pokemon/pokemonParty'
import { createPokemonStorage } from '../pokemon/pokemonStorage'
import { createHgssPokedex, markPokemonCaught } from '../pokedex/hgssPokedex'
import { commitHgssWildCaptureBeforeStorage, completeHgssWildCaptureAfterBattle, hasHgssPokemonNicknameInput, HGSS_CAUGHT_POKEMON_GAME_STAT_ID, HGSS_NICKNAMES_GIVEN_GAME_STAT_ID, prepareHgssWildCaptureProgression, type HgssWildCaptureProgressState } from '../encounters/hgssWildCaptureFinalizer'
import { createHgssSafariState, startHgssSafariSession, type HgssSafariAreaId } from './hgssSafariState'
import { isHgssSafariChallengeComplete } from './hgssSafariProgression'
import { attemptHgssSafariBattleAction, createHgssSafariBattleState } from './hgssSafariBattle'
import {
  HGSS_SAFARI_BALLS_OUT_SCRIPT_ID,
  HGSS_SAFARI_MET_LOCATION,
  HGSS_SAFARI_REENTRY_SCRIPT_ID,
  HGSS_SAFARI_STORAGE_FULL_SCRIPT_ID,
  HGSS_SYS_MET_BILL_FLAG_ID,
  beginHgssSafariCaptureRegistration,
  commitHgssSafariCapture,
  completeHgssSafariCaptureSequence,
  createHgssSafariTransactionalActionPolicy,
  createHgssSafariRuntimePokemon,
  finalizeHgssSafariCapture,
  fadeHgssSafariCapturedBall,
  getHgssSafariCaptureBlock,
  HgssSafariCaptureBlockedError,
  prepareHgssSafariCapture,
  prepareHgssSafariRuntimeEncounter,
  prepareHgssSafariRuntimeEncounterAt,
  resolveHgssSafariExitRoute,
  resolveHgssSafariExitScript,
  resolveHgssSafariStorageMessageId,
  type HgssSafariRuntimeContext,
  type HgssSafariRuntimeOptions,
} from './hgssSafariRuntimeCoordinator'

const times = ['morning', 'day', 'night'] as const
const methods = ['land', 'surf', 'oldRod', 'goodRod', 'superRod'] as const

function safariCatalog(): HgssSafariEncounterCatalog {
  const methodData = (speciesId: number): HgssSafariEncounterMethodData => ({
    bonusCount: 1,
    base: Object.fromEntries(times.map((time) => [time, Array.from({ length: 10 }, () => ({ speciesId, level: 17 }))])) as HgssSafariEncounterMethodData['base'],
    bonus: Object.fromEntries(times.map((time) => [time, [{ speciesId, level: 17 }]])) as HgssSafariEncounterMethodData['bonus'],
    bonusConditions: [{ blockType1: 1, blockCount1: 255, blockType2: 0, blockCount2: 0 }],
  })
  return Array.from({ length: 12 }, (_, areaId): HgssSafariAreaEncounterData => ({
    areaId: areaId as HgssSafariAreaId,
    methods: Object.fromEntries(methods.map((method, index) => [method, methodData(74 + index)])) as HgssSafariAreaEncounterData['methods'],
  }))
}

function createContext(): HgssSafariRuntimeContext {
  const catalog = createPokemonTestCatalog()
  const trainer = { id: 123, name: 'LUTH', gender: 'male' as const }
  const lead = createCanonicalPokemon(catalog, {
    speciesId: 152,
    level: 20,
    rng: createHgssLcrng(1),
    personality: { kind: 'fixed', value: 12 },
    individualValues: { kind: 'fixed', value: 12 },
    originalTrainer: trainer,
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 20, metTerrain: 0 },
    ballId: 4,
  })
  const safariZone = startHgssSafariSession(createHgssSafariState(0), 0)
  const pokedex = createHgssPokedex({ enabled: true })
  let preparedPokemon: CanonicalPokemon | undefined
  return {
    inventory: {
      battleAnimationCatalog: {} as HgssSafariRuntimeContext['inventory']['battleAnimationCatalog'],
      battleBackgroundResolver: (() => { throw new Error('inutilisé') }) as HgssSafariRuntimeContext['inventory']['battleBackgroundResolver'],
      battleMessages: { 871: 'DEX', 1174: 'SOMEONE', 1175: 'BILL', 1176: 'SOMEONE2', 1177: 'BILL2' },
      battlePokemonSpriteResolver: (() => { throw new Error('inutilisé') }) as HgssSafariRuntimeContext['inventory']['battlePokemonSpriteResolver'],
      itemCatalog: { items: [] } as unknown as HgssSafariRuntimeContext['inventory']['itemCatalog'],
      pokemonCatalog: catalog,
      safariEncounterCatalog: safariCatalog(),
      storageBoxNames: Array.from({ length: 18 }, (_, index) => `B${index + 1}`),
    },
    safariZone,
    party: createPokemonParty([lead]),
    pokemonStorage: createPokemonStorage(),
    pokedex,
    eventFlags: new Set(),
    progression: {
      recordEncounterStarted: () => undefined,
      recordOpponentFled: () => undefined,
      prepareCapture: (pokemon) => {
        preparedPokemon = pokemon
        const alreadyCaught = pokedex.caughtSpeciesIds.has(pokemon.speciesId)
        return { speciesId: pokemon.speciesId, wasAlreadyCaught: alreadyCaught, registeredNewSpecies: !alreadyCaught, scoreEventIds: alreadyCaught ? [] : [21 as const], scoreAdded: alreadyCaught ? 0 : 20 }
      },
      commitCaptureBeforeStorage: (_, nickname) => {
        expect(nickname === undefined || typeof nickname === 'string').toBe(true)
        if (!preparedPokemon) throw new Error('Pokémon de test absent.')
        markPokemonCaught(pokedex, preparedPokemon, 3)
      },
      completeCaptureAfterBattle: () => undefined,
    },
    pokemonRuntime: { catalog, rng: createHgssLcrng(7), trainer, language: 3, gameVersion: 7 },
    playerName: trainer.name,
    world: { mapId: 357, tileX: 32, tileZ: 32, battleBackgroundId: 1, battleTerrainId: 7, region: 0, hour: 12, battlePaletteTime: 1 },
  }
}

describe('coordination du runtime Safari HGSS', () => {
  it('attend BALL_ANIM_FADE sur la seule Ball capturée du joueur', async () => {
    vi.useFakeTimers()
    const animate = vi.fn(() => ({ finish: vi.fn(), cancel: vi.fn() }))
    const ball = { animate, hidden: false, style: {} } as unknown as HTMLElement
    const querySelector = vi.fn((selector: string) => selector === '.battle-pokeball-player' ? ball : null)
    let completed = false
    const playback = fadeHgssSafariCapturedBall({ querySelector } as unknown as HTMLElement).then(() => { completed = true })
    await Promise.resolve()
    expect(querySelector).toHaveBeenCalledWith('.battle-pokeball-player')
    expect(animate).toHaveBeenCalledOnce()
    expect(completed).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    await playback
    expect(animate).toHaveBeenCalledTimes(2)
    expect(completed).toBe(true)
    vi.useRealTimers()
  })

  it('substitue la table de la parcelle active sans retomber sur la table de carte', () => {
    const context = createContext()
    expect(prepareHgssSafariRuntimeEncounter(context, 'land')).toMatchObject({
      method: 'safari', safariMethod: 'land', areaSlot: 0, areaId: 0, speciesId: 74, level: 17,
    })
    context.world.tileX = 31
    expect(prepareHgssSafariRuntimeEncounter(context, 'land')).toBeUndefined()
  })

  it('prepare une case visible avec heure et RNG isoles sans muter le contexte de jeu', () => {
    const context = createContext()
    context.world.tileX = 31
    context.world.hour = 6
    const gameplaySeed = context.pokemonRuntime.rng.getSeed()
    const visibleRng = createHgssLcrng(0x1020_3040)
    const visibleSeed = visibleRng.getSeed()

    expect(prepareHgssSafariRuntimeEncounterAt(context, {
      method: 'surf', worldTileX: 32, worldTileZ: 32, hour: 22, rng: visibleRng, isSweetScent: true,
    })).toMatchObject({
      method: 'safari', safariMethod: 'surf', time: 'night', areaSlot: 0, speciesId: 75,
    })
    expect(context.world).toMatchObject({ tileX: 31, tileZ: 32, hour: 6 })
    expect(context.pokemonRuntime.rng.getSeed()).toBe(gameplaySeed)
    expect(visibleRng.getSeed()).not.toBe(visibleSeed)
  })

  it('crée le Pokémon avec le lieu Safari natif et conserve le meneur pour la génération', () => {
    const context = createContext()
    const encounter = prepareHgssSafariRuntimeEncounter(context, 'surf')!
    const pokemon = createHgssSafariRuntimePokemon(encounter, context)
    expect(pokemon.origin).toMatchObject({ metLocation: HGSS_SAFARI_MET_LOCATION, metLevel: 17, metTerrain: 7 })
    expect(pokemon.ballId).toBe(4)
  })

  it('valide atomiquement Équipe, Pokédex et Safari Ball', () => {
    const context = createContext()
    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const result = commitHgssSafariCapture(context, pokemon)
    expect(result.joinedParty).toBe(true)
    expect(result.pokemon.ballId).toBe(5)
    expect(context.party.members).toHaveLength(2)
    expect(context.party.members[1]!.ballId).toBe(5)
    expect(isHgssSafariChallengeComplete(0, context.party.members, context.pokemonRuntime.trainer.id)).toBe(true)
    expect(context.pokedex.caughtSpeciesIds.has(pokemon.speciesId)).toBe(true)
    expect(result.presentation).toEqual([{ messageId: 871, values: [pokemon.speciesName], advance: 'automatic', minimumFrames: 30 }])
  })

  it('diffère le rangement jusqu’au choix du surnom et le conserve au commit', () => {
    const context = createContext()
    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const pending = prepareHgssSafariCapture(context, pokemon)
    expect(context.party.members).toHaveLength(1)
    expect(context.pokedex.caughtSpeciesIds.has(pokemon.speciesId)).toBe(false)
    const result = finalizeHgssSafariCapture(context, pending, 'ROC')
    expect(result.pokemon.nickname).toBe('ROC')
    expect(context.party.members[1]?.nickname).toBe('ROC')
    expect(context.pokedex.caughtSpeciesIds.has(pokemon.speciesId)).toBe(true)
  })

  it('attend la fiche Pokédex seulement à la première capture, avant le surnom', async () => {
    const context = createContext()
    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const order: string[] = []
    let releaseRegistration: (() => void) | undefined
    const registration = new Promise<void>((resolve) => { releaseRegistration = resolve })
    const callbacks = {
      presentPokedexRegistration: () => { order.push('pokedex'); return registration },
      requestNickname: async () => { order.push('nickname'); return 'ROC' },
    }

    const firstPromise = completeHgssSafariCaptureSequence(
      context,
      prepareHgssSafariCapture(context, pokemon),
      'PROMPT',
      callbacks,
    )
    await Promise.resolve()
    expect(order).toEqual(['pokedex'])
    releaseRegistration?.()
    const first = await firstPromise
    expect(order).toEqual(['pokedex', 'nickname'])
    expect(first.pokemon.nickname).toBe('ROC')

    order.length = 0
    await completeHgssSafariCaptureSequence(
      context,
      prepareHgssSafariCapture(context, pokemon),
      'PROMPT',
      callbacks,
    )
    expect(order).toEqual(['nickname'])
  })

  it('n’acquiert pas le Pokémon si la scène est remplacée pendant le surnom', async () => {
    const context = createContext()
    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const pending = prepareHgssSafariCapture(context, pokemon)
    let current = true
    let releaseNickname: ((nickname: string | undefined) => void) | undefined
    const nickname = new Promise<string | undefined>((resolve) => { releaseNickname = resolve })
    const sequence = completeHgssSafariCaptureSequence(context, pending, 'PROMPT', {
      presentPokedexRegistration: async () => undefined,
      requestNickname: () => nickname,
      isCurrent: () => current,
    })
    await Promise.resolve(); await Promise.resolve()

    current = false
    releaseNickname?.('ROC')

    await expect(sequence).rejects.toMatchObject({ name: 'AbortError' })
    expect(context.party.members).toHaveLength(1)
    expect(context.pokemonStorage.boxes.flat().every((slot) => slot === undefined)).toBe(true)
  })

  it('crédite event21 au message 871, valide l’identité avant stockage et termine le score après le combat', async () => {
    const context = createContext()
    const progress: HgssWildCaptureProgressState = {
      gameScore: 0, gameStats: new Map(), pokedex: context.pokedex, pokemonStorage: context.pokemonStorage,
      phoneContacts: new Set(), flags: context.eventFlags, phoneCallTriggers: new Set(),
    }
    const johtoDexNumbers = Array<number>(494).fill(0)
    context.progression.prepareCapture = (pokemon) => {
      johtoDexNumbers[pokemon.speciesId] = 1
      return prepareHgssWildCaptureProgression(progress, pokemon, { nativeGameLanguage: 3, johtoDexNumbers })
    }
    context.progression.commitCaptureBeforeStorage = (preparation, nickname) => {
      commitHgssWildCaptureBeforeStorage(preparation, { nicknameWasEntered: hasHgssPokemonNicknameInput(nickname) })
    }
    context.progression.completeCaptureAfterBattle = (preparation) => { completeHgssWildCaptureAfterBattle(preparation) }
    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const pending = prepareHgssSafariCapture(context, pokemon)

    expect(progress.gameScore).toBe(0)
    expect(progress.pokedex.caughtSpeciesIds.has(pokemon.speciesId)).toBe(false)
    const preparation = beginHgssSafariCaptureRegistration(context, pending)
    expect(progress.gameScore).toBe(20)
    const committed = await completeHgssSafariCaptureSequence(context, pending, 'PROMPT', {
      presentPokedexRegistration: async () => {
        expect(progress.gameScore).toBe(20)
        expect(progress.pokedex.caughtSpeciesIds.has(pokemon.speciesId)).toBe(false)
      },
      requestNickname: async () => ' ROC ',
    })
    expect(committed.pokemon.nickname).toBe(' ROC ')
    expect(progress.gameScore).toBe(20)
    expect(progress.gameStats.get(HGSS_NICKNAMES_GIVEN_GAME_STAT_ID)).toBe(1)
    expect(progress.gameStats.get(HGSS_CAUGHT_POKEMON_GAME_STAT_ID)).toBe(1)
    expect(progress.pokedex.caughtSpeciesIds.has(pokemon.speciesId)).toBe(true)
    completeHgssWildCaptureAfterBattle(preparation)
    expect(progress.gameScore).toBe(22)
  })

  it('range dans la première Boîte libre et ne produit que les messages ROM', () => {
    const context = createContext()
    while (context.party.members.length < 6) context.party.members.push({ ...context.party.members[0]! })
    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'goodRod')!, context)
    const result = commitHgssSafariCapture(context, pokemon)
    expect(result.joinedParty).toBe(false)
    expect(result.storagePlacement).toEqual({ previousBox: 0, box: 0, slot: 0 })
    expect(result.presentation.map(({ messageId }) => messageId)).toEqual([871, 1174])
    expect(result.presentation[1]!.values).toEqual([pokemon.speciesName, 'B1'])
    expect(result.presentation[1]).toMatchObject({ advance: 'automatic', minimumFrames: 30 })
  })

  it('redirige au PC une capture dont l’ajout à l’équipe est refusé', () => {
    const context = createContext()
    context.teamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => ({ code: 'party-locked', reason: 'Équipe verrouillée.' }),
    }
    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)

    const pending = prepareHgssSafariCapture(context, pokemon)
    expect(pending.acquisitionPlan).toMatchObject({
      kind: 'storage', box: 0, slot: 0,
      redirectedByPolicy: { code: 'party-locked' },
    })
    const result = finalizeHgssSafariCapture(context, pending)
    expect(result.joinedParty).toBe(false)
    expect(result.storagePlacement).toEqual({ previousBox: 0, box: 0, slot: 0 })
    expect(context.party.members).toHaveLength(1)
    expect(context.pokemonStorage.boxes[0]?.[0]?.speciesId).toBe(pokemon.speciesId)
  })

  it('expose un blocage avant toute progression lorsque le veto ne peut pas être redirigé', () => {
    const context = createContext()
    const stored = context.party.members[0]!
    for (const box of context.pokemonStorage.boxes) box.fill(stored)
    context.teamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => ({ code: 'capture-locked', reason: 'Capture verrouillée.' }),
    }
    context.progression.prepareCapture = vi.fn(context.progression.prepareCapture)
    context.progression.commitCaptureBeforeStorage = vi.fn(context.progression.commitCaptureBeforeStorage)
    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const pending = prepareHgssSafariCapture(context, pokemon)

    expect(getHgssSafariCaptureBlock(pending)).toEqual({
      kind: 'blocked', code: 'capture-locked', reason: 'Capture verrouillée.',
    })
    expect(() => beginHgssSafariCaptureRegistration(context, pending)).toThrow(HgssSafariCaptureBlockedError)
    expect(context.progression.prepareCapture).not.toHaveBeenCalled()
    expect(context.progression.commitCaptureBeforeStorage).not.toHaveBeenCalled()
    expect(context.party.members).toHaveLength(1)
    expect(context.pokedex.caughtSpeciesIds.has(pokemon.speciesId)).toBe(false)
  })

  it('distingue le veto de policy du plein natif qui reste géré par le lancer de Ball', () => {
    const context = createContext()
    const stored = context.party.members[0]!
    while (context.party.members.length < 6) context.party.members.push(stored)
    for (const box of context.pokemonStorage.boxes) box.fill(stored)
    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const pending = prepareHgssSafariCapture(context, pokemon)

    expect(pending.acquisitionPlan).toEqual({ kind: 'full' })
    expect(getHgssSafariCaptureBlock(pending)).toEqual({
      kind: 'full', code: 'storage-full', reason: 'L’équipe et le PC sont pleins.',
    })
  })

  it('applique la policy externe avant le préflight acquisition et avant toute consommation', () => {
    const context = createContext()
    const teamVeto = vi.fn(() => ({ code: 'capture-locked', reason: 'Capture verrouillée.' }))
    context.teamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: teamVeto,
    }
    const opponent = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const externalVeto = { code: 'safari-ball-disabled', reason: 'Safari Ball désactivée.' }
    const externalPolicy = { vetoPlayerAction: vi.fn(() => externalVeto) }
    const rng = { getSeed: () => 0, nextU16: vi.fn(() => 0) }
    const state = createHgssSafariBattleState(opponent, 30)

    const attempt = attemptHgssSafariBattleAction(
      state,
      'ball',
      { catalog: context.inventory.pokemonCatalog, rng, hasStorageSpace: true },
      createHgssSafariTransactionalActionPolicy(context, opponent, externalPolicy),
    )

    expect(attempt).toEqual({ accepted: false, action: 'ball', state, veto: externalVeto })
    expect(externalPolicy.vetoPlayerAction).toHaveBeenCalledWith({ kind: 'safari', action: 'ball' })
    expect(teamVeto).not.toHaveBeenCalled()
    expect(rng.nextU16).not.toHaveBeenCalled()
    expect(state).toMatchObject({ ballsRemaining: 30, turnCount: 0, outcome: 'active' })
  })

  it('veto le lancer avant Ball et RNG si le refus équipe ne peut pas être redirigé au PC', () => {
    const context = createContext()
    const stored = context.party.members[0]!
    for (const box of context.pokemonStorage.boxes) box.fill(stored)
    context.teamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => ({ code: 'capture-locked', reason: 'Capture verrouillée.' }),
    }
    const opponent = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const rng = { getSeed: () => 0, nextU16: vi.fn(() => 0) }
    const state = createHgssSafariBattleState(opponent, 30)

    const attempt = attemptHgssSafariBattleAction(
      state,
      'ball',
      { catalog: context.inventory.pokemonCatalog, rng, hasStorageSpace: true },
      createHgssSafariTransactionalActionPolicy(context, opponent),
    )

    expect(attempt).toEqual({
      accepted: false,
      action: 'ball',
      state,
      veto: { code: 'capture-locked', reason: 'Capture verrouillée.' },
    })
    expect(rng.nextU16).not.toHaveBeenCalled()
    expect(state).toMatchObject({ ballsRemaining: 30, turnCount: 0, outcome: 'active' })
  })

  it('laisse le plein natif débiter la Ball sans lire le RNG', () => {
    const context = createContext()
    const stored = context.party.members[0]!
    while (context.party.members.length < 6) context.party.members.push(stored)
    for (const box of context.pokemonStorage.boxes) box.fill(stored)
    const opponent = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const rng = { getSeed: () => 0, nextU16: vi.fn(() => 0) }

    const attempt = attemptHgssSafariBattleAction(
      createHgssSafariBattleState(opponent, 30),
      'ball',
      { catalog: context.inventory.pokemonCatalog, rng, hasStorageSpace: false },
      createHgssSafariTransactionalActionPolicy(context, opponent),
    )

    expect(attempt).toMatchObject({
      accepted: true,
      turn: {
        state: { ballsRemaining: 29, turnCount: 1, outcome: 'storage-full' },
        events: [{ kind: 'storage-full' }],
      },
    })
    expect(rng.nextU16).not.toHaveBeenCalled()
  })

  it('laisse le transfert au Naming Screen pour Oui comme pour Non', async () => {
    const context = createContext()
    while (context.party.members.length < 6) context.party.members.push({ ...context.party.members[0]! })
    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    let preview: Parameters<HgssSafariRuntimeOptions['requestNickname']>[2]
    const named = await completeHgssSafariCaptureSequence(context, prepareHgssSafariCapture(context, pokemon), 'PROMPT', {
      presentPokedexRegistration: async () => undefined,
      requestNickname: async (_pokemon, _prompt, storageMessage) => { preview = storageMessage; return 'ROC' },
    })
    expect(preview).toEqual({ template: 'SOMEONE', previousBoxName: 'B1', destinationBoxName: 'B1', movedToDifferentBox: false })
    expect(named.storagePlacement).toEqual({ previousBox: 0, box: 0, slot: 0 })
    expect(named.presentation).toEqual([])

    const secondContext = createContext()
    while (secondContext.party.members.length < 6) secondContext.party.members.push({ ...secondContext.party.members[0]! })
    const unnamed = await completeHgssSafariCaptureSequence(secondContext, prepareHgssSafariCapture(secondContext, pokemon), 'PROMPT', {
      presentPokedexRegistration: async () => undefined,
      requestNickname: async () => undefined,
    })
    expect(unnamed.presentation).toEqual([])
  })

  it('valide les stats avant le slot PC et réserve les hooks post-combat à la fin du message', () => {
    const context = createContext()
    while (context.party.members.length < 6) context.party.members.push({ ...context.party.members[0]! })
    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const order: string[] = []
    let preparedPokemon: CanonicalPokemon | undefined
    context.progression.prepareCapture = (captured) => {
      order.push('event21')
      preparedPokemon = captured
      return { speciesId: captured.speciesId, wasAlreadyCaught: false, registeredNewSpecies: true, scoreEventIds: [21], scoreAdded: 20 }
    }
    context.progression.commitCaptureBeforeStorage = () => {
      expect(context.pokemonStorage.boxes[0]![0]).toBeUndefined()
      order.push('stat50-caught-stat10')
      markPokemonCaught(context.pokedex, preparedPokemon!, 3)
    }
    context.progression.completeCaptureAfterBattle = () => {
      expect(context.pokemonStorage.boxes[0]![0]).toBeDefined()
      order.push('calls-score')
    }

    const pending = prepareHgssSafariCapture(context, pokemon)
    expect(order).toEqual([])
    beginHgssSafariCaptureRegistration(context, pending)
    beginHgssSafariCaptureRegistration(context, pending)
    const committed = finalizeHgssSafariCapture(context, pending, 'ROC')
    expect(order).toEqual(['event21', 'stat50-caught-stat10'])
    expect(committed.presentation[0]).toMatchObject({ messageId: 1174, advance: 'automatic' })
    context.progression.completeCaptureAfterBattle(pending.progression!)
    expect(order).toEqual(['event21', 'stat50-caught-stat10', 'calls-score'])
  })

  it('sélectionne les quatre messages PC ROM selon Léo et le changement de Boîte', () => {
    const beforeBill = new Set<number>()
    const afterBill = new Set<number>([HGSS_SYS_MET_BILL_FLAG_ID])
    expect(resolveHgssSafariStorageMessageId(false, beforeBill)).toBe(1174)
    expect(resolveHgssSafariStorageMessageId(false, afterBill)).toBe(1175)
    expect(resolveHgssSafariStorageMessageId(true, beforeBill)).toBe(1176)
    expect(resolveHgssSafariStorageMessageId(true, afterBill)).toBe(1177)
  })

  it('route les fins forcées après le test post-combat de la capacité totale', () => {
    expect(resolveHgssSafariExitRoute('balls-out', 0, false)).toEqual({
      exitScriptId: HGSS_SAFARI_REENTRY_SCRIPT_ID,
      returnToDynamicWarp: true,
    })
    expect(resolveHgssSafariExitScript('caught', 0, false)).toBe(HGSS_SAFARI_BALLS_OUT_SCRIPT_ID)
    expect(resolveHgssSafariExitScript('storage-full', 29, false)).toBe(HGSS_SAFARI_STORAGE_FULL_SCRIPT_ID)
    expect(resolveHgssSafariExitScript('opponent-fled', 29, false)).toBe(HGSS_SAFARI_STORAGE_FULL_SCRIPT_ID)
    expect(resolveHgssSafariExitScript('player-ran', 29, true)).toBeUndefined()
  })

  it('éjecte sans Ball supplémentaire quand une capture remplit la dernière place disponible', () => {
    const context = createContext()
    while (context.party.members.length < 6) context.party.members.push({ ...context.party.members[0]! })
    const stored = context.party.members[0]!
    for (const box of context.pokemonStorage.boxes) box.fill(stored)
    context.pokemonStorage.boxes.at(-1)![29] = undefined

    const pokemon = createHgssSafariRuntimePokemon(prepareHgssSafariRuntimeEncounter(context, 'land')!, context)
    const result = commitHgssSafariCapture(context, pokemon)

    expect(result.storagePlacement).toEqual({ previousBox: 0, box: 17, slot: 29 })
    expect(resolveHgssSafariExitScript('caught', 29, false)).toBe(HGSS_SAFARI_STORAGE_FULL_SCRIPT_ID)
  })
})
