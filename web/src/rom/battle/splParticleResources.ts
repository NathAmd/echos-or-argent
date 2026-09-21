import type { NitroGraphic, RomFile } from '../../ndsTypes'

export const HGSS_BATTLE_PARTICLE_ARCHIVE_PATH = '/a/0/2/9'
export const HGSS_BATTLE_PARTICLE_RESOURCE_COUNT = 486

export type HgssSplAnimationCurve = {
  in: number
  peak?: number
  out: number
}

export type HgssSplChildResource = {
  flags: number
  usesBehaviors: boolean
  hasScaleAnimation: boolean
  hasAlphaAnimation: boolean
  rotationType: number
  followEmitter: boolean
  useChildColor: boolean
  drawType: number
  randomInitialVelocityMagnitude: number
  endScale: number
  lifetimeFrames: number
  velocityRatio: number
  scaleRatio: number
  color: number
  emissionCount: number
  emissionDelay: number
  emissionIntervalFrames: number
  textureIndex: number
  textureTileCountS: number
  textureTileCountT: number
  flipTextureS: boolean
  flipTextureT: boolean
}

export type HgssSplBehavior =
  | { kind: 'gravity', magnitude: readonly [number, number, number] }
  | { kind: 'random', magnitude: readonly [number, number, number], applyIntervalFrames: number }
  | { kind: 'magnet', target: readonly [number, number, number], force: number }
  | { kind: 'spin', angle: number, axis: number }
  | { kind: 'collisionPlane', y: number, elasticity: number, collisionType: number }
  | { kind: 'convergence', target: readonly [number, number, number], force: number }

export type HgssSplEmitterResource = {
  id: number
  flags: number
  emissionType: number
  drawType: number
  circleAxis: number
  basePosition: readonly [number, number, number]
  emissionCount: number
  radius: number
  length: number
  axis: readonly [number, number, number]
  color: number
  initialVelocityPositionAmplifier: number
  initialVelocityAxisAmplifier: number
  baseScale: number
  aspectRatio: number
  startDelayFrames: number
  minimumRotation: number
  maximumRotation: number
  initialAngle: number
  emitterLifetimeFrames: number
  particleLifetimeFrames: number
  randomAttenuation: { baseScale: number, lifetime: number, initialVelocity: number }
  emissionIntervalFrames: number
  baseAlpha: number
  airResistance: number
  textureIndex: number
  loopFrames: number
  doubleBillboardScale: number
  textureTileCountS: number
  textureTileCountT: number
  scaleAnimationDirection: number
  faceEmitter: boolean
  flipTextureS: boolean
  flipTextureT: boolean
  polygonX: number
  polygonY: number
  userFlags: number
  scaleAnimation?: { start: number, middle: number, end: number, curve: HgssSplAnimationCurve, loop: boolean }
  colorAnimation?: { start: number, end: number, curve: HgssSplAnimationCurve, randomStart: boolean, loop: boolean, interpolate: boolean }
  alphaAnimation?: { start: number, middle: number, end: number, randomRange: number, curve: HgssSplAnimationCurve, loop: boolean }
  textureAnimation?: { textureIndexes: number[], stepFrames: number, randomStart: boolean, loop: boolean }
  childResource?: HgssSplChildResource
  behaviors: HgssSplBehavior[]
}

export type HgssSplTexture = {
  id: number
  format: 'a3i5' | 'a5i3'
  width: number
  height: number
  repeatS: boolean
  repeatT: boolean
  flipS: boolean
  flipT: boolean
  color0Transparent: boolean
  graphic: NitroGraphic
}

export type HgssSplParticleResource = {
  memberId: number
  version: string
  emitters: HgssSplEmitterResource[]
  textures: HgssSplTexture[]
}

function assertRange(offset: number, size: number, byteLength: number, label: string): void {
  if (!Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 0 || offset + size > byteLength) {
    throw new Error(`${label} depasse la ressource SPL HGSS.`)
  }
}

function readAscii(bytes: Uint8Array, offset: number, size: number): string {
  assertRange(offset, size, bytes.byteLength, 'Signature SPL')
  return String.fromCharCode(...bytes.subarray(offset, offset + size))
}

function fx32(value: number): number {
  return value / 4096
}

