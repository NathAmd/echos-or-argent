import { describe, expect, it, vi } from 'vitest'
import { createRealtimeTestRunner, formatRealtimeTestReport, parseRealtimeTestScript, realtimeTestScriptMarker, type RealtimeTestSnapshot } from './realtimeTestScript'

describe('parseRealtimeTestScript', () => {
  it('analyse les touches, attentes, assertions et commandes DEV françaises ou anglaises', () => {
    const script = parseRealtimeTestScript(`
      # Batterie minimale
      ${realtimeTestScriptMarker} smoke
      TOUCHE valider 80ms
      HOLD haut 2s
      WAIT 250ms
      WAIT battle=simple 10s
      PRESS-UNTIL valider battle=none 200ms 1m
      VERIFIER flow=bedroom
      DEBUG GODMODE ON
      DEBUG INSTANT-KILL
      DEBUG SUICIDE
      EXPECT-ERROR Safari DEBUG GODMODE ON
      BOT OUVERTURE
      BOT PREMIER-BADGE
      BOT ZEPHYR ngp-duo-solo-monotype
      BOT TOGEPI
      BOT BADGE-ESSAIM
      BOT BADGE-PLAINE
      REPORT "après ouverture"
      STOP
    `)

    expect(script.name).toBe('smoke')
    expect(script.steps).toEqual([
      expect.objectContaining({ kind: 'press', action: 'confirm', durationMs: 80, line: 4 }),
      expect.objectContaining({ kind: 'press', action: 'up', durationMs: 2_000 }),
      expect.objectContaining({ kind: 'wait', durationMs: 250 }),
      expect.objectContaining({ kind: 'wait-for', key: 'battle', expected: 'simple', timeoutMs: 10_000 }),
      expect.objectContaining({ kind: 'press-until', action: 'confirm', key: 'battle', expected: 'none', intervalMs: 200, timeoutMs: 60_000 }),
      expect.objectContaining({ kind: 'expect', key: 'flow', expected: 'bedroom' }),
      expect.objectContaining({ kind: 'debug', command: { kind: 'godmode', enabled: true } }),
      expect.objectContaining({ kind: 'debug', command: { kind: 'instant-kill' } }),
      expect.objectContaining({ kind: 'debug', command: { kind: 'suicide' } }),
      expect.objectContaining({ kind: 'expect-debug-error', expectedMessage: 'Safari', command: { kind: 'godmode', enabled: true } }),
      expect.objectContaining({ kind: 'bot', journey: 'opening' }),
      expect.objectContaining({ kind: 'bot', journey: 'zephyr', preset: 'normal' }),
      expect.objectContaining({ kind: 'bot', journey: 'zephyr', preset: 'ngp-duo-solo-monotype' }),
      expect.objectContaining({ kind: 'bot', journey: 'togepi', preset: 'normal' }),
      expect.objectContaining({ kind: 'bot', journey: 'hive', preset: 'normal' }),
      expect.objectContaining({ kind: 'bot', journey: 'plain', preset: 'normal' }),
      expect.objectContaining({ kind: 'report', label: 'après ouverture' }),
      expect.objectContaining({ kind: 'stop' }),
    ])
  })

  it('développe REPEAT sans perdre le numéro de ligne', () => {
    const script = parseRealtimeTestScript(`${realtimeTestScriptMarker} repeat\nREPEAT 3 PRESS right`)
    expect(script.steps).toHaveLength(3)
    expect(script.steps.every((step) => step.line === 2)).toBe(true)
  })

  it('accepte les commentaires de fin de ligne sans tronquer un libellé cité', () => {
    const script = parseRealtimeTestScript(`${realtimeTestScriptMarker} comments # en-tête\nPRESS confirm # touche réelle\nREPORT "étape #1" # checkpoint`)
    expect(script.steps).toEqual([
      expect.objectContaining({ kind: 'press', action: 'confirm' }),
      expect.objectContaining({ kind: 'report', label: 'étape #1' }),
    ])
  })

  it.each([
    ['', 'vide'],
    ['PRESS confirm', 'en-tête attendu'],
    [`${realtimeTestScriptMarker} bad\nPRESS nope`, 'touche inconnue'],
    [`${realtimeTestScriptMarker} bad\nWAIT 999999s`, 'hors limites'],
    [`${realtimeTestScriptMarker} bad\nDEBUG GODMODE maybe`, 'attend ON ou OFF'],
    [`${realtimeTestScriptMarker} bad\nBOT ZEPHYR inconnu`, 'preset de campagne inconnu'],
    [`${realtimeTestScriptMarker} bad\nBOT LIGUE`, 'BOT attend OPENING, ZEPHYR, TOGEPI, HIVE, PLAIN ou FOG'],
    [`${realtimeTestScriptMarker} bad\nREPEAT 1001 PRESS confirm`, 'répétition hors limites'],
  ])('rejette entièrement un fichier invalide', (source, message) => {
    expect(() => parseRealtimeTestScript(source)).toThrow(message)
  })
})

