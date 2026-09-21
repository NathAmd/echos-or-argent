import { describe, expect, it } from 'vitest'
import type { HgssBattleAnimationScript } from '../../rom/battle/battleAnimationScripts'
import {
  HGSS_BATTLE_PRESENTATION_SCRIPT_IDS,
  resolveHgssBattleEventPresentationAnimation,
  resolveHgssCannotActPresentationAnimation,
  resolveHgssConditionPresentationAnimation,
  resolveHgssBattlePresentationScript,
} from './hgssBattlePresentationAnimation'

function script(id: number, populated = true): HgssBattleAnimationScript {
  return {
    id,
    byteLength: populated ? 4 : 0,
    words: populated ? Uint32Array.of(4) : new Uint32Array(),
    instructions: populated ? [{ offsetWords: 0, opcode: 4, name: 'End', operands: new Uint32Array() }] : [],
  }
}

describe('HGSS battle presentation animations', () => {
  it('uses the native status and condition animation table', () => {
    expect(HGSS_BATTLE_PRESENTATION_SCRIPT_IDS).toEqual({
      sleep: 1,
      poison: 2,
      badPoison: 2,
      burn: 3,
      freeze: 4,
      paralysis: 5,
      confusion: 6,
      infatuation: 7,
      levelUp: 8,
      bagItem: 9,
      heldItem: 10,
      shiny: 11,
      statUp: 12,
      statDown: 13,
      heal: 14,
    })
  })

  it('resolves toxic poison through the same native poison animation', () => {
    const battleScripts = Array.from({ length: 15 }, (_, id) => script(id))
    const catalog = { battleScripts }
    expect(resolveHgssBattlePresentationScript(catalog, 'badPoison')).toBe(battleScripts[2])
    expect(resolveHgssBattlePresentationScript(catalog, 'confusion')).toBe(battleScripts[6])
  })

  it('does not fabricate a fallback when a ROM script is empty', () => {
    const battleScripts = Array.from({ length: 15 }, (_, id) => script(id, id !== 5))
    expect(resolveHgssBattlePresentationScript({ battleScripts }, 'paralysis')).toBeUndefined()
  })

  it('routes only native blocked-action effects instead of a generic status flash', () => {
    expect(resolveHgssCannotActPresentationAnimation('sleep')).toBe('sleep')
    expect(resolveHgssCannotActPresentationAnimation('infatuation')).toBe('infatuation')
    expect(resolveHgssCannotActPresentationAnimation('truant')).toBeUndefined()
    expect(resolveHgssCannotActPresentationAnimation('flinch')).toBeUndefined()
  })

  it('does not add an unrelated animation to every volatile condition', () => {
    expect(resolveHgssConditionPresentationAnimation('infatuationActive', true)).toBe('infatuation')
    expect(resolveHgssConditionPresentationAnimation('infatuation', true)).toBeUndefined()
    expect(resolveHgssConditionPresentationAnimation('nightmareDamage', true)).toBeUndefined()
    expect(resolveHgssConditionPresentationAnimation('infatuationActive', false)).toBeUndefined()
  })

  it('shares the same native routing across simple and double battle events', () => {
    expect(resolveHgssBattleEventPresentationAnimation({ kind: 'status', status: 'poison', applied: true })).toBe('poison')
    expect(resolveHgssBattleEventPresentationAnimation({ kind: 'status', status: 'badPoison', applied: true })).toBe('badPoison')
    expect(resolveHgssBattleEventPresentationAnimation({ kind: 'cannotAct', reason: 'paralysis' })).toBe('paralysis')
    expect(resolveHgssBattleEventPresentationAnimation({ kind: 'confusion', state: 'active' })).toBe('confusion')
    expect(resolveHgssBattleEventPresentationAnimation({ kind: 'confusion', state: 'ended' })).toBeUndefined()
    expect(resolveHgssBattleEventPresentationAnimation({ kind: 'residual', status: 'burn' })).toBe('burn')
    expect(resolveHgssBattleEventPresentationAnimation({ kind: 'residual', status: 'futureSight' })).toBeUndefined()
    expect(resolveHgssBattleEventPresentationAnimation({ kind: 'heal', amount: 0 })).toBeUndefined()
    expect(resolveHgssBattleEventPresentationAnimation({ kind: 'stat', change: -1, applied: true })).toBe('statDown')
  })
})
