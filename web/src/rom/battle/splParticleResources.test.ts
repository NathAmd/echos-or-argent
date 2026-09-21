import { describe, expect, it } from 'vitest'
import type { RomFile } from '../../ndsTypes'
import {
  createHgssBattleParticleResourceResolver,
  decodeHgssSplParticleResource,
  HGSS_BATTLE_PARTICLE_ARCHIVE_PATH,
  HGSS_BATTLE_PARTICLE_RESOURCE_COUNT,
} from './splParticleResources'

function createSplPayload(): Uint8Array {
  const bytes = new Uint8Array(220)
  bytes.set([...' APS12_1'].map((character) => character.charCodeAt(0)))
  const view = new DataView(bytes.buffer)
  view.setUint16(8, 1, true)
  view.setUint16(10, 1, true)
  view.setUint32(16, 88, true)
  view.setUint32(20, 100, true)
  view.setUint32(24, 120, true)
  view.setUint32(32, 0, true)
  view.setInt32(36, 4096, true)
  view.setInt32(48, 8192, true)
  view.setInt32(76, 6144, true)
  view.setInt16(80, 2048, true)
  view.setUint16(82, 3, true)
  view.setUint16(92, 20, true)
  view.setUint16(94, 12, true)
  view.setUint32(100, 2 | 31 << 8 | 200 << 16, true)
  view.setUint32(120, 0x53505420, true)
  view.setUint32(124, 6, true)
  view.setUint32(128, 64, true)
  view.setUint32(132, 96, true)
  view.setUint32(136, 4, true)
  view.setUint32(148, 100, true)
  for (let pixel = 0; pixel < 64; pixel += 1) bytes[152 + pixel] = 31 << 3 | pixel % 2
  view.setUint16(216, 0x001f, true)
  view.setUint16(218, 0x03e0, true)
  return bytes
}

describe('HGSS SPL particle resources', () => {
  it('decodes emitter fixed-point fields and A5I3 texture pixels', () => {
    const resource = decodeHgssSplParticleResource(createSplPayload(), 64)
    expect(resource).toMatchObject({ memberId: 64, version: ' APS12_1' })
    expect(resource.emitters[0]).toMatchObject({
      basePosition: [1, 0, 0],
      emissionCount: 2,
      baseScale: 1.5,
      aspectRatio: 0.5,
      emitterLifetimeFrames: 20,
      particleLifetimeFrames: 12,
      emissionIntervalFrames: 2,
      baseAlpha: 31,
      airResistance: 200,
    })
    expect(resource.textures[0]).toMatchObject({ format: 'a5i3', width: 8, height: 8 })
    expect([...resource.textures[0]!.graphic.pixels.slice(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
  })

  it('validates the exact archive and caches decoded members', () => {
    const bytes = createSplPayload()
    const archive: RomFile = {
      id: 29,
      path: HGSS_BATTLE_PARTICLE_ARCHIVE_PATH,
      offset: 0,
      size: bytes.length,
      signature: 'NARC',
      archiveEntries: HGSS_BATTLE_PARTICLE_RESOURCE_COUNT,
      archiveMembers: Array.from({ length: HGSS_BATTLE_PARTICLE_RESOURCE_COUNT }, (_, index) => ({ index, offset: 0, size: bytes.length, signature: ' APS' })),
    }
    const resolve = createHgssBattleParticleResourceResolver(bytes, archive)
    expect(resolve(64)).toBe(resolve(64))
    expect(() => resolve(486)).toThrow('invalide')
  })
})
