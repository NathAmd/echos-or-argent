import { describe, expect, it } from 'vitest'
import type { RomFile } from '../../ndsTypes'
import { hgssGrowthTableSize } from './growthTable'
import { hgssMoveDataSize } from './moveData'
import { hgssPersonalDataSize } from './personalData'
import { hgssPokeathlonPerformanceMemberCount, hgssPokeathlonPerformanceSize } from './pokeathlonPerformance'
import { hgssItemDataMemberCount, hgssItemDataSize } from '../items/itemData'
import { createPokemonArchiveRegistry } from './pokemonArchiveRegistry'

function createArchive(path: string, members: number, memberSize = 4): RomFile {
  return {
    id: 0,
    path,
    offset: 0,
    size: members * memberSize,
    signature: 'N A R C',
    archiveEntries: members,
    archiveMembers: Array.from({ length: members }, (_, index) => ({
      index,
      offset: index * memberSize,
      size: memberSize,
      signature: '',
    })),
  }
}

function createCompleteFixture(): RomFile[] {
  return [
    createArchive('/a/0/0/2', 494, hgssPersonalDataSize),
    createArchive('/a/0/0/3', 8, hgssGrowthTableSize),
    createArchive('/a/0/0/4', 494),
    createArchive('/a/1/1/4', 261),
    createArchive('/a/0/0/5', 494),
    createArchive('/a/1/1/7', 160, 1),
    createArchive('/a/0/1/1', 468, hgssMoveDataSize),
    createArchive('/a/0/1/7', hgssItemDataMemberCount, hgssItemDataSize),
    createArchive('/a/0/1/8', 1),
    createArchive('/a/0/2/0', 551),
    createArchive('/a/0/3/3', 494),
    createArchive('/a/0/3/4', 494, 0x2c),
    createArchive('/a/1/6/9', hgssPokeathlonPerformanceMemberCount, hgssPokeathlonPerformanceSize),
    createArchive('/a/1/4/1', 566),
    createArchive('/a/0/8/1', 863),
  ]
}

describe('HGSS Pokemon archive registry', () => {
  it('resolves each proven role to one structural ROM archive', () => {
    const registry = createPokemonArchiveRegistry(createCompleteFixture())

    expect(registry).toHaveLength(15)
    expect(registry.map(({ role, path }) => ({ role, path }))).toContainEqual({
      role: 'personalData',
      path: '/a/0/0/2',
    })
    expect(new Set(registry.map((entry) => entry.role)).size).toBe(registry.length)
  })

  it('rejects missing, duplicate, truncated, and structurally invalid archives', () => {
    const fixture = createCompleteFixture()
    expect(() => createPokemonArchiveRegistry(fixture.filter((file) => file.path !== '/a/0/0/2'))).toThrow('doit etre unique; 0')
    expect(() => createPokemonArchiveRegistry([...fixture, fixture[0]!])).toThrow('doit etre unique; 2')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/0/0/3' ? createArchive(file.path, 7, hgssGrowthTableSize) : file))).toThrow('8 minimum')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/0/0/3' ? createArchive(file.path, 8, 400) : file))).toThrow('400 octets')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/0/1/1' ? createArchive(file.path, 467) : file))).toThrow('468 minimum')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/0/1/1' ? createArchive(file.path, 468, 15) : file))).toThrow('15 octets')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/0/1/7' ? createArchive(file.path, hgssItemDataMemberCount - 1, hgssItemDataSize) : file))).toThrow('514 minimum')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/0/1/7' ? createArchive(file.path, hgssItemDataMemberCount, hgssItemDataSize - 1) : file))).toThrow('33 octets')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/0/0/2' ? createArchive(file.path, 494, 43) : file))).toThrow('43 octets')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/1/6/9' ? createArchive(file.path, hgssPokeathlonPerformanceMemberCount - 1, hgssPokeathlonPerformanceSize) : file))).toThrow('554 minimum')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/1/6/9' ? createArchive(file.path, hgssPokeathlonPerformanceMemberCount, hgssPokeathlonPerformanceSize - 1) : file))).toThrow('19 octets')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/1/4/1' ? createArchive(file.path, 565) : file))).toThrow('566 minimum')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/1/4/1' ? createArchive(file.path, 566, 3) : file))).toThrow('3 octets')
    expect(() => createPokemonArchiveRegistry(fixture.map((file) => file.path === '/a/0/8/1' ? createArchive(file.path, 862) : file))).toThrow('863 minimum')
  })
})
