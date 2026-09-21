export type BattleMovePresentationEvent = {
  kind: 'move'
  presentationId: number
}

export type BattleDamagePresentationEvent = {
  kind: 'damage'
  movePresentationId?: number
}

/**
 * Associe les dégâts à l'animation qui les a réellement produits. L'ordre seul
 * n'est pas suffisant : talents, objets et résiduels peuvent s'insérer entre
 * deux capacités, tandis qu'une capacité de zone partage plusieurs dégâts.
 */
export function collectBattleMoveDamageEvents<
  TEvent extends { kind: string, movePresentationId?: number },
>(events: readonly TEvent[], move: BattleMovePresentationEvent): Array<Extract<TEvent, BattleDamagePresentationEvent>> {
  return events.filter((event): event is Extract<TEvent, BattleDamagePresentationEvent> => (
    event.kind === 'damage' && event.movePresentationId === move.presentationId
  ))
}
