import { describe, expect, it } from 'vitest'
import { createFieldScriptState } from './fieldScriptRunner'
import { applyProjectedFieldState } from './projectedFieldState'

describe('commit d’un état de script projeté', () => {
  it('clone profondément la zone et la progression Safari sans remplacer la racine', () => {
    const target = createFieldScriptState('male', 'JO')
    const source = createFieldScriptState('female', 'KRI')
    source.poisonStepCounter = 3
    source.friendshipStepCounter = 127
    source.safariZone.areaSets[0].areas[0].placements.push({ objectId: 1, x: 2, y: 3, z: 4 })
    source.safariProgression = { ...source.safariProgression, pendingEncounterAreaIds: [2, 7] }
    const root = { dataset: {}, style: { setProperty: () => undefined } } as unknown as HTMLElement

    applyProjectedFieldState(target, source, root)
    source.safariZone.areaSets[0].areas[0].placements[0]!.x = 99
    source.safariProgression.pendingEncounterAreaIds[0] = 9

    expect(target.safariZone.areaSets[0].areas[0].placements[0]?.x).toBe(2)
    expect(target.safariProgression.pendingEncounterAreaIds).toEqual([2, 7])
    expect(target.poisonStepCounter).toBe(3)
    expect(target.friendshipStepCounter).toBe(127)
  })
})
