import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import type { FieldBattleLauncher, FieldBattleLaunchRoute } from '../battle/runtime/fieldBattleHost'
import type {
  HgssMultiplayerGateway,
  HgssMultiplayerRequest,
  HgssMultiplayerResult,
} from '../multiplayer/hgssMultiplayerGateway'
import { HgssFieldPartyInvariantError } from '../pokemon/pokemonParty'
import type { WorldTransitionResult } from '../world/worldSession'
import { createFieldScriptExecutionState } from './fieldScriptExecutionState'
import {
  createFieldScriptSessionHost,
  type FieldScriptSessionHostPorts,
  type FieldScriptSessionWorld,
} from './fieldScriptSessionHost'
import type { FieldScriptRunner } from './fieldScriptProtocol'

const multiplayerRequest: HgssMultiplayerRequest = {
  protocolVersion: 1,
  requestId: 'session-host-test',
  romOpcode: 0x226,
  player: { trainerId: 7, name: 'Luth', gender: 'male' },
  kind: 'profile-status',
}

const multiplayerResult: HgssMultiplayerResult = {
  protocolVersion: 1,
  requestId: multiplayerRequest.requestId,
  kind: multiplayerRequest.kind,
  romResult: 1,
  status: 'completed',
}

const warpMap = {
  id: 42,
  label: 'Doublonville',
} as unknown as OpeningMapPreview

const transitionedWarp: WorldTransitionResult = {
  kind: 'transitioned',
  state: { map: warpMap },
} as unknown as WorldTransitionResult

const tutorialLaunch = {
  kind: 'capture-tutorial',
  battle: { kind: 'tutorial' },
} as unknown as FieldBattleLaunchRoute

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function createRunner(
  submitMultiplayerResult = vi.fn(),
  submitBattleResult = vi.fn(),
): FieldScriptRunner {
  return {
    submitMultiplayerResult,
    submitBattleResult,
  } as unknown as FieldScriptRunner
}

function createFixture(options: {
  worldResult?: WorldTransitionResult | null
  gateway?: HgssMultiplayerGateway
  launch?: FieldBattleLauncher['launch']
  botRunning?: boolean
} = {}) {
  const calls: string[] = []
  const execution = createFieldScriptExecutionState<FieldScriptRunner>()
  const world = {
    scriptWarpTo: vi.fn(() => options.worldResult ?? transitionedWarp),
  } satisfies FieldScriptSessionWorld
  const gateway = options.gateway ?? {
    execute: vi.fn(async () => multiplayerResult),
  }
  const launcher = {
    launch: vi.fn(options.launch ?? (() => tutorialLaunch)),
  } as FieldBattleLauncher
  const clearMovement = vi.fn(() => { calls.push('clear-movement') })
  const reportStatus = vi.fn((message: string) => { calls.push(`status:${message}`) })
  const dismissAcknowledgedMessage = vi.fn(() => { calls.push('dismiss-message') })
  const resume = vi.fn(() => { calls.push('resume') })
  const setDialogueAcknowledged = vi.fn((acknowledged: boolean) => {
    calls.push(`dialogue-ack:${acknowledged}`)
  })
  const setActiveRunner = vi.fn(() => { calls.push('set-battle-runner') })
  const closeDialogue = vi.fn(() => { calls.push('close-dialogue') })
  const suspendBot = vi.fn(() => { calls.push('suspend-bot') })
  const resetAfterFailedLaunch = vi.fn(() => { calls.push('reset-failed-battle') })
  const ports = {
    execution,
    clearMovement,
    reportStatus,
    warp: {
      readWorldSession: () => options.worldResult === null ? undefined : world,
      loadTransition: vi.fn(() => { calls.push('load-transition') }),
    },
    multiplayer: {
      gateway,
      dismissAcknowledgedMessage,
      resume,
    },
    battle: {
      launcher,
      setDialogueAcknowledged,
      setActiveRunner,
      closeDialogue,
      isBotRunning: () => options.botRunning ?? false,
      suspendBot,
      resetAfterFailedLaunch,
    },
  } satisfies FieldScriptSessionHostPorts
  return {
    calls,
    execution,
    world,
    gateway,
    launcher,
    clearMovement,
    reportStatus,
    dismissAcknowledgedMessage,
    resume,
    setDialogueAcknowledged,
    setActiveRunner,
    closeDialogue,
    suspendBot,
    resetAfterFailedLaunch,
    loadTransition: ports.warp.loadTransition,
    host: createFieldScriptSessionHost(ports),
  }
}