function fx16(value: number): number {
  return value / 4096
}

function rgbaFromRgb555(color: number, alpha: number, target: Uint8ClampedArray, offset: number): void {
  target[offset] = Math.round((color & 0x1f) * 255 / 31)
  target[offset + 1] = Math.round(((color >> 5) & 0x1f) * 255 / 31)
  target[offset + 2] = Math.round(((color >> 10) & 0x1f) * 255 / 31)
  target[offset + 3] = alpha
}

function decodeCurveInOut(value: number): HgssSplAnimationCurve {
  return { in: value & 0xff, out: value >> 8 }
}

function decodeEmitter(view: DataView, offset: number, id: number): { emitter: HgssSplEmitterResource, nextOffset: number } {
  assertRange(offset, 88, view.byteLength, `Emetteur SPL ${id}`)
  const flags = view.getUint32(offset, true)
  const misc0 = view.getUint32(offset + 68, true)
  const randomAttenuation = view.getUint32(offset + 64, true)
  const misc1 = view.getUint32(offset + 72, true)
  const misc2 = view.getUint32(offset + 76, true)
  const emitter: HgssSplEmitterResource = {
    id,
    flags,
    emissionType: flags & 0x0f,
    drawType: flags >> 4 & 0x03,
    circleAxis: flags >> 6 & 0x03,
    basePosition: [fx32(view.getInt32(offset + 4, true)), fx32(view.getInt32(offset + 8, true)), fx32(view.getInt32(offset + 12, true))],
    emissionCount: fx32(view.getInt32(offset + 16, true)),
    radius: fx32(view.getInt32(offset + 20, true)),
    length: fx32(view.getInt32(offset + 24, true)),
    axis: [fx16(view.getInt16(offset + 28, true)), fx16(view.getInt16(offset + 30, true)), fx16(view.getInt16(offset + 32, true))],
    color: view.getUint16(offset + 34, true),
    initialVelocityPositionAmplifier: fx32(view.getInt32(offset + 36, true)),
    initialVelocityAxisAmplifier: fx32(view.getInt32(offset + 40, true)),
    baseScale: fx32(view.getInt32(offset + 44, true)),
    aspectRatio: fx16(view.getInt16(offset + 48, true)),
    startDelayFrames: view.getUint16(offset + 50, true),
    minimumRotation: view.getInt16(offset + 52, true),
    maximumRotation: view.getInt16(offset + 54, true),
    initialAngle: view.getUint16(offset + 56, true),
    emitterLifetimeFrames: view.getUint16(offset + 60, true),
    particleLifetimeFrames: view.getUint16(offset + 62, true),
    randomAttenuation: {
      baseScale: randomAttenuation & 0xff,
      lifetime: randomAttenuation >> 8 & 0xff,
      initialVelocity: randomAttenuation >> 16 & 0xff,
    },
    emissionIntervalFrames: misc0 & 0xff,
    baseAlpha: misc0 >> 8 & 0xff,
    airResistance: misc0 >> 16 & 0xff,
    textureIndex: misc0 >>> 24,
    loopFrames: misc1 & 0xff,
    doubleBillboardScale: misc1 >>> 8 & 0xffff,
    textureTileCountS: misc1 >>> 24 & 0x03,
    textureTileCountT: misc1 >>> 26 & 0x03,
    scaleAnimationDirection: misc1 >>> 28 & 0x07,
    faceEmitter: (misc1 & 0x80000000) !== 0,
    flipTextureS: (misc2 & 1) !== 0,
    flipTextureT: (misc2 & 2) !== 0,
    polygonX: fx16(view.getInt16(offset + 80, true)),
    polygonY: fx16(view.getInt16(offset + 82, true)),
    userFlags: view.getUint8(offset + 84),
    behaviors: [],
  }
  let cursor = offset + 88
  if ((flags & 1 << 8) !== 0) {
    assertRange(cursor, 12, view.byteLength, `Animation d'echelle SPL ${id}`)
    const curve = decodeCurveInOut(view.getUint16(cursor + 6, true))
    emitter.scaleAnimation = {
      start: fx16(view.getInt16(cursor, true)),
      middle: fx16(view.getInt16(cursor + 2, true)),
      end: fx16(view.getInt16(cursor + 4, true)),
      curve,
      loop: (view.getUint16(cursor + 8, true) & 1) !== 0,
    }
    cursor += 12
  }
  if ((flags & 1 << 9) !== 0) {
    assertRange(cursor, 12, view.byteLength, `Animation de couleur SPL ${id}`)
    const packedCurve = view.getUint32(cursor + 4, true)
    const animationFlags = view.getUint16(cursor + 8, true)
    emitter.colorAnimation = {
      start: view.getUint16(cursor, true),
      end: view.getUint16(cursor + 2, true),
      curve: { in: packedCurve & 0xff, peak: packedCurve >> 8 & 0xff, out: packedCurve >> 16 & 0xff },
      randomStart: (animationFlags & 1) !== 0,
      loop: (animationFlags & 2) !== 0,
      interpolate: (animationFlags & 4) !== 0,
    }
    cursor += 12
  }
  if ((flags & 1 << 10) !== 0) {
    assertRange(cursor, 8, view.byteLength, `Animation alpha SPL ${id}`)
    const alpha = view.getUint16(cursor, true)
    const animationFlags = view.getUint16(cursor + 2, true)
    emitter.alphaAnimation = {
      start: alpha & 0x1f,
      middle: alpha >> 5 & 0x1f,
      end: alpha >> 10 & 0x1f,
      randomRange: animationFlags & 0xff,
      loop: (animationFlags & 0x100) !== 0,
      curve: decodeCurveInOut(view.getUint16(cursor + 4, true)),
    }
    cursor += 8
  }
  if ((flags & 1 << 11) !== 0) {
    assertRange(cursor, 12, view.byteLength, `Animation de texture SPL ${id}`)
    const params = view.getUint32(cursor + 8, true)
    const frameCount = params & 0xff
    if (frameCount > 8) throw new Error(`Animation de texture SPL ${id} trop longue : ${frameCount}.`)
    emitter.textureAnimation = {
      textureIndexes: [...new Uint8Array(view.buffer, view.byteOffset + cursor, frameCount)],
      stepFrames: params >> 8 & 0xff,
      randomStart: (params & 1 << 16) !== 0,
      loop: (params & 1 << 17) !== 0,
    }
    cursor += 12
  }
  if ((flags & 1 << 16) !== 0) {
    assertRange(cursor, 20, view.byteLength, `Particules enfants SPL ${id}`)
    const childFlags = view.getUint16(cursor, true)
    const childMisc0 = view.getUint32(cursor + 12, true)
    const childMisc1 = view.getUint32(cursor + 16, true)
    emitter.childResource = {
      flags: childFlags,
      usesBehaviors: (childFlags & 1) !== 0,
      hasScaleAnimation: (childFlags & 2) !== 0,
      hasAlphaAnimation: (childFlags & 4) !== 0,
      rotationType: childFlags >> 3 & 0x03,
      followEmitter: (childFlags & 1 << 5) !== 0,
      useChildColor: (childFlags & 1 << 6) !== 0,
      drawType: childFlags >> 7 & 0x03,
      randomInitialVelocityMagnitude: fx16(view.getInt16(cursor + 2, true)),
      endScale: fx16(view.getInt16(cursor + 4, true)),
      lifetimeFrames: view.getUint16(cursor + 6, true),
      velocityRatio: view.getUint8(cursor + 8),
      scaleRatio: view.getUint8(cursor + 9),
      color: view.getUint16(cursor + 10, true),
      emissionCount: childMisc0 & 0xff,
      emissionDelay: childMisc0 >> 8 & 0xff,
      emissionIntervalFrames: childMisc0 >> 16 & 0xff,
      textureIndex: childMisc0 >>> 24,
      textureTileCountS: childMisc1 & 0x03,
      textureTileCountT: childMisc1 >> 2 & 0x03,
      flipTextureS: (childMisc1 & 1 << 4) !== 0,
      flipTextureT: (childMisc1 & 1 << 5) !== 0,
    }
    cursor += 20
  }
  if ((flags & 1 << 24) !== 0) {
    assertRange(cursor, 8, view.byteLength, `Gravite SPL ${id}`)
    emitter.behaviors.push({
      kind: 'gravity',
      magnitude: [fx16(view.getInt16(cursor, true)), fx16(view.getInt16(cursor + 2, true)), fx16(view.getInt16(cursor + 4, true))],
    })
    cursor += 8
  }
  if ((flags & 1 << 25) !== 0) {
    assertRange(cursor, 8, view.byteLength, `Mouvement aleatoire SPL ${id}`)
    emitter.behaviors.push({
      kind: 'random',
      magnitude: [fx16(view.getInt16(cursor, true)), fx16(view.getInt16(cursor + 2, true)), fx16(view.getInt16(cursor + 4, true))],
      applyIntervalFrames: view.getUint16(cursor + 6, true),
    })
    cursor += 8
  }
  if ((flags & 1 << 26) !== 0) {
    assertRange(cursor, 16, view.byteLength, `Magnetisme SPL ${id}`)
    emitter.behaviors.push({
      kind: 'magnet',
      target: [fx32(view.getInt32(cursor, true)), fx32(view.getInt32(cursor + 4, true)), fx32(view.getInt32(cursor + 8, true))],
      force: fx16(view.getInt16(cursor + 12, true)),
    })
    cursor += 16
  }
  if ((flags & 1 << 27) !== 0) {
    assertRange(cursor, 4, view.byteLength, `Rotation SPL ${id}`)
    emitter.behaviors.push({ kind: 'spin', angle: view.getUint16(cursor, true), axis: view.getUint16(cursor + 2, true) })
    cursor += 4
  }
  if ((flags & 1 << 28) !== 0) {
    assertRange(cursor, 8, view.byteLength, `Collision SPL ${id}`)
    emitter.behaviors.push({
      kind: 'collisionPlane',
      y: fx32(view.getInt32(cursor, true)),
      elasticity: fx16(view.getInt16(cursor + 4, true)),
      collisionType: view.getUint16(cursor + 6, true) & 0x03,
    })
    cursor += 8
  }
  if ((flags & 1 << 29) !== 0) {
    assertRange(cursor, 16, view.byteLength, `Convergence SPL ${id}`)
    emitter.behaviors.push({
      kind: 'convergence',
      target: [fx32(view.getInt32(cursor, true)), fx32(view.getInt32(cursor + 4, true)), fx32(view.getInt32(cursor + 8, true))],
      force: fx16(view.getInt16(cursor + 12, true)),
    })
    cursor += 16
  }
  assertRange(offset, cursor - offset, view.byteLength, `Donnees optionnelles SPL ${id}`)
  return { emitter, nextOffset: cursor }
}

