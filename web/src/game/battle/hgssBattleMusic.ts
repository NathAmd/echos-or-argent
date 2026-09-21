/** Projection de BattleSetup_GetTransitionAndMusicParam/BattleStartGetMusic. */
const johtoLeaderClasses = new Set([66, 67, 70, 72, 73, 74, 75, 76, 87, 88, 89, 112])
const kantoLeaderClasses = new Set([98, 103, 104, 105, 106, 107, 108, 110])
const championClasses = new Set([86, 109])
const rivalClasses = new Set([23, 119])
const rocketClasses = new Set([55, 62, 114, 116, 117, 118, 124])
const frontierBrainClasses = new Set([97, 99, 100, 101, 102])
const majorVictoryClasses = new Set([
  ...johtoLeaderClasses,
  ...kantoLeaderClasses,
  86, // TRAINERCLASS_CHAMPION
])

export function resolveHgssTrainerBattleMusic(trainerClass: number, region: number): number {
  if (johtoLeaderClasses.has(trainerClass)) return 1118 // SEQ_GS_VS_GYMREADER
  if (kantoLeaderClasses.has(trainerClass)) return 1127 // SEQ_GS_VS_GYMREADER_KANTO
  if (championClasses.has(trainerClass)) return 1124 // SEQ_GS_VS_CHAMP
  if (rivalClasses.has(trainerClass)) return 1119 // SEQ_GS_VS_RIVAL
  if (rocketClasses.has(trainerClass)) return 1120 // SEQ_GS_VS_ROCKET
  return region === 1 ? 1126 : 1117 // SEQ_GS_VS_TRAINER[_KANTO]
}

export function resolveHgssWildBattleMusic(speciesId: number, region: number): number {
  if (speciesId === 243) return 1123 // Raikou
  if (speciesId === 244) return 1122 // Entei
  if (speciesId === 245) return 1121 // Suicune
  if (speciesId === 249) return 1133 // Lugia
  if (speciesId === 250) return 1132 // Ho-Oh
  if (speciesId === 150 || speciesId === 380 || speciesId === 381) return 1125
  if (speciesId === 382 || speciesId === 383 || speciesId === 384) return 1174
  return region === 1 ? 1125 : 1116 // SEQ_GS_VS_NORAPOKE[_KANTO]
}

/** Projection du choix de BGM effectue quand le dernier adversaire tombe. */
export function resolveHgssBattleVictoryMusic(kind: 'wild' | 'trainer', trainerClass?: number): number {
  if (kind === 'wild') return 1129 // SEQ_GS_WIN2
  if (trainerClass !== undefined && frontierBrainClasses.has(trainerClass)) return 1148 // SEQ_GS_WINBRAIN
  if (trainerClass !== undefined && majorVictoryClasses.has(trainerClass)) return 1131 // SEQ_GS_WIN3
  return 1128 // SEQ_GS_WIN1
}
