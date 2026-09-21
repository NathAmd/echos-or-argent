import { describe, expect, it } from 'vitest'
import { hgssBattleAudioSequences } from './hgssBattleAudio'

describe('séquences audio de combat HGSS', () => {
  it('verrouille les identifiants sndseq utilisés par le flux de capture Safari', () => {
    expect(hgssBattleAudioSequences).toEqual({
      trainerVictoryMusic: 1128,
      wildVictoryMusic: 1129,
      captureVictoryMusic: 1129,
      majorTrainerVictoryMusic: 1131,
      frontierBrainVictoryMusic: 1148,
      levelUpFanfare: 1184,
      pokemonCaughtFanfare: 1187,
      printerContinueSound: 1500,
      namingScreenCompleteSound: 1506,
      printerControlSound: 1510,
      ballFallImpactSound: 1510,
      ballFallBounce2Sound: 1511,
      ballFallBounce3Sound: 1512,
      ballFallBounce4Sound: 1513,
      safariBallsOutSound: 1521,
      ballShakeSound: 1533,
      fleeSound: 1791,
      ballOpenSound: 1800,
      ballCaughtSound: 1801,
      throwSound: 1802,
    })
  })
})
