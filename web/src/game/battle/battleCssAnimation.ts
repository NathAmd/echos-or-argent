export type BattleCssAnimationFinishReason =
  | 'finished'
  | 'cancelled'
  | 'no-animation'
  | 'reduced-motion'
  | 'superseded'
  | 'cleared'

export type BattleCssAnimationResult = {
  className: string
  generation: number
  animationCount: number
  reason: BattleCssAnimationFinishReason
}

export type BattleCssAnimationOptions = {
  /** Force ou neutralise le mode mouvement réduit. Par défaut, suit le média système. */
  reducedMotion?: boolean
  /** Conserve la classe après la terminaison de cette génération. */
  persist?: boolean
  /** Appelé uniquement pour la génération encore courante, jamais après un clear ou un remplacement. */
  onFinish?: (result: BattleCssAnimationResult) => void
}

export type BattleCssAnimationRun = {
  generation: number
  finished: Promise<BattleCssAnimationResult>
  /** Annule les lecteurs de cette génération et notifie onFinish une seule fois. */
  cancel: () => void
}

export type ClearBattleCssAnimationsOptions = {
  /** Annule aussi les animations non créées par cet utilitaire dans le sous-arbre. */
  cancelSubtreeAnimations?: boolean
}

type BattleCssAnimationState = {
  animations: readonly Animation[]
  className: string
  element: HTMLElement
  generation: number
  persist: boolean
  settled: boolean
  sawAnimationCancel: boolean
  onFinish?: (result: BattleCssAnimationResult) => void
  removeCancelListener: () => void
  resolve: (result: BattleCssAnimationResult) => void
}

const activeAnimations = new WeakMap<HTMLElement, Map<string, BattleCssAnimationState>>()
const animationGenerations = new WeakMap<HTMLElement, Map<string, number>>()

function animationMap(element: HTMLElement): Map<string, BattleCssAnimationState> {
  let states = activeAnimations.get(element)
  if (!states) {
    states = new Map()
    activeAnimations.set(element, states)
  }
  return states
}

function nextGeneration(element: HTMLElement, className: string): number {
  let generations = animationGenerations.get(element)
  if (!generations) {
    generations = new Map()
    animationGenerations.set(element, generations)
  }
  const generation = (generations.get(className) ?? 0) + 1
  generations.set(className, generation)
  return generation
}

function getSubtreeAnimations(element: HTMLElement): Animation[] {
  if (typeof element.getAnimations !== 'function') return []
  try {
    return element.getAnimations({ subtree: true })
  } catch {
    // Safari plus ancien expose getAnimations sans accepter l'option subtree.
    const animations = new Set<Animation>()
    const collect = (target: HTMLElement): void => {
      if (typeof target.getAnimations !== 'function') return
      try { for (const animation of target.getAnimations()) animations.add(animation) } catch { /* lecteur détaché */ }
    }
    collect(element)
    try { element.querySelectorAll<HTMLElement>('*').forEach(collect) } catch { /* host DOM incomplet */ }
    return [...animations]
  }
}

function cancelAnimation(animation: Animation): void {
  try { void animation.finished.catch(() => undefined) } catch { /* lecteur sans finished exploitable */ }
  try { animation.cancel() } catch { /* lecteur déjà détaché */ }
}

function cancelStateAnimations(state: BattleCssAnimationState): void {
  for (const animation of state.animations) cancelAnimation(animation)
}

