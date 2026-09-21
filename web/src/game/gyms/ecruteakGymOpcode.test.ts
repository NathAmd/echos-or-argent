import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptRunner, createFieldScriptState } from '../scripts/fieldScriptRunner'

function runExtinguish(sourceMode: 0 | 1, actorId: number) {
  const bytes = new Uint8Array(7)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 314, true)
  view.setUint16(2, 317, true)
  bytes[4] = sourceMode
  view.setUint16(5, 2, true)
  const map = {
    id: 80,
    label: 'Rosalia',
    fieldScripts: { bank: 1, bytes, headerSize: 0, entryOffsets: [0] },
  } as OpeningMapPreview
  const state = createFieldScriptState('male')
  const runner = createFieldScriptRunner(map, 1, state, actorId)
  expect(runner.resume()).toEqual({ kind: 'gymMechanism', gymType: 1, action: 'init' })
  const step = runner.resume()
  return { state, step }
}

describe('opcodes natifs des chandelles de Rosalia', () => {
  it('éteint la chandelle lors d’une interaction directe avec le Dresseur', () => {
    const { state, step } = runExtinguish(1, 2)
    expect(step).toEqual({ kind: 'gymMechanism', gymType: 1, action: 'extinguishCandle', parameter: 2 })
    expect([...state.gymmick.data.subarray(0, 4)]).toEqual([1, 0, 0, 0])
  })

  it('éteint aussi la chandelle quand le Dresseur a repéré le joueur', () => {
    const { state, step } = runExtinguish(0, 5)
    expect(step).toEqual({ kind: 'gymMechanism', gymType: 1, action: 'extinguishCandle', parameter: 5 })
    expect([...state.gymmick.data.subarray(0, 4)]).toEqual([0, 0, 0, 1])
  })
})
