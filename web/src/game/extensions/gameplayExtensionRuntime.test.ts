import { describe, expect, it, vi } from 'vitest'
import { baseGameplayExtensionPorts, type GameplayExtensionPorts } from './gameplayExtensionPorts'
import { createGameplayExtensionRuntime } from './gameplayExtensionRuntime'

describe('gameplayExtensionRuntime', () => {
  it('conserve ses références tout en changeant de cible puis revient au jeu de base', () => {
    const runtime = createGameplayExtensionRuntime(baseGameplayExtensionPorts)
    const stablePolicy = runtime.ports.battleActionPolicy
    const vetoPlayerAction = vi.fn(() => ({ code: 'test', reason: 'Règle NG+.' }))
    const ngPlusPorts: GameplayExtensionPorts = {
      ...baseGameplayExtensionPorts,
      battleActionPolicy: { vetoPlayerAction },
    }
    const intent = { kind: 'switch', format: 'simple', mode: 'voluntary', partyIndex: 1 } as const

    expect(stablePolicy.vetoPlayerAction(intent)).toBeUndefined()
    runtime.activate(ngPlusPorts)
    expect(runtime.ports.battleActionPolicy).toBe(stablePolicy)
    expect(stablePolicy.vetoPlayerAction(intent)).toEqual({ code: 'test', reason: 'Règle NG+.' })
    expect(vetoPlayerAction).toHaveBeenCalledOnce()

    runtime.reset()
    expect(stablePolicy.vetoPlayerAction(intent)).toBeUndefined()
  })

  it('délègue aussi les fournisseurs imbriqués des acteurs du monde', () => {
    const runtime = createGameplayExtensionRuntime(baseGameplayExtensionPorts)
    const actor = {
      id: 'visible:1', mapId: 4, tileX: 2, tileZ: 3, direction: 'south', kind: 'visible-wild',
      collision: 'blocking', interaction: 'action', speciesId: 152, form: 0, level: 5,
    } as const
    runtime.activate({
      ...baseGameplayExtensionPorts,
      worldSessionExtensionPorts: {
        dynamicActors: {
          getBlockingActorsAt: () => [actor],
          getInteractableActorsAt: () => [actor],
        },
      },
    })

    expect(runtime.ports.worldSessionExtensionPorts.dynamicActors.getBlockingActorsAt(4, 2, 3)).toEqual([actor])
    runtime.reset()
    expect(runtime.ports.worldSessionExtensionPorts.dynamicActors.getBlockingActorsAt(4, 2, 3)).toEqual([])
  })
})
