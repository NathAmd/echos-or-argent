import { resolveHgssTimeOfDay as resolveRtcTimeOfDay, type HgssTimeOfDay } from '../time/hgssRtc'

export type HgssDayPhase = 'morning' | 'day' | 'evening' | 'night' | 'late'

export type InGameHudModel = {
  location: string
  region: string
  now: Date
  money: number
  phase: HgssDayPhase
}

export type InGameHudElements = {
  root: HTMLElement
  location: HTMLElement
  region: HTMLElement
  clock: HTMLTimeElement
  phase: HTMLElement
  money: HTMLElement
}

export type InGameHudSnapshot = { visible: false } | ({ visible: true } & InGameHudModel)

const phaseLabels: Readonly<Record<HgssDayPhase, string>> = {
  morning: 'Matin',
  day: 'Jour',
  evening: 'Crépuscule',
  night: 'Nuit',
  late: 'Nuit profonde',
}

export function resolveHgssDayPhase(timeOfDay: HgssTimeOfDay): HgssDayPhase {
  return ['morning', 'day', 'evening', 'night', 'late'][timeOfDay] as HgssDayPhase
}

export const resolveHgssTimeOfDay = resolveRtcTimeOfDay

export function formatHgssClock(now: Date): string {
  return new Intl.DateTimeFormat('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
}

export function formatHgssMoney(money: number): string {
  return `${Math.max(0, Math.trunc(money)).toLocaleString('fr-FR')} ₽`
}

export function renderInGameHud(elements: InGameHudElements, model: InGameHudModel): void {
  const clock = formatHgssClock(model.now)
  elements.location.textContent = model.location
  elements.region.textContent = model.region
  elements.clock.textContent = clock
  elements.clock.dateTime = `${String(model.now.getHours()).padStart(2, '0')}:${String(model.now.getMinutes()).padStart(2, '0')}`
  elements.phase.textContent = phaseLabels[model.phase]
  const formattedMoney = formatHgssMoney(model.money)
  elements.money.textContent = formattedMoney
  elements.root.dataset.dayPhase = model.phase
  elements.root.setAttribute('aria-label', `${model.location}, ${model.region}, ${clock}, ${phaseLabels[model.phase]}, ${formattedMoney}`)
}

export function createInGameHudController(
  elements: InGameHudElements,
  readSnapshot: () => InGameHudSnapshot,
): { update: (force?: boolean) => void } {
  let nextReadAt = 0
  let previousFingerprint = ''
  return {
    update(force = false): void {
      const timestamp = performance.now()
      if (!force && timestamp < nextReadAt) return
      nextReadAt = timestamp + 250
      const snapshot = readSnapshot()
      if (!snapshot.visible) {
        elements.root.hidden = true
        previousFingerprint = 'hidden'
        return
      }
      const fingerprint = [snapshot.location, snapshot.region, snapshot.now.getHours(), snapshot.now.getMinutes(), snapshot.money, snapshot.phase].join('|')
      elements.root.hidden = false
      if (fingerprint === previousFingerprint) return
      previousFingerprint = fingerprint
      renderInGameHud(elements, snapshot)
    },
  }
}
