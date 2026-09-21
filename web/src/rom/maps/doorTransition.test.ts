import { describe, expect, it } from 'vitest'
import type { NitroMapPropPreview } from '../../ndsTypes'
import type { MapPropAnimationMetadata } from '../model/mapPropAnimationMetadata'
import { doorAnimationFrameDurationMs, resolveDoorAnimationDurationMs, resolveDoorSoundSequence, resolveDoorTransitionDescriptor } from './doorTransition'

const prop = (modelId: number, x: number, z: number): NitroMapPropPreview => ({
  modelId,
  position: [x, 0, z],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
})

const doorMetadata = (classId: number, animationArchiveIds: number[]): MapPropAnimationMetadata => ({
  hasAnimations: true,
  flags: 3,
  isBicycleSlope: false,
  controlValue: classId,
  classId,
  animationArchiveIds,
})

describe('native door transition selection', () => {
  it('keeps every short ROM pose readable for two browser frames', () => {
    expect(doorAnimationFrameDurationMs).toBeCloseTo(1000 / 30)
    expect(resolveDoorAnimationDurationMs(8)).toBeCloseTo(8000 / 30)
    expect(resolveDoorAnimationDurationMs(0)).toBeCloseTo(1000 / 30)
  })

  it('maps every native metadata class to its exact open and close sequences', () => {
    expect([1, 2, 3, 4].map((classId) => [
      resolveDoorSoundSequence(classId, true),
      resolveDoorSoundSequence(classId, false),
    ])).toEqual([
      [1540, 1542],
      [1543, 0],
      [1499, 0],
      [2325, 2326],
    ])
    expect(resolveDoorSoundSequence(0, true)).toBeUndefined()
  })

  it('selects the first ordered in-rectangle prop with door metadata instead of the nearest prop', () => {
    const orderedProps = [
      prop(10, 12, 19),
      prop(11, 10, 20),
      prop(12, 10, 19),
      prop(13, 9, 19),
    ]
    const metadata = new Map([
      [10, doorMetadata(1, [30, 31])],
      [11, doorMetadata(4, [40, 41])],
      [12, doorMetadata(0, [50, 51])],
      [13, doorMetadata(2, [60, 61])],
    ])

    expect(resolveDoorTransitionDescriptor(10, 20, orderedProps, (modelId) => metadata.get(modelId))).toMatchObject({
      tag: 1,
      modelId: 10,
      classId: 1,
      animationArchiveIds: [30, 31],
    })
  })

  it('examines no more than the four candidates retained by the native routine', () => {
    const orderedProps = [1, 2, 3, 4, 5].map((modelId) => prop(modelId, 10, 19))
    const visited: number[] = []

    expect(resolveDoorTransitionDescriptor(10, 20, orderedProps, (modelId) => {
      visited.push(modelId)
      return doorMetadata(modelId === 5 ? 1 : 0, [1, 2])
    })).toBeUndefined()
    expect(visited).toEqual([1, 2, 3, 4])
  })

  it('rejects metadata without both native open and close animations', () => {
    expect(resolveDoorTransitionDescriptor(10, 20, [prop(7, 10, 19)], () => doorMetadata(1, [42]))).toBeUndefined()
  })

  it('uses the destination-anchor rectangle for an arriving outdoor door', () => {
    const metadata = () => doorMetadata(1, [7, 8])
    const eastEdge = prop(21, 13, 11)
    const northOfAnchor = prop(22, 10, 9)

    expect(resolveDoorTransitionDescriptor(10, 10, [eastEdge], metadata, 'arrival')).toMatchObject({ modelId: 21 })
    expect(resolveDoorTransitionDescriptor(10, 10, [northOfAnchor], metadata, 'arrival')).toBeUndefined()
    expect(resolveDoorTransitionDescriptor(10, 10, [eastEdge], metadata, 'entry')).toBeUndefined()
  })

  it('uses the first animation id rather than the sound class as the arrival eligibility gate', () => {
    const candidate = prop(31, 10, 10)
    expect(resolveDoorTransitionDescriptor(10, 10, [candidate], () => doorMetadata(0, [12, 13]), 'arrival')).toMatchObject({ modelId: 31 })
    expect(resolveDoorTransitionDescriptor(10, 10, [candidate], () => doorMetadata(4, [0, 13]), 'arrival')).toBeUndefined()
  })

  it('uses the script setup rectangle without the wider arrival east edge', () => {
    const metadata = () => doorMetadata(1, [7, 8])
    expect(resolveDoorTransitionDescriptor(10, 10, [prop(41, 12, 11)], metadata, 'script')).toMatchObject({ modelId: 41 })
    expect(resolveDoorTransitionDescriptor(10, 10, [prop(42, 13, 11)], metadata, 'script')).toBeUndefined()
  })
})