function decodeTexture(view: DataView, offset: number, id: number): { texture: HgssSplTexture, nextOffset: number } {
  assertRange(offset, 32, view.byteLength, `Texture SPL ${id}`)
  const textureSignature = view.getUint32(offset, true)
  if (textureSignature !== 0x53505420) throw new Error(`Signature de texture SPL ${id} invalide.`)
  const params = view.getUint32(offset + 4, true)
  const formatId = params & 0x0f
  const format = formatId === 1 ? 'a3i5' : formatId === 6 ? 'a5i3' : undefined
  if (!format) throw new Error(`Format de texture SPL HGSS non pris en charge : ${formatId}.`)
  if ((params & 1 << 17) !== 0) throw new Error('Les textures SPL partagees ne sont pas utilisees par HGSS et ne sont pas acceptees ici.')
  const width = 8 << (params >> 4 & 0x0f)
  const height = 8 << (params >> 8 & 0x0f)
  const textureSize = view.getUint32(offset + 8, true)
  const paletteOffset = view.getUint32(offset + 12, true)
  const paletteSize = view.getUint32(offset + 16, true)
  const resourceSize = view.getUint32(offset + 28, true)
  if (textureSize !== width * height) throw new Error(`Taille de texture SPL ${id} incoherente.`)
  if (resourceSize < 32 || paletteOffset < 32 || paletteSize === 0 || paletteSize % 2 !== 0) throw new Error(`Descripteur de texture SPL ${id} invalide.`)
  assertRange(offset, resourceSize, view.byteLength, `Texture SPL ${id}`)
  assertRange(offset + 32, textureSize, offset + resourceSize, `Pixels de texture SPL ${id}`)
  assertRange(offset + paletteOffset, paletteSize, offset + resourceSize, `Palette de texture SPL ${id}`)
  const palette = Array.from({ length: paletteSize / 2 }, (_, index) => view.getUint16(offset + paletteOffset + index * 2, true))
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const packed = view.getUint8(offset + 32 + pixel)
    const colorIndex = format === 'a3i5' ? packed & 0x1f : packed & 0x07
    const alphaBits = format === 'a3i5' ? packed >> 5 : packed >> 3
    const alphaMax = format === 'a3i5' ? 7 : 31
    const alpha = Math.round(alphaBits * 255 / alphaMax)
    rgbaFromRgb555(palette[colorIndex] ?? 0, alpha, pixels, pixel * 4)
  }
  return {
    texture: {
      id,
      format,
      width,
      height,
      repeatS: (params & 1 << 12) !== 0,
      repeatT: (params & 1 << 13) !== 0,
      flipS: (params & 1 << 14) !== 0,
      flipT: (params & 1 << 15) !== 0,
      color0Transparent: (params & 1 << 16) !== 0,
      graphic: { width, height, pixels, graphicsOffset: offset + 32, paletteOffset: offset + paletteOffset, colorDepth: formatId },
    },
    nextOffset: offset + resourceSize,
  }
}

