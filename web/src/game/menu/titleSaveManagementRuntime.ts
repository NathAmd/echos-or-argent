import type { HgssBrowserSaveSlot } from '../save/hgssSaveStorage'
import type { TitleMenuCorruptSavePreview, TitleMenuSavePreview } from './titleMenuPresentationModel'
import type { TitleMenuActionId } from '../ui/titleMenuPresentation'

export type TitleSaveNewGamePlusPreference = {
  sourceSlot?: HgssBrowserSaveSlot
  targetSlot?: HgssBrowserSaveSlot
}

export type TitleSaveManagementRuntime = {
  activate: (action: TitleMenuActionId, slot?: HgssBrowserSaveSlot) => void
}

export function createTitleSaveManagementRuntime(options: {
  readSaves: () => ReadonlyMap<HgssBrowserSaveSlot, TitleMenuSavePreview>
  readCorruptSaves: () => ReadonlyMap<HgssBrowserSaveSlot, TitleMenuCorruptSavePreview>
  activateSlot: (slot: HgssBrowserSaveSlot) => void
  requestDelete: (slot: HgssBrowserSaveSlot, save: TitleMenuSavePreview) => void
  requestDeleteCorrupt: (slot: HgssBrowserSaveSlot, save: TitleMenuCorruptSavePreview) => void
  exportSave: (slot: HgssBrowserSaveSlot) => void
  importSave: (slot: HgssBrowserSaveSlot) => void
  openNewGamePlus: (preference: TitleSaveNewGamePlusPreference) => void
  reportStatus: (message: string) => void
  refresh: () => void
}): TitleSaveManagementRuntime {
  return {
    activate: (action, slot) => {
      const save = slot === undefined ? undefined : options.readSaves().get(slot)
      const corrupt = slot === undefined ? undefined : options.readCorruptSaves().get(slot)
      if (action === 'continue') {
        if (slot !== undefined && save) options.activateSlot(slot)
        else options.reportStatus(corrupt
          ? `L’emplacement ${slot} est corrompu : supprimez-le explicitement pour le libérer.`
          : 'Cette sauvegarde n’est plus disponible.')
        return
      }
      if (action === 'new-game') {
        if (slot !== undefined && !save && !corrupt) options.activateSlot(slot)
        else options.reportStatus('Cet emplacement est désormais occupé.')
        return
      }
      if (action === 'delete') {
        if (slot !== undefined && save) options.requestDelete(slot, save)
        else if (slot !== undefined && corrupt) options.requestDeleteCorrupt(slot, corrupt)
        else {
          options.reportStatus('Cette sauvegarde n’est plus disponible.')
          options.refresh()
        }
        return
      }
      if (action === 'export') {
        if (slot !== undefined && save) options.exportSave(slot)
        else options.reportStatus(corrupt
          ? `L’emplacement ${slot} est corrompu et ne peut pas être exporté.`
          : 'Cette sauvegarde n’est plus disponible.')
        return
      }
      if (action === 'import') {
        if (slot !== undefined && !save && !corrupt) options.importSave(slot)
        else options.reportStatus(slot === undefined
          ? 'La destination du backup n’est plus disponible.'
          : `L’emplacement ${slot} est occupé et ne sera pas remplacé.`)
        return
      }
      if (slot !== undefined && corrupt) {
        options.reportStatus(`L’emplacement ${slot} est corrompu et ne peut être ni source ni destination New Game+.`)
        return
      }
      options.openNewGamePlus(slot === undefined
        ? {}
        : save
          ? { sourceSlot: slot }
          : { targetSlot: slot })
    },
  }
}
