const hgssSoundMoveIds = new Set([
  45, 46, 47, 48, 103, 173, 253, 304, 319, 320, 405, 448,
])

/** Table native sSoundMoves de l'overlay 12. */
export function isHgssMoveBlockedBySoundproof(moveId: number, attackerAbilityId: number, targetAbilityId: number): boolean {
  return attackerAbilityId !== 104 && targetAbilityId === 43 && hgssSoundMoveIds.has(moveId)
}

export function canHgssConfuse(targetAbilityId: number, safeguarded = false, ignoreAbility = false): boolean {
  return !safeguarded && (ignoreAbility || targetAbilityId !== 20)
}

export function canHgssInfatuate(targetAbilityId: number, ignoreAbility = false): boolean {
  return ignoreAbility || targetAbilityId !== 12
}

export function isHgssHeldItemRemovalBlocked(targetAbilityId: number, attackerAbilityId: number, targetHasItem: boolean): boolean {
  return targetHasItem && targetAbilityId === 60 && attackerAbilityId !== 104
}

/** ov12_0224B1FC : chaque Pression concernée ajoute un PP selon la portée native. */
export function resolveHgssPressurePpCost(input: {
  moveId: number
  range: number
  targetIsAttacker: boolean
  targetAbilityId: number
  opposingAbilityIds: readonly number[]
  otherAbilityIds: readonly number[]
}): number {
  if (input.moveId === 286) return 1 + input.opposingAbilityIds.filter((abilityId) => abilityId === 46).length // Possessif
  if (input.range === (1 << 3) || input.range === (1 << 6)) return 1 + input.otherAbilityIds.filter((abilityId) => abilityId === 46).length
  if (input.range === (1 << 2) || input.range === (1 << 7)) return 1 + input.opposingAbilityIds.filter((abilityId) => abilityId === 46).length
  if ([1 << 4, 1 << 5, 1 << 8, 1 << 9].includes(input.range)) return 1
  return !input.targetIsAttacker && input.targetAbilityId === 46 ? 2 : 1
}

export type HgssSwitchBlock = { blocked: false } | { blocked: true, abilityId?: 23 | 42 | 71, reason: 'binding' | 'ingrain' | 'ability' }

/** BattlerCanSwitch natif, partagé par les contrôleurs simple, double et l'UI. */
export function resolveHgssSwitchBlock(input: {
  selfAbilityId: number
  selfTypes: readonly [number, number]
  heldItemEffect: number
  magnetRise: boolean
  gravity: boolean
  bound: boolean
  ingrained: boolean
  opposingAbilityIds: readonly number[]
}): HgssSwitchBlock {
  if (input.heldItemEffect === 123) return { blocked: false } // Carapace Mue passe avant toutes les entraves dans BattlerCanSwitch.
  if (input.bound) return { blocked: true, reason: 'binding' }
  if (input.ingrained) return { blocked: true, reason: 'ingrain' }
  if (input.selfAbilityId !== 23 && input.opposingAbilityIds.includes(23)) return { blocked: true, reason: 'ability', abilityId: 23 }
  if (input.selfTypes.includes(8) && input.opposingAbilityIds.includes(42)) return { blocked: true, reason: 'ability', abilityId: 42 }
  const grounded = input.gravity || input.heldItemEffect === 106 || (input.selfAbilityId !== 26 && !input.magnetRise && !input.selfTypes.includes(2))
  return grounded && input.opposingAbilityIds.includes(71) ? { blocked: true, reason: 'ability', abilityId: 71 } : { blocked: false }
}

export type HgssDrainResolution =
  | { kind: 'heal' | 'damage', amount: number }
  | { kind: 'blocked', amount: 0 }

function boostedDrainAmount(amount: number, leechBoostPercent?: number): number {
  return leechBoostPercent ? Math.floor(amount * (100 + leechBoostPercent) / 100) : amount
}

