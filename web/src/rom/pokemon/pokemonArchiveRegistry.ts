import type { RomFile } from '../../ndsTypes'
import { hgssFollowerParameterSize } from '../overworld/followerParameters'
import { hgssGrowthTableSize } from './growthTable'
import { hgssMoveDataSize } from './moveData'
import { hgssPersonalDataSize } from './personalData'
import { hgssPokeathlonPerformanceMemberCount, hgssPokeathlonPerformanceSize } from './pokeathlonPerformance'
import { hgssItemDataMemberCount, hgssItemDataSize } from '../items/itemData'

export type PokemonArchiveRole =
  | 'personalData'
  | 'growthTables'
  | 'battleGraphics'
  | 'battleFormGraphics'
  | 'battleSpriteHeights'
  | 'battleFormSpriteHeights'
  | 'moves'
  | 'itemData'
  | 'itemIcons'
  | 'pokemonIcons'
  | 'levelUpLearnsets'
  | 'evolutions'
  | 'pokeathlonPerformances'
  | 'followerParameters'
  | 'followerGraphics'

export type PokemonArchiveEntry = {
  role: PokemonArchiveRole
  path: string
  file: RomFile
}

const archiveDefinitions: readonly {
  role: PokemonArchiveRole
  path: string
  minimumMembers: number
  exactMemberSize?: number
}[] = [
  { role: 'personalData', path: '/a/0/0/2', minimumMembers: 494, exactMemberSize: hgssPersonalDataSize },
  { role: 'growthTables', path: '/a/0/0/3', minimumMembers: 8, exactMemberSize: hgssGrowthTableSize },
  { role: 'battleGraphics', path: '/a/0/0/4', minimumMembers: 494 },
  { role: 'battleFormGraphics', path: '/a/1/1/4', minimumMembers: 261 },
  { role: 'battleSpriteHeights', path: '/a/0/0/5', minimumMembers: 494 },
  { role: 'battleFormSpriteHeights', path: '/a/1/1/7', minimumMembers: 160, exactMemberSize: 1 },
  { role: 'moves', path: '/a/0/1/1', minimumMembers: 468, exactMemberSize: hgssMoveDataSize },
  { role: 'itemData', path: '/a/0/1/7', minimumMembers: hgssItemDataMemberCount, exactMemberSize: hgssItemDataSize },
  { role: 'itemIcons', path: '/a/0/1/8', minimumMembers: 1 },
  { role: 'pokemonIcons', path: '/a/0/2/0', minimumMembers: 551 },
  { role: 'levelUpLearnsets', path: '/a/0/3/3', minimumMembers: 494 },
  { role: 'evolutions', path: '/a/0/3/4', minimumMembers: 494, exactMemberSize: 0x2c },
  { role: 'pokeathlonPerformances', path: '/a/1/6/9', minimumMembers: hgssPokeathlonPerformanceMemberCount, exactMemberSize: hgssPokeathlonPerformanceSize },
  { role: 'followerParameters', path: '/a/1/4/1', minimumMembers: 566, exactMemberSize: hgssFollowerParameterSize },
  { role: 'followerGraphics', path: '/a/0/8/1', minimumMembers: 863 },
]

export function createPokemonArchiveRegistry(files: RomFile[]): PokemonArchiveEntry[] {
  return archiveDefinitions.map((definition) => {
    const matches = files.filter((file) => file.path === definition.path)
    if (matches.length !== 1) {
      throw new Error(`L'archive Pokemon HGSS ${definition.role} (${definition.path}) doit etre unique; ${matches.length} trouvee(s).`)
    }
    const file = matches[0]!
    if (file.archiveEntries < definition.minimumMembers) {
      throw new Error(`L'archive Pokemon HGSS ${definition.role} contient ${file.archiveEntries} membres; ${definition.minimumMembers} minimum attendus.`)
    }
    if (definition.exactMemberSize !== undefined) {
      const invalidMember = file.archiveMembers.find((member) => member.size !== definition.exactMemberSize)
      if (invalidMember) {
        throw new Error(`Le membre ${invalidMember.index} de l'archive Pokemon HGSS ${definition.role} mesure ${invalidMember.size} octets au lieu de ${definition.exactMemberSize}.`)
      }
    }
    return { role: definition.role, path: definition.path, file }
  })
}
