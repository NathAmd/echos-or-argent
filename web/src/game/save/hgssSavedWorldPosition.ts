import type { HgssSavedWorldPosition } from './hgssSaveState'
import type { FollowerWorldState, WorldState } from '../world/worldSession'

export type HgssSavedWorldPositionSource = Readonly<
  Pick<WorldState, 'tileX' | 'tileZ' | 'direction' | 'locomotion'>
  & { map: Readonly<Pick<WorldState['map'], 'id'>> }
>

export type HgssSavedFollowerPositionSource = Readonly<
  Pick<FollowerWorldState, 'tileX' | 'tileZ' | 'direction' | 'movement'>
>

/** Projette uniquement l'état spatial persistant, sans modifier la session monde. */
export function projectHgssSavedWorldPosition(
  world: HgssSavedWorldPositionSource,
  follower: HgssSavedFollowerPositionSource | undefined,
): HgssSavedWorldPosition {
  return {
    mapId: world.map.id,
    tileX: world.tileX,
    tileZ: world.tileZ,
    direction: world.direction,
    locomotion: world.locomotion,
    follower: follower && {
      tileX: follower.tileX,
      tileZ: follower.tileZ,
      direction: follower.direction,
      movement: follower.movement,
    },
  }
}
