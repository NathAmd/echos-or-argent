import { describe, expect, it } from 'vitest'
import { createHgssSafariState, setHgssSafariObjectUnlockLevel } from './hgssSafariState'
import {
  HGSS_BAOBA_CALL_DELAY_MINUTES,
  HGSS_IGT_MAX_MINUTES,
  HGSS_SAFARI_MAP_SECTION_ID,
  applyHgssBaobaCall,
  applyHgssSafariGateChallengeScene,
  completeHgssSafariChallenge,
  createHgssSafariProgressionState,
  isHgssSafariChallengeComplete,
  openHgssSafariZoneAfterLighthouse,
  registerHgssBaobaContact,
  resolveHgssBaobaCallTrigger,
  type HgssSafariChallengePokemon,
} from './hgssSafariProgression'

function challengePokemon(speciesId: number, overrides: Partial<HgssSafariChallengePokemon> = {}): HgssSafariChallengePokemon {
  return {
    speciesId,
    isEgg: false,
    originalTrainer: { id: 0x12345678 },
    origin: { metLocation: HGSS_SAFARI_MAP_SECTION_ID },
    ...overrides,
  }
}

describe('progression de Baoba HGSS', () => {
  it('valide uniquement le Pokémon demandé capturé par le joueur dans la section Safari', () => {
    const trainerId = 0x12345678
    expect(isHgssSafariChallengeComplete(0, [challengePokemon(74)], trainerId)).toBe(true)
    expect(isHgssSafariChallengeComplete(1, [challengePokemon(27)], trainerId)).toBe(true)
    expect(isHgssSafariChallengeComplete(0, [challengePokemon(27)], trainerId)).toBe(false)
    expect(isHgssSafariChallengeComplete(0, [challengePokemon(74, { isEgg: true })], trainerId)).toBe(false)
    expect(isHgssSafariChallengeComplete(0, [challengePokemon(74, { originalTrainer: { id: 7 } })], trainerId)).toBe(false)
    expect(isHgssSafariChallengeComplete(0, [challengePokemon(74, { origin: { metLocation: 201 } })], trainerId)).toBe(false)
    expect(isHgssSafariChallengeComplete(0, [challengePokemon(74, {
      origin: { metLocation: HGSS_SAFARI_MAP_SECTION_ID, eggLocation: HGSS_SAFARI_MAP_SECTION_ID },
    })], trainerId)).toBe(false)
  })

  it('enchaîne l’ouverture, les deux défis et leurs scènes sans sauter d’étape', () => {
    let progression = createHgssSafariProgressionState()
    progression = registerHgssBaobaContact(progression)
    progression = openHgssSafariZoneAfterLighthouse(progression)
    progression = applyHgssSafariGateChallengeScene(progression)
    expect(progression).toMatchObject({ baobaContactRegistered: true, baobaQuestStage: 2 })

    const first = completeHgssSafariChallenge(progression, 0, [challengePokemon(74)], 0x12345678, 100)
    expect(first).toMatchObject({ completed: true, state: { baobaQuestStage: 3, baobaIgtReferenceMinutes: 100 } })
    const wrongSecond = completeHgssSafariChallenge(first.state, 1, [challengePokemon(27)], 0x12345678, 100)
    expect(wrongSecond.completed).toBe(false)

    const safari = createHgssSafariState(0)
    expect(resolveHgssBaobaCallTrigger(first.state, safari, 100 + HGSS_BAOBA_CALL_DELAY_MINUTES - 1, true)).toBeUndefined()
    expect(resolveHgssBaobaCallTrigger(first.state, safari, 100 + HGSS_BAOBA_CALL_DELAY_MINUTES, true)).toBe('nextTest')
    progression = applyHgssBaobaCall(first.state, safari, 'nextTest', 280).progression
    expect(progression.baobaQuestStage).toBe(4)
    progression = applyHgssSafariGateChallengeScene(progression)
    expect(progression.baobaQuestStage).toBe(5)

    const second = completeHgssSafariChallenge(progression, 1, [challengePokemon(27)], 0x12345678, 500)
    expect(second).toMatchObject({ completed: true, state: { baobaQuestStage: 6, baobaIgtReferenceMinutes: 500 } })
  })

  it('ne partage jamais la file persistante des zones annoncées entre deux états', () => {
    const source = createHgssSafariProgressionState()
    source.pendingEncounterAreaIds = [2, 7]
    const next = registerHgssBaobaContact(source)
    next.pendingEncounterAreaIds.push(9)

    expect(source.pendingEncounterAreaIds).toEqual([2, 7])
    expect(next.pendingEncounterAreaIds).toEqual([2, 7, 9])
  })

  it('exige le Pokédex national avant le premier appel Object Arrangement', () => {
    const progression = createHgssSafariProgressionState()
    progression.baobaQuestStage = 6
    progression.baobaIgtReferenceMinutes = 100
    const safari = createHgssSafariState(0)

    expect(resolveHgssBaobaCallTrigger(progression, safari, 280, false)).toBeUndefined()
    expect(resolveHgssBaobaCallTrigger(progression, safari, 280, true)).toBe('objectArrangement')
  })

  it('débloque les quatre groupes par appels espacés de trois heures IGT', () => {
    let progression = createHgssSafariProgressionState()
    progression.baobaQuestStage = 6
    progression.baobaIgtReferenceMinutes = 0
    let safari = createHgssSafariState(0)

    let trigger = resolveHgssBaobaCallTrigger(progression, safari, 180, true)
    expect(trigger).toBe('objectArrangement')
    ;({ progression, safari } = applyHgssBaobaCall(progression, safari, trigger!, 180))
    expect(safari.objectUnlockLevel).toBe(1)

    trigger = resolveHgssBaobaCallTrigger(progression, safari, 360, true)
    expect(trigger).toBe('moreObjects')
    ;({ progression, safari } = applyHgssBaobaCall(progression, safari, trigger!, 360))
    expect(safari.objectUnlockLevel).toBe(2)

    trigger = resolveHgssBaobaCallTrigger(progression, safari, 540, true)
    expect(trigger).toBe('moreObjects')
    ;({ progression, safari } = applyHgssBaobaCall(progression, safari, trigger!, 540))
    expect(safari.objectUnlockLevel).toBe(3)

    trigger = resolveHgssBaobaCallTrigger(progression, safari, 720, true)
    expect(trigger).toBe('evenMoreObjects')
    ;({ progression, safari } = applyHgssBaobaCall(progression, safari, trigger!, 720))
    expect(safari.objectUnlockLevel).toBe(4)
    expect(resolveHgssBaobaCallTrigger(progression, safari, 900, true)).toBeUndefined()
  })

  it('reproduit la branche MEMORY_LOSS lorsque le compteur IGT atteint sa saturation', () => {
    const progression = {
      ...createHgssSafariProgressionState(),
      baobaQuestStage: 7 as const,
      baobaIgtReferenceMinutes: HGSS_IGT_MAX_MINUTES - 100,
    }
    const safari = setHgssSafariObjectUnlockLevel(createHgssSafariState(0), 2)
    expect(resolveHgssBaobaCallTrigger(progression, safari, HGSS_IGT_MAX_MINUTES, true)).toBe('memoryLoss')

    const applied = applyHgssBaobaCall(progression, safari, 'memoryLoss', HGSS_IGT_MAX_MINUTES)
    expect(applied.safari.objectUnlockLevel).toBe(4)
    expect(applied.progression.baobaQuestStage).toBe(7)
  })
})
