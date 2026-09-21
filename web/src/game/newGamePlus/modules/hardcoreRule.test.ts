import { describe, expect, it } from 'vitest'
import { baseBattleActionPolicy } from '../../battle/battleActionPolicy'
import { basePokemonLevelPolicy } from '../../pokemon/pokemonLevelPolicy'
import { deriveLegacyPokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import { createVersionedSaveExtensionRegistry } from '../../save/versionedSaveExtensions'
import type { HardcoreConfig } from './hardcoreModule'
import { hardcoreStateFormat } from './hardcoreState'
import {
  createHardcoreRuntime,
  hardcoreSaveExtension,
  hardcoreSaveExtensionKey,
} from './hardcoreRule'

const config: HardcoreConfig = {
  levelCaps: [
    { progression: 0, nextMajorBattle: 'Arène Alpha', levelCap: 13 },
    { progression: 2, nextMajorBattle: 'Arène Bêta', levelCap: 17 },
    { progression: 5, nextMajorBattle: 'Ligue', levelCap: 50 },
  ],
}
const pokemonInstanceId = deriveLegacyPokemonInstanceId('hardcore-test', 'runtime')

describe('runtime Hardcore', () => {
  it("reste exactement neutre lorsqu'il est désactivé", () => {
    const runtime = createHardcoreRuntime({ enabled: false, config })

    expect(runtime.enabled).toBe(false)
    expect(runtime.battleActionPolicy).toBe(baseBattleActionPolicy)
    expect(runtime.pokemonLevelPolicy).toBe(basePokemonLevelPolicy)
    expect(runtime.snapshotState()).toBeUndefined()
  })

  it('autorise uniquement les Balls et interdit les objets tactiques en simple ou double', () => {
    const runtime = createHardcoreRuntime({ enabled: true, config, readProgression: () => 0 })

    for (const format of ['simple', 'double'] as const) {
      expect(runtime.battleActionPolicy.vetoPlayerAction({
        kind: 'bag', format, itemId: 4, role: 'capture',
      })).toBeUndefined()
      for (const role of ['escape', 'battle-stat', 'party-target'] as const) {
        expect(runtime.battleActionPolicy.vetoPlayerAction({
          kind: 'bag',
          format,
          itemId: 1,
          role,
        })?.code).toBe('new-game-plus.hardcore.bag-forbidden')
      }
    }
  })

  it('refuse seulement le choix gratuit, pas un changement consommant un tour ni Safari', () => {
    const runtime = createHardcoreRuntime({ enabled: true, config, readProgression: () => 0 })

    expect(runtime.battleActionPolicy.vetoPlayerAction({
      kind: 'switch', format: 'simple', mode: 'voluntary', partyIndex: 1,
    })).toBeUndefined()
    expect(runtime.battleActionPolicy.vetoPlayerAction({
      kind: 'switch', format: 'double', mode: 'free-between-opponents', partyIndex: 2,
    })?.code).toBe('new-game-plus.hardcore.free-switch-forbidden')
    expect(runtime.battleActionPolicy.vetoPlayerAction({ kind: 'safari', action: 'ball' })).toBeUndefined()
    expect(runtime.battleActionPolicy.vetoPlayerAction({ kind: 'safari', action: 'run' })).toBeUndefined()
  })

  it('résout le plafond exclusivement depuis la table et le lecteur de progression', () => {
    let progression = 0
    const runtime = createHardcoreRuntime({ enabled: true, config, readProgression: () => progression })

    expect(runtime.readActiveLevelCap()).toEqual(runtime.config.levelCaps[0])
    expect(runtime.pokemonLevelPolicy.resolveLevelCap({
      source: 'battle',
      pokemon: { instanceId: pokemonInstanceId, speciesId: 1, level: 5, experience: 100 },
    })).toBe(13)
    progression = 2
    expect(runtime.readActiveLevelCap()).toEqual(runtime.config.levelCaps[1])
    expect(runtime.pokemonLevelPolicy.resolveLevelCap({
      source: 'rare-candy',
      pokemon: { instanceId: pokemonInstanceId, speciesId: 1, level: 16, experience: 4000 },
    })).toBe(17)
    progression = 99
    expect(runtime.pokemonLevelPolicy.resolveLevelCap({
      source: 'daycare',
      pokemon: { instanceId: pokemonInstanceId, speciesId: 1, level: 17, experience: 5000 },
    })).toBe(50)
  })

  it('sauvegarde une progression monotone et la restaure transactionnellement', () => {
    let progression = 2
    const runtime = createHardcoreRuntime({ enabled: true, config, readProgression: () => progression })
    expect(runtime.readActiveLevelCap().levelCap).toBe(17)
    progression = 0

    const snapshot = runtime.snapshotState()
    expect(snapshot).toEqual({
      format: hardcoreStateFormat,
      version: 1,
      highestProgression: 2,
    })
    expect(runtime.readActiveLevelCap().levelCap).toBe(17)

    runtime.restoreState({ ...snapshot!, highestProgression: 5 })
    expect(runtime.readActiveLevelCap().levelCap).toBe(50)
    expect(() => runtime.restoreState({ ...snapshot!, highestProgression: -1 })).toThrow()
    expect(runtime.snapshotState()?.highestProgression).toBe(5)
  })

  it('rejette immédiatement une progression hôte invalide', () => {
    const runtime = createHardcoreRuntime({ enabled: true, config, readProgression: () => 1.5 })
    expect(() => runtime.readActiveLevelCap()).toThrow(/entier positif ou nul/)
    expect(() => runtime.snapshotState()).toThrow(/entier positif ou nul/)
  })

  it("s'intègre à l'enveloppe versionnée sans état Nuzlocke ni permadeath", () => {
    const registry = createVersionedSaveExtensionRegistry([hardcoreSaveExtension])
    const source = createHardcoreRuntime({ enabled: true, config, readProgression: () => 2 })
    const saved = registry.save(source)
    const restored = createHardcoreRuntime({ enabled: true, config, readProgression: () => 0 })

    expect(saved).toEqual({
      [hardcoreSaveExtensionKey]: { version: 1, value: source.snapshotState() },
    })
    registry.load(restored, JSON.parse(JSON.stringify(saved)))
    expect(restored.snapshotState()).toEqual(source.snapshotState())
    expect('teamPolicy' in restored).toBe(false)
    expect('detailedBattleOutcomeObserver' in restored).toBe(false)
  })
})
