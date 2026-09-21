import { describe, expect, it } from 'vitest'
import { createHgssCaptureAnimationPlan, HGSS_CAPTURE_FALL_ANIMATION_FRAME_INDEXES, HGSS_CAPTURE_FALL_SOUND_CUES } from './hgssCaptureAnimationContract'

describe('contrat global de l’animation de capture HGSS', () => {
  it('rend seulement trois secousses avant le clic d’une capture réussie', () => {
    const plan = createHgssCaptureAnimationPlan({ mode: 'normal', itemId: 496, shakes: 4, caught: true })
    expect(plan.ballId).toBe(21)
    expect(plan.renderedShakes).toBe(3)
    expect(plan.phases.map(({ kind }) => kind)).toEqual([
      'throw', 'open', 'fall',
      'shake', 'shake-cooldown', 'shake', 'shake-cooldown', 'shake', 'shake-cooldown',
      'pre-click', 'click',
    ])
    expect(plan.phases.filter(({ outcomeMayBeRevealed }) => outcomeMayBeRevealed).map(({ kind }) => kind)).toEqual(['click'])
    expect(plan.result).toEqual({ messageId: 867, minimumFramesAfterPrinter: 30, successMusicId: 1129, fadeBallAfterPrinter: true })
  })

  it('ne révèle un échec qu’au breakout, après les secousses réellement réussies', () => {
    const plan = createHgssCaptureAnimationPlan({ mode: 'normal', itemId: 4, shakes: 2, caught: false })
    expect(plan.phases.map(({ kind }) => kind)).toEqual([
      'throw', 'open', 'fall', 'shake', 'shake-cooldown', 'shake', 'shake-cooldown', 'breakout',
    ])
    expect(plan.phases.filter(({ outcomeMayBeRevealed }) => outcomeMayBeRevealed).map(({ kind }) => kind)).toEqual(['breakout'])
    expect(plan.result).toEqual({ messageId: 865, minimumFramesAfterPrinter: 30, fadeBallAfterPrinter: false })
  })

  it('verrouille la Safari Ball et les cinq impacts/bonds de la chute', () => {
    const plan = createHgssCaptureAnimationPlan({ mode: 'safari', itemId: 5, shakes: 0, caught: false })
    expect(plan.ballId).toBe(5)
    expect(plan.phases.find(({ kind }) => kind === 'fall')).toMatchObject({
      slideFrames: 10,
      slideHorizontalPixels: 32,
      completionFrames: 21,
    })
    const fall = plan.phases.find((phase) => phase.kind === 'fall')
    expect(fall?.verticalOffsets).toHaveLength(20)
    expect(fall?.verticalOffsets.reduce((total, delta) => total + delta, 0)).toBe(0)
    expect(fall?.animationFrameIndexes).toEqual(HGSS_CAPTURE_FALL_ANIMATION_FRAME_INDEXES)
    expect(HGSS_CAPTURE_FALL_ANIMATION_FRAME_INDEXES).toEqual([
      1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1,
    ])
    expect(() => createHgssCaptureAnimationPlan({ mode: 'safari', itemId: 4, shakes: 0, caught: false })).toThrow(/Safari Ball 5/)
    expect(HGSS_CAPTURE_FALL_SOUND_CUES).toEqual([
      { frame: 1, sequenceId: 1510, pan: 117 },
      { frame: 8, sequenceId: 1510, pan: 117 },
      { frame: 14, sequenceId: 1511, pan: 117 },
      { frame: 18, sequenceId: 1512, pan: 117 },
      { frame: 20, sequenceId: 1513, pan: 117 },
    ])
  })

  it('rejette une issue impossible avant toute présentation', () => {
    expect(() => createHgssCaptureAnimationPlan({ mode: 'normal', itemId: 4, shakes: 3, caught: true })).toThrow(/incohérent/)
    expect(() => createHgssCaptureAnimationPlan({ mode: 'normal', itemId: 100, shakes: 0, caught: false })).toThrow(/pas une Ball/)
  })
})
