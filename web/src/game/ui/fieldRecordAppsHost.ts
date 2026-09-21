import type { GameDigitalEvent } from '../../gameInput'
import type { FieldScriptStep } from '../scripts/fieldScriptProtocol'
import { createUiValueList } from './uiPrimitives'

export type FieldRecordAppsStep = Extract<FieldScriptStep, {
  kind: 'pokeathlonApp' | 'frontierRecordsApp' | 'gameClear'
}>

export type FieldRecordAppKind = 'pokeathlon' | 'frontier-records' | 'game-clear'

export type FieldRecordAppsRunnerPort = Readonly<{
  closePokeathlonApp: () => void
  closeFrontierRecordsApp: () => void
  closeGameClear: () => void
}>

export type FieldRecordAppsRomResources = Readonly<{
  pokeathlonDataMessages: Readonly<Record<number, string>>
}>

export type FieldRecordAppsHost = Readonly<{
  open: (step: FieldRecordAppsStep) => void
  close: () => boolean
  reset: () => void
  isOpen: () => boolean
  getOpenApp: () => FieldRecordAppKind | undefined
  handleDigital: (event: GameDigitalEvent) => boolean
  destroy: () => void
}>

type FieldRecordAppsElements = Readonly<{
  pokeathlon: HTMLElement
  pokeathlonTitle: HTMLElement
  pokeathlonContent: HTMLElement
  frontierRecords: HTMLElement
  frontierRecordsTitle: HTMLElement
  frontierRecordsView: HTMLElement
  frontierRecordsContent: HTMLElement
}>

type FieldRecordAppsPorts = Readonly<{
  createElement: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K]
  readRom: () => FieldRecordAppsRomResources | undefined
  readRunner: () => FieldRecordAppsRunnerPort | undefined
  onAdvance: () => void
  onGameClear: (firstClear: boolean) => void
}>

const pokeathlonTitles = {
  courseRecords: 'Records des parcours',
  medals: 'Médailles',
  eventRecords: 'Records des épreuves',
  overview: 'Données Pokéathlon',
} as const

function getPokeathlonTitle(step: Extract<FieldRecordAppsStep, { kind: 'pokeathlonApp' }>): string {
  return step.app === 'data'
    ? `Données ${step.dataType ?? 0}`
    : pokeathlonTitles[step.app]
}

export function createFieldRecordAppsHost(
  elements: FieldRecordAppsElements,
  ports: FieldRecordAppsPorts,
): FieldRecordAppsHost {
  let openApp: FieldRecordAppKind | undefined

  const getOpenApp = (): FieldRecordAppKind | undefined => openApp
  const isOpen = (): boolean => openApp !== undefined

  const reset = (): void => {
    openApp = undefined
    elements.pokeathlon.hidden = true
    elements.pokeathlonTitle.textContent = ''
    elements.pokeathlonContent.replaceChildren()
    elements.frontierRecords.hidden = true
    elements.frontierRecordsTitle.textContent = ''
    elements.frontierRecordsView.textContent = ''
    elements.frontierRecordsContent.replaceChildren()
    delete elements.frontierRecords.dataset.scriptApp
    delete elements.frontierRecords.dataset.facility
  }

  const renderPokeathlon = (step: Extract<FieldRecordAppsStep, { kind: 'pokeathlonApp' }>): void => {
    const romMessages = ports.readRom()?.pokeathlonDataMessages ?? {}
    elements.pokeathlonTitle.textContent = getPokeathlonTitle(step)

    const points = ports.createElement('p')
    points.className = 'field-pokeathlon-points'
    points.textContent = `${step.athletePoints.toLocaleString('fr-FR')} Points Athlète`

    const displayedRecords = step.rows ?? step.records.map((value, index) => ({
      label: romMessages[index + 4] || `Record ${String(index + 1).padStart(2, '0')}`,
      value,
    }))
    const records = createUiValueList(ports.createElement, 'field-pokeathlon-records', displayedRecords.map((row) => ({
      label: row.label,
      value: String(Math.min(0xffff, row.value)),
    })))
    elements.pokeathlonContent.replaceChildren(points, records)
    elements.pokeathlon.hidden = false
  }

  const renderFrontierRecords = (
    step: Extract<FieldRecordAppsStep, { kind: 'frontierRecordsApp' | 'gameClear' }>,
  ): void => {
    elements.frontierRecords.dataset.scriptApp = step.kind === 'gameClear' ? 'game-clear' : 'frontier-records'
    elements.frontierRecords.dataset.facility = step.page.facility
    elements.frontierRecordsTitle.textContent = step.page.title
    elements.frontierRecordsView.textContent = `${step.page.viewLabel}${step.page.subject ? ` · ${step.page.subject}` : ''}`

    const records = createUiValueList(ports.createElement, 'field-frontier-record-list', step.page.rows.map((row) => ({
      label: row.label,
      value: row.value.toLocaleString('fr-FR'),
      tone: row.tone,
    })))
    elements.frontierRecordsContent.replaceChildren(records)
    elements.frontierRecords.hidden = false
  }

  const open = (step: FieldRecordAppsStep): void => {
    reset()
    if (step.kind === 'pokeathlonApp') {
      openApp = 'pokeathlon'
      renderPokeathlon(step)
      return
    }
    openApp = step.kind === 'gameClear' ? 'game-clear' : 'frontier-records'
    if (step.kind === 'gameClear') ports.onGameClear(step.firstClear)
    renderFrontierRecords(step)
  }

  const close = (): boolean => {
    if (!openApp) return false
    const runner = ports.readRunner()
    if (!runner) return false
    if (openApp === 'pokeathlon') runner.closePokeathlonApp()
    else if (openApp === 'game-clear') runner.closeGameClear()
    else runner.closeFrontierRecordsApp()
    reset()
    ports.onAdvance()
    return true
  }

  const handleDigital = (event: GameDigitalEvent): boolean => {
    if (!openApp || !event.pressed) return false
    if (event.action === 'confirm' || event.action === 'cancel' || event.action === 'menu') close()
    return true
  }

  const pokeathlonClose = elements.pokeathlon.querySelector<HTMLElement>('[data-pokeathlon-close]')
  const frontierRecordsClose = elements.frontierRecords.querySelector<HTMLElement>('[data-frontier-records-close]')
  const handleCloseClick = (): void => { close() }
  pokeathlonClose?.addEventListener('click', handleCloseClick)
  frontierRecordsClose?.addEventListener('click', handleCloseClick)

  reset()
  return Object.freeze({
    open,
    close,
    reset,
    isOpen,
    getOpenApp,
    handleDigital,
    destroy: () => {
      pokeathlonClose?.removeEventListener('click', handleCloseClick)
      frontierRecordsClose?.removeEventListener('click', handleCloseClick)
      reset()
    },
  })
}
