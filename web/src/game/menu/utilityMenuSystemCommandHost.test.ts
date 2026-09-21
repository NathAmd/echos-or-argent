import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createDefaultHgssGameOptions } from '../save/hgssGameOptions'
import type {
  MainMenuCommand,
  MainMenuResult,
  MainMenuState,
} from './mainMenuController'
import {
  createUtilityMenuSystemCommandHost,
  type UtilityMenuSystemCommandHostPorts,
} from './utilityMenuSystemCommandHost'

const menuState: MainMenuState = {
  open: true,
  screen: 'options',
  cursor: 0,
  items: [],
}
const closedMenuState: MainMenuState = { ...menuState, open: false }
const activeMap = {} as OpeningMapPreview

function commandResult(command: MainMenuCommand, optionDirection?: -1 | 1): MainMenuResult {
  return optionDirection === undefined
    ? { kind: 'command', command, state: menuState }
    : { kind: 'command', command, state: menuState, optionDirection }
}

function createFixture() {
  let map: OpeningMapPreview | undefined = activeMap
  let safariSessionActive = false
  let manualSaveResult = true
  let activeSlot = 2
  let fullscreenActive = false
  const options = createDefaultHgssGameOptions()
  let confirmation: (() => void) | undefined
  const close = vi.fn(() => closedMenuState)
  const refresh = vi.fn(() => menuState)
  const render = vi.fn()
  const hasScript = vi.fn(() => true)
  const startScript = vi.fn()
  const persistManual = vi.fn(() => manualSaveResult)
  const openBugReport = vi.fn()
  const requestConfirmation = vi.fn((_message: string, confirm: () => void) => {
    confirmation = confirm
  })
  const performEmergency = vi.fn()
  const startNewGame = vi.fn()
  const setFullscreen = vi.fn(async (enabled: boolean) => {
    fullscreenActive = enabled
  })
  const updateFullscreenPresentation = vi.fn()
  const toggleLocalWeather = vi.fn(async (currentlyEnabled: boolean) => ({
    enabled: !currentlyEnabled,
    message: 'Météo mise à jour.',
    tone: 'success' as const,
  }))
  const updateEnvironment = vi.fn()
  const persistRom = vi.fn()
  const persistSession = vi.fn()
  const syncPresentation = vi.fn()
  const setStatus = vi.fn()
  const ports: UtilityMenuSystemCommandHostPorts = {
    menu: { close, refresh, render },
    safariExit: {
      scriptId: 140,
      readActiveMap: () => map,
      hasScript,
      startScript,
      isSessionActive: () => safariSessionActive,
    },
    save: {
      persistManual,
      readActiveSlot: () => activeSlot,
    },
    bugReport: { open: openBugReport },
    emergency: { requestConfirmation, perform: performEmergency },
    newGame: { start: startNewGame },
    fullscreen: {
      isActive: () => fullscreenActive,
      setEnabled: setFullscreen,
      updatePresentation: updateFullscreenPresentation,
    },
    localWeather: { toggle: toggleLocalWeather, updateEnvironment },
    options: {
      read: () => options,
      persistRom,
      persistSession,
      syncPresentation,
    },
    setStatus,
  }
  return {
    host: createUtilityMenuSystemCommandHost(ports),
    options,
    close,
    refresh,
    render,
    hasScript,
    startScript,
    persistManual,
    openBugReport,
    requestConfirmation,
    performEmergency,
    startNewGame,
    setFullscreen,
    updateFullscreenPresentation,
    toggleLocalWeather,
    updateEnvironment,
    persistRom,
    persistSession,
    syncPresentation,
    setStatus,
    invokeConfirmation: () => confirmation?.(),
    setMap: (next: OpeningMapPreview | undefined) => { map = next },
    setSafariSessionActive: (active: boolean) => { safariSessionActive = active },
    setManualSaveResult: (saved: boolean) => { manualSaveResult = saved },
    setActiveSlot: (slot: number) => { activeSlot = slot },
    setFullscreenActive: (active: boolean) => { fullscreenActive = active },
  }
}

