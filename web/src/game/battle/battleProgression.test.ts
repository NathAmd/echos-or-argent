import { describe, expect, it } from 'vitest'
import { getExperienceForLevel } from '../../rom/pokemon/growthTable'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { applyDefeatedPokemonProgression } from './battleProgression'

function mon(speciesId: number, level: number) {
  const catalog = createPokemonTestCatalog()
  return createCanonicalPokemon(catalog, {
    speciesId, level, rng: createHgssLcrng(speciesId), personality: { kind: 'fixed', value: speciesId }, individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'J', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: level, metTerrain: 0 }, ballId: 4,
  })
}

describe('progression de combat HGSS', () => {
  it('applique EXP, EV, niveau, statistiques, PV et learnset issus du catalogue ROM', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, 5)
    const defeated = mon(155, 20)
    player.experience = getExperienceForLevel(catalog.growthTables[catalog.personalData[152]!.growthRate]!, 6) - 1
    player.currentHp -= 3
    player.moves.pop()
    catalog.personalData[155]!.experienceYield = 100
    catalog.personalData[155]!.evYield.attack = 2
    catalog.levelUpLearnsets[152] = [{ level: 6, moveId: 45 }]
    const hpDeficit = player.stats.hp - player.currentHp

    const result = applyDefeatedPokemonProgression(player, defeated, catalog, false)

    expect(result.experienceGained).toBe(Math.floor(100 * 20 / 7))
    expect(player.level).toBeGreaterThanOrEqual(6)
    expect(player.effortValues.attack).toBe(2)
    expect(player.stats.hp - player.currentHp).toBe(hpDeficit)
    expect(result.levels[0]?.learnedMoveIds).toEqual([45])
  })

  it('respecte les plafonds niveau, EV et quatre capacites sans suppression automatique', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, 100)
    const defeated = mon(155, 100)
    player.effortValues = { hp: 255, attack: 255, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 }
    const moveIds = player.moves.map((move) => move.moveId)

    const result = applyDefeatedPokemonProgression(player, defeated, catalog, true)

    expect(result).toEqual({ experienceGained: 0, levels: [] })
    expect(player.level).toBe(100)
    expect(Object.values(player.effortValues).reduce((sum, value) => sum + value, 0)).toBe(510)
    expect(player.moves.map((move) => move.moveId)).toEqual(moveIds)
  })

  it('signale la capacite a remplacer lorsque les quatre emplacements sont occupes', () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, 5)
    const defeated = mon(155, 20)
    player.moves = [10, 33, 43, 44].map((moveId) => {
      const data = catalog.moves[moveId]!
      return { moveId, pp: data.pp, maxPp: data.pp, ppUps: 0, data }
    })
    player.experience = getExperienceForLevel(catalog.growthTables[0]!, 6) - 1
    catalog.levelUpLearnsets[152] = [{ level: 6, moveId: 45 }]

    const result = applyDefeatedPokemonProgression(player, defeated, catalog, false)

    expect(result.levels[0]).toMatchObject({ learnedMoveIds: [], skippedMoveIds: [45] })
    expect(player.moves.map((move) => move.moveId)).toEqual([10, 33, 43, 44])
  })

  it("divise l'expérience entre les participants d'un combat double sans diviser les EV", () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, 5)
    const defeated = mon(155, 20)
    catalog.personalData[155]!.experienceYield = 98
    catalog.personalData[155]!.evYield.speed = 2

    const result = applyDefeatedPokemonProgression(player, defeated, catalog, true, 2)

    expect(result.experienceGained).toBe(Math.floor(Math.floor(98 * 20 / 7) / 2) * 3 / 2)
    expect(player.effortValues.speed).toBe(2)
  })

  it("reproduit l'ordre de partage et de troncature de battle_command.c", () => {
    const catalog = createPokemonTestCatalog()
    const participant = mon(152, 5)
    const holder = mon(152, 5)
    const defeated = mon(155, 7)
    catalog.personalData[155]!.experienceYield = 65

    const participantResult = applyDefeatedPokemonProgression(participant, defeated, catalog, true, 2, {
      participated: true,
      participantCount: 2,
      expShareCount: 1,
    })
    const holderResult = applyDefeatedPokemonProgression(holder, defeated, catalog, true, 2, {
      participated: false,
      participantCount: 2,
      hasExpShare: true,
      expShareCount: 1,
      holdEffect: 51,
    })

    // total=65, moitie=32, participants=16 puis bonus Dresseur.
    expect(participantResult.experienceGained).toBe(24)
    // Le porteur reçoit l'autre moitié, puis le même bonus Dresseur.
    expect(holderResult.experienceGained).toBe(48)
  })

  it("applique les bonus Œuf Chance et échange après le partage", () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, 5)
    const defeated = mon(155, 7)
    catalog.personalData[155]!.experienceYield = 65

    const result = applyDefeatedPokemonProgression(player, defeated, catalog, true, 1, {
      holdEffect: 66,
      traded: 'foreign-language',
    })

    expect(result.experienceGained).toBe(246)
  })

  it('applique les objets Pouvoir et le Bracelet Macho aux EV avant les plafonds', () => {
    const catalog = createPokemonTestCatalog()
    const defeated = mon(155, 7)
    catalog.personalData[155]!.evYield = { hp: 0, attack: 1, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 }
    const powerHolder = mon(152, 5)
    applyDefeatedPokemonProgression(powerHolder, defeated, catalog, false, 1, { holdEffect: 117, holdEffectParameter: 4 })
    expect(powerHolder.effortValues.attack).toBe(5)
    const machoHolder = mon(152, 5)
    applyDefeatedPokemonProgression(machoHolder, defeated, catalog, false, 1, { holdEffect: 50 })
    expect(machoHolder.effortValues.attack).toBe(2)
  })

  it("applique l'amitié de montée de niveau avec Ball Luxe, lieu et Grelot Zen", () => {
    const catalog = createPokemonTestCatalog()
    const player = mon(152, 5)
    const defeated = mon(155, 20)
    player.experience = getExperienceForLevel(catalog.growthTables[0]!, 6) - 1
    player.friendship = 219
    player.ballId = 11
    catalog.personalData[155]!.experienceYield = 1

    const result = applyDefeatedPokemonProgression(player, defeated, catalog, false, 1, {
      holdEffect: 53,
      currentLocationId: player.origin.metLocation,
    })

    // Palier haut +2, Ball Luxe +1, lieu +1, puis Grelot Zen x1,5.
    expect(result.levels[0]).toMatchObject({ friendshipBefore: 219, friendshipAfter: 225 })
    expect(player.friendship).toBe(225)
  })
})
