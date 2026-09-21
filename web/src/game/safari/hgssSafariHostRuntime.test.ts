import { describe, expect, it, vi } from 'vitest'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import type { HgssSafariAreaEncounterData, HgssSafariEncounterCatalog, HgssSafariEncounterMethodData } from '../../rom/safari/safariEncounterData'
import type { HgssSafariAreaId } from './hgssSafariState'
import {
  advanceHgssSafariHostStep,
  finishHgssSafariHostCall,
  prepareHgssSafariIncomingCallPresentation,
  updateHgssSafariHostStep,
} from './hgssSafariHostRuntime'
import { createHgssPhoneRingSession } from '../pokegear/hgssPhoneRingSession'

const times = ['morning', 'day', 'night'] as const
const methods = ['land', 'surf', 'oldRod', 'goodRod', 'superRod'] as const

function encounterCatalog(): HgssSafariEncounterCatalog {
  const method = (speciesId: number): HgssSafariEncounterMethodData => ({
    bonusCount: 1,
    base: Object.fromEntries(times.map((time) => [time, Array.from({ length: 10 }, () => ({ speciesId, level: 10 }))])) as HgssSafariEncounterMethodData['base'],
    bonus: Object.fromEntries(times.map((time) => [time, [{ speciesId, level: 10 }]])) as HgssSafariEncounterMethodData['bonus'],
    bonusConditions: [{ blockType1: 1, blockCount1: 255, blockType2: 0, blockCount2: 0 }],
  })
  return Array.from({ length: 12 }, (_, areaId): HgssSafariAreaEncounterData => ({
    areaId: areaId as HgssSafariAreaId,
    methods: Object.fromEntries(methods.map((name) => [name, method(74 + areaId)])) as HgssSafariAreaEncounterData['methods'],
  }))
}

