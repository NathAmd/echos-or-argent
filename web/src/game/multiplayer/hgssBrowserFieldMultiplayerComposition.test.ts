import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview, PlayerGender, RomInventory } from '../../ndsTypes'
import type { OnlineAccountSession } from '../../online/onlineAccountSession'
import type { OnlineClientConfig } from '../../online/onlineClientConfig'
import { baseGameplayExtensionPorts } from '../extensions/gameplayExtensionPorts'
import { cloneFieldScriptState, createFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import {
  createHgssSharedCampaignSaveExtension,
  readHgssSharedCampaignSaveExtension,
  replaceHgssSharedCampaignSaveExtension,
} from '../save/hgssSharedCampaignSaveExtension'
import type { VersionedSaveExtensions } from '../save/versionedSaveExtensions'
import type { DynamicWorldActor } from '../world/dynamicWorldActorRegistry'
import type { AuthoritativePlayerMoveResult, WorldSession } from '../world/worldSession'
import type { HgssBrowserFieldCampaignOptions } from './hgssBrowserFieldCampaign'
import type { HgssCampaignClientGateway } from './hgssCampaignClientGateway'
import {
  hgssCampaignProtocolVersion,
  type HgssCampaignServerSnapshot,
} from './hgssCampaignProtocol'
import type { HgssBrowserMultiplayerHostOptions } from './hgssBrowserMultiplayerHost'
import {
  createHgssBrowserFieldMultiplayerComposition,
  shouldTickHgssFieldObjects,
} from './hgssBrowserFieldMultiplayerComposition'
import {
  createHgssSharedCampaignProgressionSeed,
  readHgssSharedCampaignProgressionIdentity,
} from './hgssSharedCampaignProgression'
import { createHgssSharedCampaignProgressionSync } from './hgssSharedCampaignProgressionSync'
import { createHgssSharedCampaignFieldEventId } from './hgssSharedCampaignEventIdentity'

const mocked = vi.hoisted(() => {
  const campaignPort = Object.freeze({ start: vi.fn() })
  const campaign = Object.freeze({
    port: campaignPort,
    worldSessionExtensionPorts: Object.freeze({}),
    gameplayContribution: Object.freeze({}),
    registry: Object.freeze({}),
    getState: () => Object.freeze({ status: 'idle' as const }),
    isFieldLocked: vi.fn(() => false),
    consumeMovement: () => false,
    commitSharedEvent: vi.fn(async (eventId: string) => Object.freeze({ eventId, revision: 1 })),
    close: vi.fn(async () => undefined),
  })
  const host = Object.freeze({
    open: vi.fn(),
    close: vi.fn(),
    isOpen: () => false,
    handleDigitalEvent: () => false,
    destroy: vi.fn(async () => undefined),
  })
  return {
    campaign,
    host,
    campaignOptions: undefined as unknown,
    hostOptions: undefined as unknown,
    probeReader: undefined as unknown,
    positionInspectorReader: undefined as unknown,
    probe: vi.fn(),
    positionInspector: vi.fn(),
    onlineConfig: Object.freeze({
      httpBaseUrl: 'https://lan.test',
      identityBaseUrl: 'https://identity.test',
      webSocketBaseUrl: 'wss://lan.test',
    }) as OnlineClientConfig | undefined,
    browserAccountSession: Object.freeze({
      getAccount: vi.fn(),
      readAccessToken: vi.fn(),
    }),
    authoritativeService: Object.freeze({
      prepareHost: vi.fn(),
      prepareGuest: vi.fn(),
    }),
    authoritativeServiceOptions: undefined as unknown,
  }
})

vi.mock('../../online/onlineClientConfig', () => ({
  readOnlineClientConfig: () => mocked.onlineConfig,
}))

vi.mock('../../online/onlineAccountSession', () => ({
  readBrowserOnlineAccountSession: () => mocked.browserAccountSession,
}))

vi.mock('./hgssCampaignAuthoritativeService', () => ({
  createHgssCampaignAuthoritativeService: (options: unknown) => {
    mocked.authoritativeServiceOptions = options
    return mocked.authoritativeService
  },
}))

vi.mock('./hgssBrowserFieldCampaign', () => ({
  createHgssCampaignFieldWorldProbeFactory: (read: () => unknown) => {
    mocked.probeReader = read
    return mocked.probe
  },
  createHgssCampaignFieldPositionInspector: (read: () => unknown) => {
    mocked.positionInspectorReader = read
    return mocked.positionInspector
  },
  createHgssBrowserFieldCampaign: (options: unknown) => {
    mocked.campaignOptions = options
    return mocked.campaign
  },
}))

vi.mock('./hgssBrowserMultiplayerHost', () => ({
  hgssMultiplayerUiSoundEffects: Object.freeze({ unavailable: 1523 }),
  createHgssBrowserMultiplayerHost: (options: unknown) => {
    mocked.hostOptions = options
    return mocked.host
  },
}))

describe('composition terrain multijoueur HGSS', () => {
  it.each([
    { fishingActive: false, campaignLocked: false, expected: true },
    { fishingActive: true, campaignLocked: false, expected: false },
    { fishingActive: false, campaignLocked: true, expected: false },
    { fishingActive: true, campaignLocked: true, expected: false },
  ])('cadence les objets seulement hors pêche et verrou Coop', ({ fishingActive, campaignLocked, expected }) => {
    expect(shouldTickHgssFieldObjects(fishingActive, campaignLocked)).toBe(expected)
  })
})

const mapId = 30

function createSharedScriptMap(bytes: Uint8Array): OpeningMapPreview {
  return {
    id: mapId,
    label: 'Coop',
    header: { mapId, msgBank: 1, mapSection: 1, followMode: 2 } as OpeningMapPreview['header'],
    fieldScripts: { bank: 1, bytes, headerSize: 0, entryOffsets: [0] },
    initScripts: [],
    messages: { 0: 'Événement Coop.' },
    matrix: {} as OpeningMapPreview['matrix'],
  }
}

function createHarness(runtimeAccountSession?: OnlineAccountSession) {
  let fieldBusy = false
  let fieldMutationBlocked = false
  let gender: PlayerGender = 'male'
  let account = { signedIn: true, online: true }
  let access = { allowed: true as const }
  let saveExtensions: VersionedSaveExtensions | undefined
  const worldState = Object.freeze({
    map: Object.freeze({ id: mapId }),
    tileX: 4,
    tileZ: 7,
    direction: 'south' as const,
    locomotion: 'walking' as const,
  })
  const world = Object.freeze({ getState: () => worldState }) as unknown as WorldSession
  const fieldState = createFieldScriptState('male', 'JO')
  fieldState.pokemonRuntime = Object.freeze({}) as FieldScriptState['pokemonRuntime']
  const inventory = {
    metadata: Object.freeze({ gameCode: 'IPKE' }),
    pokemonCatalog: Object.freeze({}),
    itemCatalog: Object.freeze({}),
    npcTradeCatalog: Object.freeze([]),
  } as unknown as RomInventory
  const renderActors = vi.fn()
  const clearActors = vi.fn()
  const persistState = vi.fn()
  const writeSaveExtensions = vi.fn((value: VersionedSaveExtensions | undefined) => {
    saveExtensions = value
  })
  const publishState = vi.fn()
  const presentLocalTurn = vi.fn()
  const presentLocalStep = vi.fn()
  const onFieldLockChanged = vi.fn()
  const reportStatus = vi.fn()
  const playSoundEffect = vi.fn(async () => undefined)
  const onOpen = vi.fn()
  const onClose = vi.fn()
  const textEntry = Object.freeze({})
  const runtimeOptions = Object.freeze({
    accountManagement: false,
    ...(runtimeAccountSession ? { accountSession: runtimeAccountSession } : {}),
  })
  const createPokemonVisual = vi.fn(() => undefined)
  const composition = createHgssBrowserFieldMultiplayerComposition({
    readState: () => ({
      gameActive: true,
      fieldBusy,
      sessionRngReady: true,
      inventory,
      fieldState,
      profile: { gender, name: 'JO', gameVersion: 7, language: 2 },
      world,
      gameplay: baseGameplayExtensionPorts,
    }),
    isFieldMutationBlocked: () => fieldMutationBlocked,
    dynamicActors: {
      readCurrentMapId: () => mapId,
      resolveEventTexture: () => ({ preview: Object.freeze({}), frames: Object.freeze({}) }) as never,
      resolveSpeciesTexture: () => undefined,
      renderActors,
      clearActors,
    },
    panel: Object.freeze({}) as HTMLElement,
    textEntry: textEntry as never,
    runtimeOptions,
    readAccountAccess: () => account,
    checkMultiplayerAccess: () => access,
    createPokemonVisual,
    readSaveExtensions: () => saveExtensions,
    writeSaveExtensions,
    persistState,
    publishState,
    presentLocalTurn,
    presentLocalStep,
    onFieldLockChanged,
    reportStatus,
    playSoundEffect,
    onOpen,
    onClose,
  })
  return {
    composition,
    fieldState,
    inventory,
    world,
    renderActors,
    persistState,
    writeSaveExtensions,
    publishState,
    presentLocalTurn,
    presentLocalStep,
    onFieldLockChanged,
    reportStatus,
    playSoundEffect,
    onOpen,
    onClose,
    textEntry,
    runtimeOptions,
    createPokemonVisual,
    setFieldBusy: (value: boolean) => { fieldBusy = value },
    setFieldMutationBlocked: (value: boolean) => { fieldMutationBlocked = value },
    setGender: (value: PlayerGender) => { gender = value },
    setPlayerState: (value: number) => { fieldState.playerState = value },
    readSaveExtensions: () => saveExtensions,
    setSaveExtensions: (value: VersionedSaveExtensions | undefined) => { saveExtensions = value },
    setAccount: (value: typeof account) => { account = value },
    setAccess: (value: typeof access | { allowed: false, reason: 'subscription-required' }) => {
      access = value as typeof access
    },
  }
}

function fieldOptions(): HgssBrowserFieldCampaignOptions {
  return mocked.campaignOptions as HgssBrowserFieldCampaignOptions
}

function hostOptions(): HgssBrowserMultiplayerHostOptions {
  return mocked.hostOptions as HgssBrowserMultiplayerHostOptions
}

function progressionOptions(): NonNullable<HgssBrowserFieldCampaignOptions['progression']> {
  return fieldOptions().progression!
}

describe('composition navigateur du terrain multijoueur HGSS', () => {
  it('masque la Coop et refuse son port sans serveur plutôt que de recréer une autorité navigateur', async () => {
    const configured = mocked.onlineConfig
    mocked.onlineConfig = undefined
    try {
      createHarness()

      expect(hostOptions().campaign).toBeUndefined()
      expect(hostOptions().readContext()).toEqual(expect.objectContaining({
        state: expect.objectContaining({ pokemonRuntime: expect.any(Object) }),
        pokemonCatalog: expect.any(Object),
        itemCatalog: expect.any(Object),
      }))
      await expect(fieldOptions().authoritativeService!.prepareHost({} as never))
        .rejects.toThrow("Le serveur de campagne n'est pas configuré.")
    } finally {
      mocked.onlineConfig = configured
    }
  })

  it('réutilise exactement la session de compte injectée au runtime pour l\'autorité', () => {
    const accountSession = Object.freeze({
      getAccount: vi.fn(),
      readAccessToken: vi.fn(),
    }) as unknown as OnlineAccountSession

    createHarness(accountSession)

    expect(mocked.authoritativeServiceOptions).toEqual({
      config: mocked.onlineConfig,
      accountSession,
    })
    expect(fieldOptions().sharedEventAdmission).toEqual(expect.any(Function))
  })

  it('compose les acteurs campagne et New Game+ avec un seul propriétaire de rendu', () => {
    const runtime = createHarness()
    const campaignActor: DynamicWorldActor = {
      id: 'campaign-player:guest', kind: 'remote-player', displayName: 'Guest', spriteId: 97,
      mapId, tileX: 5, tileZ: 7, direction: 'south', collision: 'blocking', interaction: 'none',
    }
    const newGamePlusActor: DynamicWorldActor = {
      id: 'new-game-plus:25', kind: 'visible-wild', speciesId: 25, form: 0, level: 5,
      mapId, tileX: 8, tileZ: 9, direction: 'west', collision: 'blocking', interaction: 'action',
    }

    fieldOptions().publishActors?.([campaignActor])
    runtime.composition.actors.setSourceActors('new-game-plus', [newGamePlusActor])

    expect(runtime.renderActors.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ id: newGamePlusActor.id, speciesId: 25 }),
      expect.objectContaining({ id: campaignActor.id, texture: expect.any(Object) }),
    ])
    expect(runtime.composition.campaign).toBe(mocked.campaign)
    expect(runtime.composition.host).toBe(mocked.host)
    expect(hostOptions().campaign).toBe(mocked.campaign.port)
    expect(fieldOptions().authoritativeService).toBe(mocked.authoritativeService)
    expect(mocked.authoritativeServiceOptions).toEqual({
      config: mocked.onlineConfig,
      accountSession: mocked.browserAccountSession,
    })
  })

  it.each([
    ['masculin normal', 'male', 0, 0],
    ['féminin normal', 'female', 0, 97],
    ['masculin Rocket', 'male', 3, 222],
    ['féminin Rocket', 'female', 14, 221],
  ] as const)('projette le sprite ROM %s uniquement sur un terrain admissible', (_label, gender, state, spriteId) => {
    const runtime = createHarness()
    runtime.setGender(gender)
    runtime.setPlayerState(state)

    expect(fieldOptions().readContext()).toMatchObject({
      gameCode: 'IPKE', gameVersion: 7, language: 2, displayName: 'JO', gender, spriteId,
      world: runtime.world,
    })
    runtime.setFieldBusy(true)
    expect(fieldOptions().readContext()).toBeUndefined()
    runtime.setFieldBusy(false)
    runtime.setFieldMutationBlocked(true)
    expect(fieldOptions().readContext()).toBeUndefined()
  })

  it('branche la sonde de mouvement sur la ROM, le terrain et les ports courants', () => {
    const runtime = createHarness()

    expect((mocked.probeReader as () => unknown)()).toEqual({
      inventory: runtime.inventory,
      fieldState: runtime.fieldState,
      playerGender: 'male',
      extensionPorts: baseGameplayExtensionPorts.worldSessionExtensionPorts,
    })
    expect(fieldOptions().createMovementProbe).toBe(mocked.probe)
  })

  it('restaure exactement le seed hôte durable de l’extension de sauvegarde', () => {
    const runtime = createHarness()
    runtime.fieldState.flags.add(0x20)
    runtime.fieldState.variables.set(0x4000, 12)
    const branchId = '0123456789abcdef0123456789abcdef'
    const savedProgression = createHgssSharedCampaignProgressionSeed(
      runtime.fieldState,
      branchId,
      7,
    )
    const savedCampaign = createHgssSharedCampaignSaveExtension(
      savedProgression,
      'campaign:saved',
      [],
      'player:local',
    )
    runtime.setSaveExtensions(replaceHgssSharedCampaignSaveExtension(undefined, savedCampaign))

    const seed = progressionOptions().readSeed()

    expect(seed).toEqual(savedCampaign.appliedProgression)
    expect(readHgssSharedCampaignProgressionIdentity(seed)).toEqual({
      campaignBranchId: branchId,
      progressionRevision: 7,
    })
    expect(progressionOptions().readSavedCampaign()).toEqual(savedCampaign)
  })

  it('transmet le nouvel état et son checkpoint durable après un snapshot progressé', async () => {
    const runtime = createHarness()
    const progressedState = cloneFieldScriptState(runtime.fieldState)
    progressedState.flags.add(0x30)
    const branchId = 'fedcba9876543210fedcba9876543210'
    const eventId = createHgssSharedCampaignFieldEventId({
      rom: { gameCode: 'IPKE', gameVersion: 7, language: 2 },
      mapId: 30,
      source: { kind: 'object', objectId: 7 },
      scriptId: 3,
    })
    const seed = createHgssSharedCampaignProgressionSeed(progressedState, branchId, 4)
    const snapshot: HgssCampaignServerSnapshot = Object.freeze({
      protocolVersion: hgssCampaignProtocolVersion,
      sessionId: 'campaign:composition',
      revision: 9,
      players: Object.freeze([]),
      sharedProgression: Object.freeze({
        ...seed,
        milestoneIds: Object.freeze([...seed.milestoneIds, eventId]),
      }),
      pendingEvents: Object.freeze([Object.freeze({
        eventId,
        eventRevision: 9,
        pendingPlayerIds: Object.freeze(['player:local']),
      })]),
    })
    const gateway = {
      getState: () => ({ status: 'connected' as const, snapshot }),
      send: vi.fn(async () => undefined),
    } as unknown as HgssCampaignClientGateway
    const ports = progressionOptions()
    const sync = createHgssSharedCampaignProgressionSync({
      readState: ports.readFieldState,
      readGateway: () => gateway,
      readSavedCampaign: ports.readSavedCampaign,
      persistState: ports.persistState,
      publishState: ports.publishState,
    })

    await sync.observe(snapshot, 'player:local')

    expect(runtime.persistState).toHaveBeenCalledOnce()
    const [candidate] = runtime.persistState.mock.calls[0]!
    const checkpoint = readHgssSharedCampaignSaveExtension(runtime.readSaveExtensions())!
    expect(candidate).not.toBe(runtime.fieldState)
    expect([...candidate.flags]).toContain(0x30)
    expect(readHgssSharedCampaignProgressionIdentity(checkpoint.appliedProgression)).toEqual({
      campaignBranchId: branchId,
      progressionRevision: 4,
    })
    expect(checkpoint.pendingAcks).toEqual([{
      authoritySessionId: 'campaign:composition',
      eventId,
      eventRevision: 9,
    }])
    expect(runtime.publishState).toHaveBeenCalledWith(candidate)
    expect(gateway.send).toHaveBeenCalledWith({ kind: 'event-ack', eventId, eventRevision: 9 })
  })

  it('conserve une branche transitoire stable tant que le même état terrain reste chargé', () => {
    const runtime = createHarness()

    const first = progressionOptions().readSeed()
    runtime.fieldState.flags.add(0x40)
    const second = progressionOptions().readSeed()

    const firstIdentity = readHgssSharedCampaignProgressionIdentity(first)
    const secondIdentity = readHgssSharedCampaignProgressionIdentity(second)
    expect(secondIdentity).toEqual(firstIdentity)
    expect(firstIdentity.progressionRevision).toBe(0)
    expect(second).not.toEqual(first)
  })

  it('restaure les extensions si le checkpoint atomique échoue', async () => {
    const runtime = createHarness()
    const campaign = createHgssSharedCampaignSaveExtension(
      createHgssSharedCampaignProgressionSeed(
        runtime.fieldState,
        '0123456789abcdef0123456789abcdef',
      ),
      'campaign:rollback',
      [],
      'player:local',
    )
    runtime.persistState.mockRejectedValueOnce(new Error('disk-full'))

    await expect(progressionOptions().persistState(runtime.fieldState, campaign))
      .rejects.toThrow('disk-full')

    expect(runtime.readSaveExtensions()).toBeUndefined()
    expect(runtime.writeSaveExtensions).toHaveBeenCalledTimes(2)
  })

  it('conserve les barrières compte, réseau, abonnement et mutation sans confondre verrou Coop et fieldBusy', () => {
    const runtime = createHarness()
    const getBlocker = hostOptions().getOpenBlocker!

    runtime.setAccount({ signedIn: false, online: false })
    expect(getBlocker()).toMatch(/Connectez-vous/)
    runtime.setAccount({ signedIn: true, online: false })
    expect(getBlocker()).toMatch(/accès en ligne/)
    runtime.setAccount({ signedIn: true, online: true })
    runtime.setAccess({ allowed: false, reason: 'subscription-required' })
    expect(getBlocker()).toMatch(/abonnement actif/)
    runtime.setAccess({ allowed: true })
    runtime.setFieldMutationBlocked(true)
    expect(getBlocker()).toMatch(/Terminez l'action/)
    runtime.setFieldMutationBlocked(false)
    runtime.setFieldBusy(true)
    expect(getBlocker()).toMatch(/Terminez l'action/)

    runtime.setFieldBusy(false)
    fieldOptions().onFieldLockChanged?.(true)
    expect(getBlocker()).toBeUndefined()
    expect(runtime.onFieldLockChanged).toHaveBeenCalledWith(true)
  })

  it('attend le commit autoritaire avant de livrer la trace ROM immersive', async () => {
    const runtime = createHarness()
    const bytes = new Uint8Array(11)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 30, true); view.setUint16(2, 0x123, true)
    view.setUint16(4, 45, true); bytes[6] = 0
    view.setUint16(7, 49, true)
    view.setUint16(9, 2, true)
    const eventId = createHgssSharedCampaignFieldEventId({
      rom: { gameCode: 'IPKE', gameVersion: 7, language: 2 },
      mapId,
      source: { kind: 'object', objectId: 7 },
      scriptId: 1,
    })
    let confirmCommit!: () => void
    mocked.campaign.isFieldLocked.mockReturnValue(true)
    mocked.campaign.commitSharedEvent.mockClear()
    mocked.campaign.commitSharedEvent.mockImplementationOnce(async (id: string) => {
      await new Promise<void>((resolve) => { confirmCommit = resolve })
      return Object.freeze({ eventId: id, revision: 1 })
    })
    try {
      let settled = false
      const pending = runtime.composition.exploration.tryStartSharedScript({
        map: createSharedScriptMap(bytes),
        scriptId: 1,
        source: { kind: 'object', objectId: 7 },
        actorId: 7,
      }).then((runner) => { settled = true; return runner })
      await vi.waitFor(() => {
        expect(mocked.campaign.commitSharedEvent).toHaveBeenCalledOnce()
      })
      expect(settled).toBe(false)
      expect(mocked.campaign.commitSharedEvent).toHaveBeenCalledWith(
        eventId,
        expect.objectContaining({ flags: expect.any(Set) }),
        expect.objectContaining({ flags: expect.any(Set) }),
      )

      confirmCommit()
      const runner = await pending
      expect(runner?.resume()).toEqual({
        kind: 'message', messageId: 0, text: 'Événement Coop.', speakerObjectId: 7,
      })
      expect(runtime.fieldState.flags.has(0x123)).toBe(false)
    } finally {
      mocked.campaign.isFieldLocked.mockReturnValue(false)
    }
  })

  it('présente un dialogue sans mutation sans inventer de commit serveur', async () => {
    const runtime = createHarness()
    const bytes = new Uint8Array(5)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 45, true); bytes[2] = 0
    view.setUint16(3, 2, true)
    mocked.campaign.isFieldLocked.mockReturnValue(true)
    mocked.campaign.commitSharedEvent.mockClear()
    try {
      const runner = await runtime.composition.exploration.tryStartSharedScript({
        map: createSharedScriptMap(bytes),
        scriptId: 1,
        source: { kind: 'coordinate', x: 4, z: 7 },
      })

      expect(mocked.campaign.commitSharedEvent).not.toHaveBeenCalled()
      expect(runner?.resume()).toMatchObject({ kind: 'message', text: 'Événement Coop.' })
    } finally {
      mocked.campaign.isFieldLocked.mockReturnValue(false)
    }
  })

  it('branche le host, la présentation, le verrou, le son de refus et les erreurs', async () => {
    const runtime = createHarness()
    const host = hostOptions()
    const moved = Object.freeze({ kind: 'moved', movement: 'walk' }) as AuthoritativePlayerMoveResult

    expect(host).toMatchObject({
      showLauncher: false,
      campaign: mocked.campaign.port,
      textEntry: runtime.textEntry,
      runtimeOptions: runtime.runtimeOptions,
      persistState: runtime.persistState,
      publishState: runtime.publishState,
      onOpen: runtime.onOpen,
      onClose: runtime.onClose,
    })
    expect(host.readContext()).toMatchObject({
      state: runtime.fieldState,
      pokemonCatalog: runtime.inventory.pokemonCatalog,
      teamPolicy: baseGameplayExtensionPorts.pokemonTeamPolicy,
      createPokemonVisual: runtime.createPokemonVisual,
    })

    fieldOptions().onLocalTurn?.('east')
    fieldOptions().onLocalStep?.(moved)
    fieldOptions().onFieldLockChanged?.(false)
    fieldOptions().onMovementRejected?.(new Error('blocked'))
    fieldOptions().onError?.(new Error('network failure'))
    await Promise.resolve()

    expect(runtime.presentLocalTurn).toHaveBeenCalledWith('east', expect.any(Number))
    expect(runtime.presentLocalStep).toHaveBeenCalledWith(moved, expect.any(Number))
    expect(runtime.onFieldLockChanged).toHaveBeenCalledWith(false)
    expect(runtime.playSoundEffect).toHaveBeenCalledWith(1523)
    expect(runtime.reportStatus).toHaveBeenCalledWith('network failure')
  })
})
