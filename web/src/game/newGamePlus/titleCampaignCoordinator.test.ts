import { describe, expect, it, vi } from 'vitest'
import type { RomInventory } from '../../ndsTypes'
import { createTitleMenuController } from '../menu/titleMenuController'
import type { TitleMenuSavePreview } from '../menu/titleMenuPresentationModel'
import type { TitleSaveDeletionDetails } from '../menu/titleSaveDeletionController'
import type { RestoredHgssSaveState } from '../save/hgssSaveState'
import {
  deleteHgssBrowserSaveSlotIfStorageUnchanged,
  inspectHgssBrowserSaveSlot,
  readHgssBrowserSaveSlot,
  writeHgssBrowserSaveSlot,
  type HgssBrowserSaveSlotDeletionToken,
} from '../save/hgssSaveStorage'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { HGSS_GAME_CLEAR_SYSTEM_FLAG } from '../scripts/hgssFieldSystemFlags'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { hgssDataOnlySaveAuthority } from '../save/hgssDataOnlySaveDocument'
import { parseHgssSaveBackup } from '../save/hgssSaveBackup'
import { createHgssSaveState } from '../save/hgssSaveState'
import type { GameAccessDecision } from '../access/gameFeatureAccess'
import { carryMoneyModuleId, createBuiltInNewGamePlusRegistry, type NewGamePlusProfileV1 } from './index'
import { createTitleCampaignCoordinator } from './titleCampaignCoordinator'

const deletionUiHarness = vi.hoisted(() => ({
  open: vi.fn(),
  confirm: undefined as ((details: unknown) => void) | undefined,
}))

vi.mock('../menu/titleMenuPresentationModel', () => ({
  createTitleMenuPresentationModel: vi.fn(() => ({ eyebrow: '', heading: '', cursor: 0, items: [] })),
}))
vi.mock('../ui/titleMenuPresentation', () => ({ syncTitleMenuPresentation: vi.fn() }))
vi.mock('../menu/titleSaveDeletionUi', () => ({
  createTitleSaveDeletionUi: vi.fn((
    _host: unknown,
    callbacks: { onConfirm: (details: unknown) => void },
  ) => {
    deletionUiHarness.confirm = callbacks.onConfirm
    return {
    isOpen: () => false,
    open: deletionUiHarness.open,
    close: vi.fn(),
    handle: () => false,
    }
  }),
}))
vi.mock('./newGamePlusCreationUi', () => ({
  createNewGamePlusCreationUi: vi.fn(() => ({
    isOpen: () => false,
    open: vi.fn(),
    close: vi.fn(),
    handle: () => false,
  })),
}))
vi.mock('./newGamePlusUnlockNotice', () => ({
  createNewGamePlusUnlockNotice: vi.fn(() => ({
    isOpen: () => false,
    show: vi.fn(),
    close: vi.fn(),
    handle: () => false,
  })),
}))

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

function createMenuRoot(): HTMLElement {
  return {
    classList: { add: vi.fn(), remove: vi.fn() },
    hidden: false,
    inert: false,
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
  } as unknown as HTMLElement
}

function createProfile(): NewGamePlusProfileV1 {
  return createBuiltInNewGamePlusRegistry().restoreProfile({
    format: 'pokemaster-hgss-new-game-plus',
    version: 1,
    source: {
      gameCode: 'IPKF',
      slot: 1,
      playerName: 'JO',
      leagueCompletedAt: '2026-08-25T12:00:00.000Z',
    },
    modules: [],
  })
}

function createSave(profile: NewGamePlusProfileV1): TitleMenuSavePreview {
  return {
    restored: {
      profile: { gender: 'male', name: 'JO' },
      field: { flags: new Set() },
      newGamePlus: profile,
      extensions: { 'test.module': { version: 1, value: { enabled: true } } },
    } as unknown as RestoredHgssSaveState,
    savedAt: '2026-08-25T12:30:00.000Z',
    kind: 'manual',
    deletionToken: 'slot-1-exact-bytes' as HgssBrowserSaveSlotDeletionToken,
  }
}

