import type { PlayerGender, RomInventory } from '../../ndsTypes'
import { resolveBlackthornGymCollision } from '../gyms/blackthornGymMechanism'
import { resolveVioletGymHeight } from '../gyms/violetGymMechanism'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { resolveCurrentHgssMapVariant } from './hgssWeeklyWorld'
import {
  createWorldSession,
  type WorldGymmickResolvers,
  type WorldSession,
  type WorldSessionExtensionPorts,
} from './worldSession'

const violetGymMapId = 135
const blackthornGymMapId = 141

export type HgssFieldWorldSessionInventory = Pick<
  RomInventory,
  'resolvedMapCatalog' | 'mapPropAnimationMetadataResolver' | 'mapVariantResolver'
>

export type HgssFieldWorldSessionState = Pick<
  FieldScriptState,
  | 'dynamicWarp'
  | 'flags'
  | 'gymmick'
  | 'hiddenObjectIds'
  | 'pokemonRuntime'
  | 'safariZone'
  | 'trainerFlags'
  | 'variables'
>

export type HgssFieldWorldSessionFactoryOptions = Readonly<{
  inventory: HgssFieldWorldSessionInventory
  readFieldState: () => HgssFieldWorldSessionState
  readPlayerGender: () => PlayerGender
  extensionPorts: WorldSessionExtensionPorts
}>

export function createHgssActiveGymWorldResolvers(
  readFieldState: () => Pick<HgssFieldWorldSessionState, 'gymmick'>,
): WorldGymmickResolvers {
  return {
    collision: (mapId, tileX, tileZ, metatileBehavior) => {
      const { gymmick } = readFieldState()
      return gymmick.type === 6 && mapId === blackthornGymMapId
        ? resolveBlackthornGymCollision(gymmick.data, tileX, tileZ, metatileBehavior)
        : undefined
    },
    height: (mapId, tileX, tileZ) => {
      const { gymmick } = readFieldState()
      return gymmick.type === 4 && mapId === violetGymMapId
        ? resolveVioletGymHeight(gymmick.data, tileX, tileZ)
        : undefined
    },
  }
}

export function createHgssFieldWorldSession({
  inventory,
  readFieldState,
  readPlayerGender,
  extensionPorts,
}: HgssFieldWorldSessionFactoryOptions): WorldSession {
  const initialState = readFieldState()
  return createWorldSession(
    inventory.resolvedMapCatalog.maps,
    initialState.flags,
    initialState.hiddenObjectIds,
    initialState.variables,
    inventory.mapPropAnimationMetadataResolver,
    initialState.trainerFlags,
    () => readFieldState().dynamicWarp,
    (map) => {
      const state = readFieldState()
      return resolveCurrentHgssMapVariant(
        inventory.mapVariantResolver,
        map,
        state.pokemonRuntime?.now() ?? new Date(),
        state.flags,
        state.safariZone,
        readPlayerGender(),
      )
    },
    createHgssActiveGymWorldResolvers(readFieldState),
    extensionPorts,
  )
}
