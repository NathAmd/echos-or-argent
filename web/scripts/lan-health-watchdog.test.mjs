import { describe, expect, it, vi } from 'vitest'
import {
  inspectLanHealthProbeResponse,
  inspectLanHealthTargets,
  lanHealthProbeContracts,
  startLanHealthWatchdog,
} from './lan-health-watchdog.mjs'

describe('watchdog du serveur privé LAN', () => {
  it('exige le document de santé exact et un statut 200 exact pour les pages', () => {
    expect(inspectLanHealthProbeResponse(lanHealthProbeContracts.health, {
      body: '{"status":"ok"}',
      contentType: 'application/json; charset=utf-8',
      statusCode: 200,
    })).toBeUndefined()
    expect(inspectLanHealthProbeResponse(lanHealthProbeContracts.page, {
      statusCode: 200,
    })).toBeUndefined()

    for (const response of [
      { body: '{"status":"ok"}', contentType: 'application/json', statusCode: 204 },
      { body: '{"status":"ok","extra":true}', contentType: 'application/json', statusCode: 200 },
      { body: '{"status":"stopping"}', contentType: 'application/json', statusCode: 200 },
      { body: '<html></html>', contentType: 'text/html', statusCode: 200 },
    ]) expect(inspectLanHealthProbeResponse(lanHealthProbeContracts.health, response)).toBeTypeOf('string')
    expect(inspectLanHealthProbeResponse(lanHealthProbeContracts.page, { statusCode: 302 }))
      .toContain('302')
  })

  it('inspecte toutes les cibles en parallèle et conserve leurs diagnostics', async () => {
    const first = { contract: lanHealthProbeContracts.health, label: 'backend' }
    const second = { contract: lanHealthProbeContracts.page, label: 'portail' }
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const probe = vi.fn(async (target) => {
      await gate
      if (target.label === second.label) throw new Error('HTTP 503')
    })
    const inspection = inspectLanHealthTargets([first, second], probe)
    expect(probe).toHaveBeenCalledTimes(2)
    release()

    await expect(inspection).resolves.toEqual([{ label: 'portail', detail: 'HTTP 503' }])
  })

  it('tolère une panne transitoire puis déclenche une seule sortie contrôlée au seuil', async () => {
    const scheduled = []
    const schedule = vi.fn((callback) => {
      scheduled.push(callback)
      return scheduled.length
    })
    const cancel = vi.fn()
    const onUnhealthy = vi.fn()
    let healthy = false
    const watchdog = startLanHealthWatchdog({
      targets: [{ contract: lanHealthProbeContracts.health, label: 'backend' }],
      probe: async () => {
        if (!healthy) throw new Error('délai dépassé')
      },
      intervalMs: 5_000,
      maximumConsecutiveFailures: 2,
      onUnhealthy,
      schedule,
      cancel,
    })

    await expect(watchdog.checkNow()).resolves.toMatchObject({ consecutiveFailures: 1, stopped: false })
    healthy = true
    await expect(watchdog.checkNow()).resolves.toMatchObject({ consecutiveFailures: 0, stopped: false })
    healthy = false
    await watchdog.checkNow()
    const terminal = await watchdog.checkNow()

    expect(terminal).toMatchObject({ consecutiveFailures: 2, stopped: true })
    expect(onUnhealthy).toHaveBeenCalledOnce()
    expect(onUnhealthy).toHaveBeenCalledWith([{ label: 'backend', detail: 'délai dépassé' }])
    await watchdog.checkNow()
    expect(onUnhealthy).toHaveBeenCalledOnce()
    expect(schedule).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
  })

  it('refuse les cibles ambiguës et les bornes dangereuses', () => {
    const target = { contract: lanHealthProbeContracts.page, label: 'client' }
    expect(() => startLanHealthWatchdog({
      targets: [target, target],
      probe: async () => undefined,
      onUnhealthy: () => undefined,
    })).toThrow('dupliquée')
    expect(() => startLanHealthWatchdog({
      targets: [target],
      probe: async () => undefined,
      intervalMs: 0,
      onUnhealthy: () => undefined,
    })).toThrow('intervalle')
  })
})
