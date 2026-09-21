import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createHgssSafariBattleState } from '../safari/hgssSafariBattle'
import { createSafariBattleController, moveHgssSafariCommandCursor, resolveHgssSafariCommandLayoutSlot } from './safariBattleController'

const battleCss = readFileSync(new URL('../../styles/battle.css', import.meta.url), 'utf8')

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly children: TestElement[] = []
  readonly dataset: Record<string, string> = {}
  className = ''
  disabled = false
  hidden = false
  parentElement?: TestElement
  tabIndex = 0
  textContent = ''
  type = ''
  readonly classList = {
    add: (...tokens: string[]) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...tokens])].join(' ') },
    remove: (...tokens: string[]) => { this.className = this.className.split(/\s+/).filter((token) => token && !tokens.includes(token)).join(' ') },
  }

  append(...children: TestElement[]): void {
    children.forEach((child) => { child.parentElement = this; this.children.push(child) })
  }

  replaceChildren(...children: TestElement[]): void {
    this.children.forEach((child) => { child.parentElement = undefined })
    this.children.splice(0)
    this.append(...children)
  }

  querySelector<T = TestElement>(selector: string): T | null {
    return (this.querySelectorAll(selector)[0] ?? null) as T | null
  }

  querySelectorAll<T = TestElement>(selector: string): T[] {
    const matches: TestElement[] = []
    const visit = (root: TestElement): void => root.children.forEach((child) => {
      if ((selector === '.battle-stage' && child.className === 'battle-stage')
        || (selector === 'button' && child.type === 'button')
        || (selector === 'button:not(:disabled)' && child.type === 'button' && !child.disabled)
        || (selector === '[data-battle-control="confirm"]' && child.dataset.battleControl === 'confirm')) matches.push(child)
      visit(child)
    })
    visit(this)
    return matches as unknown as T[]
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  focus(): void {}
  remove(): void {
    if (!this.parentElement) return
    const index = this.parentElement.children.indexOf(this)
    if (index >= 0) this.parentElement.children.splice(index, 1)
    this.parentElement = undefined
  }
}

function createControllerFixture() {
  const screen = new TestElement()
  const stage = new TestElement()
  const confirm = new TestElement()
  stage.className = 'battle-stage'
  confirm.type = 'button'
  confirm.dataset.battleControl = 'confirm'
  screen.append(stage, confirm)
  return {
    screen,
    confirm,
    message: new TestElement(),
    commands: new TestElement(),
    moves: new TestElement(),
  }
}

function caughtSafariState() {
  const catalog = createPokemonTestCatalog()
  catalog.personalData[74]!.catchRate = 255
  const opponent = createCanonicalPokemon(catalog, {
    speciesId: 74,
    level: 17,
    rng: createHgssLcrng(1),
    personality: { kind: 'fixed', value: 74 },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 202, metLevel: 17, metTerrain: 0 },
    ballId: 5,
  })
  opponent.currentHp = 1
  return { catalog, state: createHgssSafariBattleState(opponent, 30) }
}

