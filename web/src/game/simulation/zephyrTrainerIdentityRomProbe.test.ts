import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { createPlayerProfileForRom } from '../../playerProfile'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import {
  createFieldScriptRunner,
  createFieldScriptState,
  setFieldScriptMapState,
  type FieldScriptRunner,
  type FieldScriptStep,
} from '../scripts/fieldScriptRunner'
import { ZEPHYR_BADGE_TARGET } from './johtoJourneyPlanner'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_JOURNEY_PATH ? resolve(process.env.ROM_JOURNEY_PATH) : defaultRomPath
const romProbe = process.env.RUN_ROM_JOURNEY === '1' && existsSync(romPath) ? it : it.skip

function resumeUntilBattleOrEnd(runner: FieldScriptRunner): FieldScriptStep[] {
  const steps: FieldScriptStep[] = []
  for (let index = 0; index < 512; index += 1) {
    const step = runner.resume()
    steps.push(step)
    if (step.kind === 'battle' || step.kind === 'ended') return steps
  }
  throw new Error("Le script d'Albert ne se stabilise pas après 512 étapes.")
}

romProbe("identifie Albert comme le combat 20 même si le Dresseur 47 de la Route 30 est déjà vaincu", async () => {
  const inventory = await readFile(romPath).then((bytes) => readRomInventory(new File([bytes], basename(romPath))))
  const gym = inventory.resolvedMapCatalog.maps.find(({ id }) => id === ZEPHYR_BADGE_TARGET.destinationMapId)
  expect(gym).toBeDefined()
  if (!gym) return
  const leader = gym.events?.objects.find((object) => (
    object.spriteId === ZEPHYR_BADGE_TARGET.leader.spriteId
    && object.scriptId === ZEPHYR_BADGE_TARGET.leader.scriptId
  ))
  expect(leader).toBeDefined()
  if (!leader) return

  const profile = createPlayerProfileForRom(inventory.metadata)
  profile.trainerId = 0x1bad_0020
  const rng = createHgssSessionRng(5_489)
  const state = createFieldScriptState(profile.gender, profile.name, {
    pokemonRuntime: {
      catalog: inventory.pokemonCatalog,
      pokedexCatalog: inventory.pokedexCatalog,
      itemCatalog: inventory.itemCatalog,
      rng: rng.lc,
      mt: rng.mt,
      trainer: { id: profile.trainerId, name: profile.name, gender: profile.gender },
      language: profile.language ?? 3,
      gameVersion: profile.gameVersion ?? 7,
      now: () => new Date(2026, 7, 25, 12, 0, 0),
      trainerCatalog: inventory.trainerCatalog,
      trainerMessages: inventory.trainerMessages,
      trainerClassNames: inventory.trainerClassNames,
    },
  })
  setFieldScriptMapState(state, gym, leader.x - 1, leader.z, 'east')
  state.trainerFlags.add(47)

  const runner = createFieldScriptRunner(gym, leader.scriptId, state, leader.id)
  const beforeBattle = resumeUntilBattleOrEnd(runner)

  expect(beforeBattle.at(-1)).toEqual({
    kind: 'battle',
    battle: {
      kind: 'trainer',
      trainerId: ZEPHYR_BADGE_TARGET.trainerId,
      trainerParameter: 0,
      encounterType: 0,
      battleParameter: 0,
    },
  })
  expect(inventory.trainerCatalog[ZEPHYR_BADGE_TARGET.trainerId]?.party.map(({ speciesId, level }) => (
    `${speciesId}:${level}`
  ))).toEqual(['16:9', '17:13'])

  runner.submitBattleResult(true)
  const afterBattle = resumeUntilBattleOrEnd(runner)

  expect(afterBattle.at(-1)).toEqual({ kind: 'ended' })
  expect(state.badges.has(ZEPHYR_BADGE_TARGET.badgeIndex)).toBe(true)
  expect(state.trainerFlags.has(ZEPHYR_BADGE_TARGET.trainerId)).toBe(false)
  expect(state.trainerFlags).toEqual(new Set([47, 29, 50]))
}, 180_000)