function isReducedMotionRequested(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit
  const runtime = globalThis as typeof globalThis & {
    matchMedia?: (query: string) => { matches: boolean }
  }
  // Certains moteurs WebKit exigent que `matchMedia` conserve Window comme
  // receveur. Extraire la méthode avant de l'appeler provoquait alors une
  // Illegal invocation et interrompait toute l'introduction du combat.
  try {
    return runtime.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

function isCurrent(state: BattleCssAnimationState): boolean {
  return activeAnimations.get(state.element)?.get(state.className) === state
}

function removeCurrentState(state: BattleCssAnimationState): void {
  const states = activeAnimations.get(state.element)
  if (states?.get(state.className) !== state) return
  states.delete(state.className)
  if (states.size === 0) activeAnimations.delete(state.element)
}

function settleState(
  state: BattleCssAnimationState,
  reason: BattleCssAnimationFinishReason,
  options: { forceRemoveClass?: boolean, notify?: boolean } = {},
): void {
  if (state.settled) return
  state.settled = true
  state.removeCancelListener()
  const current = isCurrent(state)
  const removeClass = options.forceRemoveClass || !state.persist
  if (current && removeClass) state.element.classList.remove(state.className)
  if (current && removeClass) removeCurrentState(state)
  const result: BattleCssAnimationResult = {
    className: state.className,
    generation: state.generation,
    animationCount: state.animations.length,
    reason,
  }
  state.resolve(result)
  if (current && options.notify !== false) state.onFinish?.(result)
}

function clearState(state: BattleCssAnimationState, reason: 'cleared' | 'superseded'): void {
  cancelStateAnimations(state)
  state.element.classList.remove(state.className)
  if (!state.settled) settleState(state, reason, { forceRemoveClass: true, notify: false })
  else {
    state.removeCancelListener()
    removeCurrentState(state)
  }
}

function animationName(animation: Animation): string | undefined {
  const candidate = animation as Animation & { animationName?: unknown }
  return typeof candidate.animationName === 'string' ? candidate.animationName : undefined
}

/**
 * Relance une classe d'animation et attend tous les nouveaux lecteurs WAAPI du
 * sous-arbre. Les animations ambiantes déjà actives sont volontairement
 * exclues afin qu'une boucle idle ne bloque jamais une présentation ponctuelle.
 */
export function restartBattleCssAnimation(
  element: HTMLElement,
  className: string,
  options: BattleCssAnimationOptions = {},
): BattleCssAnimationRun {
  let states = animationMap(element)
  const previous = states.get(className)
  if (previous) clearState(previous, 'superseded')

  element.classList.remove(className)
  void element.offsetWidth
  const existing = new Set(getSubtreeAnimations(element))
  element.classList.add(className)
  void element.offsetWidth
  const animations = [...new Set(getSubtreeAnimations(element).filter((animation) => !existing.has(animation)))]
  const generation = nextGeneration(element, className)
  // clearState supprime la dernière map vide du WeakMap : rattacher la map de
  // la nouvelle génération avant que ses callbacks asynchrones ne la lisent.
  states = animationMap(element)

  let resolveFinished!: (result: BattleCssAnimationResult) => void
  const finished = new Promise<BattleCssAnimationResult>((resolve) => { resolveFinished = resolve })
  const names = new Set(animations.flatMap((animation) => animationName(animation) ?? []))
  const state: BattleCssAnimationState = {
    animations,
    className,
    element,
    generation,
    persist: options.persist ?? false,
    settled: false,
    sawAnimationCancel: false,
    onFinish: options.onFinish,
    removeCancelListener: () => undefined,
    resolve: resolveFinished,
  }
  const onAnimationCancel = (event: Event): void => {
    if (!isCurrent(state)) return
    const cancelledName = (event as AnimationEvent).animationName
    if (names.size === 0 || names.has(cancelledName)) state.sawAnimationCancel = true
  }
  element.addEventListener('animationcancel', onAnimationCancel, true)
  state.removeCancelListener = () => element.removeEventListener('animationcancel', onAnimationCancel, true)
  states.set(className, state)

  const terminalPromises = animations.map((animation) => {
    try { return Promise.resolve(animation.finished) } catch { return Promise.resolve() }
  })
  const reducedMotion = isReducedMotionRequested(options.reducedMotion)
  if (reducedMotion) {
    // Attacher les handlers avant cancel évite tout rejet AbortError orphelin.
    void Promise.allSettled(terminalPromises)
    cancelStateAnimations(state)
    queueMicrotask(() => settleState(state, 'reduced-motion'))
  } else if (animations.length === 0) {
    queueMicrotask(() => settleState(state, 'no-animation'))
  } else {
    void Promise.allSettled(terminalPromises).then((results) => {
      const cancelled = state.sawAnimationCancel || results.some((result) => result.status === 'rejected')
      settleState(state, cancelled ? 'cancelled' : 'finished')
    })
  }

  return {
    generation,
    finished,
    cancel: () => {
      if (state.settled) {
        if (isCurrent(state)) clearState(state, 'cleared')
        return
      }
      cancelStateAnimations(state)
      settleState(state, 'cancelled', { forceRemoveClass: true })
    },
  }
}

/** Annule une classe suivie sans déclencher son callback onFinish. */
export function clearBattleCssAnimation(element: HTMLElement, className: string): void {
  const state = activeAnimations.get(element)?.get(className)
  if (state) clearState(state, 'cleared')
  else element.classList.remove(className)
}

/**
 * Nettoie toutes les classes suivies sur un élément. Par défaut, annule aussi
 * les lecteurs non suivis du sous-arbre : ce mode convient au recyclage d'un
 * host de Pokémon entre deux occupants ou deux scènes.
 */
export function clearBattleCssAnimations(
  element: HTMLElement,
  options: ClearBattleCssAnimationsOptions = {},
): void {
  const states = [...(activeAnimations.get(element)?.values() ?? [])]
  for (const state of states) clearState(state, 'cleared')
  if (options.cancelSubtreeAnimations ?? true) {
    for (const animation of getSubtreeAnimations(element)) cancelAnimation(animation)
  }
}
