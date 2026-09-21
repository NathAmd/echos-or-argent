import type { OpeningMapPreview } from '../../ndsTypes'
import {
  cycleHgssTextSpeed,
  stepHgssTextSpeed,
  type HgssGameOptions,
} from '../save/hgssGameOptions'
import { parseMainMenuCommand } from './mainMenuCommand'
import type { MainMenuController, MainMenuResult, MainMenuState } from './mainMenuController'

export type UtilityMenuStatusTone = 'info' | 'success' | 'warning'

export type UtilityMenuSystemCommandHostPorts = Readonly<{
  menu: Pick<MainMenuController, 'close' | 'refresh'> & Readonly<{
    render: (state: MainMenuState) => void
  }>
  safariExit: Readonly<{
    scriptId: number
    readActiveMap: () => OpeningMapPreview | undefined
    hasScript: (map: OpeningMapPreview, scriptId: number) => boolean
    startScript: (map: OpeningMapPreview, scriptId: number) => void
    isSessionActive: () => boolean
  }>
  save: Readonly<{
    persistManual: () => boolean
    readActiveSlot: () => number
  }>
  bugReport: Readonly<{
    open: () => void | Promise<unknown>
  }>
  emergency: Readonly<{
    requestConfirmation: (message: string, confirm: () => void) => void
    perform: () => void
  }>
  newGame: Readonly<{
    start: () => void
  }>
  fullscreen: Readonly<{
    isActive: () => boolean
    setEnabled: (enabled: boolean) => Promise<unknown>
    updatePresentation: () => void
  }>
  localWeather: Readonly<{
    toggle: (currentlyEnabled: boolean) => Promise<{
      enabled: boolean
      message: string
      tone: 'success' | 'warning'
    }>
    updateEnvironment: (force: boolean) => void
  }>
  options: Readonly<{
    read: () => HgssGameOptions
    persistRom: (options: HgssGameOptions) => void
    persistSession: () => void
    syncPresentation: () => void
  }>
  setStatus: (text: string, tone?: UtilityMenuStatusTone) => void
}>

export type UtilityMenuSystemCommandHost = Readonly<{
  handle: (result: MainMenuResult) => boolean
}>

/** Owns system actions and Options commands emitted by the utility menu. */
export function createUtilityMenuSystemCommandHost(
  ports: UtilityMenuSystemCommandHostPorts,
): UtilityMenuSystemCommandHost {
  const persistOptions = (options: HgssGameOptions): void => {
    ports.options.persistRom(options)
    ports.options.persistSession()
    ports.options.syncPresentation()
  }

  return Object.freeze({
    handle(result): boolean {
      if (result.kind !== 'command') return false
      const command = parseMainMenuCommand(result.command)

      if (command.kind === 'retire') {
        const map = ports.safariExit.readActiveMap()
        ports.menu.render(ports.menu.close())
        if (!map || !ports.safariExit.hasScript(map, ports.safariExit.scriptId)) {
          throw new Error(`Le script standard Safari ${ports.safariExit.scriptId} est absent de la ROM.`)
        }
        ports.safariExit.startScript(map, ports.safariExit.scriptId)
        return true
      }
      if (command.kind === 'save') {
        if (ports.safariExit.isSessionActive()) {
          ports.menu.render(ports.menu.refresh())
          return true
        }
        const saved = ports.save.persistManual()
        ports.setStatus(
          saved
            ? `Partie sauvegardée dans l’emplacement ${ports.save.readActiveSlot()}.`
            : 'Sauvegarde indisponible pendant cette action.',
          saved ? 'success' : 'warning',
        )
        ports.menu.render(ports.menu.refresh())
        return true
      }
      if (command.kind === 'report-bug') {
        ports.menu.render(ports.menu.close())
        void ports.bugReport.open()
        return true
      }
      if (command.kind === 'emergency-unstick') {
        ports.emergency.requestConfirmation(
          'Forcer un déblocage d’urgence et simuler un blackout ROM ?',
          ports.emergency.perform,
        )
        return true
      }
      if (command.kind === 'new-game') {
        ports.newGame.start()
        ports.menu.render(ports.menu.close())
        return true
      }
      if (command.kind === 'toggle-fullscreen') {
        const enable = result.optionDirection === undefined
          ? !ports.fullscreen.isActive()
          : result.optionDirection > 0
        if (enable === ports.fullscreen.isActive()) return true
        void ports.fullscreen.setEnabled(enable).then(() => {
          ports.fullscreen.updatePresentation()
          ports.options.syncPresentation()
        })
        return true
      }
      if (command.kind === 'toggle-local-weather') {
        const current = ports.options.read()
        const enable = result.optionDirection === undefined
          ? !current.localWeather
          : result.optionDirection > 0
        if (enable === current.localWeather) return true
        void ports.localWeather.toggle(current.localWeather).then((update) => {
          const options = ports.options.read()
          options.localWeather = update.enabled
          ports.options.persistRom(options)
          ports.options.persistSession()
          ports.localWeather.updateEnvironment(true)
          ports.setStatus(update.message, update.tone)
          ports.options.syncPresentation()
        })
        return true
      }
      if (command.kind === 'cycle-text-speed') {
        const options = ports.options.read()
        options.textSpeed = result.optionDirection
          ? stepHgssTextSpeed(options.textSpeed, result.optionDirection)
          : cycleHgssTextSpeed(options.textSpeed)
        persistOptions(options)
        return true
      }
      if (command.kind === 'toggle-battle-animations') {
        const options = ports.options.read()
        options.battleAnimations = result.optionDirection
          ? result.optionDirection > 0
          : !options.battleAnimations
        persistOptions(options)
        return true
      }
      return false
    },
  })
}