export function decodeHgssSplParticleResource(payload: Uint8Array, memberId: number): HgssSplParticleResource {
  if (payload.byteLength < 32) throw new Error(`Ressource de particules HGSS ${memberId} trop courte.`)
  const version = readAscii(payload, 0, 8)
  if (version !== ' APS12_1') throw new Error(`Signature SPL HGSS invalide : ${JSON.stringify(version)}.`)
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const emitterCount = view.getUint16(8, true)
  const textureCount = view.getUint16(10, true)
  const emitterDataSize = view.getUint32(16, true)
  const textureDataSize = view.getUint32(20, true)
  const textureOffset = view.getUint32(24, true)
  if (textureOffset !== 32 + emitterDataSize) throw new Error(`Offset de textures SPL HGSS ${memberId} incoherent.`)
  assertRange(32, emitterDataSize, payload.byteLength, 'Emetteurs SPL')
  assertRange(textureOffset, textureDataSize, payload.byteLength, 'Textures SPL')
  const emitters: HgssSplEmitterResource[] = []
  let cursor = 32
  for (let id = 0; id < emitterCount; id += 1) {
    const decoded = decodeEmitter(view, cursor, id)
    emitters.push(decoded.emitter)
    cursor = decoded.nextOffset
  }
  if (cursor !== textureOffset) throw new Error(`Taille des emetteurs SPL HGSS ${memberId} incoherente.`)
  const textures: HgssSplTexture[] = []
  for (let id = 0; id < textureCount; id += 1) {
    const decoded = decodeTexture(view, cursor, id)
    textures.push(decoded.texture)
    cursor = decoded.nextOffset
  }
  if (cursor !== textureOffset + textureDataSize) throw new Error(`Taille des textures SPL HGSS ${memberId} incoherente.`)
  return { memberId, version, emitters, textures }
}

export function createHgssBattleParticleResourceResolver(
  romBytes: Uint8Array,
  archive: RomFile,
): (memberId: number) => HgssSplParticleResource {
  if (archive.path !== HGSS_BATTLE_PARTICLE_ARCHIVE_PATH || archive.archiveMembers.length !== HGSS_BATTLE_PARTICLE_RESOURCE_COUNT) {
    throw new Error(`L'archive ${HGSS_BATTLE_PARTICLE_ARCHIVE_PATH} des particules HGSS est invalide.`)
  }
  const cache = new Map<number, HgssSplParticleResource>()
  return (memberId) => {
    if (!Number.isInteger(memberId) || memberId < 0 || memberId >= archive.archiveMembers.length) {
      throw new Error(`Ressource de particules HGSS invalide : ${memberId}.`)
    }
    const cached = cache.get(memberId)
    if (cached) return cached
    const member = archive.archiveMembers[memberId]!
    assertRange(member.offset, member.size, romBytes.byteLength, `Membre SPL ${memberId}`)
    const resource = decodeHgssSplParticleResource(romBytes.subarray(member.offset, member.offset + member.size), memberId)
    cache.set(memberId, resource)
    return resource
  }
}
