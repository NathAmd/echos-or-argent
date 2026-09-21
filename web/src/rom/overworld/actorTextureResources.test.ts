import { describe, expect, it } from 'vitest'
import type { NitroTexturePreview } from '../../ndsTypes'
import {
  decodeEventTextureResources,
  decodePlayerTextureFrames,
  groupPlayerTextureFrames,
  resolveFollowerEventTextureResource,
} from './actorTextureResources'

function texture(name: string): NitroTexturePreview {
  return {
    id: name,
    name,
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray([255, 255, 255, 255]),
  }
}

function textures(count: number): NitroTexturePreview[] {
  return Array.from({ length: count }, (_, index) => texture(`hero.${index + 1}`))
}

describe('overworld actor texture resources', () => {
  it('groups the native 16 walking and 16 running cells by cardinal direction', () => {
    const frames = groupPlayerTextureFrames(textures(32))!
    expect(Object.fromEntries(Object.entries(frames.walking).map(([direction, values]) => [
      direction,
      values.map(({ name }) => name),
    ]))).toEqual({
      north: ['hero.1', 'hero.2', 'hero.3', 'hero.4'],
      south: ['hero.5', 'hero.6', 'hero.7', 'hero.8'],
      west: ['hero.9', 'hero.10', 'hero.11', 'hero.12'],
      east: ['hero.13', 'hero.14', 'hero.15', 'hero.16'],
    })
    expect(Object.fromEntries(Object.entries(frames.running!).map(([direction, values]) => [
      direction,
      values.map(({ name }) => name),
    ]))).toEqual({
      north: ['hero.17', 'hero.18', 'hero.19', 'hero.20'],
      south: ['hero.21', 'hero.22', 'hero.23', 'hero.24'],
      west: ['hero.25', 'hero.26', 'hero.27', 'hero.28'],
      east: ['hero.29', 'hero.30', 'hero.31', 'hero.32'],
    })
    expect(frames.standing.south.name).toBe('hero.5')
  })

  it('keeps the compact four-cell Surf fallback at one pose per direction', () => {
    const frames = groupPlayerTextureFrames(textures(4))!
    expect(Object.fromEntries(Object.entries(frames.walking).map(([direction, values]) => [
      direction,
      values.map(({ name }) => name),
    ]))).toEqual({
      north: ['hero.1'],
      south: ['hero.2'],
      west: ['hero.3'],
      east: ['hero.4'],
    })
    expect(frames.running).toBeUndefined()
  })

  it('rejects incomplete direction groups and missing archives without leaking partial state', () => {
    expect(groupPlayerTextureFrames(textures(3))).toBeUndefined()
    expect(groupPlayerTextureFrames(textures(5))).toBeUndefined()
    expect(decodePlayerTextureFrames(new Uint8Array(), undefined, 0)).toBeUndefined()
    expect(decodeEventTextureResources(new Uint8Array(), undefined, [])).toEqual({})
  })

  it('adapts native follower mmodels used by static Pokemon object events', () => {
    const directionFrames = {
      north: [texture('north.1'), texture('north.2')],
      south: [texture('south.1'), texture('south.2')],
      west: [texture('west.1'), texture('west.2')],
      east: [texture('east.1'), texture('east.2')],
    }
    const calls: number[] = []
    const resource = resolveFollowerEventTextureResource(361, (parameterIndex) => {
      calls.push(parameterIndex)
      return {
        preview: texture('abra'),
        textures: Object.values(directionFrames).flat(),
        animationFrames: directionFrames,
      }
    })

    expect(calls).toEqual([64])
    expect(resource?.preview.name).toBe('abra')
    expect(resource?.frames.standing.south.name).toBe('south.1')
    expect(resource?.frames.walking.east.map(({ name }) => name)).toEqual(['east.1', 'east.2'])
    expect(resolveFollowerEventTextureResource(296, () => { throw new Error('unreachable') })).toBeUndefined()
  })
})
