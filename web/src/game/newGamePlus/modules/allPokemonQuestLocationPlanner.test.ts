import { describe, expect, it } from 'vitest'
import { createAllPokemonQuestWorldLocations } from './allPokemonQuestLocationPlanner'

function map(id: number, section: number, attributes: number[], width = 3, height = 3) {
  return {
    id,
    header: { region: 0, mapSection: section, wildEncounterBank: 1 },
    matrix: { matrixIndex: id, name: `m${id}`, width: 1, height: 1, headers: new Uint16Array([id]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
    terrain: { width, height, attributes },
    events: { objects: [], warps: [{ x: 0, z: 1, header: id, anchor: 0 }], backgrounds: [], coordinateEvents: [] },
  } as never
}

describe('createAllPokemonQuestWorldLocations', () => {
  it('retient une terre praticable avec une case d’approche et une section unique', () => {
    const passable = Array<number>(9).fill(0)
    const result = createAllPokemonQuestWorldLocations([map(2, 1, passable), map(1, 1, passable), map(3, 2, passable)])
    expect(result).toEqual([
      { mapId: 1, mapSectionId: 1, tileX: 1, tileZ: 1, direction: 'north' },
      { mapId: 3, mapSectionId: 2, tileX: 1, tileZ: 1, direction: 'north' },
    ])
  })

  it('exclut le contexte Safari dédié des autels de quêtes standard', () => {
    const passable = Array<number>(9).fill(0)
    expect(createAllPokemonQuestWorldLocations([map(357, 1, passable), map(4, 2, passable)]))
      .toEqual([{ mapId: 4, mapSectionId: 2, tileX: 1, tileZ: 1, direction: 'north' }])
  })

  it('refuse une carte entièrement bloquée', () => {
    expect(() => createAllPokemonQuestWorldLocations([map(1, 1, Array<number>(9).fill(0x8000))])).toThrow(/Aucune zone/)
  })

  it('écarte une clairière locale qui ne peut pas être rejointe depuis le warp', () => {
    const width = 7, height = 7
    const attributes = Array<number>(width * height).fill(0x8000)
    const open = (x: number, z: number) => { attributes[z * width + x] = 0 }
    // Petit couloir réellement relié au warp, assez large pour un autel et
    // sa case d'approche.
    for (let z = 1; z <= 4; z += 1) open(1, z)
    // Clairière centrale entièrement isolée. L'ancien score choisissait son
    // centre puisqu'il ne contrôlait que l'adjacence locale.
    for (let z = 2; z <= 4; z += 1) for (let x = 3; x <= 5; x += 1) open(x, z)

    const [location] = createAllPokemonQuestWorldLocations([map(7, 7, attributes, width, height)])
    expect(location).toMatchObject({ mapId: 7, tileX: 1 })
    expect(location?.tileX).not.toBeGreaterThanOrEqual(3)
  })
})
