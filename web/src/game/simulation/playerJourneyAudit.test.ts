import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createFieldInputSimulator } from './fieldInputSimulator'
import { createPlayerJourneyAudit, PlayerJourneyBlocker } from './playerJourneyAudit'

function createMap(): OpeningMapPreview {
  return {
    id: 1,
    label: 'Carte audit',
    header: { mapId: 1, msgBank: 0, mapSection: 0 } as OpeningMapPreview['header'],
    fieldScripts: { bank: 0, bytes: new Uint8Array([0, 0]), headerSize: 2, entryOffsets: [] },
    initScripts: [],
    messages: {},
    matrix: {
      matrixIndex: 1,
      name: 'audit',
      width: 1,
      height: 1,
      headers: new Uint16Array([1]),
      altitudes: new Uint8Array([0]),
      modelIds: new Uint16Array([1]),
    },
    terrain: { modelId: 1, width: 8, height: 8, attributes: new Uint16Array(64) },
  }
}

describe('player journey audit', () => {
  it('captures the exact player checkpoint and recent inputs when a journey fails', () => {
    const simulator = createFieldInputSimulator([createMap()], createFieldScriptState('male'), {
      mapId: 1,
      tileX: 4,
      tileZ: 7,
      direction: 'south',
    })
    const audit = createPlayerJourneyAudit(simulator)
    audit.checkpoint('first-battle', 'Premier combat')
    audit.input('up')

    expect(() => audit.run(() => { throw new Error('Opcode HGSS 999 non pris en charge') })).toThrow(PlayerJourneyBlocker)
    expect(() => audit.run(() => { throw new Error('Opcode HGSS 999 non pris en charge') })).toThrow('Premier combat')
    expect(() => audit.run(() => { throw new Error('Opcode HGSS 999 non pris en charge') })).toThrow('mapId')
  })
})
