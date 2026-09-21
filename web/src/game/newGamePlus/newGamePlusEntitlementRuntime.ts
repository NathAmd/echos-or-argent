import type { HgssBrowserSaveSlot } from '../save/hgssSaveStorage'
import {
  deleteNewGamePlusEntitlement,
  markNewGamePlusEntitlementAnnounced,
  readNewGamePlusEntitlement,
  reconcileNewGamePlusEntitlement,
  type NewGamePlusEntitlement,
} from './newGamePlusEntitlementStorage'

type EntitlementStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type NewGamePlusCompletionEvidence = {
  sourceSlot: HgssBrowserSaveSlot
  savedAt: string
}

export type NewGamePlusEntitlementRuntime = {
  reset: () => void
  isUnlocked: () => boolean
  reconcile: (gameCode: string, completedSaves: readonly NewGamePlusCompletionEvidence[]) => readonly string[]
  acknowledge: () => void
  noteGameClear: (firstClear: boolean) => void
  completeFieldScript: (saved: boolean, savedAt: string | undefined, sourceSlot: HgssBrowserSaveSlot) => void
  cancelPendingGameClear: () => void
}

export function createNewGamePlusEntitlementRuntime(
  storage: EntitlementStorage,
  callbacks: {
    onUnlocked: (entitlement: NewGamePlusEntitlement) => void
    reportStatus: (message: string) => void
  },
): NewGamePlusEntitlementRuntime {
  let entitlement: NewGamePlusEntitlement | undefined
  let currentGameCode: string | undefined
  let pendingFirstClear = false

  return {
    reset: () => {
      entitlement = undefined
      currentGameCode = undefined
      pendingFirstClear = false
    },
    isUnlocked: () => Boolean(entitlement),
    reconcile: (gameCode, completedSaves) => {
      currentGameCode = gameCode
      const warnings: string[] = []
      let storedError: unknown
      try {
        entitlement = readNewGamePlusEntitlement(storage, gameCode)
      } catch (error) {
        entitlement = undefined
        storedError = error
      }
      if (storedError && completedSaves.length > 0) {
        deleteNewGamePlusEntitlement(storage, gameCode)
        warnings.push('La métadonnée New Game+ endommagée a été reconstruite depuis la sauvegarde terminée.')
      } else if (storedError) {
        warnings.push(storedError instanceof Error ? `New Game+ ignoré : ${storedError.message}` : 'Droit New Game+ invalide.')
      }
      for (const { sourceSlot, savedAt } of completedSaves) {
        try {
          entitlement = reconcileNewGamePlusEntitlement(storage, { gameCode, unlockedAt: savedAt, sourceSlot })
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : 'Le déblocage New Game+ ne peut pas être restauré.')
        }
      }
      return warnings
    },
    acknowledge: () => {
      if (!currentGameCode) return
      try {
        entitlement = markNewGamePlusEntitlementAnnounced(storage, currentGameCode)
      } catch (error) {
        callbacks.reportStatus(error instanceof Error ? error.message : 'Le déblocage New Game+ ne peut pas être confirmé.')
      }
    },
    noteGameClear: (firstClear) => { if (firstClear) pendingFirstClear = true },
    completeFieldScript: (saved, savedAt, sourceSlot) => {
      const unlocks = pendingFirstClear
      pendingFirstClear = false
      if (!unlocks || !saved || !currentGameCode) return
      try {
        entitlement = reconcileNewGamePlusEntitlement(storage, {
          gameCode: currentGameCode,
          unlockedAt: savedAt ?? new Date().toISOString(),
          sourceSlot,
        })
        if (!entitlement.announcedAt) callbacks.onUnlocked(entitlement)
      } catch (error) {
        callbacks.reportStatus(error instanceof Error ? error.message : 'Le New Game+ ne peut pas être débloqué.')
      }
    },
    cancelPendingGameClear: () => { pendingFirstClear = false },
  }
}
