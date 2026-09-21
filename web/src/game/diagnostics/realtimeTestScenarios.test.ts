import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseRealtimeTestScript } from './realtimeTestScript'

const scenarioDirectory = new URL('../../../debug-tests/', import.meta.url)

describe('batteries TXT livrées', () => {
  it('valide intégralement chaque scénario et impose un nom unique', async () => {
    const fileNames = (await readdir(scenarioDirectory)).filter((name) => name.endsWith('.txt')).sort()
    const scripts = await Promise.all(fileNames.map(async (fileName) => ({
      fileName,
      script: parseRealtimeTestScript(await readFile(new URL(fileName, scenarioDirectory), 'utf8')),
    })))

    expect(fileNames.length).toBeGreaterThanOrEqual(5)
    expect(new Set(scripts.map(({ script }) => script.name)).size).toBe(scripts.length)
    for (const { fileName, script } of scripts) {
      expect(script.steps.length, fileName).toBeGreaterThan(2)
      expect(script.steps.at(-1), fileName).toMatchObject({ kind: 'stop' })
    }
  })

  it('livre les quatre campagnes premier badge avec leur preset et leurs preuves matérielles', async () => {
    const cases = [
      ['campagne-premier-badge.txt', 'normal'],
      ['campagne-premier-badge-ngp-monotype-complet.txt', 'ngp-simple-full-monotype'],
      ['campagne-premier-badge-ngp-duo-eevee.txt', 'ngp-duo-eevee'],
      ['campagne-premier-badge-ngp-duo-solo-monotype.txt', 'ngp-duo-solo-monotype'],
    ] as const
    for (const [fileName, preset] of cases) {
      const script = parseRealtimeTestScript(await readFile(new URL(fileName, scenarioDirectory), 'utf8'))
      expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'bot', journey: 'zephyr', preset }))
      expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key: 'campaignmode' }))
      expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key: 'initialpartysize' }))
      expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key: 'mindoubleplayerparticipants' }))
    }
  })

  it('livre le jalon Togepi borné avec ses preuves ROM et son retour à Mauville', async () => {
    const script = parseRealtimeTestScript(await readFile(new URL('campagne-oeuf-togepi.txt', scenarioDirectory), 'utf8'))
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'bot', journey: 'togepi', preset: 'normal' }))
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key: 'togepieggreceived', expected: 'true' }))
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key: 'togepireturncomplete', expected: 'true' }))
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key: 'map', expected: '73' }))
  })

  it('livre le Badge Essaim borné et exige toutes ses preuves indépendantes', async () => {
    const script = parseRealtimeTestScript(await readFile(new URL('campagne-badge-essaim.txt', scenarioDirectory), 'utf8'))
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'bot', journey: 'hive', preset: 'normal' }))
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'wait-for', key: 'journey', expected: 'passed', timeoutMs: 15 * 60_000 }))
    for (const key of ['zephyrbadge', 'falknerdefeated', 'togepieggreceived', 'slowpokewellcleared', 'hivebadge', 'bugsydefeated', 'hivegymcomplete']) {
      expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key, expected: 'true' }))
    }
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key: 'map', expected: '180' }))
  })

  it('livre le Badge Plaine borné et exige Coupe, la Radio et Blanche', async () => {
    const script = parseRealtimeTestScript(await readFile(new URL('campagne-badge-plaine.txt', scenarioDirectory), 'utf8'))
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'bot', journey: 'plain', preset: 'normal' }))
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'wait-for', key: 'journey', expected: 'passed', timeoutMs: 20 * 60_000 }))
    for (const key of ['ilexforestcleared', 'cutlearned', 'radioquizcomplete', 'plainbadge', 'whitneydefeated', 'plaingymcomplete']) {
      expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key, expected: 'true' }))
    }
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key: 'map', expected: '137' }))
  })

  it('livre le Badge Brume borné et exige Simularbre, les fauves et Mortimer', async () => {
    const script = parseRealtimeTestScript(await readFile(new URL('campagne-badge-brume.txt', scenarioDirectory), 'utf8'))
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'bot', journey: 'fog', preset: 'normal' }))
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'wait-for', key: 'journey', expected: 'passed', timeoutMs: 25 * 60_000 }))
    for (const key of ['squirtbottlereceived', 'sudowoodocleared', 'legendarybeastsreleased', 'fogbadge', 'mortydefeated', 'foggymcomplete']) {
      expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key, expected: 'true' }))
    }
    expect(script.steps).toContainEqual(expect.objectContaining({ kind: 'expect', key: 'map', expected: '80' }))
  })
})
