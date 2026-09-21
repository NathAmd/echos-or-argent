import type { RomFile } from '../../ndsTypes'
import { createHgssBattleBallSpriteResolver } from './battleBallSprites'
import { createHgssBattleThrowSpriteResolver } from './battleThrowSprites'

export const HGSS_MOVE_ANIMATION_ARCHIVE_PATH = '/a/0/1/0'
export const HGSS_BATTLE_ANIMATION_ARCHIVE_PATH = '/a/0/6/1'
export const HGSS_BATTLE_ANIMATION_RESOURCE_PATHS = [
  '/a/0/0/7',
  '/a/0/0/8',
  '/a/0/2/2',
  '/a/0/2/3',
  '/a/0/2/4',
  '/a/0/2/5',
] as const

export const HGSS_MOVE_ANIMATION_SCRIPT_COUNT = 501
export const HGSS_BATTLE_ANIMATION_SCRIPT_COUNT = 50
export const HGSS_BATTLE_ANIMATION_OPCODE_MAX = 0x57

const HGSS_BATTLE_ANIMATION_OPCODE_SPECS = [
  ['Delay', 1],
  ['WaitForAnimTasks', 0],
  ['BeginLoop', 1],
  ['EndLoop', 0],
  ['End', 0],
  ['PlaySoundEffect', 1],
  ['Nop0', 0],
  ['Nop1', 0],
  ['SetBg0Bg1AlphaBlending', 2],
  ['SetDefaultAlphaBlending', 0],
  ['Call', 1],
  ['Return', 0],
  ['SetVar', 2],
  ['JumpIfEffectChanceOdd', 2],
  ['JumpIfEffectChance', 2],
  ['Jump', 1],
  ['SwitchBg', 2],
  ['SetBgSwitchVar', 2],
  ['RestoreBg', 2],
  ['WaitForPartialBgSwitch', 0],
  ['WaitForBgSwitch', 0],
  ['SetBg', 1],
  ['PlayPannedSoundEffect', 2],
  ['PanSoundEffects', 1],
  ['PlayMovingSoundEffectAtkDef', 5],
  ['PlayLoopedSoundEffect', 4],
  ['PlayDelayedSoundEffect', 3],
  ['Nop2', 0],
  ['Nop3', 0],
  ['WaitForSoundEffects', 0],
  ['JumpIfEqual', 3],
  ['LoadPokemonSpriteIntoBg', 2],
  ['RemovePokemonSpriteFromBg', 1],
  ['JumpIfUnknown01', 1],
  ['SwitchBgEx', 3],
  ['PlayMovingSoundEffectNoCorrection', 5],
  ['PlayMovingSoundEffectAtkDef2', 5],
  ['Nop4', 0],
  ['Nop5', 0],
  ['Nop6', 0],
  ['Nop7', 0],
  ['Nop8', 0],
  ['Nop9', 0],
  ['Nop10', 0],
  ['StopSoundEffect', 1],
  ['CallFunc', -1],
  ['CreateEmitter', 3],
  ['CreateEmitterEx', 4],
  ['CreateEmitterForMove', 8],
  ['CreateEmitterForFriendlyFire', 6],
  ['WaitForAllEmitters', 0],
  ['LoadParticleSystem', 2],
  ['LoadDebugParticleSystem', 3],
  ['UnloadParticleSystem', 1],
  ['Nop11', 0],
  ['SetExtraParams', -2],
  ['InitPokemonSpriteManager', 0],
  ['LoadPokemonSpriteDummyResources', 1],
  ['AddPokemonSprite', 4],
  ['FreePokemonSpriteManager', 0],
  ['RemovePokemonSprite', 1],
  ['CancelTrackingTask', 1],
  ['SetCameraProjection', 2],
  ['SetCameraFlip', 2],
  ['JumpIfBattlerSide', 3],
  ['PlayPokemonCry', 3],
  ['WaitForPokemonCries', 1],
  ['ResetVars', 0],
  ['StartBattlerSlideIn', 1],
  ['StartBattlerSlideOut', 1],
  ['JumpIfWeather', 5],
  ['JumpIfContest', 1],
  ['JumpIfFriendlyFire', 1],
  ['InitSpriteManager', 8],
  ['LoadCharResObj', 2],
  ['LoadPlttRes', 3],
  ['LoadCellResObj', 2],
  ['LoadAnimResObj', 2],
  ['AddSpriteWithFunc', -3],
  ['AddSprite', 8],
  ['FreeSpriteManager', 1],
  ['SetPokemonSpriteVisible', 2],
  ['StartPokemonSpriteDrawTask', 3],
  ['StopPokemonSpriteDrawTask', 1],
  ['WaitForLRX', 0],
  ['HgssUnknown85', 1],
  ['HgssUnknown86', 3],
  ['HgssUnknown87', 1],
] as const satisfies readonly (readonly [string, number])[]

