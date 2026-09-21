import { deleteHgssBrowserSave, deleteHgssBrowserSaveSlot, hgssBrowserSaveSlotCount, type HgssBrowserSaveSlot } from '../save/hgssSaveStorage'

export type EphemeralStoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Superpose des écritures mémoire aux lectures du navigateur. Les parcours DEV
 * peuvent ainsi tester suppression, droits NG+ et transactions sans modifier
 * le stockage persistant qui sera relu au prochain rechargement.
 */
export function createEphemeralStorageOverlay(base: EphemeralStoragePort): EphemeralStoragePort {
  const overlay = new Map<string, string | undefined>()
  return {
    getItem(key) {
      if (overlay.has(key)) return overlay.get(key) ?? null
      return base.getItem(key)
    },
    setItem(key, value) { overlay.set(key, String(value)) },
    removeItem(key) { overlay.set(key, undefined) },
  }
}

export function maskHgssCampaignSavesInOverlay(storage: EphemeralStoragePort, gameCode: string): void {
  for (let index = 1; index <= hgssBrowserSaveSlotCount; index += 1) {
    deleteHgssBrowserSaveSlot(storage, gameCode, index as HgssBrowserSaveSlot)
  }
  deleteHgssBrowserSave(storage, gameCode)
}
