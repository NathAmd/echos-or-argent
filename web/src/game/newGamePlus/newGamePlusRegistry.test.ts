import { describe, expect, it } from 'vitest'
import { createFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { createNewGamePlusRegistry } from './newGamePlusRegistry'
import {
  NewGamePlusApplicationError,
  defineNewGamePlusModule,
} from './newGamePlusTypes'
import {
  carryMoneyModule,
  carryPokedexModule,
  createBuiltInNewGamePlusRegistry,
} from './modules/index'

const sourceMetadata = {
  gameCode: 'IPKF',
  slot: 1 as const,
  playerName: 'LUTH',
  leagueCompletedAt: '2026-08-24T18:30:00.000Z',
}

describe('registre New Game+', () => {
  it('compose plusieurs modules et conserve la source ainsi que la destination', () => {
    const registry = createBuiltInNewGamePlusRegistry()
    const source = createFieldScriptState('male', 'LUTH')
    source.money = 640_000
    source.pokedex.enabled = true
    source.pokedex.nationalDexEnabled = true
    source.pokedex.canDetectForms = true
    source.pokedex.seenSpeciesIds.add(25)
    source.pokedex.caughtSpeciesIds.add(25)
    source.pokedex.caughtShinySpeciesIds.add(25)
    source.pokedex.seenGenders.set(25, ['female'])
    source.pokedex.seenForms.set(25, [0])
    source.pokedex.caughtLanguages.set(25, new Set([3]))
    const destination = createFieldScriptState('female', 'CELESTA')

    const profile = registry.createProfile({
      source: sourceMetadata,
      modules: [
        { id: 'carry-pokedex', config: { includeNationalDex: false } },
        { id: 'carry-money', config: { percentage: 25 } },
      ],
    })
    const restoredProfile = registry.restoreProfile(JSON.parse(JSON.stringify(profile)))
    const result = registry.applyProfile(restoredProfile, source, destination)

    expect(restoredProfile.modules.map(({ id }) => id)).toEqual(['carry-pokedex', 'carry-money'])
    expect(result.money).toBe(160_000)
    expect(result.pokedex).toMatchObject({ enabled: true, nationalDexEnabled: false, canDetectForms: true })
    expect([...result.pokedex.caughtSpeciesIds]).toEqual([25])
    expect([...result.pokedex.caughtShinySpeciesIds]).toEqual([25])
    expect(result.pokedex.seenGenders.get(25)).toEqual(['female'])

    expect(source.money).toBe(640_000)
    expect(source.pokedex.nationalDexEnabled).toBe(true)
    expect(destination.money).toBe(3000)
    expect(destination.pokedex.enabled).toBe(false)
    expect(destination.pokedex.seenSpeciesIds.size).toBe(0)
    expect(result).not.toBe(destination)
    expect(result.pokedex).not.toBe(source.pokedex)

    result.pokedex.seenSpeciesIds.add(150)
    expect(source.pokedex.seenSpeciesIds.has(150)).toBe(false)
  })

  it('emploie les configurations par défaut sans partager leurs objets', () => {
    const registry = createBuiltInNewGamePlusRegistry()
    const first = registry.createProfile({ source: sourceMetadata, modules: [{ id: 'carry-money' }] })
    const second = registry.createProfile({ source: sourceMetadata, modules: [{ id: 'carry-money' }] })

    expect(first.modules[0]?.config).toEqual({ percentage: 100 })
    expect(second.modules[0]?.config).toEqual({ percentage: 100 })
    expect(first.modules[0]?.config).not.toBe(second.modules[0]?.config)
  })

  it('refuse les doublons de registre et de profil', () => {
    expect(() => createNewGamePlusRegistry([carryMoneyModule, carryMoneyModule])).toThrow('enregistré plusieurs fois')

    const registry = createBuiltInNewGamePlusRegistry()
    expect(() => registry.createProfile({
      source: sourceMetadata,
      modules: [{ id: 'carry-money' }, { id: 'carry-money' }],
    })).toThrow('sélectionné plusieurs fois')
  })

  it('refuse les modules absents, les révisions incompatibles et les configurations invalides', () => {
    const registry = createBuiltInNewGamePlusRegistry()
    const valid = registry.createProfile({ source: sourceMetadata, modules: [{ id: 'carry-money' }] })

    expect(() => registry.createProfile({ source: sourceMetadata, modules: [{ id: 'inconnu' }] })).toThrow("n'est pas installé")
    expect(() => registry.restoreProfile({
      ...valid,
      modules: [{ ...valid.modules[0], revision: 2 }],
    })).toThrow('attend la révision 1')
    expect(() => registry.createProfile({
      source: sourceMetadata,
      modules: [{ id: 'carry-money', config: { percentage: 12.5 } }],
    })).toThrow('pourcentage entier')
    expect(() => registry.createProfile({
      source: sourceMetadata,
      modules: [{ id: 'carry-pokedex', config: { includeNationalDex: 'oui' } }],
    })).toThrow('includeNationalDex')
  })

  it('annule toute la transaction lorsqu’un module échoue', () => {
    const mutatingModule = defineNewGamePlusModule({
      id: 'mutation-test', revision: 1, title: 'Mutation', description: 'Module de mutation de test.', createDefaultConfig: () => null, decodeConfig: () => null,
      apply: ({ destination }) => { destination.money = 42 },
    })
    const failingModule = defineNewGamePlusModule({
      id: 'failure-test', revision: 1, title: 'Échec', description: 'Module d’échec de test.', createDefaultConfig: () => null, decodeConfig: () => null,
      apply: () => { throw new Error('échec volontaire') },
    })
    const registry = createNewGamePlusRegistry([mutatingModule, failingModule])
    const profile = registry.createProfile({
      source: sourceMetadata,
      modules: [{ id: 'mutation-test' }, { id: 'failure-test' }],
    })
    const source = createFieldScriptState('male', 'LUTH')
    const destination = createFieldScriptState('female', 'CELESTA')

    expect(() => registry.applyProfile(profile, source, destination)).toThrow(NewGamePlusApplicationError)
    expect(destination.money).toBe(3000)
  })

  it('donne à chaque module une copie source indépendante', () => {
    const hostileModule = defineNewGamePlusModule({
      id: 'hostile-test', revision: 1, title: 'Hostile', description: 'Module hostile de test.', createDefaultConfig: () => null, decodeConfig: () => null,
      apply: ({ source }) => { (source as FieldScriptState).money = 0 },
    })
    const readerModule = defineNewGamePlusModule({
      id: 'reader-test', revision: 1, title: 'Lecture', description: 'Module lecteur de test.', createDefaultConfig: () => null, decodeConfig: () => null,
      apply: ({ source, destination }) => { destination.money = source.money },
    })
    const registry = createNewGamePlusRegistry([hostileModule, readerModule])
    const profile = registry.createProfile({
      source: sourceMetadata,
      modules: [{ id: 'hostile-test' }, { id: 'reader-test' }],
    })
    const source = createFieldScriptState('male', 'LUTH')
    source.money = 123_456

    const result = registry.applyProfile(profile, source, createFieldScriptState('female', 'CELESTA'))

    expect(source.money).toBe(123_456)
    expect(result.money).toBe(123_456)
  })

  it('une sélection vide reste une copie isolée du jeu de base', () => {
    const registry = createBuiltInNewGamePlusRegistry()
    const destination = createFieldScriptState('female', 'CELESTA')
    destination.money = 7777
    destination.flags.add(123)
    const profile = registry.createProfile({ source: sourceMetadata, modules: [] })

    const result = registry.applyProfile(profile, createFieldScriptState('male', 'LUTH'), destination)

    expect(result).toEqual(destination)
    expect(result).not.toBe(destination)
    result.flags.add(456)
    expect(destination.flags.has(456)).toBe(false)
  })

  it('expose les deux modules intégrés avec leurs révisions et valeurs par défaut', () => {
    expect(createNewGamePlusRegistry([carryPokedexModule, carryMoneyModule]).listModules()).toEqual([
      {
        id: 'carry-pokedex', revision: 1, title: 'Conserver le Pokédex',
        description: 'Recopie les espèces, formes et langues enregistrées dans la partie terminée.',
        enabledByDefault: false, defaultConfig: { includeNationalDex: true },
      },
      {
        id: 'carry-money', revision: 1, title: 'Conserver l’argent',
        description: 'Transfère l’argent de la partie terminée (100 % avec le réglage actuel).',
        enabledByDefault: false, defaultConfig: { percentage: 100 },
      },
    ])
  })
})
