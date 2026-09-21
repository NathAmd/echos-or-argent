import type { PokemonMoveData } from '../../rom/pokemon/moveData'

export type SimpleBattleMoveSupport = 'implemented' | 'damage-only' | 'no-effect-fallback'
export type DoubleBattleMoveSupport = SimpleBattleMoveSupport

const implementedEffectIds = new Set<number>([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30,
  29, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67,
  68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90,
  91, 92, 93, 94, 95, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 111, 112, 113, 114, 115,
  116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 132, 135, 136, 137, 138, 139, 140,
  142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 158, 159, 160, 162, 164, 165, 166, 167, 168, 169, 171,
  170, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 197, 198, 199, 200, 201,
  202, 204, 205, 206, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222,
  161, 196, 203, 207, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 240, 243, 244, 245, 246, 249,
  239, 241, 242, 247, 248, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 265, 266, 269, 270, 271, 273,
  267, 268, 272, 274, 275, 276,
])

const implementedDoubleBattleEffectIds = new Set<number>([
  0, 1, 2, 3, 4, 5, 6, 7,
  10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 32, 33,
  17, 29, 31, 35, 36, 42, 43, 49, 50, 51, 52, 53, 54, 55, 56, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67,
  68, 69, 70, 71, 72, 73, 74, 76, 81, 99, 103, 111, 115, 116, 117, 121, 123, 132, 136, 137, 143, 146, 147, 148, 149, 151, 152, 155, 156,
  120, 164, 169, 173, 174, 178, 181, 182, 187, 190, 193, 196, 211, 217, 219, 221, 237, 242, 245, 246, 254, 255, 256, 257, 259, 260, 263, 276,
  39, 40, 41, 44, 47, 75, 77, 87, 88, 101, 104, 108, 119, 126, 130, 135, 150, 185, 186, 189, 200, 202, 203, 207, 209, 230, 231, 235, 267, 268, 272, 273, 274, 275,
  8, 37, 102, 138, 139, 140, 204, 205, 206, 208, 212, 218, 226, 229, 243, 244, 250, 265, 271,
  172, 176,
  34, 45, 48, 80, 198, 253, 262, 269,
  85, 91, 92, 97, 118, 142, 160, 161, 162, 166, 167, 168, 199,
  201, 210, 215, 225, 236, 239, 240, 247, 251, 252,
  105, 177, 184, 188, 222,
  86, 90, 100, 165, 175, 192,
  112, 129, 249, 258, 266,
  89, 125, 144, 145, 158, 170, 171, 223, 227, 261,
  30, 82, 191, 213, 234,
  84, 107, 114, 179,
  79, 183, 195,
  214, 220, 270,
  26, 27, 38, 159,
  78, 122, 197,
  46, 124,
  94, 109, 113, 216,
  83, 180, 241, 248,
  224, 232, 233,
  93, 98, 194, 238,
  9, 57, 95,
  28, 106, 127, 153, 228,
  154,
  128,
])

/**
 * Décrit honnêtement la sémantique actuellement exécutée par le moteur 1 contre 1.
 *
 * Une capacité reste sélectionnable pendant la reconstruction : `damage-only` indique
 * que ses dégâts ROM sont joués mais pas encore son effet spécial, tandis que
 * `no-effect-fallback` désigne un effet de statut qui se replie encore sur « aucun effet ».
 */
export function classifySimpleBattleMoveSupport(move: Pick<PokemonMoveData, 'effect' | 'power'>): SimpleBattleMoveSupport {
  if (implementedEffectIds.has(move.effect)) return 'implemented'
  return move.power > 0 ? 'damage-only' : 'no-effect-fallback'
}

export function isSimpleBattleMoveSemanticallyImplemented(move: Pick<PokemonMoveData, 'effect' | 'power'>): boolean {
  return classifySimpleBattleMoveSupport(move) === 'implemented'
}

export function getImplementedSimpleBattleEffectIds(): readonly number[] {
  return [...implementedEffectIds].sort((left, right) => left - right)
}

/** Couverture séparée : le moteur double ne doit jamais hériter implicitement du bilan 1 contre 1. */
export function classifyDoubleBattleMoveSupport(move: Pick<PokemonMoveData, 'effect' | 'power'>): DoubleBattleMoveSupport {
  if (implementedDoubleBattleEffectIds.has(move.effect)) return 'implemented'
  return move.power > 0 ? 'damage-only' : 'no-effect-fallback'
}
