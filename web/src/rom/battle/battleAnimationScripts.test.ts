import { describe, expect, it } from 'vitest'
import type { NarcMember, RomFile } from '../../ndsTypes'
import {
  decodeHgssBattleAnimationCatalog,
  decodeHgssBattleAnimationInstructions,
  HGSS_BATTLE_ANIMATION_ARCHIVE_PATH,
  HGSS_BATTLE_ANIMATION_RESOURCE_PATHS,
  HGSS_BATTLE_ANIMATION_SCRIPT_COUNT,
  HGSS_MOVE_ANIMATION_ARCHIVE_PATH,
  HGSS_MOVE_ANIMATION_SCRIPT_COUNT,
} from './battleAnimationScripts'

function createArchive(path: string, count: number, memberSize: number, offset = 0): RomFile {
  const archiveMembers: NarcMember[] = Array.from({ length: count }, (_, index) => ({
    index,
    offset: offset + index * memberSize,
    size: memberSize,
    signature: '',
  }))
  return { id: 0, path, offset, size: count * memberSize, signature: 'NARC', archiveEntries: count, archiveMembers }
}

function createResources(): RomFile[] {
  return HGSS_BATTLE_ANIMATION_RESOURCE_PATHS.map((path) => createArchive(path, 0, 0))
}

const unusedResolver = () => { throw new Error('unused') }

describe('HGSS battle animation scripts', () => {
  it('decodes the exact move and battle script banks as little-endian 32-bit words', () => {
    const moveBytes = HGSS_MOVE_ANIMATION_SCRIPT_COUNT * 4
    const battleBytes = HGSS_BATTLE_ANIMATION_SCRIPT_COUNT * 4
    const bytes = new Uint8Array(moveBytes + battleBytes)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < HGSS_MOVE_ANIMATION_SCRIPT_COUNT; index += 1) view.setUint32(index * 4, index === 33 ? 0x38 : 0x04, true)
    for (let index = 0; index < HGSS_BATTLE_ANIMATION_SCRIPT_COUNT; index += 1) view.setUint32(moveBytes + index * 4, 0x04, true)

    const catalog = decodeHgssBattleAnimationCatalog(
      bytes,
      createArchive(HGSS_MOVE_ANIMATION_ARCHIVE_PATH, HGSS_MOVE_ANIMATION_SCRIPT_COUNT, 4),
      createArchive(HGSS_BATTLE_ANIMATION_ARCHIVE_PATH, HGSS_BATTLE_ANIMATION_SCRIPT_COUNT, 4, moveBytes),
      createResources(),
      unusedResolver,
      unusedResolver,
    )

    expect(catalog.moveScripts).toHaveLength(501)
    expect(catalog.battleScripts).toHaveLength(50)
    expect(catalog.moveScripts[33]).toMatchObject({ id: 33, byteLength: 4 })
    expect([...catalog.moveScripts[33]!.words]).toEqual([0x38])
    expect(catalog.moveScripts[33]!.instructions[0]).toMatchObject({ opcode: 0x38, name: 'InitPokemonSpriteManager' })
    expect([...catalog.battleScripts[0]!.words]).toEqual([0x04])
  })

  it('keeps empty battle animation entries but rejects empty move scripts', () => {
    const moveArchive = createArchive(HGSS_MOVE_ANIMATION_ARCHIVE_PATH, HGSS_MOVE_ANIMATION_SCRIPT_COUNT, 0)
    const battleArchive = createArchive(HGSS_BATTLE_ANIMATION_ARCHIVE_PATH, HGSS_BATTLE_ANIMATION_SCRIPT_COUNT, 0)
    expect(() => decodeHgssBattleAnimationCatalog(new Uint8Array(), moveArchive, battleArchive, createResources(), unusedResolver, unusedResolver)).toThrow('est vide')

    const bytes = new Uint8Array(HGSS_MOVE_ANIMATION_SCRIPT_COUNT * 4)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < HGSS_MOVE_ANIMATION_SCRIPT_COUNT; index += 1) view.setUint32(index * 4, 4, true)
    const validMoveArchive = createArchive(HGSS_MOVE_ANIMATION_ARCHIVE_PATH, HGSS_MOVE_ANIMATION_SCRIPT_COUNT, 4)
    const catalog = decodeHgssBattleAnimationCatalog(bytes, validMoveArchive, battleArchive, createResources(), unusedResolver, unusedResolver)
    expect(catalog.battleScripts.every((script) => script.words.length === 0)).toBe(true)
  })

  it('rejects a non-ROM opcode and missing shared resources', () => {
    const bytes = new Uint8Array((HGSS_MOVE_ANIMATION_SCRIPT_COUNT + HGSS_BATTLE_ANIMATION_SCRIPT_COUNT) * 4)
    new DataView(bytes.buffer).setUint32(0, 0x59, true)
    const moveArchive = createArchive(HGSS_MOVE_ANIMATION_ARCHIVE_PATH, HGSS_MOVE_ANIMATION_SCRIPT_COUNT, 4)
    const battleArchive = createArchive(HGSS_BATTLE_ANIMATION_ARCHIVE_PATH, HGSS_BATTLE_ANIMATION_SCRIPT_COUNT, 4, HGSS_MOVE_ANIMATION_SCRIPT_COUNT * 4)
    expect(() => decodeHgssBattleAnimationCatalog(bytes, moveArchive, battleArchive, createResources(), unusedResolver, unusedResolver)).toThrow(/opcode/i)
    expect(() => decodeHgssBattleAnimationCatalog(bytes, moveArchive, battleArchive, [], unusedResolver, unusedResolver)).toThrow('ressources')
  })

  it('decodes variable-length CallFunc operands without losing the next command', () => {
    const moveBytes = HGSS_MOVE_ANIMATION_SCRIPT_COUNT * 24
    const battleBytes = HGSS_BATTLE_ANIMATION_SCRIPT_COUNT * 4
    const bytes = new Uint8Array(moveBytes + battleBytes)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < HGSS_MOVE_ANIMATION_SCRIPT_COUNT; index += 1) {
      const offset = index * 24
      for (const [word, value] of [45, 78, 2, 11, 22, 4].entries()) view.setUint32(offset + word * 4, value, true)
    }
    for (let index = 0; index < HGSS_BATTLE_ANIMATION_SCRIPT_COUNT; index += 1) view.setUint32(moveBytes + index * 4, 4, true)
    const catalog = decodeHgssBattleAnimationCatalog(
      bytes,
      createArchive(HGSS_MOVE_ANIMATION_ARCHIVE_PATH, HGSS_MOVE_ANIMATION_SCRIPT_COUNT, 24),
      createArchive(HGSS_BATTLE_ANIMATION_ARCHIVE_PATH, HGSS_BATTLE_ANIMATION_SCRIPT_COUNT, 4, moveBytes),
      createResources(),
      unusedResolver,
      unusedResolver,
    )
    expect(catalog.moveScripts[0]!.instructions.map(({ name }) => name)).toEqual(['CallFunc', 'End'])
    expect([...catalog.moveScripts[0]!.instructions[0]!.operands]).toEqual([78, 2, 11, 22])
  })

  it('valide les cibles relatives de contrôle depuis le mot opérande', () => {
    expect(decodeHgssBattleAnimationInstructions(Uint32Array.from([10, 1, 4]), 12).map(({ name }) => name)).toEqual(['Call', 'End'])
    expect(() => decodeHgssBattleAnimationInstructions(Uint32Array.from([10, 5, 4]), 13)).toThrow('Cible 6 absente')
  })
})