export type HgssBattleAnimationInstruction = {
  offsetWords: number
  opcode: number
  name: string
  operands: Uint32Array
}

export type HgssBattleAnimationScript = {
  id: number
  byteLength: number
  words: Uint32Array
  instructions: HgssBattleAnimationInstruction[]
}

export type HgssBattleAnimationCatalog = {
  moveArchivePath: typeof HGSS_MOVE_ANIMATION_ARCHIVE_PATH
  battleArchivePath: typeof HGSS_BATTLE_ANIMATION_ARCHIVE_PATH
  resourceArchivePaths: typeof HGSS_BATTLE_ANIMATION_RESOURCE_PATHS
  moveScripts: HgssBattleAnimationScript[]
  battleScripts: HgssBattleAnimationScript[]
  particleResourceResolver: (memberId: number) => import('./splParticleResources').HgssSplParticleResource
  spriteResourceResolver: (request: import('./battleSpriteResources').HgssBattleSpriteResourceRequest) => import('./battleSpriteResources').HgssBattleSpriteResource
  ballSpriteResolver: ReturnType<typeof createHgssBattleBallSpriteResolver>
  throwSpriteResolver: ReturnType<typeof createHgssBattleThrowSpriteResolver>
}

const hgssBattleAnimationBranchOperands: Readonly<Partial<Record<string, readonly number[]>>> = {
  Call: [0],
  Jump: [0],
  JumpIfEqual: [2],
  JumpIfEffectChanceOdd: [0, 1],
  JumpIfEffectChance: [1],
  JumpIfBattlerSide: [1, 2],
  JumpIfWeather: [0, 1, 2, 3, 4],
  JumpIfContest: [0],
  JumpIfFriendlyFire: [0],
  JumpIfUnknown01: [0],
}

/** Valide les offsets relatifs depuis le mot opérande, tels qu'encodés par les macros Nitro. */
export function validateHgssBattleAnimationControlFlow(
  instructions: readonly HgssBattleAnimationInstruction[],
  scriptId: number,
): void {
  const offsets = new Set(instructions.map(({ offsetWords }) => offsetWords))
  for (const instruction of instructions) {
    for (const operandIndex of hgssBattleAnimationBranchOperands[instruction.name] ?? []) {
      const encoded = instruction.operands[operandIndex]
      if (encoded === undefined) throw new Error(`Branche d'animation HGSS tronquée dans le script ${scriptId} à ${instruction.offsetWords}.`)
      const targetOffset = instruction.offsetWords + 1 + operandIndex + (encoded | 0)
      if (!offsets.has(targetOffset)) {
        throw new Error(`Cible ${targetOffset} absente de l'animation HGSS ${scriptId} (${instruction.name} à ${instruction.offsetWords}).`)
      }
    }
  }
}

function requireWord(words: Uint32Array, index: number, scriptId: number): number {
  const value = words[index]
  if (value === undefined) throw new Error(`Le script d'animation HGSS ${scriptId} se termine au milieu d'une commande.`)
  return value
}

export function decodeHgssBattleAnimationInstructions(words: Uint32Array, scriptId = 0): HgssBattleAnimationInstruction[] {
  const instructions: HgssBattleAnimationInstruction[] = []
  let offsetWords = 0
  while (offsetWords < words.length) {
    const opcode = requireWord(words, offsetWords, scriptId)
    const spec = HGSS_BATTLE_ANIMATION_OPCODE_SPECS[opcode]
    if (!spec) throw new Error(`Opcode d'animation HGSS invalide dans le script ${scriptId} : ${opcode}.`)
    let operandWords = spec[1]
    if (operandWords === -1) operandWords = 2 + requireWord(words, offsetWords + 2, scriptId)
    else if (operandWords === -2) operandWords = 1 + requireWord(words, offsetWords + 1, scriptId)
    else if (operandWords === -3) operandWords = 9 + requireWord(words, offsetWords + 9, scriptId)
    const nextOffset = offsetWords + 1 + operandWords
    if (nextOffset > words.length) {
      throw new Error(`Le script d'animation HGSS ${scriptId} se termine au milieu de ${spec[0]}.`)
    }
    instructions.push({
      offsetWords,
      opcode,
      name: spec[0],
      operands: words.slice(offsetWords + 1, nextOffset),
    })
    offsetWords = nextOffset
  }
  validateHgssBattleAnimationControlFlow(instructions, scriptId)
  return instructions
}

