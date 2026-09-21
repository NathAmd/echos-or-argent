import { describe, expect, it } from 'vitest'
import {
  HGSS_DAYCARE_TRIGGER_EGG_CALL_FLAG_ID,
  HGSS_MOM_SAVINGS_FLAG_ID,
  HGSS_TALKED_TO_MOM_AFTER_NAMING_RIVAL_FLAG_ID,
  resolveHgssScriptedPhoneMessage,
} from './phoneCalls'

describe('appels Pokématos scénarisés HGSS', () => {
  it('route l’appel de panique d’Orme vers les messages ROM genrés 33 et 34', () => {
    const call = { callerId: 1, parameter1: 2, parameter2: 0 }
    expect(resolveHgssScriptedPhoneMessage(call, 'male')).toEqual({ callerId: 1, phoneScriptId: 2, messageId: 33 })
    expect(resolveHgssScriptedPhoneMessage(call, 'female')).toEqual({ callerId: 1, phoneScriptId: 2, messageId: 34 })
  })

  it('rejette un mode non scénarisé au lieu d’inventer un texte', () => {
    expect(resolveHgssScriptedPhoneMessage({ callerId: 1, parameter1: 0, parameter2: 0 }, 'male')).toBeUndefined()
  })

  it('reproduit tout le dialogue interactif de Maman lancé sur la Route 30', () => {
    expect(resolveHgssScriptedPhoneMessage(
      { callerId: 0, parameter1: 2, parameter2: 0 },
      'male',
    )).toEqual({
      callerId: 0,
      phoneScriptId: 0,
      messageId: 22,
      initialEffects: [{
        kind: 'flag',
        flagId: HGSS_TALKED_TO_MOM_AFTER_NAMING_RIVAL_FLAG_ID,
        enabled: true,
      }],
      choice: {
        kind: 'mom-saving',
        options: [
          {
            value: 'yes',
            labelMessageId: 8,
            continuationMessageId: 25,
            effects: [{ kind: 'flag', flagId: HGSS_MOM_SAVINGS_FLAG_ID, enabled: true }],
          },
          {
            value: 'no',
            labelMessageId: 9,
            continuationMessageId: 26,
            effects: [{ kind: 'flag', flagId: HGSS_MOM_SAVINGS_FLAG_ID, enabled: false }],
          },
        ],
        defaultIndex: 0,
        cancelIndex: 1,
      },
    })
  })

  it('route l’appel de Chen à Jadielle par le script natif 82', () => {
    const call = { callerId: 2, parameter1: 2, parameter2: 0 }
    expect(resolveHgssScriptedPhoneMessage(call, 'male'))
      .toEqual({ callerId: 2, phoneScriptId: 82, messageId: 12 })
    expect(resolveHgssScriptedPhoneMessage(call, 'female'))
      .toEqual({ callerId: 2, phoneScriptId: 82, messageId: 12 })
  })

  it("route l'appel entrant déclenché par l'éclosion de Togepi", () => {
    const call = { callerId: 1, parameter1: 3, parameter2: 13 }
    expect(resolveHgssScriptedPhoneMessage(call, 'male')).toEqual({ callerId: 1, phoneScriptId: 13, messageId: 13 })
    expect(resolveHgssScriptedPhoneMessage(call, 'female')).toEqual({ callerId: 1, phoneScriptId: 13, messageId: 14 })
  })

  it('route Pokérus, la Boutique Vélo, le PC plein et Maman par leurs scripts natifs', () => {
    expect(resolveHgssScriptedPhoneMessage(
      { callerId: 1, parameter1: 3, parameter2: 7 },
      'male',
    )).toEqual({ callerId: 1, phoneScriptId: 7, messageId: 43 })
    expect(resolveHgssScriptedPhoneMessage(
      { callerId: 1, parameter1: 3, parameter2: 7 },
      'female',
    )).toEqual({ callerId: 1, phoneScriptId: 7, messageId: 44 })
    expect(resolveHgssScriptedPhoneMessage(
      { callerId: 15, parameter1: 3, parameter2: 85 },
      'female',
    )).toEqual({ callerId: 15, phoneScriptId: 85, messageId: 3 })
    expect(resolveHgssScriptedPhoneMessage(
      { callerId: 9, parameter1: 3, parameter2: 93 },
      'male',
    )).toEqual({ callerId: 9, phoneScriptId: 93, messageId: 10 })
    expect(resolveHgssScriptedPhoneMessage(
      { callerId: 9, parameter1: 3, parameter2: 93 },
      'female',
    )).toEqual({ callerId: 9, phoneScriptId: 93, messageId: 11 })
    expect(resolveHgssScriptedPhoneMessage(
      { callerId: 0, parameter1: 3, parameter2: 27 },
      'male',
    )).toEqual({ callerId: 0, phoneScriptId: 27, messageId: 29 })
  })

  it('calcule le palier 50..450 du Pokédex national pour les scripts Chen 69..77', () => {
    const call = { callerId: 2, parameter1: 3, parameter2: 0 }
    expect(resolveHgssScriptedPhoneMessage(call, 'male')).toBeUndefined()
    expect(resolveHgssScriptedPhoneMessage(call, 'male', { nationalDexOwnedCount: 0 }))
      .toEqual({ callerId: 2, phoneScriptId: 69, messageId: 3 })
    expect(resolveHgssScriptedPhoneMessage(call, 'female', { nationalDexOwnedCount: 100 }))
      .toEqual({ callerId: 2, phoneScriptId: 70, messageId: 4 })
    expect(resolveHgssScriptedPhoneMessage(call, 'male', { nationalDexOwnedCount: 493 }))
      .toEqual({ callerId: 2, phoneScriptId: 77, messageId: 11 })
    expect(() => resolveHgssScriptedPhoneMessage(call, 'male', { nationalDexOwnedCount: -1 })).toThrow(/invalide/)
  })

  it('distingue le premier avis et les avis suivants de la Pension par le flag ROM 0x992', () => {
    const call = { callerId: 6, parameter1: 3, parameter2: 0 }
    expect(HGSS_DAYCARE_TRIGGER_EGG_CALL_FLAG_ID).toBe(0x992)
    expect(resolveHgssScriptedPhoneMessage(call, 'male')).toBeUndefined()
    expect(resolveHgssScriptedPhoneMessage(call, 'male', { eventFlags: new Set() }))
      .toEqual({ callerId: 6, phoneScriptId: 95, messageId: 12 })
    expect(resolveHgssScriptedPhoneMessage(call, 'female', {
      eventFlags: new Set([HGSS_DAYCARE_TRIGGER_EGG_CALL_FLAG_ID]),
    })).toEqual({ callerId: 6, phoneScriptId: 96, messageId: 13 })
  })

  it('route l’appel scénarisé de Baoba déclenché après la quête du Phare', () => {
    const call = { callerId: 24, parameter1: 2, parameter2: 0 }
    expect(resolveHgssScriptedPhoneMessage(call, 'male')).toEqual({ callerId: 24, phoneScriptId: 141, messageId: 2 })
    expect(resolveHgssScriptedPhoneMessage(call, 'female')).toEqual({ callerId: 24, phoneScriptId: 141, messageId: 3 })
  })

  it('route les cinq appels entrants de progression de Baoba vers la banque ROM 667', () => {
    expect(resolveHgssScriptedPhoneMessage({ callerId: 24, parameter1: 3, parameter2: 142 }, 'male')?.messageId).toBe(4)
    expect(resolveHgssScriptedPhoneMessage({ callerId: 24, parameter1: 3, parameter2: 146 }, 'female')?.messageId).toBe(13)
  })
})