function createHarness(
  onResume: (menuOpen: boolean) => void,
  checkFeatureAccess?: () => GameAccessDecision,
) {
  const menu = createTitleMenuController()
  const profile = createProfile()
  const save = createSave(profile)
  let activatedProfile: NewGamePlusProfileV1 | undefined
  const onActivateProfile = vi.fn((next: NewGamePlusProfileV1 | undefined) => { activatedProfile = next })
  const reportStatus = vi.fn()
  const playSoundEffect = vi.fn()
  const coordinator = createTitleCampaignCoordinator({
    host: {} as HTMLElement,
    menuRoot: createMenuRoot(),
    menu,
    storage: new MemoryStorage(),
    readInventory: () => ({ metadata: { gameCode: 'IPKF' } }) as unknown as RomInventory,
    readSaves: () => new Map([[1, save]]),
    readCorruptSaves: () => new Map(),
    createPokemonIcon: () => undefined,
    onActivateProfile,
    onResume: () => onResume(menu.getState().open),
    onBegin: vi.fn(),
    deleteSave: async () => 'missing',
    onDelete: vi.fn(),
    reportStatus,
    playSoundEffect,
    ...(checkFeatureAccess ? { checkFeatureAccess } : {}),
  })
  coordinator.open()
  return { coordinator, menu, profile, onActivateProfile, reportStatus, playSoundEffect, readActivatedProfile: () => activatedProfile }
}

