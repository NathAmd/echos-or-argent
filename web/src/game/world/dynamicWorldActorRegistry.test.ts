import { describe, expect, it } from 'vitest'
import {
  createDynamicWorldActorRegistry,
  dynamicWorldActorLimits,
  dynamicWorldActorSnapshotVersion,
  getDynamicWorldActorFacingTile,
  isDynamicWorldActorSnapshot,
  parseDynamicWorldActor,
  parseDynamicWorldActorSnapshot,
  type RemotePlayerWorldActor,
  type VisibleWildWorldActor,
} from './dynamicWorldActorRegistry'

const remotePlayer: RemotePlayerWorldActor = {
  id: 'remote:player-2',
  kind: 'remote-player',
  mapId: 61,
  tileX: 8,
  tileZ: 12,
  direction: 'north',
  collision: 'blocking',
  interaction: 'action',
  displayName: 'LYRA',
  spriteId: 1,
}

const visibleWild: VisibleWildWorldActor = {
  id: 'wild:61:4',
  kind: 'visible-wild',
  mapId: 61,
  tileX: 8,
  tileZ: 11,
  direction: 'south',
  collision: 'non-blocking',
  interaction: 'action',
  speciesId: 16,
  form: 0,
  level: 4,
}

describe('contrat JSON des acteurs dynamiques', () => {
  it('valide les deux variantes après un aller-retour JSON', () => {
    expect(parseDynamicWorldActor(JSON.parse(JSON.stringify(remotePlayer)))).toEqual(remotePlayer)
    expect(parseDynamicWorldActor(JSON.parse(JSON.stringify(visibleWild)))).toEqual(visibleWild)

    const snapshot = {
      version: dynamicWorldActorSnapshotVersion,
      actors: [remotePlayer, visibleWild],
    }
    const decoded: unknown = JSON.parse(JSON.stringify(snapshot))
    expect(parseDynamicWorldActorSnapshot(decoded)).toEqual(snapshot)
    expect(isDynamicWorldActorSnapshot(decoded)).toBe(true)
  })

  it('refuse les versions, champs, bornes et identités invalides', () => {
    expect(parseDynamicWorldActor({ ...remotePlayer, id: '' })).toBeUndefined()
    expect(parseDynamicWorldActor({ ...remotePlayer, mapId: -1 })).toBeUndefined()
    expect(parseDynamicWorldActor({ ...remotePlayer, tileX: dynamicWorldActorLimits.maxCoordinate + 1 })).toBeUndefined()
    expect(parseDynamicWorldActor({ ...remotePlayer, direction: 'up' })).toBeUndefined()
    expect(parseDynamicWorldActor({ ...remotePlayer, collision: true })).toBeUndefined()
    expect(parseDynamicWorldActor({ ...remotePlayer, privateToken: 'secret' })).toBeUndefined()
    expect(parseDynamicWorldActor({ ...visibleWild, speciesId: 0 })).toBeUndefined()
    expect(parseDynamicWorldActor({ ...visibleWild, level: 101 })).toBeUndefined()
    expect(parseDynamicWorldActorSnapshot({ version: 2, actors: [] })).toBeUndefined()
    expect(parseDynamicWorldActorSnapshot({ version: 1, actors: [remotePlayer, remotePlayer] })).toBeUndefined()
  })

  it('refuse les structures hostiles ou au-delà des limites sans lever', () => {
    const hostile = Object.create(null) as Record<string, unknown>
    Object.defineProperty(hostile, 'kind', { enumerable: true, get: () => { throw new Error('hostile') } })
    expect(parseDynamicWorldActor(hostile)).toBeUndefined()
    expect(parseDynamicWorldActor(new Date())).toBeUndefined()

    const hostileActors: unknown[] = []
    Object.defineProperty(hostileActors, '0', { enumerable: true, get: () => { throw new Error('hostile') } })
    expect(parseDynamicWorldActorSnapshot({ version: 1, actors: hostileActors })).toBeUndefined()

    const tooMany = Array.from({ length: dynamicWorldActorLimits.maxActors + 1 }, (_, index) => ({
      ...visibleWild,
      id: `wild:${index}`,
    }))
    expect(parseDynamicWorldActorSnapshot({ version: 1, actors: tooMany })).toBeUndefined()
  })
})

