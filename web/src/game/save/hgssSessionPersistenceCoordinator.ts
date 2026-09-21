import type { HgssBrowserSaveKind } from './hgssSaveStorage'

export type HgssSessionPersistenceCoordinatorOptions<
  State,
  Arguments extends [string, ...unknown[]],
  Document,
> = Readonly<{
  readArguments: (state: State, explicitFieldSave: boolean) => Arguments | undefined
  write: (
    gameCode: string,
    document: Document,
    kind: HgssBrowserSaveKind,
  ) => Readonly<{ savedAt: string }>
  onSaved?: (savedAt: string) => void
  reportError?: (message: string) => void
  createDocument: (...args: Arguments) => Document
}>

export type HgssSessionPersistenceCoordinator<State> = Readonly<{
  persist: (state: State, kind?: HgssBrowserSaveKind, explicitFieldSave?: boolean) => boolean
}>

/** Une animation visuelle ne bloque pas un checkpoint terrain déjà autoritaire. */
export function isVisualMovementSaveBlocked(playerMoving: boolean, explicitFieldSave: boolean): boolean {
  return playerMoving && !explicitFieldSave
}

/**
 * Point transactionnel unique pour la sauvegarde locale : le candidat est
 * projeté data-only et écrit avant que l'appelant ne le publie dans le jeu.
 */
export function createHgssSessionPersistenceCoordinator<
  State,
  Arguments extends [string, ...unknown[]],
  Document,
>(
  options: HgssSessionPersistenceCoordinatorOptions<State, Arguments, Document>,
): HgssSessionPersistenceCoordinator<State> {
  return Object.freeze({
    persist(state, kind = 'auto', explicitFieldSave = false) {
      try {
        const args = options.readArguments(state, explicitFieldSave)
        if (!args) return false
        const document = options.createDocument(...args)
        const record = options.write(args[0], document, kind)
        options.onSaved?.(record.savedAt)
        return true
      } catch (value) {
        options.reportError?.(value instanceof Error
          ? `Sauvegarde impossible : ${value.message}`
          : 'Sauvegarde navigateur impossible.')
        return false
      }
    },
  })
}
