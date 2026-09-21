import type { HgssMersenneTwister } from '../pokemon/hgssSessionRng'

export type HgssFriendGroup = {
  groupName?: string
  groupNameSource?: 'user-text'
  memberName?: string
  memberNameSource?: 'user-text'
  memberGender: 'male' | 'female'
  language: number
  groupId: number
  randomValue: number
}

export type HgssFriendGroupState = Array<HgssFriendGroup>

export function createHgssFriendGroupState(): HgssFriendGroupState {
  return Array.from({ length: 6 }, () => ({
    memberGender: 'male',
    language: 0,
    groupId: 0,
    randomValue: 0,
  }))
}

export function cloneHgssFriendGroupState(state: HgssFriendGroupState): HgssFriendGroupState {
  return state.map((group) => ({ ...group }))
}

/** Port de `sub_0202C78C`: PRandom est avancé une fois par jour pour les six groupes. */
export function advanceHgssFriendGroupDays(state: HgssFriendGroupState, elapsedDays: number): void {
  if (!Number.isInteger(elapsedDays) || elapsedDays < 0) {
    throw new Error(`Le nombre de jours des groupes amis HGSS ${elapsedDays} est invalide.`)
  }
  for (const group of state) {
    for (let day = 0; day < elapsedDays; day += 1) {
      group.randomValue = (Math.imul(group.randomValue, 1812433253) + 1) >>> 0
    }
  }
}

export function isHgssFriendGroupActive(group: HgssFriendGroup | undefined): boolean {
  return group?.groupName !== undefined && group.memberName !== undefined
}

export function areHgssFriendGroupsEqual(first: HgssFriendGroup | undefined, second: HgssFriendGroup | undefined): boolean {
  return Boolean(first && second
    && first.groupName === second.groupName
    && first.memberName === second.memberName
    && first.memberGender === second.memberGender
    && first.language === second.language
    && first.groupId === second.groupId)
}

export function initializePlayerHgssFriendGroup(
  state: HgssFriendGroupState,
  playerName: string,
  gender: 'male' | 'female',
  mt: HgssMersenneTwister,
): void {
  const owner = state[0]
  if (!owner) throw new Error('Le groupe ami propriétaire HGSS est absent.')
  owner.memberName = playerName.slice(0, 7)
  owner.memberNameSource = 'user-text'
  owner.memberGender = gender
  owner.language = 2
  owner.groupId = mt.nextU32()
  owner.randomValue = (Math.imul(owner.groupId, 1812433253) + 1) >>> 0
  state[1] = { ...owner }
}

export function copyHgssFriendGroup(state: HgssFriendGroupState, source: number, destination: number): void {
  const group = state[source]
  if (!group || destination < 0 || destination >= state.length) throw new Error(`Copie de groupe ami HGSS ${source}->${destination} invalide.`)
  state[destination] = { ...group }
}
