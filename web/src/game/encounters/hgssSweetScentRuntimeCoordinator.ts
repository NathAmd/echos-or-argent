import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import type { PreparedFieldWildEncounter, PreparedSafariWildEncounter } from './wildEncounterSelection'
import {
  HGSS_SWEET_SCENT_FAILURE_SCRIPT_ID,
  HGSS_SWEET_SCENT_WEATHER_FAILURE_SCRIPT_ID,
  checkHgssSweetScentEncounter,
  prepareHgssSweetScentEncounter,
} from './hgssSweetScentEncounter'

export type HgssSweetScentSource = 'move' | 'honey'

export type HgssSweetScentRuntimeContext = {
  mapId: number
  weatherId: number
  terrainAttribute: number | undefined
  encounters?: HgssWildEncounterData
  eventFlags: ReadonlySet<number>
  hour: number
  rng: HgssLcrng
  prepareContextEncounter?: (method: 'land' | 'surf') => PreparedSafariWildEncounter | undefined
  /** Route native partagée avec les rencontres de pas (roamers et compteurs inclus). */
  prepareForcedEncounter?: (
    check: Extract<ReturnType<typeof checkHgssSweetScentEncounter>, { kind: 'ready' }>,
  ) => PreparedFieldWildEncounter | undefined
}

export type HgssSweetScentRuntimeOptions = {
  readContext: () => HgssSweetScentRuntimeContext | undefined
  consumeHoney: () => boolean
  closeMenu: () => void
  presentAnimation: (source: HgssSweetScentSource) => void | Promise<void>
  dismissAnimation: (successful: boolean) => void | Promise<void>
  presentFailureScript: (scriptId: typeof HGSS_SWEET_SCENT_FAILURE_SCRIPT_ID | typeof HGSS_SWEET_SCENT_WEATHER_FAILURE_SCRIPT_ID) => void
  startEncounter: (prepared: PreparedFieldWildEncounter) => boolean
  persist: () => void
}

export type HgssSweetScentRuntimeCoordinator = {
  use: (source: HgssSweetScentSource) => boolean
  isActive: () => boolean
  close: () => void
}

/** Ordonne consommation, météo, effet, garde de case et combat comme le Task natif partagé. */
export function createHgssSweetScentRuntimeCoordinator(
  options: HgssSweetScentRuntimeOptions,
): HgssSweetScentRuntimeCoordinator {
  let active = false
  let revision = 0
  let weatherTimer: ReturnType<typeof setTimeout> | undefined

  const finishFailure = (scriptId: Parameters<HgssSweetScentRuntimeOptions['presentFailureScript']>[0], activeRevision: number): void => {
    if (!active || revision !== activeRevision) return
    active = false
    options.persist()
    options.presentFailureScript(scriptId)
  }

  const close = (): void => {
    revision += 1
    active = false
    if (weatherTimer !== undefined) clearTimeout(weatherTimer)
    weatherTimer = undefined
  }

  return {
    use(source) {
      if (active) return false
      const context = options.readContext()
      if (!context) return false
      // ItemMenuUseFunc_Honey retire l'objet avant même le premier état du Task.
      if (source === 'honey' && !options.consumeHoney()) return false
      active = true
      const activeRevision = ++revision
      options.closeMenu()
      const check = checkHgssSweetScentEncounter(context)
      if (check.kind === 'weather-blocked') {
        weatherTimer = setTimeout(() => {
          weatherTimer = undefined
          finishFailure(HGSS_SWEET_SCENT_WEATHER_FAILURE_SCRIPT_ID, activeRevision)
        }, hgssVBlanksToMilliseconds(20))
        return true
      }
      void Promise.resolve(options.presentAnimation(source)).then(async () => {
        if (!active || revision !== activeRevision) return
        if (check.kind !== 'ready' || !context.encounters) {
          await options.dismissAnimation(false)
          finishFailure(HGSS_SWEET_SCENT_FAILURE_SCRIPT_ID, activeRevision)
          return
        }
        const prepared = context.prepareForcedEncounter
          ? context.prepareForcedEncounter(check)
          : prepareHgssSweetScentEncounter(
            check, context.encounters, context.hour, context.rng, context.prepareContextEncounter,
          )
        if (!prepared) throw new Error('La rencontre forcée HGSS acceptée n’a produit aucun Pokémon.')
        await options.dismissAnimation(true)
        if (!active || revision !== activeRevision) return
        active = false
        options.persist()
        options.startEncounter(prepared)
      })
      return true
    },
    isActive: () => active,
    close,
  }
}
