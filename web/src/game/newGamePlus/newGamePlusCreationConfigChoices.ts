import type { RomInventory } from '../../ndsTypes'
import type { NewGamePlusCreationModuleOption } from './newGamePlusCreationController'
import type { NewGamePlusJsonValue } from './newGamePlusTypes'
import { hasCompleteMonotypeStarterSpecies, monotypeModuleId } from './modules/monotypeModule'
import { soloRunModuleId } from './modules/soloRunModule'

type RegisteredCreationModule = Readonly<{
  id: string
  title: string
  description: string
  enabledByDefault: boolean
  defaultConfig: NewGamePlusJsonValue
}>

function moveDefaultFirst(
  choices: readonly Readonly<{ label: string, config: NewGamePlusJsonValue }>[],
  defaultIndex: number,
): readonly Readonly<{ label: string, config: NewGamePlusJsonValue }>[] {
  if (defaultIndex <= 0 || !choices[defaultIndex]) return choices
  return Object.freeze([choices[defaultIndex], ...choices.slice(0, defaultIndex), ...choices.slice(defaultIndex + 1)])
}

function readNumericConfig(value: NewGamePlusJsonValue, key: string): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const selected = (value as { readonly [key: string]: NewGamePlusJsonValue })[key]
  return typeof selected === 'number' ? selected : undefined
}

/** Les libellés viennent de la ROM chargée ; aucun catalogue parallèle n'est inventé. */
export function createNewGamePlusCreationModuleOption(
  module: RegisteredCreationModule,
  inventory: RomInventory,
): NewGamePlusCreationModuleOption {
  let configChoices: readonly Readonly<{ label: string, config: NewGamePlusJsonValue }>[] = Object.freeze([{
    label: 'Configuration standard',
    config: module.defaultConfig,
  }])
  if (module.id === monotypeModuleId) {
    const choices = inventory.pokedexCatalog.typeNames.flatMap((name, typeId) => (
      name && hasCompleteMonotypeStarterSpecies(inventory.pokemonCatalog, typeId)
        ? [{ label: name, config: { typeId } }]
        : []
    ))
    configChoices = moveDefaultFirst(choices, choices.findIndex(({ config }) => (
      readNumericConfig(config, 'typeId') === readNumericConfig(module.defaultConfig, 'typeId')
    )))
  } else if (module.id === soloRunModuleId) {
    const choices = inventory.pokemonCatalog.personalData.flatMap((personal, speciesId) => {
      const name = inventory.pokemonCatalog.speciesNames[speciesId]
      return speciesId >= 1 && speciesId <= 493 && personal && name
        ? [{ label: `${String(speciesId).padStart(3, '0')} · ${name}`, config: { speciesId, form: 0 } }]
        : []
    })
    configChoices = moveDefaultFirst(choices, choices.findIndex(({ config }) => (
      readNumericConfig(config, 'speciesId') === readNumericConfig(module.defaultConfig, 'speciesId')
    )))
  }
  if (configChoices.length === 0) throw new Error(`Le module New Game+ ${module.id} ne possède aucune configuration disponible.`)
  return Object.freeze({
    id: module.id,
    title: module.title,
    description: module.description,
    enabledByDefault: module.enabledByDefault,
    configChoices,
  })
}
