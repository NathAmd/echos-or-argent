import { describe, expect, it, vi } from 'vitest'
import type {
  NitroTexturePreview,
  OpeningMapPreview,
  PlayerTextureFrames,
  RomInventory,
} from '../../ndsTypes'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import { createCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import type { WorldState } from '../world/worldSession'
import type { HgssFishingBiteEffectAsset } from './hgssFishingBiteEffect'
import type { FieldWildEncounterIdentityPort } from './fieldWildEncounterIdentityPort'
import {
  createBrowserFishingHost,
  type BrowserFishingFieldState,
  type BrowserFishingHostPorts,
} from './browserFishingHost'
import type { PreparedSafariWildEncounter } from './wildEncounterSelection'

const fishingMessages = {
  37: '{103 0,0} ne peut pas pêcher ici.',
  49: 'Ça ne mord pas...',
  50: 'Le Pokémon s’est échappé...',
  51: '{103 0,0} a ferré trop tôt!',
  52: 'Oh! Ça mord!',
} as const

function createEncounterTable(rate = 100): HgssWildEncounterData {
  const slots = Array.from({ length: 5 }, () => ({ speciesId: 155, minLevel: 8, maxLevel: 8 }))
  return {
    bankId: 3,
    rates: { walking: 0, surfing: 0, rockSmash: 0, oldRod: rate, goodRod: rate, superRod: rate },
    land: { morning: [], day: [], night: [] },
    hoennSoundSpecies: [0, 0],
    sinnohSoundSpecies: [0, 0],
    surfing: [],
    rockSmash: [],
    oldRod: slots,
    goodRod: slots,
    superRod: slots,
    swarm: { landSpeciesId: 0, surfingSpeciesId: 0, nightFishingSpeciesId: 0, fishingSpeciesId: 0 },
  }
}

function createMap(mapId = 44, wildEncounterBank = 3): OpeningMapPreview {
  return {
    id: mapId,
    label: `Carte ${mapId}`,
    header: { wildEncounterBank },
  } as unknown as OpeningMapPreview
}

function constantRng(value = 0): HgssLcrng {
  return { getSeed: () => value, nextU16: () => value }
}

function createPokemon(
  catalog: ReturnType<typeof createPokemonTestCatalog>,
  friendship = 255,
): CanonicalPokemon {
  const pokemon = createCanonicalPokemon(catalog, {
    speciesId: 152,
    level: 16,
    rng: constantRng(1),
    personality: { kind: 'fixed', value: 1 },
    individualValues: { kind: 'fixed', value: 10 },
    originalTrainer: { id: 7, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 44, metLevel: 16, metTerrain: 0 },
    friendship,
    ballId: 4,
  })
  return pokemon
}

type HarnessOptions = Readonly<{
  mapId?: number
  wildEncounterBank?: number
  locomotion?: WorldState['locomotion']
  facingSurfable?: boolean
  encounterRate?: number
  followerActive?: boolean
  followerFriendship?: number
  safariActive?: boolean
  gender?: 'male' | 'female'
  messages?: Record<number, string>
  worldPresent?: boolean
  runtimePresent?: boolean
  inventoryPresent?: boolean
  soundFailure?: boolean
}>

function createHarness(options: HarnessOptions = {}) {
  const order: string[] = []
  const catalog = createPokemonTestCatalog(493)
  const lead = createPokemon(catalog, options.followerFriendship ?? 255)
  const map = createMap(options.mapId ?? 44, options.wildEncounterBank ?? 3)
  let world: WorldState | undefined = options.worldPresent === false
    ? undefined
    : {
        map,
        tileX: 1,
        tileZ: 1,
        direction: 'north',
        locomotion: options.locomotion ?? 'walking',
      }
  const pokemonRuntime = options.runtimePresent === false
    ? undefined
    : { catalog, rng: constantRng(), now: () => new Date('2026-08-27T12:00:00Z') }
  const frames = { standing: {}, walking: {} } as unknown as PlayerTextureFrames
  const preview = { id: 'fishing-player' } as unknown as NitroTexturePreview
  const biteEffect = { timeline: { keyFrames: [] } } as unknown as HgssFishingBiteEffectAsset
  const eventTextureResolver = vi.fn(() => ({ frames, preview }))
  const fishingBiteEffectResolver = vi.fn(() => biteEffect)
  const wildEncounterCatalog = Object.assign([], {
    3: createEncounterTable(options.encounterRate ?? 100),
  }) as unknown as RomInventory['wildEncounterCatalog']
  const inventory = options.inventoryPresent === false
    ? undefined
    : {
        uiMessageBanks: { 40: options.messages ?? fishingMessages },
        wildEncounterCatalog,
        eventTextureResolver,
        fishingBiteEffectResolver,
      }
  const fieldState: BrowserFishingFieldState = {
    party: { members: [lead] },
    followMonActive: options.followerActive ?? false,
    followerMood: 50,
    safariZone: { session: { active: options.safariActive ?? false } },
    gameStats: new Map(),
  }
  let player: { name: string, gender: 'male' | 'female' } = {
    name: 'JO',
    gender: options.gender ?? 'male',
  }
  const safariEncounter = {
    areaId: 0,
    areaSlot: 0,
    method: 'safari',
    safariMethod: 'oldRod',
    time: 'day',
    slotIndex: 0,
    speciesId: 155,
    level: 8,
  } as const satisfies PreparedSafariWildEncounter
  const prepareSafariEncounter = vi.fn((
    rod: 'oldRod' | 'goodRod' | 'superRod',
  ): PreparedSafariWildEncounter | undefined => {
    void rod
    return undefined
  })
  const identityPort = vi.fn<FieldWildEncounterIdentityPort>((prepared) => prepared)
  const materialized = createPokemon(catalog)
  const materializePreparedEncounter = vi.fn(() => materialized)
  const startPreparedEncounter = vi.fn(() => { order.push('battle'); return true })
  const clearMovementInput = vi.fn(() => { order.push('clear') })
  const setFollowerMovementPaused = vi.fn((paused: boolean) => { order.push(`pause:${paused}`) })
  const setPlayerTextureFrames = vi.fn((value: PlayerTextureFrames) => {
    void value
    order.push('frames')
  })
  const setPlayerTexture = vi.fn((value: NitroTexturePreview) => {
    void value
    order.push('texture')
  })
  const applyCurrentPlayerSkin = vi.fn((force?: boolean) => { order.push(`skin:${String(force)}`) })
  const startFishingBiteEffect = vi.fn((target: 'player' | 'follower', effect: HgssFishingBiteEffectAsset) => {
    void effect
    order.push(`bite:${target}`)
  })
  const stopFishingBiteEffect = vi.fn((target?: 'player' | 'follower') => {
    order.push(`bite-end:${String(target)}`)
  })
  const setStatus = vi.fn((text: string) => { order.push(`status:${text}`) })
  const showMessages = vi.fn((message: string, dialogueOptions?: Readonly<{ speaker?: string }>) => {
    void dialogueOptions
    order.push(`message:${message}`)
  })
  const hide = vi.fn(() => { order.push('hide') })
  const playSoundEffect = vi.fn((sequenceId: number) => {
    void sequenceId
    return options.soundFailure
      ? Promise.reject(new Error('audio indisponible'))
      : Promise.resolve()
  })
  const scheduleAutosave = vi.fn((delayMs?: number) => {
    void delayMs
    order.push('autosave')
  })
  const ports: BrowserFishingHostPorts = {
    sources: {
      readWorld: () => world,
      readPokemonRuntime: () => pokemonRuntime,
      readInventory: () => inventory,
      readFieldState: () => fieldState,
      readPlayer: () => player,
      isFacingSurfableSurface: () => options.facingSurfable ?? true,
    },
    encounters: {
      identityPort,
      prepareSafariEncounter,
      materializePreparedEncounter,
      startPreparedEncounter,
    },
    presentation: {
      clearMovementInput,
      setFollowerMovementPaused,
      setPlayerTextureFrames,
      setPlayerTexture,
      applyCurrentPlayerSkin,
      startFishingBiteEffect,
      stopFishingBiteEffect,
      setStatus,
    },
    dialogue: { showMessages, hide },
    audio: { playSoundEffect },
    persistence: { scheduleAutosave },
  }
  return {
    host: createBrowserFishingHost(ports),
    ports,
    fieldState,
    map,
    frames,
    preview,
    biteEffect,
    safariEncounter,
    order,
    eventTextureResolver,
    fishingBiteEffectResolver,
    prepareSafariEncounter,
    identityPort,
    materializePreparedEncounter,
    materialized,
    startPreparedEncounter,
    clearMovementInput,
    setFollowerMovementPaused,
    setPlayerTextureFrames,
    setPlayerTexture,
    applyCurrentPlayerSkin,
    startFishingBiteEffect,
    stopFishingBiteEffect,
    setStatus,
    showMessages,
    hide,
    playSoundEffect,
    scheduleAutosave,
    setWorld: (next: WorldState | undefined) => { world = next },
    setPlayer: (next: { name: string, gender: 'male' | 'female' }) => { player = next },
  }
}

function tickUntil(host: ReturnType<typeof createHarness>['host'], predicate: () => boolean): void {
  for (let frame = 0; frame < 300; frame += 1) {
    if (predicate()) return
    host.tick()
  }
  throw new Error('La phase de pêche attendue n’a pas été atteinte.')
}

describe('browser fishing host', () => {
  it('valide le contexte et les cinq messages ROM avant toute mutation', () => {
    for (const missing of [
      createHarness({ worldPresent: false }),
      createHarness({ runtimePresent: false }),
      createHarness({ inventoryPresent: false }),
    ]) {
      expect(missing.host.tryStart(445)).toBe(false)
      expect(missing.clearMovementInput).not.toHaveBeenCalled()
    }
    const messages: Record<number, string> = { ...fishingMessages }
    delete messages[50]
    const incomplete = createHarness({ messages })
    expect(() => incomplete.host.tryStart(445)).toThrow('Les messages ROM de pêche HGSS sont absents.')
    expect(incomplete.clearMovementInput).not.toHaveBeenCalled()
  })

  it('refuse la surface, le déplacement, la banque et les objets qui ne sont pas des cannes', () => {
    const notSurfable = createHarness({ facingSurfable: false })
    expect(notSurfable.host.tryStart(445)).toBe(false)
    expect(notSurfable.setStatus).toHaveBeenCalledWith('JO ne peut pas pêcher ici.')

    const cycling = createHarness({ locomotion: 'cycling' })
    expect(cycling.host.tryStart(445)).toBe(false)
    expect(cycling.setStatus).toHaveBeenCalledWith('JO ne peut pas pêcher ici.')

    const noBank = createHarness({ wildEncounterBank: 0xff })
    expect(noBank.host.tryStart(445)).toBe(false)
    expect(noBank.setStatus).toHaveBeenCalledWith('JO ne peut pas pêcher ici.')

    const wrongItem = createHarness()
    expect(wrongItem.host.tryStart(444)).toBe(false)
    expect(wrongItem.setStatus).not.toHaveBeenCalled()
    expect(wrongItem.clearMovementInput).not.toHaveBeenCalled()
  })

  it('signale précisément une banque ROM absente après avoir validé la canne', () => {
    const harness = createHarness({ wildEncounterBank: 4 })
    expect(() => harness.host.tryStart(445))
      .toThrow('La banque ROM de pêche 4 de Carte 44 est absente.')
    expect(harness.clearMovementInput).not.toHaveBeenCalled()
  })

  it('prépare l’identité, matérialise puis équipe le skin de pêche correspondant au genre', () => {
    const harness = createHarness({ gender: 'female' })

    expect(harness.host.tryStart(445)).toBe(true)

    expect(harness.host.isActive()).toBe(true)
    expect(harness.identityPort).toHaveBeenCalledWith(
      expect.objectContaining({ encounter: expect.objectContaining({ method: 'fishing', rod: 'oldRod' }) }),
      { mapId: harness.map.id, source: 'fishing' },
    )
    const prepared = harness.identityPort.mock.results[0]?.value
    expect(harness.materializePreparedEncounter).toHaveBeenCalledWith(prepared)
    expect(harness.eventTextureResolver).toHaveBeenCalledWith(189)
    expect(harness.setPlayerTextureFrames).toHaveBeenCalledWith(harness.frames)
    expect(harness.setPlayerTexture).toHaveBeenCalledWith(harness.preview)
    expect(harness.order.slice(0, 5)).toEqual(['clear', 'pause:true', 'frames', 'texture', 'status:'])
    expect(harness.host.tryStart(446)).toBe(false)
    expect(harness.clearMovementInput).toHaveBeenCalledOnce()
  })

  it('route la table Safari et place la touche sur le follower seulement à pied', () => {
    const harness = createHarness({ mapId: 357, safariActive: true, followerActive: true })
    harness.prepareSafariEncounter.mockReturnValue(harness.safariEncounter)

    expect(harness.host.tryStart(445)).toBe(true)
    expect(harness.prepareSafariEncounter).toHaveBeenCalledWith('oldRod')
    tickUntil(harness.host, () => harness.startFishingBiteEffect.mock.calls.length > 0)

    expect(harness.startFishingBiteEffect).toHaveBeenCalledWith('follower', harness.biteEffect)
    expect(harness.fishingBiteEffectResolver).toHaveBeenCalledOnce()

    const surfing = createHarness({ locomotion: 'surfing', followerActive: true })
    expect(surfing.host.tryStart(445)).toBe(true)
    tickUntil(surfing.host, () => surfing.startFishingBiteEffect.mock.calls.length > 0)
    expect(surfing.startFishingBiteEffect).toHaveBeenCalledWith('player', surfing.biteEffect)
  })

  it('joue le son du lancer et absorbe son rejet asynchrone', async () => {
    const harness = createHarness({ soundFailure: true })
    expect(harness.host.tryStart(445)).toBe(true)

    for (let frame = 0; frame < 10; frame += 1) harness.host.tick()
    await Promise.resolve()

    expect(harness.playSoundEffect).toHaveBeenCalledWith(1615)
    expect(harness.host.isActive()).toBe(true)
  })

  it('termine une prise, incrémente la statistique 11, démarre le combat puis autosauvegarde', () => {
    const harness = createHarness()
    harness.fieldState.gameStats.set(11, 7)
    expect(harness.host.tryStart(445)).toBe(true)
    tickUntil(harness.host, () => harness.startFishingBiteEffect.mock.calls.length > 0)

    expect(harness.host.handle('confirm')).toBe(true)
    tickUntil(harness.host, () => harness.showMessages.mock.calls.length > 0)
    expect(harness.showMessages).toHaveBeenCalledWith('Oh! Ça mord!', { speaker: undefined })
    expect(harness.host.handle('confirm')).toBe(true)
    tickUntil(harness.host, () => !harness.host.isActive())

    const prepared = harness.identityPort.mock.results[0]?.value
    expect(harness.fieldState.gameStats.get(11)).toBe(8)
    expect(harness.startPreparedEncounter).toHaveBeenCalledWith(prepared, harness.materialized)
    expect(harness.scheduleAutosave).toHaveBeenCalledWith(0)
    expect(harness.order.slice(-5)).toEqual(['hide', 'pause:false', 'skin:true', 'battle', 'autosave'])
    expect(harness.host.handle('confirm')).toBe(false)
  })

  it('compte un Pokémon échappé avec saturation sans démarrer de combat', () => {
    const harness = createHarness()
    harness.fieldState.gameStats.set(101, 0xffff_ffff)
    expect(harness.host.tryStart(447)).toBe(true)
    tickUntil(harness.host, () => harness.startFishingBiteEffect.mock.calls.length > 0)
    tickUntil(harness.host, () => harness.showMessages.mock.calls.length > 0)

    expect(harness.showMessages).toHaveBeenCalledWith('Le Pokémon s’est échappé...', { speaker: undefined })
    expect(harness.fieldState.gameStats.get(101)).toBe(0xffff_ffff)
    expect(harness.host.handle('cancel')).toBe(true)
    tickUntil(harness.host, () => !harness.host.isActive())

    expect(harness.startPreparedEncounter).not.toHaveBeenCalled()
    expect(harness.scheduleAutosave).toHaveBeenCalledWith(0)
  })

  it('conserve le mini-jeu sans rencontre puis autosauvegarde le résultat aucune touche', () => {
    const harness = createHarness({ encounterRate: 0 })
    expect(harness.host.tryStart(445)).toBe(true)
    expect(harness.identityPort).not.toHaveBeenCalled()
    expect(harness.materializePreparedEncounter).not.toHaveBeenCalled()
    tickUntil(harness.host, () => harness.showMessages.mock.calls.length > 0)

    expect(harness.showMessages).toHaveBeenCalledWith('Ça ne mord pas...', { speaker: undefined })
    harness.host.handle('confirm')
    tickUntil(harness.host, () => !harness.host.isActive())

    expect(harness.startPreparedEncounter).not.toHaveBeenCalled()
    expect(harness.scheduleAutosave).toHaveBeenCalledWith(0)
  })

  it('annule de façon idempotente en retirant l’effet et en restaurant dialogue, follower et skin', () => {
    const harness = createHarness({ followerActive: true })
    expect(harness.host.tryStart(445)).toBe(true)
    tickUntil(harness.host, () => harness.startFishingBiteEffect.mock.calls.length > 0)
    harness.order.splice(0)

    harness.host.cancel()

    expect(harness.host.isActive()).toBe(false)
    expect(harness.order).toEqual(['bite-end:follower', 'hide', 'pause:false', 'skin:true'])
    expect(harness.scheduleAutosave).not.toHaveBeenCalled()
    expect(harness.startPreparedEncounter).not.toHaveBeenCalled()

    harness.host.cancel()
    expect(harness.order).toEqual(['bite-end:follower', 'hide', 'pause:false', 'skin:true'])
  })
})
