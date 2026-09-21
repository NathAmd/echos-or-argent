import { describe, expect, it } from 'vitest'
import { decodeFieldScriptBank, decodeMapInitScripts, resolveMapFrameScripts, resolveMapInitScript, resolveMapInitScripts } from './fieldScripts'

describe('HGSS field scripts', () => {
  it('decodes the two relative ScrDef entries used by the opening bedroom', () => {
    const bytes = new Uint8Array(104)
    const view = new DataView(bytes.buffer)
    view.setInt32(0, 6, true)
    view.setInt32(4, 78, true)
    view.setUint16(8, 0xfd13, true)
    view.setUint16(10, 609, true)
    view.setUint16(86, 73, true)

    expect(decodeFieldScriptBank(bytes)).toEqual({
      headerSize: 10,
      entryOffsets: [10, 86],
    })
  })

  it('rejects missing terminators and out-of-range ScrDef targets', () => {
    expect(() => decodeFieldScriptBank(new Uint8Array([0, 0, 0, 0]))).toThrow('ScrDef')
    expect(() => decodeFieldScriptBank(new Uint8Array([100, 0, 0, 0, 0x13, 0xfd]))).toThrow('hors de la banque')
  })

  it('accepts an empty init member and decodes fixed and frame entries', () => {
    expect(decodeMapInitScripts(new Uint8Array())).toEqual([])

    const bytes = new Uint8Array(23)
    const view = new DataView(bytes.buffer)
    bytes[0] = 2
    view.setUint16(1, 3, true)
    bytes[5] = 1
    view.setInt32(6, 5, true)
    bytes[10] = 0
    view.setUint16(15, 0x4001, true)
    view.setUint16(17, 7, true)
    view.setUint16(19, 3, true)
    view.setUint16(21, 0, true)

    expect(decodeMapInitScripts(bytes)).toEqual([
      { type: 'onTransition', scriptId: 3 },
      {
        type: 'onFrame',
        conditionsOffset: 15,
        conditions: [{ variable: 0x4001, value: 7, scriptId: 3 }],
      },
    ])
  })

  it('rejects unknown and truncated init entries', () => {
    expect(() => decodeMapInitScripts(new Uint8Array([9, 0, 0, 0, 0, 0]))).toThrow('inconnu')
    expect(() => decodeMapInitScripts(new Uint8Array([2, 1]))).toThrow('depasse')
  })

  it('resolves frame conditions separately from fixed lifecycle phases', () => {
    const entries = decodeMapInitScripts(new Uint8Array([
      1, 1, 0, 0, 0, 0,
      0x06, 0x41, 3, 0, 7, 0,
      0x06, 0x41, 0, 0, 1, 0,
      0, 0,
    ]))

    expect(resolveMapInitScript(entries, 'transition', () => 0)).toBeUndefined()
    expect(resolveMapFrameScripts(entries, (variable) => variable === 0x4106 ? 0 : 0)).toEqual([1])
    expect(resolveMapInitScript(entries, 'transition', () => 2)).toBeUndefined()
  })

  it('returns only the scripts belonging to the requested lifecycle phase', () => {
    const entries = [
      { type: 'onFrame' as const, conditionsOffset: 0, conditions: [{ variable: 0x4106, value: 0, scriptId: 3 }] },
      { type: 'onTransition' as const, scriptId: 9 },
      { type: 'onLoad' as const, scriptId: 6 },
      { type: 'onResume' as const, scriptId: 12 },
    ]

    expect(resolveMapInitScripts(entries, 'transition')).toEqual([9])
    expect(resolveMapInitScripts(entries, 'load')).toEqual([6])
    expect(resolveMapInitScripts(entries, 'resume')).toEqual([12])
    expect(resolveMapFrameScripts(entries, () => 0)).toEqual([3])
  })
})