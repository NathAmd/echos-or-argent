/**
 * Projection de sTrainerEncounterMusicParam / FieldBGM_GetEyesMeetForTrainer
 * dans field_bgm.c de Pokémon HeartGold/SoulSilver.
 */
const defaultEncounterSequenceId = 1108

const trainerEncounterSequenceByClass = new Map<number, readonly [johto: number, kanto: number]>([
  [2, [1108, 1108]], [3, [1113, 1113]], [4, [1108, 1108]], [5, [1113, 1113]],
  [6, [1108, 1108]], [8, [1113, 1113]], [9, [1115, 1115]], [11, [1115, 1115]],
  [14, [1115, 1115]], [20, [1115, 1115]], [21, [1113, 1113]], [24, [1115, 1115]],
  [25, [1113, 1113]], [69, [1108, 1108]], [31, [1109, 1109]], [34, [1115, 1115]],
  [36, [1113, 1113]], [38, [1114, 1114]], [42, [1115, 1115]], [43, [1113, 1113]],
  [46, [1115, 1115]], [47, [1111, 1111]], [49, [1108, 1108]], [52, [1115, 1115]],
  [55, [1112, 1112]], [56, [1113, 1113]], [60, [1108, 1108]], [62, [1112, 1112]],
  [63, [1109, 1109]], [64, [1115, 1115]], [65, [1115, 1115]], [68, [1109, 1109]],
  [77, [1113, 1113]], [78, [1109, 1109]], [79, [1110, 1110]], [82, [1110, 1110]],
  [113, [1112, 1109]], [115, [1115, 1115]], [121, [1114, 1114]], [122, [1113, 1113]],
  [116, [1112, 1112]], [114, [1112, 1112]], [117, [1112, 1112]], [118, [1112, 1112]],
])

export function resolveHgssTrainerEncounterMusic(trainerClass: number, region: number): number {
  const sequences = trainerEncounterSequenceByClass.get(trainerClass)
  if (!sequences) return defaultEncounterSequenceId
  return sequences[region === 1 ? 1 : 0]
}
