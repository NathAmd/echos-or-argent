export interface BattleGaugeElements {
  playerHp: HTMLProgressElement
  opponentHp: HTMLProgressElement
  playerHpText: HTMLElement
  playerExp: HTMLProgressElement
  playerLevel: HTMLElement
}

export interface BattleGaugeSnapshot {
  playerHp: { value: number, maximum: number }
  opponentHp: { value: number, maximum: number }
  playerHpText: string
  playerExp: { value: number, maximum: number, ariaValueText: string | null, labelValue?: string }
  playerLevel: string
}

export function captureBattleGaugePresentation(elements: BattleGaugeElements): BattleGaugeSnapshot {
  return {
    playerHp: { value: elements.playerHp.value, maximum: elements.playerHp.max },
    opponentHp: { value: elements.opponentHp.value, maximum: elements.opponentHp.max },
    playerHpText: elements.playerHpText.textContent ?? '',
    playerExp: {
      value: elements.playerExp.value,
      maximum: elements.playerExp.max,
      ariaValueText: elements.playerExp.getAttribute('aria-valuetext'),
      labelValue: elements.playerExp.closest<HTMLElement>('.battle-exp')?.dataset.value,
    },
    playerLevel: elements.playerLevel.textContent ?? '',
  }
}

export function restoreBattleGaugePresentation(
  snapshot: BattleGaugeSnapshot,
  elements: BattleGaugeElements,
  syncHpZone: (progress: HTMLProgressElement) => void,
): void {
  elements.playerHp.max = snapshot.playerHp.maximum
  elements.playerHp.value = snapshot.playerHp.value
  elements.opponentHp.max = snapshot.opponentHp.maximum
  elements.opponentHp.value = snapshot.opponentHp.value
  elements.playerHpText.textContent = snapshot.playerHpText
  elements.playerExp.max = snapshot.playerExp.maximum
  elements.playerExp.value = snapshot.playerExp.value
  elements.playerLevel.textContent = snapshot.playerLevel
  if (snapshot.playerExp.ariaValueText === null) elements.playerExp.removeAttribute('aria-valuetext')
  else elements.playerExp.setAttribute('aria-valuetext', snapshot.playerExp.ariaValueText)
  const label = elements.playerExp.closest<HTMLElement>('.battle-exp')
  if (label && snapshot.playerExp.labelValue === undefined) delete label.dataset.value
  else if (label) label.dataset.value = snapshot.playerExp.labelValue
  syncHpZone(elements.playerHp)
  syncHpZone(elements.opponentHp)
}

export function resolveBattleGaugeTarget(from: number, maximum: number, amount: number): number {
  return Math.max(0, Math.min(maximum, from + amount))
}

export function resolveBattleGaugeAnimationTiming(
  from: number,
  to: number,
  maximum: number,
  reducedMotion = false,
): { duration: number, steps: number } {
  if (reducedMotion || from === to) return { duration: 0, steps: 1 }
  const distance = Math.abs(to - from)
  const ratio = Math.min(1, distance / Math.max(1, maximum))
  return {
    // Un petit soin ne doit pas sembler aussi lent qu'une barre vidée entière.
    duration: Math.round(180 + ratio * 420),
    // Une valeur par PV pour les petits écarts, limitée au rythme d'un écran 60 Hz.
    steps: Math.max(1, Math.min(36, Math.ceil(distance))),
  }
}

export function sampleSteppedBattleGauge(from: number, to: number, ratio: number, steps = 12): number {
  const boundedRatio = Math.max(0, Math.min(1, ratio))
  const steppedRatio = boundedRatio === 1 ? 1 : Math.floor(boundedRatio * steps) / steps
  return Math.round(from + (to - from) * steppedRatio)
}

export function animateSteppedBattleGauge(
  from: number,
  to: number,
  duration: number,
  render: (value: number) => void,
  isCurrent: () => boolean = () => true,
  steps = 12,
): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = performance.now()
    const update = (now: number) => {
      if (!isCurrent()) { resolve(); return }
      const ratio = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration)
      render(sampleSteppedBattleGauge(from, to, ratio, steps))
      if (ratio < 1) window.requestAnimationFrame(update)
      else resolve()
    }
    window.requestAnimationFrame(update)
  })
}
