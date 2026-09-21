import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createFieldScriptRunner, createFieldScriptState, type FieldPokemonRuntime, type FieldScriptStep } from '../scripts/fieldScriptRunner'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

let inventoryPromise: Promise<RomInventory> | undefined
function inventory(): Promise<RomInventory> {
  inventoryPromise ??= readFile(romPath).then((bytes) => readRomInventory(new File([bytes], basename(romPath))))
  return inventoryPromise
}

function runtime(source: RomInventory): FieldPokemonRuntime {
  const rng = createHgssLcrng(0x12345678)
  return {
    catalog: source.pokemonCatalog,
    rng,
    trainer: { id: 0x11223344, name: 'LUTH', gender: 'male' },
    language: 3,
    gameVersion: 7,
    now: () => new Date(2026, 7, 22, 12, 30),
    photoDataCatalog: source.photoDataCatalog,
  }
}

function traceCameron(map: OpeningMapPreview, scriptId: number, state: ReturnType<typeof createFieldScriptState>): Extract<FieldScriptStep, { kind: 'photoCapture' }> {
  const runner = createFieldScriptRunner(map, scriptId, state)
  let capture: Extract<FieldScriptStep, { kind: 'photoCapture' }> | undefined
  for (let index = 0; index < 512; index += 1) {
    const step = runner.resume()
    if (step.kind === 'choice') runner.choose(0)
    if (step.kind === 'photoCapture') {
      capture = step
      runner.finishPhotoCapture?.()
    }
    if (step.kind === 'ended') break
  }
  if (!capture) throw new Error(`Le script Cameron ${map.id}:${scriptId} n'a pas appelé CameronPhoto.`)
  return capture
}

describe('HGSS PhotoAlbum ROM FR probe', () => {
  probe('décode les 93 PhotoData et les points natifs Route 47/48 sans table web', async () => {
    const source = await inventory()
    expect(source.photoDataCatalog).toHaveLength(93)
    expect(Array.from({ length: 12 }, (_, messageId) => source.uiMessageBanks[0]?.[messageId])
      .every((message) => typeof message === 'string' && message.length > 0)).toBe(true)
    expect(source.photoDataCatalog[37]).toEqual({
      id: 37, mapId: 152, iconId: 7, x: 101, z: 339, unk8: 1, unk9: 255,
      subjectSpriteId: 0, parameters: [0, 0],
    })
    expect(source.photoDataCatalog[91]).toEqual({
      id: 91, mapId: 151, iconId: 0, x: 79, z: 371, unk8: 1, unk9: 255,
      subjectSpriteId: 356, parameters: [0, 0],
    })
  }, 30_000)

  probe('exécute les scripts Cameron Route 47 et Route 48 jusqu’aux opcodes 618 puis 615', async () => {
    const source = await inventory()
    const rt47 = runtime(source)
    const state47 = createFieldScriptState('male', 'LUTH', {
      pokemonRuntime: rt47,
      party: [createCanonicalPokemon(source.pokemonCatalog, {
        speciesId: 155, level: 15, rng: rt47.rng, personality: { kind: 'random' }, individualValues: { kind: 'random' },
        originalTrainer: rt47.trainer, origin: { language: 3, gameVersion: 7, metLocation: 151, metLevel: 15, metTerrain: 2 }, ballId: 4,
      })],
      followMonActive: true,
    })
    const route47 = source.resolvedMapCatalog.maps.find(({ id }) => id === 151)
    const route48 = source.resolvedMapCatalog.maps.find(({ id }) => id === 152)
    if (!route47 || !route48) throw new Error('Les cartes ROM Routes 47/48 sont absentes.')
    expect(traceCameron(route47, 5, state47)).toMatchObject({ photoDataId: 91, photo: { mapId: 151, subjectSpriteId: 356 } })

    const rt48 = runtime(source)
    const state48 = createFieldScriptState('male', 'LUTH', { pokemonRuntime: rt48, party: state47.party.members, followMonActive: true })
    expect(traceCameron(route48, 1, state48)).toMatchObject({ photoDataId: 37, photo: { mapId: 152, subjectSpriteId: 0 } })
  }, 30_000)
})
