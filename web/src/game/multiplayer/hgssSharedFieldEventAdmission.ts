import type { PlayerGender, RomInventory } from '../../ndsTypes'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { createHgssFieldWorldSession } from '../world/hgssFieldWorldSessionFactory'
import type { WorldSessionExtensionPorts } from '../world/worldSession'
import type { HgssCampaignServerPortContext } from './hgssCampaignServerCore'
import type { HgssCampaignClientCommand } from './hgssCampaignProtocol'
import {
  applyHgssSharedCampaignProgression,
  createHgssSharedCampaignEventIntent,
} from './hgssSharedCampaignProgression'
import { parseHgssSharedCampaignFieldEventId } from './hgssSharedCampaignEventIdentity'
import { evaluateHgssSharedFieldScriptTransaction } from './hgssSharedFieldScriptTransaction'

type SharedEventCommand = Extract<HgssCampaignClientCommand, { kind: 'shared-event' }>

export type HgssSharedFieldEventAdmissionInput = HgssCampaignServerPortContext<SharedEventCommand>

export type HgssSharedFieldEventAdmissionDecision =
  | Readonly<{ kind: 'accept' }>
  | Readonly<{ kind: 'reject', code: string, message: string }>

export type HgssSharedFieldEventAdmissionContext = Readonly<{
  inventory: Pick<
    RomInventory,
    'metadata' | 'resolvedMapCatalog' | 'mapPropAnimationMetadataResolver' | 'mapVariantResolver'
  >
  fieldState: FieldScriptState
  playerGender: PlayerGender
  gameVersion: number
  language: number
  extensionPorts: WorldSessionExtensionPorts
}>

export type HgssSharedFieldEventAdmission = (
  input: HgssSharedFieldEventAdmissionInput,
) => HgssSharedFieldEventAdmissionDecision

const reject = (code: string, message: string): HgssSharedFieldEventAdmissionDecision => (
  Object.freeze({ kind: 'reject', code, message })
)

function sameEffects(
  command: SharedEventCommand,
  intent: ReturnType<typeof createHgssSharedCampaignEventIntent>,
): boolean {
  return intent !== undefined
    && command.eventId === intent.eventId
    && command.milestoneIds.length === intent.milestoneIds.length
    && command.milestoneIds.every((value, index) => value === intent.milestoneIds[index])
    && command.counters.length === intent.counters.length
    && command.counters.every((value, index) => {
      const expected = intent.counters[index]
      return expected?.id === value.id
        && expected.expectedValue === value.expectedValue
        && expected.value === value.value
    })
}

/**
 * Oracle ROM de l'hôte. Le serveur reste l'autorité durable, mais il ne
 * soumet l'intention qu'après que le propriétaire a reproduit cible, script et
 * delta sur une copie du dernier snapshot partagé.
 */
export function createHgssSharedFieldEventAdmission(
  readContext: () => HgssSharedFieldEventAdmissionContext | undefined,
): HgssSharedFieldEventAdmission {
  return (input) => {
    let context: HgssSharedFieldEventAdmissionContext | undefined
    try { context = readContext() } catch { /* Le port reste fermé si le runtime se démonte. */ }
    if (!context) {
      return reject('shared-event-context-unavailable', "Le contexte ROM de l'hôte est indisponible.")
    }
    try {
      if (input.command.expectedRevision !== input.snapshot.revision
        || input.snapshot.sessionId !== input.sessionId) {
        return reject('shared-event-state-conflict', "Le snapshot de l'événement partagé est périmé.")
      }
      const identity = parseHgssSharedCampaignFieldEventId(input.command.eventId)
      if (!identity
        || identity.rom.gameCode !== context.inventory.metadata.gameCode
        || identity.rom.gameVersion !== context.gameVersion
        || identity.rom.language !== context.language) {
        return reject('shared-event-identity-mismatch', "L'identité ROM de l'événement partagé diverge.")
      }
      const player = input.snapshot.players.find(({ playerId }) => playerId === input.playerId)
      if (!player || player.state !== 'active' || player.position.mapId !== identity.mapId) {
        return reject('shared-event-source-mismatch', "La source terrain ne correspond pas au joueur.")
      }

      const projectedState = applyHgssSharedCampaignProgression(
        context.fieldState,
        input.snapshot.sharedProgression,
      )
      const world = createHgssFieldWorldSession({
        inventory: context.inventory,
        readFieldState: () => projectedState,
        readPlayerGender: () => context.playerGender,
        extensionPorts: context.extensionPorts,
      })
      if (!world.loadMap(
        player.position.mapId,
        player.position.x,
        player.position.z,
        player.position.direction,
        'walking',
      )) {
        return reject('shared-event-source-mismatch', "La position terrain n'existe pas dans la ROM hôte.")
      }
      const resolution = world.resolveInteraction()
      if (!resolution || resolution.map.id !== identity.mapId
        || resolution.event.kind === 'follower'
        || resolution.event.scriptId !== identity.scriptId) {
        return reject('shared-event-source-mismatch', "La cible terrain ne correspond pas à la ROM hôte.")
      }
      const actorId = identity.source.kind === 'object'
        && resolution.event.kind === 'npc'
        && resolution.event.id === identity.source.objectId
        ? resolution.event.id
        : undefined
      const coordinateMatches = identity.source.kind === 'coordinate'
        && (resolution.event.kind === 'background' || resolution.event.kind === 'metatile')
        && resolution.worldX === identity.source.x
        && resolution.worldZ === identity.source.z
      if (identity.source.kind === 'object' ? actorId === undefined : !coordinateMatches) {
        return reject('shared-event-source-mismatch', "La cible terrain ne correspond pas à la ROM hôte.")
      }

      const transaction = evaluateHgssSharedFieldScriptTransaction({
        map: resolution.map,
        scriptId: identity.scriptId,
        ...(actorId === undefined ? {} : { actorId }),
        state: projectedState,
      })
      const intent = createHgssSharedCampaignEventIntent(
        input.command.eventId,
        input.snapshot.sharedProgression,
        transaction.before,
        transaction.after,
      )
      return sameEffects(input.command, intent)
        ? Object.freeze({ kind: 'accept' })
        : reject('shared-event-effects-mismatch', "Les effets partagés ne correspondent pas au script ROM.")
    } catch {
      return reject('shared-event-script-unsafe', "Le script ROM n'appartient pas à la tranche partagée sûre.")
    }
  }
}
