export type FieldBattleFormatSource =
  | { readonly kind: 'tutorial' | 'trainerHouse' | 'tagTrainer' | 'multiTrainer' | 'wild' }
  | { readonly kind: 'trainer', readonly trainer: { readonly doubleBattle: boolean } }

export type ResolvedFieldBattleFormat =
  | { readonly engine: 'tutorial' }
  | { readonly engine: 'simple', readonly sessionKind: 'trainer' }
  | { readonly engine: 'simple', readonly sessionKind: 'wild' }
  | { readonly engine: 'double', readonly sessionKind: 'double' }
  | { readonly engine: 'double', readonly sessionKind: 'multi' }

export type FieldBattleFormatResolver = (battle: FieldBattleFormatSource) => ResolvedFieldBattleFormat

/** Reproduit strictement le dispatch HGSS actuel, sans règle optionnelle. */
export const resolveBaseFieldBattleFormat: FieldBattleFormatResolver = (battle) => {
  if (battle.kind === 'tutorial') return { engine: 'tutorial' }
  if (battle.kind === 'multiTrainer') return { engine: 'double', sessionKind: 'multi' }
  if (battle.kind === 'tagTrainer') return { engine: 'double', sessionKind: 'double' }
  if (battle.kind === 'trainer') return battle.trainer.doubleBattle
    ? { engine: 'double', sessionKind: 'double' }
    : { engine: 'simple', sessionKind: 'trainer' }
  if (battle.kind === 'wild') return { engine: 'simple', sessionKind: 'wild' }
  return { engine: 'simple', sessionKind: 'trainer' }
}
