import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'

/**
 * File ordonnée des présentations de progression de fin de combat.
 *
 * Les apprentissages doivent être résolus avant l'évolution : certaines règles
 * ROM (Mime Jr./Mimique, Excelangue/Roulade, etc.) inspectent le moveset final.
 * Une évolution est dédupliquée par Pokémon afin que plusieurs K.O. dans le
 * même combat ne conservent pas plusieurs closures sur une ancienne espèce.
 */
export type BattleProgressionPresentationQueue<TEntry> = {
  enqueueMoveLearning(entry: TEntry): void
  enqueueEvolution(key: string, entry: TEntry): void
  drain(): TEntry[]
  clear(): void
  isEmpty(): boolean
}

export function createBattleProgressionPokemonKey(
  pokemon: Pick<CanonicalPokemon, 'instanceId'>,
  source: { kind: string, ownerId?: string },
): string {
  return `${source.ownerId ?? source.kind}:${pokemon.instanceId}`
}

export function createBattleProgressionPresentationQueue<TEntry>(): BattleProgressionPresentationQueue<TEntry> {
  const moveLearning: TEntry[] = []
  const evolutions = new Map<string, TEntry>()

  return {
    enqueueMoveLearning(entry) {
      moveLearning.push(entry)
    },
    enqueueEvolution(key, entry) {
      if (!evolutions.has(key)) evolutions.set(key, entry)
    },
    drain() {
      const entries = [...moveLearning, ...evolutions.values()]
      moveLearning.length = 0
      evolutions.clear()
      return entries
    },
    clear() {
      moveLearning.length = 0
      evolutions.clear()
    },
    isEmpty() {
      return moveLearning.length === 0 && evolutions.size === 0
    },
  }
}