async function drainSafariPresentation(): Promise<void> {
  for (let pass = 0; pass < 4; pass += 1) {
    await vi.runAllTimersAsync()
    await Promise.resolve()
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('navigation des commandes Safari', () => {
  it('suit les voisins de l’arc réellement affiché au lieu de la grille DS cachée', () => {
    const directions = ['left', 'right', 'up', 'down'] as const
    expect(directions.map((action) => moveHgssSafariCommandCursor(0, action))).toEqual([1, 1, 3, 1])
    expect(directions.map((action) => moveHgssSafariCommandCursor(1, action))).toEqual([0, 0, 0, 2])
    expect(directions.map((action) => moveHgssSafariCommandCursor(2, action))).toEqual([0, 0, 1, 3])
    expect(directions.map((action) => moveHgssSafariCommandCursor(3, action))).toEqual([0, 0, 2, 0])
  })

  it('saute un emplacement désactivé sans changer les voisins visuels restants', () => {
    expect(moveHgssSafariCommandCursor(0, 'right', [true, false, true, true])).toBe(2)
    expect(moveHgssSafariCommandCursor(2, 'up', [true, false, true, true])).toBe(0)
  })

  it('réutilise les quatre emplacements de l’arc de combat global', () => {
    expect((['ball', 'bait', 'mud', 'run'] as const).map(resolveHgssSafariCommandLayoutSlot)).toEqual([
      'fight', 'bag', 'party', 'run',
    ])
  })

  it('place le compteur de Safari Balls au-dessus de la scène au lieu de le laisser dans le flux invisible', () => {
    const rule = battleCss.match(/\.battle-screen:not\(\[hidden\]\) \.battle-safari-balls \{([^}]*)\}/)?.[1]
    expect(rule).toContain('position: absolute;')
    expect(rule).toContain('z-index: 10;')
    expect(rule).toContain('top: 3%;')
    expect(rule).toContain('right: 3%;')
  })

  it('signale un veto Safari sans RNG, consommation de Ball ni changement d etat', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { createElement: () => new TestElement() })
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    const fixture = createControllerFixture()
    const controller = createSafariBattleController(fixture as unknown as Parameters<typeof createSafariBattleController>[0])
    const { catalog, state } = caughtSafariState()
    const rng = { getSeed: () => 0, nextU16: vi.fn(() => 0) }
    const veto = { code: 'challenge.safari-ball-disabled', reason: 'Capture deja tentee.' }
    const onStateChange = vi.fn()
    const onActionVeto = vi.fn()
    controller.start({
      state,
      context: { catalog, rng, hasStorageSpace: true },
      actionPolicy: { vetoPlayerAction: () => veto },
      names: { playerName: 'JO', opponentName: 'RACAILLOU', safariBallName: 'SAFARI BALL' },
      messages: { 950: 'BALLS', 951: '{0}', 965: 'APPARITION', 927: 'FUITE', 931: 'BALL', 932: 'APPAT', 933: 'BOUE' },
      onStateChange,
      onActionVeto,
      onFinish: () => undefined,
    })
    await drainSafariPresentation()

    controller.handle('confirm')

    expect(onActionVeto).toHaveBeenCalledWith(veto, 'ball', state)
    expect(onStateChange).not.toHaveBeenCalled()
    expect(rng.nextU16).not.toHaveBeenCalled()
    expect(controller.getState()).toBe(state)
    expect(state).toMatchObject({ ballsRemaining: 30, turnCount: 0, outcome: 'active' })
    expect(fixture.commands.hidden).toBe(false)
  })

  it('un appui termine immédiatement le délai de la phase courante', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { createElement: () => new TestElement() })
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    const fixture = createControllerFixture()
    const controller = createSafariBattleController(fixture as unknown as Parameters<typeof createSafariBattleController>[0])
    const { catalog, state } = caughtSafariState()
    controller.start({
      state,
      context: { catalog, rng: { getSeed: () => 0, nextU16: () => 0 }, hasStorageSpace: true },
      names: { playerName: 'JO', opponentName: 'RACAILLOU', safariBallName: 'SAFARI BALL' },
      messages: { 950: 'BALLS', 951: '{0}', 965: 'APPARITION\r', 927: 'FUITE', 931: 'BALL', 932: 'APPAT', 933: 'BOUE' },
      onStateChange: () => undefined,
      onFinish: () => undefined,
    })
    expect(fixture.message.hidden).toBe(true)
    controller.handle('confirm')
    await Promise.resolve()
    expect(fixture.message.textContent).toBe('APPARITION')
    expect(vi.getTimerCount()).toBeLessThan(2)
  })

  it('ne route jamais les micro-tâches d’une ancienne entrée vers les nouvelles options', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { createElement: () => new TestElement() })
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    const fixture = createControllerFixture()
    const controller = createSafariBattleController(fixture as unknown as Parameters<typeof createSafariBattleController>[0])
    const { catalog, state } = caughtSafariState()
    const oldAnimation = vi.fn()
    const oldCue = vi.fn()
    const newAnimation = vi.fn()
    const newCue = vi.fn()
    const start = (onAnimation: typeof oldAnimation, onSceneCue: typeof oldCue) => controller.start({
      state,
      context: { catalog, rng: { getSeed: () => 0, nextU16: () => 0 }, hasStorageSpace: true },
      names: { playerName: 'JO', opponentName: 'RACAILLOU', safariBallName: 'SAFARI BALL' },
      messages: { 950: 'BALLS', 951: '{0}', 965: 'APPARITION', 927: 'FUITE', 931: 'BALL', 932: 'APPAT', 933: 'BOUE' },
      onStateChange: () => undefined,
      onAnimation,
      onSceneCue,
      onFinish: () => undefined,
    })

    start(oldAnimation, oldCue)
    controller.handle('confirm')
    controller.close()
    start(newAnimation, newCue)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()

    expect(oldAnimation).not.toHaveBeenCalled()
    expect(oldCue).not.toHaveBeenCalled()
    expect(newAnimation).toHaveBeenCalledOnce()
    expect(newCue).not.toHaveBeenCalled()
  })

  it('enchaîne les printers, contrôles audio et délais de capture dans leur cadence ROM', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { createElement: () => new TestElement() })
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    const fixture = createControllerFixture()
    const controller = createSafariBattleController(fixture as unknown as Parameters<typeof createSafariBattleController>[0])
    const { catalog, state } = caughtSafariState()
    const order: string[] = []
    let finishBallAnimation: (() => void) | undefined
    const ballAnimation = new Promise<void>((resolve) => { finishBallAnimation = resolve })
    let finishFanfare: (() => void) | undefined
    const fanfare = new Promise<void>((resolve) => { finishFanfare = resolve })
    let finishCaptureFade: (() => void) | undefined
    const captureFade = new Promise<void>((resolve) => { finishCaptureFade = resolve })
    const onFinish = vi.fn()
    controller.start({
      state,
      context: { catalog, rng: { getSeed: () => 0, nextU16: () => 0 }, hasStorageSpace: true },
      names: { playerName: 'JO', opponentName: 'RACAILLOU', safariBallName: 'SAFARI BALL' },
      messages: { 950: 'BALLS', 951: '{0}', 965: 'APPARITION\r', 927: 'FUITE', 931: 'BALL', 932: 'APPAT', 933: 'BOUE', 857: 'LANCER', 867: '{202 3}CAPTURE{202 2}\r', 871: 'DEX\r', 1174: 'PC' },
      onStateChange: () => undefined,
      onAudio: (entry) => { if (entry.audio?.kind === 'music') order.push(`music:${entry.audio.sequenceId}`) },
      onMessageControl: (control) => {
        if (control.kind === 'play-fanfare') order.push(`fanfare:${control.sequenceId}`)
        if (control.kind === 'wait-fanfare') return fanfare
      },
      onAnimation: (_animation, entry) => {
        if (entry.messageId !== 857) return
        order.push('ball-animation')
        return ballAnimation
      },
      onSceneCue: (cue) => { order.push(cue); if (cue === 'capture-fade') return captureFade },
      onCaught: () => ({
        presentation: [{ messageId: 871, values: [], advance: 'automatic', minimumFrames: 30 }],
        onPresentationStart: () => { order.push(`event21:${fixture.message.textContent}`) },
        afterPresentation: async () => {
          order.push('pokedex-nickname-storage')
          return [{ messageId: 1174, values: [], advance: 'automatic', minimumFrames: 30 }]
        },
        afterAllPresentation: () => { order.push('post-battle') },
      }),
      onFinish,
    })

    await vi.advanceTimersByTimeAsync(122 * 1000 / 60 + 1)
    expect(fixture.message.textContent).toBe('APPARITION')
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(10 * 1000 / 60 + 1)
    expect(fixture.message.textContent).toBe('APPARITION')
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(1000 / 60 + 1)
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(18 * 1000 / 60 + 1)
    await Promise.resolve()
    expect(fixture.commands.hidden).toBe(false)
    controller.handle('confirm')
    expect(fixture.message.textContent).toBe('LANCER')
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(8 * 1000 / 60 + 1)
    expect(fixture.message.textContent).toBe('LANCER')
    expect(fixture.confirm.hidden).toBe(true)
    expect(order).toEqual(['opponent-gauge', 'ball-animation'])
    expect(fixture.message.textContent).toBe('LANCER')
    finishBallAnimation?.()
    await vi.advanceTimersByTimeAsync(1000 / 60 + 1)
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(8 * 1000 / 60 + 1)
    expect(fixture.message.textContent).toBe('CAPTURE')
    expect(order).toEqual(['opponent-gauge', 'ball-animation', 'music:1129', 'fanfare:1187'])
    controller.handle('confirm')
    expect(fixture.message.textContent).toBe('CAPTURE')
    finishFanfare?.()
    await vi.advanceTimersByTimeAsync(1000 / 60 + 1)
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(1000 / 60 + 500 + 1)
    expect(fixture.message.textContent).toBe('CAPTURE')
    expect(order).not.toContain('event21:')
    finishCaptureFade?.()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(29 * 1000 / 60)
    expect(fixture.message.textContent).toBe('CAPTURE')
    await vi.advanceTimersByTimeAsync(2 * 1000 / 60 + 9 * 1000 / 60 + 1)
    expect(fixture.message.textContent).toBe('DEX')
    expect(order).toEqual(['opponent-gauge', 'ball-animation', 'music:1129', 'fanfare:1187', 'capture-fade', 'event21:'])
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(5 * 1000 / 60 + 1)
    controller.handle('confirm')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1000 / 60 + 1)
    expect(fixture.message.textContent).toBe('PC')
    expect(order.at(-1)).toBe('pokedex-nickname-storage')
    await vi.advanceTimersByTimeAsync(29 * 1000 / 60)
    expect(order.at(-1)).toBe('pokedex-nickname-storage')
    await vi.advanceTimersByTimeAsync(2 * 1000 / 60 + 1)
    expect(order.at(-1)).toBe('post-battle')
    expect(onFinish).toHaveBeenCalledWith('caught', expect.objectContaining({ outcome: 'caught' }))
  })

  it.each([
    ['afterPresentation', 'sync'],
    ['afterPresentation', 'async'],
    ['afterAllPresentation', 'sync'],
    ['afterAllPresentation', 'async'],
  ] as const)('libère la capture si %s rejette (%s)', async (hook, rejectionKind) => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { createElement: () => new TestElement() })
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    const fixture = createControllerFixture()
    const controller = createSafariBattleController(fixture as unknown as Parameters<typeof createSafariBattleController>[0])
    const { catalog, state } = caughtSafariState()
    const onFinish = vi.fn()
    const afterPresentationReached = vi.fn()
    const afterAllPresentationReached = vi.fn()
    const reject: () => never | Promise<never> = rejectionKind === 'sync'
      ? () => { throw new Error(`${hook}-sync`) }
      : () => Promise.reject(new Error(`${hook}-async`))

    controller.start({
      state,
      context: { catalog, rng: { getSeed: () => 0, nextU16: () => 0 }, hasStorageSpace: true },
      names: { playerName: 'JO', opponentName: 'RACAILLOU', safariBallName: 'SAFARI BALL' },
      messages: { 950: 'BALLS', 951: '{0}', 965: 'APPARITION', 927: 'FUITE', 931: 'BALL', 932: 'APPAT', 933: 'BOUE', 857: 'LANCER', 867: 'CAPTURE' },
      onStateChange: () => undefined,
      onCaught: () => ({
        presentation: [],
        afterPresentation: hook === 'afterPresentation'
          ? reject
          : async () => { afterPresentationReached(); return [] },
        afterAllPresentation: hook === 'afterAllPresentation'
          ? reject
          : () => { afterAllPresentationReached() },
      }),
      onFinish,
    })

    await drainSafariPresentation()
    expect(fixture.commands.hidden).toBe(false)
    controller.handle('confirm')
    await drainSafariPresentation()

    expect(onFinish).toHaveBeenCalledOnce()
    expect(onFinish).toHaveBeenCalledWith('caught', expect.objectContaining({ outcome: 'caught' }))
    expect(vi.getTimerCount()).toBe(0)
    if (hook === 'afterPresentation') expect(afterAllPresentationReached).toHaveBeenCalledOnce()
    else expect(afterPresentationReached).toHaveBeenCalledOnce()
  })

  it.each(['confirm', 'cancel', 'secondary', 'tertiary', 'menu'] as const)('accepte la touche faciale %s pendant WaitButtonABTime', async (action) => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { createElement: () => new TestElement() })
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    const fixture = createControllerFixture()
    const controller = createSafariBattleController(fixture as unknown as Parameters<typeof createSafariBattleController>[0])
    const { catalog, state } = caughtSafariState()
    controller.start({
      state,
      context: { catalog, rng: { getSeed: () => 0, nextU16: () => 0 }, hasStorageSpace: true },
      names: { playerName: 'JO', opponentName: 'RACAILLOU', safariBallName: 'SAFARI BALL' },
      messages: { 950: 'BALLS', 951: '{0}', 965: 'APPARITION\r', 927: 'FUITE', 931: 'BALL', 932: 'APPAT', 933: 'BOUE' },
      onStateChange: () => undefined,
      onFinish: () => undefined,
    })
    await vi.advanceTimersByTimeAsync(122 * 1000 / 60 + 1)
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(10 * 1000 / 60 + 1)
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(1000 / 60 + 1)
    controller.handle(action)
    expect(fixture.commands.hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(18 * 1000 / 60 + 1)
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.commands.hidden).toBe(false)
  })

  it('ignore Start/Select pendant WaitButtonABTime comme la ROM', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { createElement: () => new TestElement() })
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    const fixture = createControllerFixture()
    const controller = createSafariBattleController(fixture as unknown as Parameters<typeof createSafariBattleController>[0])
    const { catalog, state } = caughtSafariState()
    controller.start({
      state,
      context: { catalog, rng: { getSeed: () => 0, nextU16: () => 0 }, hasStorageSpace: true },
      names: { playerName: 'JO', opponentName: 'RACAILLOU', safariBallName: 'SAFARI BALL' },
      messages: { 950: 'BALLS', 951: '{0}', 965: 'APPARITION\r', 927: 'FUITE', 931: 'BALL', 932: 'APPAT', 933: 'BOUE' },
      onStateChange: () => undefined,
      onFinish: () => undefined,
    })
    await vi.advanceTimersByTimeAsync(122 * 1000 / 60 + 1)
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(10 * 1000 / 60 + 1)
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(1000 / 60 + 1)
    controller.handle('menu')
    await Promise.resolve()
    expect(fixture.commands.hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(30 * 1000 / 60 + 1)
    expect(fixture.commands.hidden).toBe(false)
  })

  it('reprend la sélection pointeur avant la direction et ignore le relâchement physique', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { createElement: () => new TestElement() })
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    const fixture = createControllerFixture()
    const controller = createSafariBattleController(fixture as unknown as Parameters<typeof createSafariBattleController>[0])
    const { catalog, state } = caughtSafariState()
    controller.start({
      state,
      context: { catalog, rng: { getSeed: () => 0, nextU16: () => 0 }, hasStorageSpace: true },
      names: { playerName: 'JO', opponentName: 'RACAILLOU', safariBallName: 'SAFARI BALL' },
      messages: { 950: 'BALLS', 951: '{0}', 965: 'APPARITION\r', 927: 'FUITE', 931: 'BALL', 932: 'APPAT', 933: 'BOUE' },
      onStateChange: () => undefined,
      onFinish: () => undefined,
    })
    await vi.advanceTimersByTimeAsync(122 * 1000 / 60 + 1)
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(10 * 1000 / 60 + 1)
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(1000 / 60 + 1)
    controller.handle('confirm')
    await vi.advanceTimersByTimeAsync(18 * 1000 / 60 + 1)
    await Promise.resolve()

    fixture.commands.children.forEach((button) => button.setAttribute('aria-current', 'false'))
    fixture.commands.children[1]?.setAttribute('aria-current', 'true')
    controller.handle('down', true)
    controller.handle('down', false)
    expect(fixture.commands.children[2]?.getAttribute('aria-current')).toBe('true')

    fixture.commands.children.forEach((button) => button.setAttribute('aria-current', 'false'))
    fixture.commands.children[0]?.setAttribute('aria-current', 'true')
    fixture.commands.children[1]!.disabled = true
    controller.handle('right', true)
    expect(fixture.commands.children[2]?.getAttribute('aria-current')).toBe('true')
  })

  it('annule les timers de présentation à la fermeture', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { createElement: () => new TestElement() })
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    const fixture = createControllerFixture()
    const controller = createSafariBattleController(fixture as unknown as Parameters<typeof createSafariBattleController>[0])
    const { catalog, state } = caughtSafariState()
    const onFinish = vi.fn()
    controller.start({
      state,
      context: { catalog, rng: { getSeed: () => 0, nextU16: () => 0 }, hasStorageSpace: true },
      names: { playerName: 'JO', opponentName: 'RACAILLOU', safariBallName: 'SAFARI BALL' },
      messages: { 950: 'BALLS', 951: '{0}', 965: 'APPARITION', 927: 'FUITE', 931: 'BALL', 932: 'APPAT', 933: 'BOUE' },
      onStateChange: () => undefined,
      onFinish,
    })
    controller.close()
    expect(fixture.confirm.hidden).toBe(false)
    await vi.runAllTimersAsync()
    expect(controller.isActive()).toBe(false)
    expect(onFinish).not.toHaveBeenCalled()
  })
})