function decodeScriptBank(
  romBytes: Uint8Array,
  archive: RomFile,
  expectedPath: string,
  expectedCount: number,
  allowEmpty: boolean,
): HgssBattleAnimationScript[] {
  if (archive.path !== expectedPath) {
    throw new Error(`Archive d'animations HGSS inattendue : ${archive.path}.`)
  }
  if (archive.archiveMembers.length !== expectedCount) {
    throw new Error(`L'archive ${expectedPath} doit contenir ${expectedCount} scripts HGSS.`)
  }

  return archive.archiveMembers.map((member, id) => {
    if (member.index !== id) {
      throw new Error(`Index de script d'animation HGSS incoherent dans ${expectedPath} : ${member.index}.`)
    }
    if (member.size === 0) {
      if (!allowEmpty) throw new Error(`Le script d'animation HGSS ${id} est vide.`)
      return { id, byteLength: 0, words: new Uint32Array(), instructions: [] }
    }
    if (member.size % 4 !== 0) {
      throw new Error(`Le script d'animation HGSS ${id} n'est pas aligne sur des mots de 32 bits.`)
    }
    if (member.offset < 0 || member.offset + member.size > romBytes.byteLength) {
      throw new Error(`Le script d'animation HGSS ${id} depasse les donnees de la ROM.`)
    }

    const view = new DataView(romBytes.buffer, romBytes.byteOffset + member.offset, member.size)
    const words = new Uint32Array(member.size / 4)
    for (let word = 0; word < words.length; word += 1) words[word] = view.getUint32(word * 4, true)
    return { id, byteLength: member.size, words, instructions: decodeHgssBattleAnimationInstructions(words, id) }
  })
}

export function decodeHgssBattleAnimationCatalog(
  romBytes: Uint8Array,
  moveArchive: RomFile,
  battleArchive: RomFile,
  resourceArchives: RomFile[],
  particleResourceResolver: HgssBattleAnimationCatalog['particleResourceResolver'],
  spriteResourceResolver: HgssBattleAnimationCatalog['spriteResourceResolver'],
): HgssBattleAnimationCatalog {
  for (const path of HGSS_BATTLE_ANIMATION_RESOURCE_PATHS) {
    if (!resourceArchives.some((archive) => archive.path === path)) {
      throw new Error(`L'archive de ressources d'animation HGSS ${path} est absente.`)
    }
  }
  const throwSpriteArchive = resourceArchives.find(({ path }) => path === '/a/0/0/8')!
  return {
    moveArchivePath: HGSS_MOVE_ANIMATION_ARCHIVE_PATH,
    battleArchivePath: HGSS_BATTLE_ANIMATION_ARCHIVE_PATH,
    resourceArchivePaths: HGSS_BATTLE_ANIMATION_RESOURCE_PATHS,
    moveScripts: decodeScriptBank(
      romBytes,
      moveArchive,
      HGSS_MOVE_ANIMATION_ARCHIVE_PATH,
      HGSS_MOVE_ANIMATION_SCRIPT_COUNT,
      false,
    ),
    battleScripts: decodeScriptBank(
      romBytes,
      battleArchive,
      HGSS_BATTLE_ANIMATION_ARCHIVE_PATH,
      HGSS_BATTLE_ANIMATION_SCRIPT_COUNT,
      true,
    ),
    particleResourceResolver,
    spriteResourceResolver,
    ballSpriteResolver: createHgssBattleBallSpriteResolver(romBytes, throwSpriteArchive),
    throwSpriteResolver: createHgssBattleThrowSpriteResolver(romBytes, throwSpriteArchive),
  }
}
