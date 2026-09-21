import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import { usesWorldMatrixCoordinates } from './mapCoordinates'

export const hgssStrengthRockSpriteId = 84
export const hgssStrengthRockScriptId = 10002

export type StrengthBoulderFall = {
  sourceEventFlag: number
  targetEventFlag: number
  targetMapId: number
}

type MapObjectEventPreview = MapEventPreview['objects'][number]

const holeTilesByMap = new WeakMap<OpeningMapPreview, ReadonlySet<string>>()

function tileKey(tileX: number, tileZ: number): string {
  return `${tileX}:${tileZ}`
}

function isHoleSurface(materialName?: string, textureName?: string): boolean {
  return /(?:^|_)stairhole(?:_|$)/i.test(materialName ?? '')
    || /(?:^|_)stairhole(?:_|$)/i.test(textureName ?? '')
}

/**
 * Resolve les trous de rochers depuis la scene et la BDHC de la ROM.
 * Les escaliers emploient le meme decor `stairhole`, mais leur comportement
 * de terrain est un comportement d'echelle; le centre vide d'un vrai trou a
 * le comportement nul. Aucun identifiant de carte ni coordonnee n'est codé.
 */
export function findStrengthHoleTiles(map: OpeningMapPreview): ReadonlySet<string> {
  const cached = holeTilesByMap.get(map)
  if (cached) return cached
  const holes = new Set<string>()
  const sceneHoleTiles = new Set<string>()
  const terrain = map.terrain
  if (!terrain || usesWorldMatrixCoordinates(map)) {
    holeTilesByMap.set(map, holes)
    return holes
  }
  for (const surface of map.model?.surfaces ?? []) {
    if (!isHoleSurface(surface.materialName, surface.textureName)) continue
    for (let offset = 0; offset + 8 < surface.positions.length; offset += 9) {
      const centerX = (surface.positions[offset]! + surface.positions[offset + 3]! + surface.positions[offset + 6]!) / 3
      const centerZ = (surface.positions[offset + 2]! + surface.positions[offset + 5]! + surface.positions[offset + 8]!) / 3
      const tileX = Math.floor(centerX / 16 + terrain.width / 2)
      const tileZ = Math.floor(centerZ / 16 + terrain.height / 2)
      if (tileX < 0 || tileZ < 0 || tileX >= terrain.width || tileZ >= terrain.height) continue
      if ((terrain.attributes[tileZ * terrain.width + tileX]! & 0xff) === 0) sceneHoleTiles.add(tileKey(tileX, tileZ))
    }
  }
  // Les triangles `stairhole` incluent leur bord décoratif. Les événements
  // de coordonnées ROM désignent exactement les cases centrales qui font
  // tomber le joueur et, par conséquent, les rochers de Force.
  for (const event of map.events?.coordinateEvents ?? []) {
    for (let z = event.z; z < event.z + Math.max(1, event.height); z += 1) {
      for (let x = event.x; x < event.x + Math.max(1, event.width); x += 1) {
        const key = tileKey(x, z)
        if (sceneHoleTiles.has(key)) holes.add(key)
      }
    }
  }
  holeTilesByMap.set(map, holes)
  return holes
}

export function isPushableStrengthBoulder(object: MapObjectEventPreview): boolean {
  return object.spriteId === hgssStrengthRockSpriteId && object.scriptId === hgssStrengthRockScriptId
}

function orderedFlaggedBoulders(map: OpeningMapPreview, pushable: boolean): MapObjectEventPreview[] {
  return (map.events?.objects ?? [])
    .filter((object) => object.spriteId === hgssStrengthRockSpriteId
      && object.eventFlag > 0
      && isPushableStrengthBoulder(object) === pushable)
    .sort((left, right) => left.eventFlag - right.eventFlag)
}

/**
 * Associe le rocher du niveau supérieur à sa représentation tombée, selon
 * l'ordre des drapeaux ROM dans une même section de carte. HGSS initialise
 * les drapeaux cibles comme cachés puis les révèle lors de la chute.
 */
export function resolveStrengthBoulderFall(
  maps: readonly OpeningMapPreview[],
  sourceMap: OpeningMapPreview,
  source: MapObjectEventPreview,
  targetTileX: number,
  targetTileZ: number,
): StrengthBoulderFall | undefined {
  if (!isPushableStrengthBoulder(source)
    || source.eventFlag === 0
    || !findStrengthHoleTiles(sourceMap).has(tileKey(targetTileX, targetTileZ))) return undefined
  const sources = orderedFlaggedBoulders(sourceMap, true)
  const sourceIndex = sources.findIndex((candidate) => candidate.eventFlag === source.eventFlag)
  if (sourceIndex < 0) return undefined
  const candidates = maps.flatMap((map) => {
    if (map.id === sourceMap.id || map.header.mapSection !== sourceMap.header.mapSection) return []
    const targets = orderedFlaggedBoulders(map, false)
    if (targets.length !== sources.length || targets[0]!.eventFlag <= sources.at(-1)!.eventFlag) return []
    return [{ map, targets }]
  })
  if (candidates.length !== 1) return undefined
  const target = candidates[0]!.targets[sourceIndex]
  if (!target) return undefined
  return {
    sourceEventFlag: source.eventFlag,
    targetEventFlag: target.eventFlag,
    targetMapId: candidates[0]!.map.id,
  }
}