describe('fieldScriptSessionHost', () => {
  it('laisse les autres domaines au host suivant', () => {
    const fixture = createFixture()

    expect(fixture.host.handle({ kind: 'save' }, createRunner())).toBe('unhandled')
    expect(fixture.clearMovement).not.toHaveBeenCalled()
  })

  it('suspend un warp et transporte le runner interrompu vers la transition', () => {
    const fixture = createFixture()
    const interruptedRunner = createRunner()
    const handlerRunner = createRunner()
    fixture.execution.setRunner(interruptedRunner)

    expect(fixture.host.handle({
      kind: 'warp',
      mapId: 42,
      x: 120,
      z: 87,
      direction: 'west',
    }, handlerRunner)).toBe('suspend')
    expect(fixture.world.scriptWarpTo).toHaveBeenCalledWith(42, 120, 87, 'west')
    expect(fixture.loadTransition).toHaveBeenCalledWith(warpMap, interruptedRunner)
    expect(fixture.calls).toEqual(['clear-movement', 'load-transition'])
  })

  it.each([
    null,
    { kind: 'missing-map', mapId: 42 } as WorldTransitionResult,
    { kind: 'missing-anchor', map: warpMap } as WorldTransitionResult,
  ])('refuse une destination de warp absente sans toucher la présentation', (worldResult) => {
    const fixture = createFixture({ worldResult })
    expect(() => fixture.host.handle({
      kind: 'warp',
      mapId: 42,
      x: 1,
      z: 2,
      direction: 'north',
    }, createRunner())).toThrow('Warp script ROM vers la carte 42 indisponible.')
    expect(fixture.clearMovement).not.toHaveBeenCalled()
    expect(fixture.loadTransition).not.toHaveBeenCalled()
  })

  it('reprend le multijoueur uniquement après avoir soumis le résultat courant', async () => {
    const fixture = createFixture()
    const runner = createRunner()
    fixture.execution.setRunner(runner)

    expect(fixture.host.handle({ kind: 'multiplayer', request: multiplayerRequest }, runner)).toBe('suspend')
    expect(fixture.dismissAcknowledgedMessage).toHaveBeenCalledOnce()
    expect(fixture.execution.getWait()).toBe('multiplayer')
    await vi.waitFor(() => expect(runner.submitMultiplayerResult).toHaveBeenCalledWith(multiplayerResult))
    expect(fixture.execution.getWait()).toBeUndefined()
    expect(fixture.reportStatus).not.toHaveBeenCalled()
    expect(fixture.resume).toHaveBeenCalledOnce()
  })

  it('ignore un résultat multijoueur dont le runner lié a changé', async () => {
    const deferred = createDeferred<HgssMultiplayerResult>()
    const fixture = createFixture({ gateway: { execute: () => deferred.promise } })
    const runner = createRunner()
    fixture.execution.setRunner(runner)

    expect(fixture.host.handle({ kind: 'multiplayer', request: multiplayerRequest }, runner)).toBe('suspend')
    fixture.execution.setRunner(createRunner())
    deferred.resolve(multiplayerResult)
    await deferred.promise
    await Promise.resolve()

    expect(runner.submitMultiplayerResult).not.toHaveBeenCalled()
    expect(fixture.execution.getWait()).toBe('multiplayer')
    expect(fixture.resume).not.toHaveBeenCalled()
  })

  it.each([
    [new Error('Tunnel indisponible.'), 'Tunnel indisponible.'],
    ['offline', 'Le service multijoueur HGSS est indisponible.'],
  ])('soumet le fallback hors ligne et affiche précisément son erreur', async (failure, message) => {
    const fixture = createFixture({ gateway: { execute: vi.fn(async () => { throw failure }) } })
    const runner = createRunner()
    fixture.execution.setRunner(runner)

    fixture.host.handle({ kind: 'multiplayer', request: multiplayerRequest }, runner)
    await vi.waitFor(() => expect(fixture.reportStatus).toHaveBeenCalledWith(message))
    expect(runner.submitMultiplayerResult).toHaveBeenCalledWith(expect.objectContaining({
      requestId: multiplayerRequest.requestId,
      status: 'offline',
      romResult: 0,
    }))
    expect(fixture.resume).toHaveBeenCalledOnce()
  })

  it('prépare un combat, lie son runner et suspend aussi le bot actif', () => {
    const fixture = createFixture({ botRunning: true })
    const runner = createRunner()

    expect(fixture.host.handle({ kind: 'battle', battle: { kind: 'tutorial' } }, runner)).toBe('suspend')
    expect(fixture.launcher.launch).toHaveBeenCalledWith({ kind: 'tutorial' })
    expect(fixture.setActiveRunner).toHaveBeenCalledWith(runner)
    expect(fixture.reportStatus).toHaveBeenCalledWith('Combat tutoriel ROM pret')
    expect(fixture.calls).toEqual([
      'dialogue-ack:false',
      'clear-movement',
      'set-battle-runner',
      'close-dialogue',
      'status:Combat tutoriel ROM pret',
      'suspend-bot',
    ])
  })

  it.each([
    [new Error('Catalogue combat absent.'), 'Catalogue combat absent.'],
    ['rom-error', 'Le combat ROM ne peut pas être préparé.'],
  ])('annule un lancement de combat ordinaire puis continue le même runner', (failure, message) => {
    const fixture = createFixture({ launch: () => { throw failure } })
    const runner = createRunner(undefined, vi.fn(() => { fixture.execution.setRunner(undefined) }))
    fixture.execution.setRunner(createRunner())

    expect(fixture.host.handle({ kind: 'battle', battle: { kind: 'tutorial' } }, runner)).toBe('continue')
    expect(runner.submitBattleResult).toHaveBeenCalledWith(false)
    expect(fixture.resetAfterFailedLaunch).toHaveBeenCalledOnce()
    expect(fixture.reportStatus).toHaveBeenCalledWith(message)
    expect(fixture.execution.getRunner()).toBe(runner)
  })

  it('propage un échec de lancement automatisé sans le convertir en défaite ROM', () => {
    const failure = new Error('Présentation Hector indisponible.')
    const fixture = createFixture({
      botRunning: true,
      launch: () => { throw failure },
    })
    const runner = createRunner()

    expect(() => fixture.host.handle({ kind: 'battle', battle: { kind: 'trainer', trainerId: 21, trainerParameter: 0, encounterType: 0, battleParameter: 0 } }, runner))
      .toThrow(failure)
    expect(runner.submitBattleResult).not.toHaveBeenCalled()
    expect(fixture.resetAfterFailedLaunch).toHaveBeenCalledOnce()
    expect(fixture.reportStatus).not.toHaveBeenCalled()
  })

  it('relaisse intacte une violation de l’invariant terrain HGSS', () => {
    const invariant = new HgssFieldPartyInvariantError('équipe inutilisable')
    const fixture = createFixture({ launch: () => { throw invariant } })
    const runner = createRunner()

    expect(() => fixture.host.handle({ kind: 'battle', battle: { kind: 'tutorial' } }, runner))
      .toThrow(invariant)
    expect(runner.submitBattleResult).not.toHaveBeenCalled()
    expect(fixture.resetAfterFailedLaunch).not.toHaveBeenCalled()
    expect(fixture.reportStatus).not.toHaveBeenCalled()
  })

  it('récupère aussi un échec de présentation produit après le lancement', () => {
    const fixture = createFixture()
    fixture.closeDialogue.mockImplementationOnce(() => { throw new Error('Dialogue bloqué.') })
    const runner = createRunner()

    expect(fixture.host.handle({ kind: 'battle', battle: { kind: 'tutorial' } }, runner)).toBe('continue')
    expect(fixture.setActiveRunner).toHaveBeenCalledWith(runner)
    expect(runner.submitBattleResult).toHaveBeenCalledWith(false)
    expect(fixture.resetAfterFailedLaunch).toHaveBeenCalledOnce()
    expect(fixture.reportStatus).toHaveBeenCalledWith('Dialogue bloqué.')
  })
})
