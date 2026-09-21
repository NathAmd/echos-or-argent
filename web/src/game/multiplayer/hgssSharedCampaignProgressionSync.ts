import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { HgssCampaignClientGateway } from './hgssCampaignClientGateway'
import type {
  HgssCampaignPendingEvent,
  HgssCampaignServerSnapshot,
  HgssCampaignSharedProgression,
} from './hgssCampaignProtocol'
import {
  applyHgssSharedCampaignProgression,
  createHgssSharedCampaignEventIntent,
  projectHgssSharedCampaignProgression,
} from './hgssSharedCampaignProgression'
import {
  compareHgssSharedCampaignSaveProgression,
  createHgssSharedCampaignSaveExtension,
  type HgssSharedCampaignSaveExtensionV1,
} from '../save/hgssSharedCampaignSaveExtension'

export type HgssSharedCampaignProgressionSyncOptions = Readonly<{
  readState: () => FieldScriptState
  readGateway: () => HgssCampaignClientGateway | undefined
  readSavedCampaign?: () => HgssSharedCampaignSaveExtensionV1 | undefined
  persistState: (
    state: FieldScriptState,
    campaign: HgssSharedCampaignSaveExtensionV1,
  ) => Promise<void> | void
  publishState: (state: FieldScriptState) => void
}>

export type HgssSharedCampaignEventCommit = Readonly<{
  eventId: string
  revision: number
}>

export type HgssSharedCampaignProgressionSync = Readonly<{
  /** Applique, sauvegarde, puis acquitte les événements destinés au joueur local. */
  observe: (snapshot: HgssCampaignServerSnapshot, localParticipantId: string) => Promise<void>
  /** Soumet une transaction terrain déjà évaluée sur une copie isolée. */
  commit: (
    eventId: string,
    before: FieldScriptState,
    after: FieldScriptState,
  ) => Promise<HgssSharedCampaignEventCommit | undefined>
  /** Invalide les tâches d'une salle quittée avant de réutiliser le runtime. */
  reset: () => void
  flush: () => Promise<void>
}>

function sameProgression(
  left: HgssCampaignSharedProgression,
  right: HgssCampaignSharedProgression,
): boolean {
  return left.milestoneIds.length === right.milestoneIds.length
    && left.milestoneIds.every((value, index) => value === right.milestoneIds[index])
    && left.counters.length === right.counters.length
    && left.counters.every((value, index) => {
      const other = right.counters[index]
      return other?.id === value.id && other.value === value.value
    })
}

function pendingFor(
  snapshot: HgssCampaignServerSnapshot,
  localParticipantId: string,
): readonly HgssCampaignPendingEvent[] {
  return snapshot.pendingEvents.filter(({ pendingPlayerIds }) => (
    pendingPlayerIds.includes(localParticipantId)
  ))
}

function eventEffectIsPresent(
  snapshot: HgssCampaignServerSnapshot,
  intent: ReturnType<typeof createHgssSharedCampaignEventIntent>,
): boolean {
  if (!intent) return true
  const milestones = new Set(snapshot.sharedProgression.milestoneIds)
  const counters = new Map(snapshot.sharedProgression.counters.map(({ id, value }) => [id, value]))
  return milestones.has(intent.eventId)
    && intent.milestoneIds.every((id) => milestones.has(id))
    && intent.counters.every(({ id, value }) => counters.get(id) === value)
}

function sameSavedCampaign(
  left: HgssSharedCampaignSaveExtensionV1 | undefined,
  right: HgssSharedCampaignSaveExtensionV1,
): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right)
}

function asError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error('La progression partagée n’a pas pu être synchronisée.')
}

/**
 * Journal client de la progression partagée. Une présence dans le monde local
 * ne vaut jamais acquittement : la sauvegarde doit réussir avant l'ACK serveur.
 */
