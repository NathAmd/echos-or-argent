import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Pokérus post-combat dans le runtime navigateur', () => {
  it('applique la progression commune aux sorties des combats simple et double', () => {
    const main = readFileSync(new URL('../../main.ts', import.meta.url), 'utf8')
    const calls = main.match(/applyPostBattle\(fieldScriptState\.party, [^)]+, battle\.result === 'won'\)/g) ?? []

    expect(main).toContain('applyHgssPostBattleProgression as applyPostBattle')
    expect(calls).toHaveLength(2)
    expect(main).not.toContain('applyHgssPostBattleAbilityItems(fieldScriptState.party.members')
  })
})
