import { describe, expect, it } from 'vitest'
import {
  hgssBattleCanvasPointToWorldPosition,
  hgssSoloBattlerWorldPosition,
  resolveHgssBattlerWorldPositionFromRects,
} from './battleParticlePlacement'

describe('HGSS battle particle placement', () => {
  it('converts the native solo anchors back into the DS viewport', () => {
    expect(hgssBattleCanvasPointToWorldPosition(72, 128, 0.0156)).toEqual([
      -2.3515625,
      -1.34375,
      0.0156,
    ])
    expect(hgssBattleCanvasPointToWorldPosition(192, 70, -1.2812)).toEqual([
      2.6875,
      1.091796875,
      -1.2812,
    ])
  })

  it('anchors particles on the rendered battler instead of a fixed solo position', () => {
    const position = resolveHgssBattlerWorldPositionFromRects(
      { width: 256, height: 192 },
      { left: 100, top: 50, width: 1_024, height: 768 },
      { left: 740, top: 210, width: 160, height: 160 },
      'opponent',
    )
    // Centre du sprite : (720, 240) dans le canevas CSS, soit (180, 60) en DS.
    expect(position).toEqual([
      (180 - 128) * 172 / 4096,
      (96 - 60) * 172 / 4096,
      hgssSoloBattlerWorldPosition('opponent')[2],
    ])
  })

  it('keeps the canonical ROM anchor while a hidden battler has no layout box', () => {
    expect(resolveHgssBattlerWorldPositionFromRects(
      { width: 256, height: 192 },
      { left: 0, top: 0, width: 0, height: 0 },
      { left: 0, top: 0, width: 0, height: 0 },
      'player',
    )).toEqual(hgssSoloBattlerWorldPosition('player'))
  })
})
