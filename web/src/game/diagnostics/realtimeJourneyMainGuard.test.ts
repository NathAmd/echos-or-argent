import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('real-time journey main guard', () => {
  it('does not call the journey agent during the map-transition ON_FRAME window', () => {
    const main = readFileSync(new URL('../../main.ts', import.meta.url), 'utf8')
    const functionStart = main.indexOf('const advanceBotField')
    const functionEnd = main.indexOf('const runBot', functionStart)
    const implementation = main.slice(functionStart, functionEnd)
    const transitionGuard = implementation.indexOf('if (fieldExplorationRuntime.isTransitionActive()')
    const agentCall = implementation.indexOf('botJourneyAgent.nextInput(')

    expect(functionStart).toBeGreaterThanOrEqual(0)
    expect(functionEnd).toBeGreaterThan(functionStart)
    expect(transitionGuard).toBeGreaterThanOrEqual(0)
    expect(agentCall).toBeGreaterThan(transitionGuard)
  })

  it('confirme le dialogue de blackout avant de rappeler l’agent de parcours', () => {
    const main = readFileSync(new URL('../../main.ts', import.meta.url), 'utf8')
    const functionStart = main.indexOf('const advanceBotField')
    const functionEnd = main.indexOf('const runBot', functionStart)
    const implementation = main.slice(functionStart, functionEnd)
    const blackoutGuard = implementation.indexOf('if (pendingBlackoutFollowup)')
    const confirmation = implementation.indexOf('confirmBlackoutMessage()', blackoutGuard)
    const guardReturn = implementation.indexOf('return', confirmation)
    const checkpointRead = implementation.indexOf('const checkpoint', blackoutGuard)
    const agentCall = implementation.indexOf('botJourneyAgent.nextInput(')

    expect(blackoutGuard).toBeGreaterThanOrEqual(0)
    expect(confirmation).toBeGreaterThan(blackoutGuard)
    expect(guardReturn).toBeGreaterThan(confirmation)
    expect(guardReturn).toBeLessThan(checkpointRead)
    expect(agentCall).toBeGreaterThan(confirmation)
  })

  it('efface le Save_Gymmick avant le warp de blackout natif', () => {
    const main = readFileSync(new URL('../../main.ts', import.meta.url), 'utf8')
    const functionStart = main.indexOf('function performNativeBlackout()')
    const functionEnd = main.indexOf('function confirmBlackoutMessage()', functionStart)
    const implementation = main.slice(functionStart, functionEnd)
    const clearGymmick = implementation.indexOf('initializeHgssGymmickState(fieldScriptState, 0)')
    const warp = implementation.indexOf('worldSession.scriptWarpTo(')

    expect(functionStart).toBeGreaterThanOrEqual(0)
    expect(functionEnd).toBeGreaterThan(functionStart)
    expect(clearGymmick).toBeGreaterThanOrEqual(0)
    expect(warp).toBeGreaterThan(clearGymmick)
  })
})