/** Sous-script natif DrainHalfDamageDealt : Grosse Racine, Suintement, Anti-Soin et Garde Magik. */
export function resolveHgssDrain(input: {
  dealtDamage: number
  attackerCurrentHp: number
  attackerMaximumHp: number
  attackerAbilityId: number
  defenderAbilityId: number
  healBlocked: boolean
  leechBoostPercent?: number
}): HgssDrainResolution {
  if (input.dealtDamage <= 0) return { kind: 'blocked', amount: 0 }
  let amount = boostedDrainAmount(Math.max(1, Math.floor(input.dealtDamage / 2)), input.leechBoostPercent)
  if (input.defenderAbilityId === 64) return input.attackerAbilityId === 98
    ? { kind: 'blocked', amount: 0 }
    : { kind: 'damage', amount: Math.min(input.attackerCurrentHp, amount) }
  if (input.healBlocked) return { kind: 'blocked', amount: 0 }
  amount = Math.min(input.attackerMaximumHp - input.attackerCurrentHp, amount)
  return amount > 0 ? { kind: 'heal', amount } : { kind: 'blocked', amount: 0 }
}

/** Vampigraine draine tout le huitième retiré, puis applique Grosse Racine/Suintement. */
export function resolveHgssLeechSeedDrain(input: {
  dealtDamage: number
  receiverCurrentHp: number
  receiverMaximumHp: number
  receiverAbilityId: number
  seededAbilityId: number
  healBlocked: boolean
  leechBoostPercent?: number
}): HgssDrainResolution {
  if (input.dealtDamage <= 0) return { kind: 'blocked', amount: 0 }
  const amount = boostedDrainAmount(input.dealtDamage, input.leechBoostPercent)
  if (input.seededAbilityId === 64) return input.receiverAbilityId === 98
    ? { kind: 'blocked', amount: 0 }
    : { kind: 'damage', amount: Math.min(input.receiverCurrentHp, amount) }
  if (input.healBlocked) return { kind: 'blocked', amount: 0 }
  const healed = Math.min(input.receiverMaximumHp - input.receiverCurrentHp, amount)
  return healed > 0 ? { kind: 'heal', amount: healed } : { kind: 'blocked', amount: 0 }
}

/** Racines et Anneau Hydro reçoivent eux aussi le bonus de Grosse Racine. */
export function resolveHgssPassiveRecovery(input: {
  baseAmount: number
  currentHp: number
  maximumHp: number
  healBlocked: boolean
  leechBoostPercent?: number
}): number {
  if (input.healBlocked || input.currentHp >= input.maximumHp || input.baseAmount <= 0) return 0
  return Math.min(
    input.maximumHp - input.currentHp,
    boostedDrainAmount(input.baseAmount, input.leechBoostPercent),
  )
}

export type HgssStatusChainEntry = { recipient: 'target' | 'source', status: HgssAppliedStatus, applied: boolean }

/** TrySyncronizeStatus natif : seuls poison, brûlure et paralysie repartent vers la source. */
export function resolveHgssSynchronizeStatusChain(
  inflicted: { status: HgssAppliedStatus, applied: boolean } | undefined,
  synchronizerAbilityId: number,
  source: CanonicalPokemon,
  sourceTypes: readonly [number, number],
  sourceAbilityId: number,
  rng: HgssLcrng,
  context: HgssStatusContext = {},
): HgssStatusChainEntry[] {
  if (!inflicted) return []
  const chain: HgssStatusChainEntry[] = [{ recipient: 'target', ...inflicted }]
  if (!inflicted.applied || synchronizerAbilityId !== 28) return chain
  const reflected = inflicted.status === 'poison' || inflicted.status === 'badPoison' ? 'poison'
    : inflicted.status === 'burn' ? 'burn' : inflicted.status === 'paralysis' ? 'paralysis' : undefined
  if (reflected) chain.push({ recipient: 'source', ...applyHgssPrimaryStatus(reflected, source, sourceTypes, rng, sourceAbilityId, context) })
  return chain
}
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { applyHgssPrimaryStatus, type HgssAppliedStatus, type HgssStatusContext } from './hgssBattleRules'
