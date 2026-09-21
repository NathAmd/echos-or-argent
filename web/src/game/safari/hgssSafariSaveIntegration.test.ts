import { describe, expect, it } from 'vitest'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createHgssSaveState, parseHgssSaveStateV1, restoreHgssSaveState } from '../save/hgssSaveState'
import { placeHgssSafariObject, setHgssSafariObjectUnlockLevel, startHgssSafariSession } from './hgssSafariState'
import { recordHgssSafariIgtReference, registerHgssBaobaContact, setHgssBaobaQuestStage } from './hgssSafariProgression'

const profile = { gender: 'male', name: 'JO', trainerId: 0x12345678, language: 3, gameVersion: 7 } as const
const world = { mapId: 524, tileX: 8, tileZ: 12, direction: 'south' } as const

describe('HGSS Safari save integration', () => {
  it('deeply snapshots and restores the complete Safari state and Baoba progression', () => {
    const rng = createHgssSessionRng(11)
    const field = createFieldScriptState('male', 'JO')
    field.safariZone = setHgssSafariObjectUnlockLevel(field.safariZone, 2)
    field.safariZone = placeHgssSafariObject(field.safariZone, 0, 0, { objectId: 7, x: 10, y: 2, z: 14 })
    field.safariZone.areaSets[0].areaLevels[0] = 70
    field.safariZone = startHgssSafariSession(field.safariZone, 0)
    field.safariProgression = registerHgssBaobaContact(field.safariProgression)
    field.safariProgression = setHgssBaobaQuestStage(field.safariProgression, 6)
    field.safariProgression = recordHgssSafariIgtReference(field.safariProgression, 1_234)
    field.variables.set(0x4057, 6)
    field.phoneContacts.add(24)

    const saved = createHgssSaveState('IPKF', profile, rng, world, field)
    field.safariZone.areaSets[0].areas[0]!.placements[0]!.x = 99
    const restored = restoreHgssSaveState(
      JSON.parse(JSON.stringify(saved)),
      'IPKF',
      createPokemonTestCatalog(),
      () => new Date(2026, 7, 22),
    )

    expect(restored.field.safariZone).toMatchObject({
      schemaVersion: 1,
      activeAreaSet: 0,
      objectUnlockLevel: 2,
      session: { active: true, balls: 30 },
    })
    expect(restored.field.safariZone.areaSets[0].areas[0]!.placements[0]).toEqual({ objectId: 7, x: 10, y: 2, z: 14 })
    expect(restored.field.safariZone.areaSets[0].areaLevels[0]).toBe(70)
    expect(restored.field.safariProgression).toEqual({
      schemaVersion: 1,
      baobaContactRegistered: true,
      baobaQuestStage: 6,
      baobaIgtReferenceMinutes: 1_234,
      pendingEncounterAreaIds: [],
    })
  })

  it('migrates the legacy active/areaSet/balls/steps payload and native Baoba sources', () => {
    const rng = createHgssSessionRng(12)
    const saved = createHgssSaveState('IPKF', profile, rng, world, createFieldScriptState('male', 'JO'))
    saved.field.safariZone = { active: true, areaSet: 0, balls: 12, steps: 65_535 }
    delete saved.field.safariProgression
    saved.field.variables.push([0x4057, 5])
    saved.field.phoneContacts.push(24)

    const restored = restoreHgssSaveState(saved, 'IPKF', createPokemonTestCatalog(), () => new Date())

    expect(restored.field.safariZone).toMatchObject({
      schemaVersion: 1,
      activeAreaSet: 0,
      session: { active: true, balls: 12 },
    })
    expect(restored.field.safariZone.areaSets).toHaveLength(2)
    expect(restored.field.safariZone.areaSets[0].areas).toHaveLength(6)
    expect(restored.field.safariZone).not.toHaveProperty('steps')
    expect(restored.field.safariProgression).toMatchObject({ baobaContactRegistered: true, baobaQuestStage: 5 })
  })

  it('répare les sources natives absentes depuis le miroir Safari sauvegardé', () => {
    const rng = createHgssSessionRng(15)
    const field = createFieldScriptState('male', 'JO')
    field.safariProgression = registerHgssBaobaContact(field.safariProgression)
    field.safariProgression = setHgssBaobaQuestStage(field.safariProgression, 3)
    field.safariProgression = recordHgssSafariIgtReference(field.safariProgression, 700)
    const saved = createHgssSaveState('IPKF', profile, rng, world, field)

    const restored = restoreHgssSaveState(saved, 'IPKF', createPokemonTestCatalog(), () => new Date())

    expect(restored.field.variables.get(0x4057)).toBe(3)
    expect(restored.field.phoneContacts.has(24)).toBe(true)
    expect(restored.field.safariProgression).toMatchObject({
      baobaContactRegistered: true,
      baobaQuestStage: 3,
      baobaIgtReferenceMinutes: 700,
    })
  })

  it('rejects malformed nested Safari placements with an exact path', () => {
    const rng = createHgssSessionRng(13)
    const saved = createHgssSaveState('IPKF', profile, rng, world, createFieldScriptState('male', 'JO'))
    if (!saved.field.safariZone || !('schemaVersion' in saved.field.safariZone)) throw new Error('État Safari moderne attendu.')
    saved.field.safariZone = placeHgssSafariObject(saved.field.safariZone, 0, 0, { objectId: 0, x: 1, y: 2, z: 3 })
    saved.field.safariZone.areaSets[0].areas[0]!.placements[0]!.x = 256

    expect(() => restoreHgssSaveState(saved, 'IPKF', createPokemonTestCatalog(), () => new Date()))
      .toThrow('field.safariZone.areaSets[0].areas[0].placements[0].x')
  })

  it('rejette une date civile impossible et une file d’annonce dupliquée', () => {
    const rng = createHgssSessionRng(14)
    const saved = createHgssSaveState('IPKF', profile, rng, world, createFieldScriptState('male', 'JO'))
    if (!saved.field.safariProgression) throw new Error('Progression Safari attendue.')
    saved.field.safariProgression.lastAreaUpdateDay = '2026-2-31'
    expect(() => restoreHgssSaveState(saved, 'IPKF', createPokemonTestCatalog(), () => new Date()))
      .toThrow('field.safariProgression.lastAreaUpdateDay')

    saved.field.safariProgression.lastAreaUpdateDay = '2026-8-22'
    saved.field.safariProgression.pendingEncounterAreaIds = [2, 2]
    expect(() => restoreHgssSaveState(saved, 'IPKF', createPokemonTestCatalog(), () => new Date()))
      .toThrow('field.safariProgression.pendingEncounterAreaIds')
  })

  it('ne rend portable un nom de meneur Safari que si sa provenance utilisateur est explicite', () => {
    const rng = createHgssSessionRng(16)
    const field = createFieldScriptState('male', 'JO')
    field.safariZone.linkLeader.name = 'AMBIGU'
    const ambiguous = createHgssSaveState('IPKF', profile, rng, world, field)
    if (!ambiguous.field.safariZone || !('linkLeader' in ambiguous.field.safariZone)) throw new Error('État Safari moderne attendu.')
    expect(ambiguous.field.safariZone.linkLeader.name).toBe('')
    expect(ambiguous.field.safariZone.linkLeader.nameSource).toBeUndefined()

    field.safariZone.linkLeader.name = 'AMI'
    field.safariZone.linkLeader.nameSource = 'user-text'
    const attested = createHgssSaveState('IPKF', profile, rng, world, field)
    if (!attested.field.safariZone || !('linkLeader' in attested.field.safariZone)) throw new Error('État Safari moderne attendu.')
    expect(attested.field.safariZone.linkLeader).toMatchObject({ name: 'AMI', nameSource: 'user-text' })
    delete attested.field.safariZone.linkLeader.nameSource
    expect(() => parseHgssSaveStateV1(attested)).toThrow('pas attesté utilisateur')
  })

  it('migre le nom legacy du meneur lié comme profil joueur distant', () => {
    const rng = createHgssSessionRng(17)
    const legacy = createHgssSaveState('IPKF', profile, rng, world, createFieldScriptState('male', 'JO'))
    if (!legacy.field.safariZone || !('linkLeader' in legacy.field.safariZone)) throw new Error('État Safari moderne attendu.')
    Object.assign(legacy.field.safariZone.linkLeader, {
      linked: true, trainerId: 77, name: 'DISTANT', gender: 'female', language: 3, gameVersion: 7,
    })
    delete legacy.field.safariZone.linkLeader.nameSource

    const restoredLegacy = restoreHgssSaveState(legacy, 'IPKF', createPokemonTestCatalog(), () => new Date())
    expect(restoredLegacy.field.safariZone.linkLeader).toMatchObject({ name: 'DISTANT', nameSource: 'user-text' })
    const canonical = createHgssSaveState(
      'IPKF', restoredLegacy.profile, restoredLegacy.rng, restoredLegacy.world, restoredLegacy.field,
    )
    expect(() => parseHgssSaveStateV1(canonical)).not.toThrow()
    const restoredCanonical = restoreHgssSaveState(canonical, 'IPKF', createPokemonTestCatalog(), () => new Date())
    expect(restoredCanonical.field.safariZone.linkLeader).toMatchObject({ name: 'DISTANT', trainerId: 77 })
  })
})