describe('coordinateur de campagne au menu titre', () => {
  it('joue les retours sonores natifs du curseur et de la sélection', () => {
    const harness = createHarness(() => undefined)

    expect(harness.coordinator.handleMenuInput('down')).toBe(true)
    expect(harness.playSoundEffect).toHaveBeenLastCalledWith(1509)
    expect(harness.coordinator.handleMenuInput('confirm')).toBe(true)
    expect(harness.playSoundEffect).toHaveBeenLastCalledWith(1500)
  })

  it('active l’export du slot focalisé avec la confirmation clavier/manette', async () => {
    const storage = new MemoryStorage()
    const profile = createProfile()
    const preview = createSave(profile)
    const document = hgssDataOnlySaveAuthority.project(createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'JO', trainerId: 7, gameVersion: 7, language: 3 },
      createHgssSessionRng(5489),
      { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
      createFieldScriptState('male', 'JO'),
    ))
    writeHgssBrowserSaveSlot(storage, 'IPKF', 1, document)
    const action = {
      dataset: { titleMenuAction: 'export', titleMenuSlot: '1' },
      setAttribute: vi.fn(),
      focus: vi.fn(),
    } as unknown as HTMLButtonElement
    const menuRoot = createMenuRoot()
    menuRoot.querySelector = vi.fn((selector: string) => (
      selector === '.title-save-action:focus' ? action : null
    )) as typeof menuRoot.querySelector
    menuRoot.querySelectorAll = vi.fn(() => [action]) as unknown as typeof menuRoot.querySelectorAll
    const saveJson = vi.fn(async (fileName: string, contents: string) => (
      fileName.length > 0 && contents.length > 0
    ))
    const inventory = {
      metadata: { gameCode: 'IPKF' },
      pokemonCatalog: createPokemonTestCatalog(),
    } as unknown as RomInventory
    const coordinator = createTitleCampaignCoordinator({
      host: {} as HTMLElement,
      menuRoot,
      menu: createTitleMenuController(),
      storage,
      readInventory: () => inventory,
      readSaves: () => new Map([[1, preview]]),
      readCorruptSaves: () => new Map(),
      createPokemonIcon: () => undefined,
      onResume: vi.fn(),
      onBegin: vi.fn(),
      deleteSave: async () => 'missing',
      onDelete: vi.fn(),
      reportStatus: vi.fn(),
      backupFiles: { pickJson: vi.fn(), saveJson },
    })
    coordinator.open()

    expect(coordinator.handleMenuInput('confirm')).toBe(true)
    await vi.waitFor(() => { expect(saveJson).toHaveBeenCalledOnce() })

    expect(parseHgssSaveBackup(saveJson.mock.calls[0]![1]).metadata.sourceSlot).toBe(1)
  })

  it('restaure le profil précédent et garde le menu ouvert si la reprise échoue', () => {
    const failure = new Error('carte absente')
    const harness = createHarness((menuOpen) => {
      expect(menuOpen).toBe(true)
      throw failure
    })

    expect(harness.coordinator.applyMenuResult({
      kind: 'choice', choice: 'slot-1', state: harness.menu.getState(),
    })).toBe(true)

    expect(harness.menu.getState().open).toBe(true)
    expect(harness.coordinator.getActiveProfile()).toBeUndefined()
    expect(harness.readActivatedProfile()).toBeUndefined()
    expect(harness.onActivateProfile).toHaveBeenCalledTimes(2)
    expect(harness.onActivateProfile.mock.calls[0]?.[0]).toEqual(harness.profile)
    expect(harness.onActivateProfile.mock.calls[1]?.[0]).toBeUndefined()
    expect(harness.reportStatus).toHaveBeenCalledWith('Reprise impossible : carte absente')
  })

  it('ne ferme le menu qu’après le succès complet de onResume', () => {
    const order: string[] = []
    const harness = createHarness((menuOpen) => {
      order.push(`resume:${menuOpen ? 'open' : 'closed'}`)
    })

    harness.coordinator.applyMenuResult({
      kind: 'choice', choice: 'slot-1', state: harness.menu.getState(),
    })
    order.push(`after:${harness.menu.getState().open ? 'open' : 'closed'}`)

    expect(order).toEqual(['resume:open', 'after:closed'])
    expect(harness.coordinator.getActiveProfile()).toEqual(harness.profile)
    expect(harness.readActivatedProfile()).toEqual(harness.profile)
    expect(harness.onActivateProfile).toHaveBeenCalledOnce()
    expect(harness.reportStatus).not.toHaveBeenCalled()
  })

  it('prépare le futur verrou serveur sans modifier l’accès NG+ par défaut', () => {
    const allowed = createHarness(vi.fn())
    allowed.coordinator.applyMenuResult({
      kind: 'choice', choice: 'slot-1', state: allowed.menu.getState(),
    })
    expect(allowed.onActivateProfile).toHaveBeenCalledOnce()

    const onResume = vi.fn()
    const blocked = createHarness(onResume, () => ({ allowed: false, reason: 'subscription-required' }))
    blocked.coordinator.applyMenuResult({
      kind: 'choice', choice: 'slot-1', state: blocked.menu.getState(),
    })

    expect(onResume).not.toHaveBeenCalled()
    expect(blocked.onActivateProfile).not.toHaveBeenCalled()
    expect(blocked.menu.getState().open).toBe(true)
    expect(blocked.reportStatus).toHaveBeenCalledWith(
      'Un abonnement actif est nécessaire pour accéder au New Game+.',
    )
  })

  it('préserve une sauvegarde remplacée par des octets différents au même horodatage avant confirmation', async () => {
    deletionUiHarness.open.mockClear()
    const storage = new MemoryStorage()
    const savedAt = '2026-08-25T12:30:00.000Z'
    const atSameTime = () => new Date(savedAt)
    writeHgssBrowserSaveSlot(storage, 'IPKF', 1, { marker: 'présenté' }, 'manual', atSameTime)
    const inspection = inspectHgssBrowserSaveSlot(storage, 'IPKF', 1)
    if (inspection.kind !== 'readable') throw new Error('Sauvegarde de test illisible')

    const profile = createProfile()
    const preview = { ...createSave(profile), deletionToken: inspection.deletionToken }
    const menu = createTitleMenuController()
    const onDelete = vi.fn()
    const reportStatus = vi.fn()
    const coordinator = createTitleCampaignCoordinator({
      host: {} as HTMLElement,
      menuRoot: createMenuRoot(),
      menu,
      storage,
      readInventory: () => ({ metadata: { gameCode: 'IPKF' } }) as unknown as RomInventory,
      readSaves: () => new Map([[1, preview]]),
      readCorruptSaves: () => new Map(),
      createPokemonIcon: () => undefined,
      onResume: vi.fn(),
      onBegin: vi.fn(),
      deleteSave: async (slot, token) => deleteHgssBrowserSaveSlotIfStorageUnchanged(storage, 'IPKF', slot, token),
      onDelete,
      reportStatus,
    })

    coordinator.activateMenuControl({
      dataset: { titleMenuAction: 'delete', titleMenuSlot: '1' },
    } as unknown as HTMLButtonElement)
    const details = deletionUiHarness.open.mock.lastCall?.[0] as TitleSaveDeletionDetails | undefined
    expect(details).toEqual(expect.objectContaining({ deletionToken: inspection.deletionToken }))

    writeHgssBrowserSaveSlot(storage, 'IPKF', 1, { marker: 'remplacé' }, 'manual', atSameTime)
    if (!details) throw new Error('Confirmation de suppression non ouverte')
    deletionUiHarness.confirm?.(details)
    await vi.waitFor(() => { expect(reportStatus).toHaveBeenCalled() })

    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 1)).toEqual(expect.objectContaining({
      savedAt,
      value: { marker: 'remplacé' },
    }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(reportStatus).toHaveBeenCalledWith(expect.stringContaining('modifié depuis la confirmation'))
  })

  it('active un profil préparé DEV par la même transaction, clone la source et conserve le profil pour la sauvegarde', () => {
    const menu = createTitleMenuController()
    const source = createFieldScriptState('male', 'JO')
    source.flags.add(HGSS_GAME_CLEAR_SYSTEM_FLAG)
    source.money = 424_242
    const profile = createBuiltInNewGamePlusRegistry().createProfile({
      source: { gameCode: 'IPKF', slot: 1, playerName: 'JO', leagueCompletedAt: '2026-08-25T12:00:00.000Z' },
      modules: [{ id: carryMoneyModuleId }],
    })
    const onActivateProfile = vi.fn()
    const onBegin = vi.fn()
    const coordinator = createTitleCampaignCoordinator({
      host: {} as HTMLElement, menuRoot: createMenuRoot(), menu, storage: new MemoryStorage(),
      readInventory: () => ({ metadata: { gameCode: 'IPKF' } }) as unknown as RomInventory,
      readSaves: () => new Map(), readCorruptSaves: () => new Map(), createPokemonIcon: () => undefined,
      onActivateProfile, onResume: vi.fn(), onBegin, deleteSave: async () => 'missing', onDelete: vi.fn(), reportStatus: vi.fn(),
      allowPreparedNewGamePlusStart: true,
    })

    expect(coordinator.beginPreparedNewGamePlusForDevelopment({ profile, source, targetSlot: 2 })).toEqual(profile)
    expect(onActivateProfile).toHaveBeenCalledWith(profile, undefined, 'new')
    expect(onBegin).toHaveBeenCalledWith(2)
    expect(coordinator.getActiveProfile()).toEqual(profile)
    source.money = 1
    expect(coordinator.applyPendingStart(createFieldScriptState('female', 'DEST')).money).toBe(424_242)
  })

  it('ferme la porte préparée hors DEV, restaure un profil invalide et refuse toute cible occupée', () => {
    const source = createFieldScriptState('male', 'JO')
    source.flags.add(HGSS_GAME_CLEAR_SYSTEM_FLAG)
    const profile = createBuiltInNewGamePlusRegistry().createProfile({
      source: { gameCode: 'IPKF', slot: 1, playerName: 'JO', leagueCompletedAt: '2026-08-25T12:00:00.000Z' }, modules: [],
    })
    const createCoordinator = (allow: boolean, occupied = false) => createTitleCampaignCoordinator({
      host: {} as HTMLElement, menuRoot: createMenuRoot(), menu: createTitleMenuController(), storage: new MemoryStorage(),
      readInventory: () => ({ metadata: { gameCode: 'IPKF' } }) as unknown as RomInventory,
      readSaves: () => occupied ? new Map([[2, createSave(profile)]]) : new Map(), readCorruptSaves: () => new Map(),
      createPokemonIcon: () => undefined, onActivateProfile: vi.fn(), onResume: vi.fn(), onBegin: vi.fn(),
      deleteSave: async () => 'missing', onDelete: vi.fn(), reportStatus: vi.fn(), allowPreparedNewGamePlusStart: allow,
    })

    expect(() => createCoordinator(false).beginPreparedNewGamePlusForDevelopment({ profile, source, targetSlot: 2 })).toThrow('développement')
    expect(() => createCoordinator(true, true).beginPreparedNewGamePlusForDevelopment({ profile, source, targetSlot: 2 })).toThrow('occupé')
    const invalid = { ...profile, modules: [{ id: 'module-inconnu', revision: 1, config: {} }] }
    expect(() => createCoordinator(true).beginPreparedNewGamePlusForDevelopment({ profile: invalid, source, targetSlot: 2 })).toThrow('pas installé')
  })

  it('restaure l’activation précédente si le démarrage préparé échoue après activation', () => {
    const source = createFieldScriptState('male', 'JO')
    source.flags.add(HGSS_GAME_CLEAR_SYSTEM_FLAG)
    const profile = createProfile()
    const onActivateProfile = vi.fn()
    const failure = new Error('intro indisponible')
    const coordinator = createTitleCampaignCoordinator({
      host: {} as HTMLElement, menuRoot: createMenuRoot(), menu: createTitleMenuController(), storage: new MemoryStorage(),
      readInventory: () => ({ metadata: { gameCode: 'IPKF' } }) as unknown as RomInventory,
      readSaves: () => new Map(), readCorruptSaves: () => new Map(), createPokemonIcon: () => undefined,
      onActivateProfile, onResume: vi.fn(), onBegin: () => { throw failure }, deleteSave: async () => 'missing', onDelete: vi.fn(), reportStatus: vi.fn(),
      allowPreparedNewGamePlusStart: true,
    })

    expect(() => coordinator.beginPreparedNewGamePlusForDevelopment({ profile, source, targetSlot: 2 })).toThrow(failure)
    expect(coordinator.getActiveProfile()).toBeUndefined()
    expect(onActivateProfile).toHaveBeenNthCalledWith(1, profile, undefined, 'new')
    expect(onActivateProfile).toHaveBeenNthCalledWith(2, undefined, undefined, 'normal')
  })
})