export function createHgssSharedCampaignProgressionSync(
  options: HgssSharedCampaignProgressionSyncOptions,
): HgssSharedCampaignProgressionSync {
  if (typeof options.readState !== 'function'
    || typeof options.readGateway !== 'function'
    || typeof options.persistState !== 'function'
    || typeof options.publishState !== 'function') {
    throw new TypeError('Les ports de progression partagée HGSS sont incomplets.')
  }

  let generation = 0
  let activeSessionId: string | undefined
  let activeLocalParticipantId: string | undefined
  let appliedRevision = -1
  let queue: Promise<void> = Promise.resolve()

  const enqueue = <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  const reconcile = async (
    snapshot: HgssCampaignServerSnapshot,
    localParticipantId: string,
    expectedGeneration: number,
  ): Promise<void> => {
    if (expectedGeneration !== generation || snapshot.sessionId !== activeSessionId) return
    if (snapshot.revision < appliedRevision) return

    const current = options.readState()
    const pending = pendingFor(snapshot, localParticipantId)
    const savedCampaign = createHgssSharedCampaignSaveExtension(
      snapshot.sharedProgression,
      snapshot.sessionId,
      snapshot.pendingEvents,
      localParticipantId,
    )
    const previousCampaign = options.readSavedCampaign?.()
    if (previousCampaign) {
      const order = compareHgssSharedCampaignSaveProgression(savedCampaign, previousCampaign)
      if (order === 'different-branch') {
        throw new Error('La salle Coop appartient à une autre branche de campagne.')
      }
      if (order === 'right-ahead') {
        throw new Error('La salle Coop est plus ancienne que la sauvegarde locale.')
      }
      if (order === 'divergent') {
        throw new Error('La salle Coop diverge de la sauvegarde locale.')
      }
    }

    const candidate = applyHgssSharedCampaignProgression(current, snapshot.sharedProgression)
    const currentProjection = projectHgssSharedCampaignProgression(current)
    const candidateProjection = projectHgssSharedCampaignProgression(candidate)
    const changed = !sameProgression(currentProjection, candidateProjection)
    const checkpointChanged = !sameSavedCampaign(previousCampaign, savedCampaign)

    if (changed || pending.length > 0 || checkpointChanged) {
      await options.persistState(candidate, savedCampaign)
      if (expectedGeneration !== generation || snapshot.sessionId !== activeSessionId) return
      if (changed) options.publishState(candidate)
    }

    appliedRevision = Math.max(appliedRevision, snapshot.revision)
    for (const event of pending) {
      if (expectedGeneration !== generation || snapshot.sessionId !== activeSessionId) return
      const gateway = options.readGateway()
      // Le snapshot initial doit être écrit avant que le gateway publie
      // `connected`. Son ACK sera repris lorsque le coordinator republiera ce
      // même snapshot après la barrière ready.
      if (!gateway || gateway.getState().status !== 'connected') return
      const authoritativePending = gateway.getState().snapshot?.pendingEvents.find(({ eventId }) => (
        eventId === event.eventId
      ))
      // `gateway.send` publie son snapshot avant de résoudre. Un observeur déjà
      // en file peut donc revoir l'ancien snapshot après un premier ACK réussi :
      // seule l'autorité courante décide si cet ACK est encore nécessaire.
      if (authoritativePending?.eventRevision !== event.eventRevision
        || !authoritativePending.pendingPlayerIds.includes(localParticipantId)) continue
      await gateway.send({
        kind: 'event-ack',
        eventId: event.eventId,
        eventRevision: event.eventRevision,
      })
    }
  }

  const observe = (
    snapshot: HgssCampaignServerSnapshot,
    localParticipantId: string,
  ): Promise<void> => {
    if (snapshot.sessionId !== activeSessionId) {
      activeSessionId = snapshot.sessionId
      activeLocalParticipantId = localParticipantId
      appliedRevision = -1
      generation += 1
    } else if (activeLocalParticipantId !== localParticipantId) {
      return Promise.reject(new Error("L'identité locale de la campagne a changé dans la même salle."))
    }
    const expectedGeneration = generation
    return enqueue(() => reconcile(snapshot, localParticipantId, expectedGeneration))
  }

  const commit = (
    eventId: string,
    before: FieldScriptState,
    after: FieldScriptState,
  ): Promise<HgssSharedCampaignEventCommit | undefined> => enqueue(async () => {
    const expectedGeneration = generation
    const sessionId = activeSessionId
    const localParticipantId = activeLocalParticipantId
    const gateway = options.readGateway()
    const snapshot = gateway?.getState().snapshot
    if (!gateway || gateway.getState().status !== 'connected' || !snapshot
      || !sessionId || !localParticipantId || snapshot.sessionId !== sessionId) {
      throw new Error("L'autorité Coop n'est pas prête pour cet événement terrain.")
    }

    const intent = createHgssSharedCampaignEventIntent(
      eventId,
      snapshot.sharedProgression,
      before,
      after,
    )
    if (!intent) return undefined

    try {
      await gateway.send(intent)
    } catch (value) {
      const recovered = gateway.getState().snapshot
      if (!recovered || recovered.sessionId !== sessionId || !eventEffectIsPresent(recovered, intent)) {
        throw asError(value)
      }
    }

    const accepted = gateway.getState().snapshot
    if (expectedGeneration !== generation || !accepted || accepted.sessionId !== sessionId
      || !eventEffectIsPresent(accepted, intent)) {
      throw new Error("Le snapshot autoritaire ne prouve pas le commit de l'événement terrain.")
    }
    await reconcile(accepted, localParticipantId, expectedGeneration)
    return Object.freeze({ eventId, revision: accepted.revision })
  })

  const reset = (): void => {
    generation += 1
    activeSessionId = undefined
    activeLocalParticipantId = undefined
    appliedRevision = -1
  }

  return Object.freeze({
    observe,
    commit,
    reset,
    flush: () => queue,
  })
}