describe('registre des acteurs dynamiques', () => {
  it('expose collision et interaction par carte et par case', () => {
    const registry = createDynamicWorldActorRegistry()
    registry.upsert(remotePlayer)
    registry.upsert(visibleWild)

    expect(registry.getActorsOnMap(61)).toEqual([visibleWild, remotePlayer])
    expect(registry.getActorsAt(61, 8, 12)).toEqual([remotePlayer])
    expect(registry.getBlockingActorsAt(61, 8, 12)).toEqual([remotePlayer])
    expect(registry.isTileBlocked(61, 8, 12)).toBe(true)
    expect(registry.isTileBlocked(61, 8, 12, remotePlayer.id)).toBe(false)
    expect(registry.isTileBlocked(61, 8, 11)).toBe(false)
    expect(registry.getInteractableActorsAt(61, 8, 11)).toEqual([visibleWild])
    expect(registry.getInteractableActorsAhead(remotePlayer)).toEqual([visibleWild])
    expect(getDynamicWorldActorFacingTile(remotePlayer)).toEqual({ mapId: 61, tileX: 8, tileZ: 11 })
  })

  it('met à jour un acteur sur une autre carte sans laisser d’ancienne occupation', () => {
    const registry = createDynamicWorldActorRegistry()
    registry.upsert(remotePlayer)
    registry.upsert({ ...remotePlayer, mapId: 62, tileX: 2, tileZ: 3, direction: 'east' })

    expect(registry.get(remotePlayer.id)).toMatchObject({ mapId: 62, tileX: 2, tileZ: 3, direction: 'east' })
    expect(registry.getActorsOnMap(61)).toEqual([])
    expect(registry.getActorsAt(62, 2, 3)).toHaveLength(1)
    expect(registry.remove(remotePlayer.id)).toBe(true)
    expect(registry.remove(remotePlayer.id)).toBe(false)
  })

  it('conserve un ordre déterministe indépendant de l’ordre des upserts', () => {
    const actorA = { ...remotePlayer, id: 'remote:a', tileX: 4, tileZ: 8 }
    const actorB = { ...remotePlayer, id: 'remote:b', tileX: 3, tileZ: 8 }
    const actorC = { ...visibleWild, id: 'wild:c', tileX: 3, tileZ: 8 }
    const registry = createDynamicWorldActorRegistry()
    registry.upsert(actorA)
    registry.upsert(actorC)
    registry.upsert(actorB)

    expect(registry.list().map(({ id }) => id)).toEqual(['remote:b', 'wild:c', 'remote:a'])
    expect(registry.snapshot().actors.map(({ id }) => id)).toEqual(['remote:b', 'wild:c', 'remote:a'])
  })

  it('restaure atomiquement un snapshot et produit un roundtrip JSON stable', () => {
    const original = createDynamicWorldActorRegistry()
    original.upsert(remotePlayer)
    original.upsert(visibleWild)
    const jsonSnapshot: unknown = JSON.parse(JSON.stringify(original.snapshot()))

    const restored = createDynamicWorldActorRegistry(jsonSnapshot)
    expect(restored.snapshot()).toEqual(original.snapshot())

    expect(() => restored.restore({ version: 1, actors: [{ ...remotePlayer, spriteId: -1 }] })).toThrow(/snapshot/)
    expect(restored.snapshot()).toEqual(original.snapshot())
  })

  it('interdit de recycler une identité stable pour un autre type', () => {
    const registry = createDynamicWorldActorRegistry()
    registry.upsert(remotePlayer)
    expect(() => registry.upsert({ ...visibleWild, id: remotePlayer.id })).toThrow(/changer de type/)
    expect(registry.get(remotePlayer.id)).toEqual(remotePlayer)
  })
})
