import { describe, expect, it } from 'vitest'
import { createHgssSafariProgressionState } from './hgssSafariProgression'
import { createHgssSafariState } from './hgssSafariState'
import {
  answerHgssSafariIncomingCall,
  completeHgssSafariIncomingCall,
  HGSS_PHONE_RING_CYCLE_FRAMES,
  HGSS_PHONE_RING_SOUND_SEQUENCE_ID,
  resolveHgssSafariNewPokemonCallMessage,
  resolveHgssSafariIncomingCall,
  resolveHgssSafariIncomingCallLaunch,
  scheduleHgssBaobaProgressionCall,
  selectHgssSafariIncomingCall,
} from './hgssSafariPhoneRuntime'

function createState() {
  return {
    safariZone: createHgssSafariState(0),
    safariProgression: { ...createHgssSafariProgressionState(), baobaContactRegistered: true },
    variables: new Map<number, number>(),
    phoneCallTriggers: new Set<number>(),
  }
}

describe('appels entrants de Baoba HGSS', () => {
  it('programme puis applique le second test après trois heures IGT', () => {
    const state = createState()
    state.safariProgression.baobaQuestStage = 3
    state.safariProgression.baobaIgtReferenceMinutes = 100
    expect(scheduleHgssBaobaProgressionCall(state, 279, true)).toBeUndefined()
    expect(scheduleHgssBaobaProgressionCall(state, 280, true)).toBe(7)

    const incoming = selectHgssSafariIncomingCall(state, { getSeed: () => 0, nextU16: () => 0 }, 100, 524)
    expect(incoming).toEqual({
      triggerId: 7,
      call: { callerId: 24, parameter1: 3, parameter2: 142 },
      forcePickUp: true,
    })
    completeHgssSafariIncomingCall(state, 7, 280)
    expect(state.safariProgression.baobaQuestStage).toBe(4)
    expect(state.variables.get(0x4057)).toBe(4)
    expect(state.phoneCallTriggers.has(7)).toBe(false)
  })

  it('fait seulement sonner le trigger 6 jusqu’à la réponse par le Pokématos', () => {
    const state = createState()
    state.safariProgression.pendingEncounterAreaIds = [2, 7]
    state.phoneCallTriggers.add(6)
    const incoming = selectHgssSafariIncomingCall(state, { getSeed: () => 0, nextU16: () => 0 }, 100, 524)!

    expect(resolveHgssSafariIncomingCallLaunch(incoming)).toEqual({
      kind: 'ringing',
      answerAction: 'openPokegearPhone',
      soundSequenceId: HGSS_PHONE_RING_SOUND_SEQUENCE_ID,
      soundCycleFrames: HGSS_PHONE_RING_CYCLE_FRAMES,
    })
    expect(HGSS_PHONE_RING_SOUND_SEQUENCE_ID).toBe(2169)
    expect(HGSS_PHONE_RING_CYCLE_FRAMES).toBe(30)
    expect(state.phoneCallTriggers.has(6)).toBe(true)

    expect(answerHgssSafariIncomingCall(state, 6, 0)).toBe(true)
    expect(state.phoneCallTriggers.has(6)).toBe(false)
    // Le tableau persistant de la ROM est lu par l'appel, mais pas effacé.
    expect(state.safariProgression.pendingEncounterAreaIds).toEqual([2, 7])
    expect(answerHgssSafariIncomingCall(state, 6, 0)).toBe(false)
  })

  it('débloque et espace les groupes d’objets via les scripts 143/144', () => {
    const state = createState()
    state.safariProgression.baobaQuestStage = 6
    state.safariProgression.baobaIgtReferenceMinutes = 0
    expect(scheduleHgssBaobaProgressionCall(state, 180, true)).toBe(8)
    completeHgssSafariIncomingCall(state, 8, 180)
    expect(state.safariZone.objectUnlockLevel).toBe(1)
    expect(state.safariProgression).toMatchObject({ baobaQuestStage: 7, baobaIgtReferenceMinutes: 180 })
    completeHgssSafariIncomingCall(state, 8, 180)
    expect(state.safariZone.objectUnlockLevel).toBe(1)
    expect(scheduleHgssBaobaProgressionCall(state, 359, true)).toBeUndefined()
    expect(scheduleHgssBaobaProgressionCall(state, 360, true)).toBe(9)
  })

  it('reproduit les textes dynamiques des zones sans inventer leur nom', () => {
    const progression = { ...createHgssSafariProgressionState(), pendingEncounterAreaIds: [2 as const, 7 as const, 9 as const] }
    expect(resolveHgssSafariNewPokemonCallMessage(progression, 'male')).toEqual({ messageId: 18, areaIds: [2, 7, 9] })
    expect(resolveHgssSafariNewPokemonCallMessage(progression, 'female').messageId).toBe(19)
    expect(resolveHgssSafariNewPokemonCallMessage({ ...progression, pendingEncounterAreaIds: [] }, 'male').messageId).toBe(38)
  })

  it('ne fait pas sonner Baoba dans sa propre section de carte', () => {
    const state = createState()
    state.phoneCallTriggers.add(6)
    expect(selectHgssSafariIncomingCall(state, { getSeed: () => 0, nextU16: () => 0 }, 524, 524)).toBeUndefined()
  })

  it('décroche automatiquement les appels de progression', () => {
    const state = createState()
    state.phoneCallTriggers.add(7)
    const incoming = selectHgssSafariIncomingCall(state, { getSeed: () => 0, nextU16: () => 0 }, 100, 524)!
    expect(resolveHgssSafariIncomingCallLaunch(incoming)).toEqual({ kind: 'forcePickUp' })
  })

  it('adapte le tirage global sans recopier ses métadonnées', () => {
    const safari = {
      triggerId: 7,
      call: { callerId: 24, parameter1: 3, parameter2: 142 },
      forcePickUp: true,
    } as const
    expect(resolveHgssSafariIncomingCall(safari)).toBe(safari)
    expect(resolveHgssSafariIncomingCall({
      triggerId: 0,
      call: { callerId: 1, parameter1: 3, parameter2: 13 },
      forcePickUp: false,
    })).toBeUndefined()
    expect(resolveHgssSafariIncomingCall({
      triggerId: 6,
      call: { callerId: 1, parameter1: 3, parameter2: 0 },
      forcePickUp: false,
    })).toBeUndefined()
  })
})
