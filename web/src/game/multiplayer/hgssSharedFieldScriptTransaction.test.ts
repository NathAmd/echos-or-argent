import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { HgssSharedFieldEventDeltaError } from './hgssSharedFieldEventDelta'
import {
  createHgssSharedFieldScriptPresentationRunner,
  evaluateHgssSharedFieldScriptTransaction,
  HgssSharedFieldScriptTransactionError,
} from './hgssSharedFieldScriptTransaction'

function createMap(bytes: Uint8Array, messages: Record<number, string> = {}): OpeningMapPreview {
  return {
    id: 64,
    label: 'Transaction',
    header: { mapId: 64, msgBank: 1, mapSection: 1, followMode: 2 } as OpeningMapPreview['header'],
    fieldScripts: { bank: 1, bytes, headerSize: 0, entryOffsets: [0] },
    initScripts: [],
    messages,
    matrix: {} as OpeningMapPreview['matrix'],
  }
}

function createSafeScript(): Uint8Array {
  const bytes = new Uint8Array(25)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 30, true); view.setUint16(2, 0x123, true)
  view.setUint16(4, 41, true); view.setUint16(6, 0x4010, true); view.setUint16(8, 7, true)
  view.setUint16(10, 52, true)
  view.setUint16(12, 45, true); bytes[14] = 0
  view.setUint16(15, 73, true); view.setUint16(17, 1500, true)
  view.setUint16(19, 49, true)
  view.setUint16(21, 53, true)
  view.setUint16(23, 2, true)
  return bytes
}

describe('transaction sûre des scripts terrain partagés HGSS', () => {
  it('évalue flags et variables sur un clone puis conserve une trace immersive figée', () => {
    const live = createFieldScriptState('male', 'JO')
    const transaction = evaluateHgssSharedFieldScriptTransaction({
      map: createMap(createSafeScript(), { 0: 'Bonjour depuis la ROM.' }),
      scriptId: 1,
      actorId: 7,
      state: live,
    })

    expect(transaction.delta).toEqual({
      addedFlagIds: [0x123],
      removedFlagIds: [],
      variables: [{ variableId: 0x4010, expectedValue: 0, value: 7 }],
    })
    expect(transaction.presentationSteps).toEqual([
      { kind: 'dialogue', action: 'open' },
      { kind: 'message', messageId: 0, text: 'Bonjour depuis la ROM.', speakerObjectId: 7 },
      { kind: 'soundEffect', action: 'play', sequenceId: 1500 },
      { kind: 'inputWait', accepts: ['confirm', 'cancel'] },
      { kind: 'dialogue', action: 'close' },
    ])
    expect(Object.isFrozen(transaction.presentationSteps)).toBe(true)
    expect(transaction.presentationSteps.every(Object.isFrozen)).toBe(true)
    expect(live.flags.has(0x123)).toBe(false)
    expect(live.variables.has(0x4010)).toBe(false)
    expect(transaction.before.flags.has(0x123)).toBe(false)
    expect(transaction.after.flags.has(0x123)).toBe(true)
    expect(transaction.after.variables.get(0x800d)).toBe(7)
  })

  it('refuse une mutation de registre temporaire même si le script ne suspend pas', () => {
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 41, true); view.setUint16(2, 0x8001, true); view.setUint16(4, 9, true)
    view.setUint16(6, 2, true)

    expect(() => evaluateHgssSharedFieldScriptTransaction({
      map: createMap(bytes), scriptId: 1, state: createFieldScriptState('female'),
    })).toThrowError(HgssSharedFieldEventDeltaError)
  })

  it('refuse aussi une simple lecture personnelle qui influencerait le delta partagé', () => {
    const bytes = new Uint8Array(10)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 112, true)
    view.setUint16(2, 0x4010, true)
    view.setUint32(4, 3_000, true)
    view.setUint16(8, 2, true)

    try {
      evaluateHgssSharedFieldScriptTransaction({
        map: createMap(bytes), scriptId: 1, state: createFieldScriptState('male'),
      })
      throw new Error("La lecture de l'argent aurait dû être refusée.")
    } catch (error) {
      expect(error).toBeInstanceOf(HgssSharedFieldScriptTransactionError)
      expect(error).toMatchObject({ code: 'unsupported-state-read', path: 'money' })
    }
  })

  it('refuse fermement une étape de monde avant toute présentation', () => {
    const bytes = new Uint8Array(12)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 174, true)
    view.setUint16(2, 8, true)
    view.setUint16(4, 0, true)
    view.setUint16(6, 2, true)
    view.setUint16(8, 0x7fff, true)
    view.setUint16(10, 2, true)

    try {
      evaluateHgssSharedFieldScriptTransaction({
        map: createMap(bytes), scriptId: 1, state: createFieldScriptState('male'),
      })
      throw new Error("L'étape de fondu aurait dû être refusée.")
    } catch (error) {
      expect(error).toBeInstanceOf(HgssSharedFieldScriptTransactionError)
      expect(error).toMatchObject({ code: 'unsupported-step', stepKind: 'screenFade' })
    }
  })

  it('retire RTC, catalogues et RNG personnels de la sandbox', () => {
    const now = vi.fn(() => new Date('2026-08-28T12:00:00.000Z'))
    const runtime = {
      catalog: {},
      rng: { getSeed: () => 123, nextU16: vi.fn(() => 1) },
      trainer: { id: 1 },
      language: 2,
      gameVersion: 7,
      now,
    } as unknown as NonNullable<FieldScriptState['pokemonRuntime']>
    const live = createFieldScriptState('male', 'JO', { pokemonRuntime: runtime })
    const callsBefore = now.mock.calls.length
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 522, true); view.setUint16(2, 0x4010, true)
    view.setUint16(4, 2, true)

    expect(() => evaluateHgssSharedFieldScriptTransaction({
      map: createMap(bytes), scriptId: 1, state: live,
    })).toThrow('domaine personnel pokemonRuntime')
    expect(now).toHaveBeenCalledTimes(callsBefore)
    expect(runtime.rng.nextU16).not.toHaveBeenCalled()
  })

  it('rejoue la trace sans exposer une seconde voie de saisie gameplay', () => {
    const transaction = evaluateHgssSharedFieldScriptTransaction({
      map: createMap(createSafeScript(), { 0: 'Bonjour depuis la ROM.' }),
      scriptId: 1,
      state: createFieldScriptState('male'),
    })
    const runner = createHgssSharedFieldScriptPresentationRunner(transaction.presentationSteps)

    expect(runner.resume()).toEqual({ kind: 'dialogue', action: 'open' })
    expect(() => runner.choose(0)).toThrow('aucune saisie de gameplay')
    for (let index = 1; index < transaction.presentationSteps.length; index += 1) runner.resume()
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })
})
