import { describe, expect, it } from 'vitest'
import type { HgssTrainer } from './trainerData'
import { calculateHgssMoneyLoss, calculateHgssPayDayPayout, calculateHgssTrainerPrizeMoney, decodeHgssPrizeMoneyTableFromOverlay, hgssPrizeMoneyEntryCount } from './prizeMoney'

function trainer(trainerClass: number, level: number): HgssTrainer {
  return {
    trainerId: 1, trainerType: 0, trainerClass, partySize: 1, items: [0, 0, 0, 0], aiFlags: 0, doubleBattle: false,
    party: [{ difficulty: 0, genderOverride: 0, abilityOverride: 0, level, speciesId: 1, form: 0, capsule: 0 }],
  }
}

describe('argent de combat HGSS', () => {
  it("retrouve et décode les 129 entrées de l'overlay 12", () => {
    const overlay = new Uint8Array(32 + hgssPrizeMoneyEntryCount * 4)
    const view = new DataView(overlay.buffer)
    for (let index = 0; index < hgssPrizeMoneyEntryCount; index += 1) {
      view.setUint16(16 + index * 4, index, true)
      view.setUint16(16 + index * 4 + 2, index < 2 ? 0 : index === 2 || index === 3 ? 4 : index % 51, true)
    }
    expect(decodeHgssPrizeMoneyTableFromOverlay(overlay)).toHaveLength(hgssPrizeMoneyEntryCount)
  })

  it('applique le niveau du dernier Pokémon et le facteur des doubles ordinaires', () => {
    const table = [{ trainerClass: 2, multiplier: 4 }, { trainerClass: 24, multiplier: 15 }]
    expect(calculateHgssTrainerPrizeMoney(trainer(24, 10), table)).toBe(600)
    expect(calculateHgssTrainerPrizeMoney(trainer(24, 10), table, { ordinaryDouble: true })).toBe(1200)
    expect(calculateHgssTrainerPrizeMoney(trainer(250, 10), table)).toBe(160)
  })

  it('plafonne la perte au portefeuille et au huitième badge', () => {
    expect(calculateHgssMoneyLoss([{ level: 25 }, { level: 30 }], 3, 9999)).toBe(1080)
    expect(calculateHgssMoneyLoss([{ level: 100 }], 12, 500)).toBe(500)
  })

  it('multiplie puis plafonne séparément les pièces dispersées par Jackpot', () => {
    expect(calculateHgssPayDayPayout(250, 2)).toBe(500)
    expect(calculateHgssPayDayPayout(40_000, 2)).toBe(65_535)
  })
})