describe('utility menu system command host', () => {
  it('ne consomme ni les états ni les commandes d’un autre domaine', () => {
    const fixture = createFixture()

    expect(fixture.host.handle({ kind: 'state', state: menuState })).toBe(false)
    expect(fixture.host.handle(commandResult('team-member:0'))).toBe(false)
    expect(fixture.render).not.toHaveBeenCalled()
    expect(fixture.persistSession).not.toHaveBeenCalled()
  })

  it('ferme le menu avant de lancer le script de sortie Safari', () => {
    const fixture = createFixture()

    expect(fixture.host.handle(commandResult('retire'))).toBe(true)
    expect(fixture.render).toHaveBeenCalledWith(closedMenuState)
    expect(fixture.hasScript).toHaveBeenCalledWith(activeMap, 140)
    expect(fixture.startScript).toHaveBeenCalledWith(activeMap, 140)
    expect(fixture.render.mock.invocationCallOrder[0]).toBeLessThan(fixture.startScript.mock.invocationCallOrder[0]!)

    fixture.setMap(undefined)
    expect(() => fixture.host.handle(commandResult('retire')))
      .toThrowError('Le script standard Safari 140 est absent de la ROM.')
    expect(fixture.render).toHaveBeenCalledTimes(2)
  })

  it('bloque la sauvegarde dans le Safari et reproduit les deux statuts manuels', () => {
    const fixture = createFixture()
    fixture.setSafariSessionActive(true)

    expect(fixture.host.handle(commandResult('save'))).toBe(true)
    expect(fixture.persistManual).not.toHaveBeenCalled()
    expect(fixture.render).toHaveBeenLastCalledWith(menuState)

    fixture.setSafariSessionActive(false)
    fixture.setActiveSlot(3)
    fixture.host.handle(commandResult('save'))
    expect(fixture.setStatus).toHaveBeenLastCalledWith(
      'Partie sauvegardée dans l’emplacement 3.',
      'success',
    )

    fixture.setManualSaveResult(false)
    fixture.host.handle(commandResult('save'))
    expect(fixture.setStatus).toHaveBeenLastCalledWith(
      'Sauvegarde indisponible pendant cette action.',
      'warning',
    )
    expect(fixture.render).toHaveBeenCalledTimes(3)
  })

  it('préserve la fermeture et les callbacks des commandes système', () => {
    const fixture = createFixture()

    fixture.host.handle(commandResult('report-bug'))
    expect(fixture.render).toHaveBeenLastCalledWith(closedMenuState)
    expect(fixture.openBugReport).toHaveBeenCalledOnce()

    fixture.host.handle(commandResult('emergency-unstick'))
    expect(fixture.requestConfirmation).toHaveBeenCalledWith(
      'Forcer un déblocage d’urgence et simuler un blackout ROM ?',
      fixture.performEmergency,
    )
    expect(fixture.performEmergency).not.toHaveBeenCalled()
    fixture.invokeConfirmation()
    expect(fixture.performEmergency).toHaveBeenCalledOnce()

    fixture.host.handle(commandResult('new-game'))
    expect(fixture.startNewGame).toHaveBeenCalledOnce()
    expect(fixture.render).toHaveBeenLastCalledWith(closedMenuState)
  })

  it('attend le plein écran avant de rafraîchir ses présentations', async () => {
    const fixture = createFixture()
    let resolveFullscreen!: () => void
    fixture.setFullscreen.mockImplementationOnce((enabled: boolean) => {
      fixture.setFullscreenActive(enabled)
      return new Promise<void>((resolve) => { resolveFullscreen = resolve })
    })

    expect(fixture.host.handle(commandResult('toggle-fullscreen', 1))).toBe(true)
    expect(fixture.setFullscreen).toHaveBeenCalledWith(true)
    expect(fixture.updateFullscreenPresentation).not.toHaveBeenCalled()
    expect(fixture.syncPresentation).not.toHaveBeenCalled()

    resolveFullscreen()
    await Promise.resolve()
    expect(fixture.updateFullscreenPresentation).toHaveBeenCalledOnce()
    expect(fixture.syncPresentation).toHaveBeenCalledOnce()

    fixture.host.handle(commandResult('toggle-fullscreen', 1))
    expect(fixture.setFullscreen).toHaveBeenCalledOnce()
  })

  it('applique la météo seulement après la réponse asynchrone', async () => {
    const fixture = createFixture()
    let resolveWeather!: (update: { enabled: boolean; message: string; tone: 'success' }) => void
    fixture.toggleLocalWeather.mockImplementationOnce(() => new Promise((resolve) => {
      resolveWeather = resolve
    }))

    expect(fixture.host.handle(commandResult('toggle-local-weather', 1))).toBe(true)
    expect(fixture.toggleLocalWeather).toHaveBeenCalledWith(false)
    expect(fixture.options.localWeather).toBe(false)
    expect(fixture.persistSession).not.toHaveBeenCalled()

    resolveWeather({ enabled: true, message: 'Soleil local.', tone: 'success' })
    await Promise.resolve()
    expect(fixture.options.localWeather).toBe(true)
    expect(fixture.persistRom).toHaveBeenCalledWith(fixture.options)
    expect(fixture.persistSession).toHaveBeenCalledOnce()
    expect(fixture.updateEnvironment).toHaveBeenCalledWith(true)
    expect(fixture.setStatus).toHaveBeenCalledWith('Soleil local.', 'success')
    expect(fixture.syncPresentation).toHaveBeenCalledOnce()
    expect(fixture.persistRom.mock.invocationCallOrder[0]).toBeLessThan(fixture.persistSession.mock.invocationCallOrder[0]!)
    expect(fixture.persistSession.mock.invocationCallOrder[0]).toBeLessThan(fixture.updateEnvironment.mock.invocationCallOrder[0]!)
    expect(fixture.updateEnvironment.mock.invocationCallOrder[0]).toBeLessThan(fixture.setStatus.mock.invocationCallOrder[0]!)
    expect(fixture.setStatus.mock.invocationCallOrder[0]).toBeLessThan(fixture.syncPresentation.mock.invocationCallOrder[0]!)
  })

  it('fait cycler les options synchrones puis les persiste une seule fois', () => {
    const fixture = createFixture()

    fixture.host.handle(commandResult('cycle-text-speed'))
    expect(fixture.options.textSpeed).toBe('fast')
    expect(fixture.persistRom).toHaveBeenLastCalledWith(fixture.options)

    fixture.host.handle(commandResult('cycle-text-speed', -1))
    expect(fixture.options.textSpeed).toBe('normal')

    fixture.host.handle(commandResult('toggle-battle-animations', -1))
    expect(fixture.options.battleAnimations).toBe(false)
    expect(fixture.persistRom).toHaveBeenCalledTimes(3)
    expect(fixture.persistSession).toHaveBeenCalledTimes(3)
    expect(fixture.syncPresentation).toHaveBeenCalledTimes(3)
  })
})
