import type { PokemonCatalog } from '../../ndsTypes'
import { getPokemonBattleStatusPresentation } from '../pokemon/pokemonStatus'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createBattleExperienceDisplay } from './battleExperienceDisplay'
import type { BattleStat, BattleStatStages, HgssAppliedStatus } from './hgssBattleRules'
import type { SimpleBattleSession } from './simpleBattleSession'

export type BattlePokemonStatus = HgssAppliedStatus | number

const battleStageNames: Record<BattleStat, string> = {
  attack: 'ATQ',
  defense: 'DEF',
  speed: 'VIT',
  specialAttack: 'AS',
  specialDefense: 'DS',
  accuracy: 'PRE',
  evasion: 'ESQ',
}

const battleStats = Object.keys(battleStageNames) as BattleStat[]

function battleStageDatasetKey(stat: BattleStat): string {
  return `battleStage${stat[0]!.toUpperCase()}${stat.slice(1)}`
}

function encodeBattlePokemonStatus(status?: BattlePokemonStatus): number {
  if (typeof status === 'number') return status
  if (status === 'sleep') return 0x1
  if (status === 'poison') return 0x8
  if (status === 'badPoison') return 0x80
  if (status === 'burn') return 0x10
  if (status === 'freeze') return 0x20
  if (status === 'paralysis') return 0x40
  return 0
}

export function syncBattleHudPrimaryStatus(hud: HTMLElement, status?: BattlePokemonStatus): void {
  const presentation = getPokemonBattleStatusPresentation(encodeBattlePokemonStatus(status))
  const condition = hud.querySelector<HTMLElement>('.battle-condition')
  if (!condition) return
  condition.textContent = presentation?.shortLabel ?? ''
  condition.hidden = !presentation
  condition.title = presentation?.label ?? ''
  if (presentation) condition.dataset.status = presentation.kind
  else delete condition.dataset.status
}

export function syncBattleStageSummary(hud: HTMLElement, stages: BattleStatStages): void {
  for (const stat of battleStats) hud.dataset[battleStageDatasetKey(stat)] = String(stages[stat])

  const stageLabels = battleStats
    .filter((stat) => stages[stat] !== 0)
    .map((stat) => {
      const value = stages[stat]
      return `${battleStageNames[stat]}${value > 0 ? '+' : ''}${value}`
    })

  let stageSummary = hud.querySelector<HTMLElement>('.battle-stage-summary')
  if (!stageSummary) {
    stageSummary = document.createElement('small')
    stageSummary.className = 'battle-stage-summary'
    hud.append(stageSummary)
  }
  stageSummary.replaceChildren(...stageLabels.map((label) => {
    const badge = document.createElement('span')
    badge.textContent = label
    badge.dataset.tone = label.includes('+') ? 'up' : 'down'
    return badge
  }))
  stageSummary.hidden = stageLabels.length === 0
}

export function applyBattleStagePresentation(hud: HTMLElement, stat: BattleStat, change: number): void {
  const stages = Object.fromEntries(battleStats.map((name) => {
    const value = Number.parseInt(hud.dataset[battleStageDatasetKey(name)] ?? '0', 10)
    return [name, Number.isFinite(value) ? value : 0]
  })) as BattleStatStages
  stages[stat] = Math.max(-6, Math.min(6, stages[stat] + change))
  syncBattleStageSummary(hud, stages)
}

export function setBattleExperienceGaugeElement(
  progressElement: HTMLProgressElement,
  value: number,
  maximum: number,
  levelCap = false,
): void {
  const max = Math.max(1, Math.trunc(maximum))
  const progress = Math.max(0, Math.min(max, Math.trunc(value)))
  progressElement.max = max
  progressElement.value = progress
  progressElement.setAttribute('aria-valuetext', levelCap ? `${max}/${max}` : `${progress}/${max}`)
  const label = progressElement.closest<HTMLElement>('.battle-exp')
  if (label) label.dataset.value = levelCap ? 'MAX' : `${progress}/${max}`
}

/** Met à jour seulement la progression, sans pré-afficher PV, statuts ou stages de fin de tour. */
export function syncBattleProgressionHud(hud: HTMLElement, pokemon: CanonicalPokemon, catalog: PokemonCatalog): void {
  const level = hud.querySelector<HTMLElement>(':scope > div > span:last-child')
  if (level) level.textContent = `Nv.${pokemon.level}`
  const expProgress = hud.querySelector<HTMLProgressElement>('.battle-exp progress')
  if (!expProgress) return
  const experience = createBattleExperienceDisplay(pokemon, catalog)
  setBattleExperienceGaugeElement(expProgress, experience.progress, experience.required, experience.levelCap)
}

/** Synchronise l'état durable d'un HUD sans lire l'étape finale du moteur. */
export function syncBattleConditionHud(
  hud: HTMLElement,
  pokemon: CanonicalPokemon,
  stages: BattleStatStages,
  state?: SimpleBattleSession['player'],
): void {
  const condition = hud.querySelector<HTMLElement>('.battle-condition')
  const status = getPokemonBattleStatusPresentation(pokemon.status)
  if (condition) {
    condition.textContent = status?.shortLabel ?? ''
    condition.hidden = !status
    condition.title = status?.label ?? ''
    if (status) condition.dataset.status = status.kind
    else delete condition.dataset.status
  }
  syncBattleStageSummary(hud, stages)
  let volatileSummary = hud.querySelector<HTMLElement>('.battle-volatile-summary')
  if (!volatileSummary) {
    volatileSummary = document.createElement('small')
    volatileSummary.className = 'battle-volatile-summary'
    hud.append(volatileSummary)
  }
  const volatileLabels = state ? [
    state.volatile.confusionTurns > 0 ? 'CONFUS' : '',
    state.volatile.infatuated ? 'AMOUR' : '',
    state.volatile.seeded ? 'VAMPIGRAINE' : '',
    state.volatile.substituteHp > 0 ? `CLONE ${state.volatile.substituteHp}` : '',
    state.volatile.tauntTurns > 0 ? `PROVOC ${state.volatile.tauntTurns}` : '',
    state.volatile.torment ? 'TOURMENTE' : '',
    state.volatile.encoreTurns > 0 ? `ENCORE ${state.volatile.encoreTurns}` : '',
    state.volatile.disableTurns > 0 ? `ENTRAVE ${state.volatile.disableTurns}` : '',
    state.volatile.healBlockTurns > 0 ? `ANTI-SOIN ${state.volatile.healBlockTurns}` : '',
    state.volatile.trappedTurns > 0 ? `PIEGE ${state.volatile.trappedTurns}` : '',
    state.volatile.perishTurns > 0 ? `REQUIEM ${state.volatile.perishTurns}` : '',
    state.volatile.ingrain ? 'RACINES' : '',
    state.volatile.aquaRing ? 'ANNEAU HYDRO' : '',
    state.volatile.charged ? 'CHARGE' : '',
    state.screens.reflectTurns > 0 ? `REFLET ${state.screens.reflectTurns}` : '',
    state.screens.lightScreenTurns > 0 ? `MUR LUM. ${state.screens.lightScreenTurns}` : '',
    state.screens.safeguardTurns > 0 ? `RUNE PROT. ${state.screens.safeguardTurns}` : '',
    state.screens.tailwindTurns > 0 ? `VENT AR. ${state.screens.tailwindTurns}` : '',
  ].filter(Boolean) : []
  volatileSummary.replaceChildren(...volatileLabels.map((label) => {
    const badge = document.createElement('span')
    badge.textContent = label
    return badge
  }))
  volatileSummary.hidden = volatileLabels.length === 0
}