describe('createRealtimeTestRunner', () => {
  it('injecte une pression puis garantit son relâchement selon l’horloge réelle', () => {
    const dispatch = vi.fn()
    const runner = createRealtimeTestRunner({
      dispatch,
      readSnapshot: () => ({}),
      executeDebugCommand: () => '',
      startBotJourney: () => '',
    })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} keys\nPRESS confirm 100ms\nSTOP`), 1_000)
    runner.tick(1_000)
    expect(dispatch).toHaveBeenCalledWith('confirm', true, 'test-tape:keys:2')
    runner.tick(1_099)
    expect(dispatch).toHaveBeenCalledTimes(1)
    runner.tick(1_100)
    expect(dispatch).toHaveBeenLastCalledWith('confirm', false, 'test-tape:keys:2')
    runner.tick(1_145)
    expect(runner.getState().status).toBe('passed')
  })

  it('attend un état, exécute les commandes et produit les checkpoints', () => {
    let snapshot: RealtimeTestSnapshot = { flow: 'title', battle: 'none' }
    const debug = vi.fn(() => 'Godmode activé.')
    const checkpoint = vi.fn()
    const runner = createRealtimeTestRunner({
      dispatch: vi.fn(),
      readSnapshot: () => snapshot,
      executeDebugCommand: debug,
      startBotJourney: () => 'Bot lancé.',
      recordCheckpoint: checkpoint,
    })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} state\nWAIT flow=bedroom 1s\nDEBUG GODMODE ON\nREPORT terrain\nEXPECT battle=none`), 0)
    runner.tick(0)
    snapshot = { flow: 'bedroom', battle: 'none' }
    runner.tick(500)
    expect(runner.getState().status).toBe('passed')
    expect(debug).toHaveBeenCalledWith({ kind: 'godmode', enabled: true })
    expect(checkpoint).toHaveBeenCalledWith('terrain', snapshot)
  })

  it('publie la progression de BOT et de WAIT sans attendre la fin du délai', () => {
    let snapshot: RealtimeTestSnapshot = {
      journey: 'running',
      journeyCheckpoint: 'route-29',
    }
    const states: string[] = []
    const startBotJourney = vi.fn(() => 'Bot premier badge lancé.')
    const runner = createRealtimeTestRunner({
      dispatch: vi.fn(),
      readSnapshot: () => snapshot,
      executeDebugCommand: () => '',
      startBotJourney,
      onStateChange: (state) => { states.push(`${state.stepIndex}:${state.message}`) },
    })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} progress\nBOT ZEPHYR\nWAIT journey=passed 10s`), 0)

    runner.tick(0)

    expect(startBotJourney).toHaveBeenCalledOnce()
    expect(states.some((entry) => entry.includes('Bot premier badge lancé.'))).toBe(true)
    expect(runner.getState()).toMatchObject({ status: 'running', stepIndex: 1, currentLine: 3 })
    expect(runner.getState().message).toContain('attente journey=passed · actuel running · 0/10000 ms · jalon route-29')
    expect(runner.getState().message).toContain('état{loaded=∅; flow=∅; map=∅; x=∅; z=∅;')
    expect(runner.getState().message).toContain('journey=running; journeyCheckpoint=route-29;')

    snapshot = { journey: 'running', journeyCheckpoint: 'mauville' }
    runner.tick(999)
    expect(runner.getState().message).toContain('jalon route-29')
    runner.tick(1_000)
    expect(runner.getState().message).toContain('1000/10000 ms · jalon mauville')
  })

  it('échoue immédiatement avec la cause remontée par un bot déjà lancé', () => {
    let snapshot: RealtimeTestSnapshot = { bot: 'running' }
    const runner = createRealtimeTestRunner({
      dispatch: vi.fn(),
      readSnapshot: () => snapshot,
      executeDebugCommand: () => '',
      startBotJourney: () => 'Bot d’ouverture lancé.',
    })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} bot-failure\nBOT OPENING\nWAIT bot=stopped 10m`), 0)
    runner.tick(0)

    snapshot = { bot: 'stopped', botError: 'Contrôle E2E « Mode local » absent.' }
    runner.tick(100)

    expect(runner.getState()).toMatchObject({ status: 'failed', stepIndex: 1 })
    expect(runner.getState().message).toContain('le bot E2E a échoué : Contrôle E2E « Mode local » absent.')
    expect(runner.getState().message).toContain('bot=stopped; botStatus=∅; botError=Contrôle E2E « Mode local » absent.;')
  })

  it('répète une touche jusqu’à la condition sans envoyer d’entrée après succès', () => {
    let battle = 'simple'
    const dispatch = vi.fn()
    const runner = createRealtimeTestRunner({ dispatch, readSnapshot: () => ({ battle }), executeDebugCommand: () => '', startBotJourney: () => '' })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} until\nPRESS-UNTIL confirm battle=none 100ms 1s`), 0)
    runner.tick(0)
    runner.tick(99)
    expect(dispatch).toHaveBeenCalledTimes(2)
    runner.tick(100)
    expect(dispatch).toHaveBeenCalledTimes(4)
    battle = 'none'
    runner.tick(200)
    expect(runner.getState().status).toBe('passed')
    expect(dispatch).toHaveBeenCalledTimes(4)
  })

  it('échoue avec la ligne, la valeur réelle et libère toute touche lors d’un arrêt', () => {
    const dispatch = vi.fn()
    const runner = createRealtimeTestRunner({
      dispatch,
      readSnapshot: () => ({ battle: 'none' }),
      executeDebugCommand: () => '',
      startBotJourney: () => '',
    })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} failure\nPRESS up 5s\nEXPECT battle=simple`), 0)
    runner.tick(0)
    runner.stop(100)
    expect(dispatch).toHaveBeenLastCalledWith('up', false, 'test-tape:failure:2')
    expect(runner.getState()).toMatchObject({ status: 'stopped', finishedAtMs: 100 })

    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} failure\nEXPECT battle=simple`), 200)
    runner.tick(200)
    expect(runner.getState().message).toContain('Ligne 2: battle vaut none, attendu simple')
  })

  it.each([
    ['WAIT', 'WAIT battle=none 10ms', [0, 10], 2],
    ['PRESS-UNTIL', 'PRESS-UNTIL confirm battle=none 1ms 10ms', [0, 45], 2],
    ['EXPECT', 'EXPECT battle=none', [0], 1],
  ])('joint l’état déterministe à un échec %s', (_command, source, ticks, expectedReads) => {
    const snapshot: RealtimeTestSnapshot = {
      journeyCheckpoint: 'zephyr-badge',
      campaignModules: 'all-battles-in-duo,eevee-team',
      z: 7,
      phoneChoiceOpen: true,
      scriptWait: 'movement',
      scriptMovementTasks: 1,
      scriptMoving: true,
      followerMoving: false,
      ignoredSecret: 'ne doit pas sortir',
      bot: 'running',
      botStatus: 'Route 30',
      x: 4,
      journey: 'running',
      map: 32,
      campaignMode: 'new-game-plus',
      battle: 'simple',
      debugReady: true,
      godmode: true,
      zephyrBadge: true,
      falknerDefeated: false,
      campaignPreset: 'ngp-duo-eevee',
    }
    const readSnapshot = vi.fn(() => snapshot)
    const runner = createRealtimeTestRunner({
      dispatch: vi.fn(),
      readSnapshot,
      executeDebugCommand: () => '',
      startBotJourney: () => '',
    })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} diagnostic\n${source}`), 0)
    for (const tick of ticks) runner.tick(tick)

    const state = runner.getState()
    expect(state.status).toBe('failed')
    expect(readSnapshot).toHaveBeenCalledTimes(expectedReads)
    expect(state.logs.at(-1)?.message).toBe(state.message)
    expect(state.message).toContain('map=32; x=4; z=7; dialog=∅; phoneChoiceOpen=true;')
    expect(state.message).toContain('scriptWait=movement; scriptMovementTasks=1; scriptMoving=true; followerMoving=false;')
    expect(state.message).toContain('battle=simple;')
    expect(state.message).toContain('debugReady=true; bot=running; botStatus=Route 30;')
    expect(state.message).toContain('bot=running;')
    expect(state.message).toContain('zephyrBadge=true; falknerDefeated=false;')
    expect(state.message).not.toContain('godmode=')
    expect(state.message).toContain('campaignPreset=ngp-duo-eevee; campaignMode=new-game-plus; campaignModules=all-battles-in-duo,eevee-team;')
    expect(state.message).toContain('journey=running; journeyCheckpoint=zephyr-badge;')
    expect(state.message).not.toContain('ignoredSecret')
  })

  it('borne les valeurs longues et ne dépend pas de l’ordre des clés du host', () => {
    const runFailure = (snapshot: RealtimeTestSnapshot): string => {
      const runner = createRealtimeTestRunner({
        dispatch: vi.fn(),
        readSnapshot: () => snapshot,
        executeDebugCommand: () => '',
        startBotJourney: () => '',
      })
      runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} bounded\nEXPECT battle=none`), 0)
      runner.tick(0)
      const message = runner.getState().message
      return message.slice(message.indexOf('état{'))
    }
    const longError = `cause=\n${'x'.repeat(5_000)};fin\r`
    const left = runFailure({
      journeyError: longError,
      campaignModules: longError,
      battle: 'simple',
      botError: longError,
      z: 9,
      x: 8,
      map: 7,
    })
    const right = runFailure({
      map: 7,
      x: 8,
      z: 9,
      botError: longError,
      battle: 'simple',
      campaignModules: longError,
      journeyError: longError,
    })

    expect(left).toBe(right)
    expect(left.length).toBeLessThanOrEqual(2_048)
    expect(left).toContain('…')
    expect(left).not.toMatch(/[\r\n]/)
    expect(left).not.toContain('x'.repeat(100))
  })

  it('distingue une valeur undefined d’une clé absente dans le diagnostic', () => {
    const runner = createRealtimeTestRunner({
      dispatch: vi.fn(),
      readSnapshot: () => ({ battle: 'simple', map: undefined }),
      executeDebugCommand: () => '',
      startBotJourney: () => '',
    })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} missing\nEXPECT battle=none`), 0)
    runner.tick(0)

    expect(runner.getState().message).toContain('map=undefined; x=∅; z=∅;')
  })

  it('considère une clé d’état inconnue comme une erreur, même si undefined est attendu', () => {
    const runner = createRealtimeTestRunner({ dispatch: vi.fn(), readSnapshot: () => ({}), executeDebugCommand: () => '', startBotJourney: () => '' })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} typo\nEXPECT batle=undefined`), 0)
    runner.tick(0)
    expect(runner.getState()).toMatchObject({ status: 'failed' })
    expect(runner.getState().message).toContain('(clé absente)')
  })

  it('résout les noms d’état sans dépendre de la casse utilisée dans le fichier', () => {
    const runner = createRealtimeTestRunner({ dispatch: vi.fn(), readSnapshot: () => ({ battleUi: 'command' }), executeDebugCommand: () => '', startBotJourney: () => '' })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} case\nEXPECT battleUi=command`), 0)
    runner.tick(0)
    expect(runner.getState()).toMatchObject({ status: 'passed' })
  })

  it('valide explicitement une commande DEBUG refusée pour la bonne raison', () => {
    const runner = createRealtimeTestRunner({
      dispatch: vi.fn(), readSnapshot: () => ({}), startBotJourney: () => '',
      executeDebugCommand: () => { throw new Error('Commande non applicable en Safari.') },
    })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} expected-error\nEXPECT-ERROR Safari DEBUG INSTANT-KILL`), 0)
    runner.tick(0)
    expect(runner.getState()).toMatchObject({ status: 'passed' })
  })

  it('génère un rapport TXT lisible sans sérialiser du code', () => {
    const runner = createRealtimeTestRunner({ dispatch: vi.fn(), readSnapshot: () => ({ flow: 'title' }), executeDebugCommand: () => '', startBotJourney: () => '' })
    runner.start(parseRealtimeTestScript(`${realtimeTestScriptMarker} report\nSTOP`), 10)
    runner.tick(25)
    expect(runner.getState()).toMatchObject({ status: 'passed', stepIndex: 1, stepCount: 1 })
    const report = formatRealtimeTestReport(runner.getState(), { flow: 'title', map: 1 })
    expect(report).toContain('status=passed')
    expect(report).toContain('[snapshot]\nflow=title\nmap=1')
    expect(report).toContain('[journal]')
  })
})