describe('hôte quotidien et téléphone Safari HGSS', () => {
  it('sépare la mise à jour quotidienne et la programmation urgente de tout tirage RNG', () => {
    const state = createFieldScriptState('male', 'LUTH')
    state.pokedex.nationalDexEnabled = true
    state.safariProgression = {
      ...state.safariProgression,
      baobaContactRegistered: true,
      baobaQuestStage: 3,
      baobaIgtReferenceMinutes: 100,
      lastAreaUpdateDay: '2026-8-22',
    }
    const rng = { getSeed: () => 0, nextU16: vi.fn(() => 0) }
    const onUrgentTriggerScheduled = vi.fn()
    const completeOptions = {
      state,
      inventory: {
        phoneBookEntries: [{ id: 24, mapId: 524 }] as never,
        phoneContactMessages: {},
        phoneContactNames: [],
        safariEncounterCatalog: encounterCatalog(),
        uiMessageBanks: {},
      },
      rng,
      now: new Date(2026, 7, 22, 12),
      currentIgtMinutes: 280,
      currentMapId: 100,
      incomingCallsEnabled: true,
      playerGender: 'male' as const,
      onUrgentTriggerScheduled,
    }

    expect(updateHgssSafariHostStep(completeOptions)).toBe(7)
    expect(state.phoneCallTriggers.has(7)).toBe(true)
    expect(onUrgentTriggerScheduled).toHaveBeenCalledWith(7)
    expect(rng.nextU16).not.toHaveBeenCalled()
  })

  it('répare le miroir Safari depuis la variable et le carnet natifs avant de programmer Baoba', () => {
    const state = createFieldScriptState('male', 'LUTH')
    state.pokedex.nationalDexEnabled = true
    state.variables.set(0x4057, 3)
    state.phoneContacts.add(24)
    state.safariProgression.baobaQuestStage = 0
    state.safariProgression.baobaContactRegistered = false
    state.safariProgression.baobaIgtReferenceMinutes = 100

    expect(updateHgssSafariHostStep({
      state,
      inventory: {
        phoneBookEntries: [{ id: 24, mapId: 524 }] as never,
        phoneContactMessages: {},
        phoneContactNames: [],
        safariEncounterCatalog: encounterCatalog(),
        uiMessageBanks: {},
      },
      now: new Date(2026, 7, 22, 12),
      currentIgtMinutes: 280,
    })).toBe(7)
    expect(state.safariProgression).toMatchObject({
      baobaQuestStage: 3,
      baobaContactRegistered: true,
    })
    expect(state.phoneCallTriggers.has(7)).toBe(true)
  })

  it('restaure les données natives absentes depuis une progression Safari sauvegardée', () => {
    const state = createFieldScriptState('male', 'LUTH')
    state.pokedex.nationalDexEnabled = true
    state.safariProgression = {
      ...state.safariProgression,
      baobaContactRegistered: true,
      baobaQuestStage: 3,
      baobaIgtReferenceMinutes: 100,
    }

    expect(updateHgssSafariHostStep({
      state,
      inventory: {
        phoneBookEntries: [{ id: 24, mapId: 524 }] as never,
        phoneContactMessages: {},
        phoneContactNames: [],
        safariEncounterCatalog: encounterCatalog(),
        uiMessageBanks: {},
      },
      now: new Date(2026, 7, 22, 12),
      currentIgtMinutes: 280,
    })).toBe(7)
    expect(state.variables.get(0x4057)).toBe(3)
    expect(state.phoneContacts.has(24)).toBe(true)
  })

  it('prépare exactement les appels 6 et 7 déjà tirés sans rejouer la mise à jour', () => {
    const state = createFieldScriptState('male', 'LUTH')
    state.pokedex.nationalDexEnabled = true
    state.safariProgression = {
      ...state.safariProgression,
      baobaContactRegistered: true,
      baobaQuestStage: 3,
      baobaIgtReferenceMinutes: 100,
      lastAreaUpdateDay: '2026-8-21',
      pendingEncounterAreaIds: [2, 7],
    }
    const options = {
      state,
      inventory: {
        phoneBookEntries: [{ id: 24, mapId: 524 }] as never,
        phoneContactMessages: { 24: { 4: 'TEST', 16: 'NOUVEAUX {100 10} ET {100 11}' } },
        phoneContactNames: Object.assign([], { 24: 'BAOBA' }),
        safariEncounterCatalog: encounterCatalog(),
        uiMessageBanks: { 428: { 2: 'DÉSERT', 7: 'MONTAGNE' } },
      },
      playerGender: 'male' as const,
    }
    const before = { ...state.safariProgression }
    const ordinary = prepareHgssSafariIncomingCallPresentation(options, {
      triggerId: 6,
      call: { callerId: 24, parameter1: 3, parameter2: 0 },
      forcePickUp: false,
    })
    expect(ordinary).toMatchObject({
      incoming: { triggerId: 6 },
      callerName: 'BAOBA',
      message: 'NOUVEAUX {100 10} ET {100 11}',
    })
    expect([...ordinary.buffers]).toEqual([[10, 'DÉSERT'], [11, 'MONTAGNE']])
    expect(prepareHgssSafariIncomingCallPresentation(options, {
      triggerId: 7,
      call: { callerId: 24, parameter1: 3, parameter2: 142 },
      forcePickUp: true,
    })).toMatchObject({
      incoming: { triggerId: 7 },
      callerName: 'BAOBA',
      message: 'TEST',
    })
    expect(state.safariProgression).toEqual(before)
    expect(state.phoneCallTriggers.size).toBe(0)
  })

  it('prépare le message dynamique de la banque 667 et ses noms de zones 428', () => {
    const state = createFieldScriptState('male', 'LUTH')
    state.safariProgression = {
      ...state.safariProgression,
      baobaContactRegistered: true,
      lastAreaUpdateDay: '2026-8-22',
      pendingEncounterAreaIds: [2, 7],
    }
    state.phoneCallTriggers.add(6)
    const presentation = advanceHgssSafariHostStep({
      state,
      inventory: {
        phoneBookEntries: [{ id: 24, mapId: 524 }] as never,
        phoneContactMessages: { 24: { 16: 'NOUVEAUX {100 10} ET {100 11}' } },
        phoneContactNames: Object.assign([], { 24: 'BAOBA' }),
        safariEncounterCatalog: encounterCatalog(),
        uiMessageBanks: { 428: { 2: 'DÉSERT', 7: 'MONTAGNE' } },
      },
      rng: { getSeed: () => 0, nextU16: () => 0 },
      now: new Date(2026, 7, 22, 12),
      currentIgtMinutes: 0,
      currentMapId: 100,
      incomingCallsEnabled: true,
      playerGender: 'male',
    })
    expect(presentation).toMatchObject({ callerName: 'BAOBA', message: 'NOUVEAUX {100 10} ET {100 11}' })
    expect([...presentation!.buffers]).toEqual([[10, 'DÉSERT'], [11, 'MONTAGNE']])
    finishHgssSafariHostCall(state, presentation!, 0)
    expect(state.phoneCallTriggers.has(6)).toBe(false)
    expect(state.safariProgression.pendingEncounterAreaIds).toEqual([2, 7])
  })

  it("programme l'appel du second test uniquement après trois heures IGT", () => {
    const state = createFieldScriptState('male', 'LUTH')
    state.pokedex.nationalDexEnabled = true
    state.safariProgression = {
      ...state.safariProgression,
      baobaContactRegistered: true,
      baobaQuestStage: 3,
      baobaIgtReferenceMinutes: 100,
      lastAreaUpdateDay: '2026-8-22',
    }
    const base = {
      state,
      inventory: {
        phoneBookEntries: [{ id: 24, mapId: 524 }] as never,
        phoneContactMessages: { 24: { 4: 'TEST' } },
        phoneContactNames: Object.assign([], { 24: 'BAOBA' }),
        safariEncounterCatalog: encounterCatalog(),
        uiMessageBanks: {},
      },
      rng: { getSeed: () => 0, nextU16: () => 0 },
      now: new Date(2026, 7, 22, 12),
      currentMapId: 100,
      incomingCallsEnabled: true,
      playerGender: 'male' as const,
    }
    expect(advanceHgssSafariHostStep({ ...base, currentIgtMinutes: 279 })).toBeUndefined()
    expect(advanceHgssSafariHostStep({ ...base, currentIgtMinutes: 280 })).toMatchObject({
      incoming: { triggerId: 7, call: { callerId: 24, parameter1: 3, parameter2: 142 } },
      message: 'TEST',
    })
  })

  it('passe les triggers urgents et ordinaires par la garde globale des dix minutes', () => {
    const createGate = () => createHgssPhoneRingSession<string>({
      isSoundPlaying: () => false,
      playSound: () => undefined,
      stopSound: () => undefined,
    })
    const inventory = {
      phoneBookEntries: [{ id: 24, mapId: 524 }] as never,
      phoneContactMessages: { 24: { 4: 'TEST', 14: 'ZONE {100 10}' } },
      phoneContactNames: Object.assign([], { 24: 'BAOBA' }),
      safariEncounterCatalog: encounterCatalog(),
      uiMessageBanks: { 428: { 0: 'PLAINE' } },
    }
    const common = {
      inventory,
      rng: { getSeed: () => 0, nextU16: () => 0 },
      now: new Date(2026, 7, 22, 12),
      currentMapId: 100,
      incomingCallsEnabled: true,
      playerGender: 'male' as const,
    }

    const urgentState = createFieldScriptState('male', 'LUTH')
    urgentState.pokedex.nationalDexEnabled = true
    urgentState.safariProgression = {
      ...urgentState.safariProgression,
      baobaContactRegistered: true,
      baobaQuestStage: 3,
      baobaIgtReferenceMinutes: 100,
      lastAreaUpdateDay: '2026-8-22',
    }
    const urgentGate = createGate()
    urgentGate.advanceIncomingCallMinutes(0)
    expect(advanceHgssSafariHostStep({
      ...common,
      state: urgentState,
      currentIgtMinutes: 280,
      canSelectIncoming: urgentGate.canSelectIncoming,
      onUrgentTriggerScheduled: () => urgentGate.primeUrgentIncomingCall(),
    })).toBeUndefined()
    expect(urgentState.phoneCallTriggers.has(7)).toBe(true)
    expect(urgentGate.getIncomingGateState().elapsedMinutes).toBe(9)
    urgentGate.advanceIncomingCallMinutes(1)
    expect(advanceHgssSafariHostStep({
      ...common,
      state: urgentState,
      currentIgtMinutes: 281,
      canSelectIncoming: urgentGate.canSelectIncoming,
      onUrgentTriggerScheduled: () => urgentGate.primeUrgentIncomingCall(),
    })).toMatchObject({ incoming: { triggerId: 7 }, message: 'TEST' })

    const ordinaryState = createFieldScriptState('male', 'LUTH')
    ordinaryState.safariProgression = {
      ...ordinaryState.safariProgression,
      baobaContactRegistered: true,
      lastAreaUpdateDay: '2026-8-22',
      pendingEncounterAreaIds: [0],
    }
    ordinaryState.phoneCallTriggers.add(6)
    const ordinaryGate = createGate()
    ordinaryGate.advanceIncomingCallMinutes(0)
    expect(advanceHgssSafariHostStep({
      ...common,
      state: ordinaryState,
      currentIgtMinutes: 0,
      canSelectIncoming: ordinaryGate.canSelectIncoming,
    })).toBeUndefined()
    ordinaryGate.advanceIncomingCallMinutes(10)
    expect(advanceHgssSafariHostStep({
      ...common,
      state: ordinaryState,
      currentIgtMinutes: 10,
      canSelectIncoming: ordinaryGate.canSelectIncoming,
    })).toMatchObject({ incoming: { triggerId: 6 }, message: 'ZONE {100 10}' })
  })
})
