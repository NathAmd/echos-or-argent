import { readArm9FromRom } from '../maps/mapHeaders'

const spawnCount = 30
const spawnRecordSize = 18
const spawnFlags = [
  0x30b, 0x30c, 0x30d, 0x30e, 0x30f, 0x310, 0x311, 0x312, 0x313, 0x214,
  0x315, 0x316, 0x200, 0x301, 0x302, 0x303, 0x304, 0x305, 0x306, 0x307,
  0x208, 0x309, 0x30a, 0x31e, 0x31f, 0x023, 0x021, 0x11b, 0x124, 0x125,
] as const
const deathCoordinates = [0x0806, ...Array(20).fill(0x0d08), 0x1506, ...Array(8).fill(0x0d08)]

export type HgssBlackoutDestination = {
  spawnId: number
  mapId: number
  x: number
  z: number
  direction: 'north'
  followup: 'mom' | 'pokemonCenter'
}

export type HgssFlyDestination = {
  mapId: number
  x: number
  z: number
  direction: 'south'
}

export type HgssBlackoutResolvers = {
  destination: (spawnId: number) => HgssBlackoutDestination
  spawnForMap: (mapId: number) => number | undefined
  flyDestination: (mapId: number) => HgssFlyDestination | undefined
}

export function locateHgssSpawnTable(arm9: Uint8Array): number {
  const tableSize = spawnCount * spawnRecordSize
  const matches: number[] = []
  for (let offset = 0; offset + tableSize <= arm9.byteLength; offset += 2) {
    const view = new DataView(arm9.buffer, arm9.byteOffset + offset, tableSize)
    const matchesSignature = spawnFlags.every((flags, index) => (
      view.getUint16(index * spawnRecordSize, true) === flags
      && view.getUint16(index * spawnRecordSize + 4, true) === deathCoordinates[index]
    ))
    if (matchesSignature) matches.push(offset)
  }
  if (matches.length !== 1) {
    throw new Error(`La table des points de blackout HGSS doit etre unique dans ARM9; ${matches.length} candidate(s) trouvee(s).`)
  }
  return matches[0]!
}

export function createHgssBlackoutResolvers(rom: Uint8Array): HgssBlackoutResolvers {
  const arm9 = readArm9FromRom(rom)
  const tableOffset = locateHgssSpawnTable(arm9)
  const view = new DataView(arm9.buffer, arm9.byteOffset + tableOffset, spawnCount * spawnRecordSize)
  const destination = (spawnId: number): HgssBlackoutDestination => {
    if (!Number.isInteger(spawnId) || spawnId < 1 || spawnId > spawnCount) {
      throw new Error(`Le point de blackout HGSS ${spawnId} est invalide.`)
    }
    const offset = (spawnId - 1) * spawnRecordSize
    const packedCoordinates = view.getUint16(offset + 4, true)
    return {
      spawnId,
      mapId: view.getUint16(offset + 2, true),
      x: packedCoordinates & 0xff,
      z: packedCoordinates >>> 8,
      direction: 'north',
      followup: spawnId === 1 ? 'mom' : 'pokemonCenter',
    }
  }
  const spawnForMap = (mapId: number): number | undefined => {
    if (!Number.isInteger(mapId) || mapId < 0) return undefined
    for (let index = 0; index < spawnCount; index += 1) {
      const offset = index * spawnRecordSize
      const flags = view.getUint16(offset, true)
      if ((flags & 0x100) !== 0 && view.getUint16(offset + 2, true) === mapId) return index + 1
    }
    return undefined
  }
  // GetFlyWarpData/sub_0203BB50 utilisent les champs +6/+8/+10 de la même
  // table ARM9. Les coordonnées sont globales, comme celles de ScrCmd_Warp.
  const flyDestination = (mapId: number): HgssFlyDestination | undefined => {
    if (!Number.isInteger(mapId) || mapId < 0) return undefined
    for (let index = 0; index < spawnCount; index += 1) {
      const offset = index * spawnRecordSize
      if (view.getUint16(offset + 6, true) !== mapId) continue
      return {
        mapId,
        x: view.getUint16(offset + 8, true),
        z: view.getUint16(offset + 10, true),
        direction: 'south',
      }
    }
    return undefined
  }
  return { destination, spawnForMap, flyDestination }
}

export function createHgssBlackoutDestinationResolver(rom: Uint8Array): (spawnId: number) => HgssBlackoutDestination {
  return createHgssBlackoutResolvers(rom).destination
}
