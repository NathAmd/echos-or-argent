import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { listFailedRomCertifications } from './rom-audit-certifications.mjs'

const shards = 8
const concurrency = 2
const listProbesOnly = process.argv.slice(2).includes('--list-probes')
const canonicalRomPath = resolve('..', 'Pokemon - Version Or HeartGold (France).nds')
const temporaryDirectory = resolve('.tmp-rom-audit')
const consolidatedReportPath = resolve('.field-script-probe-target-details.json')
const moveEffectReportPath = resolve(temporaryDirectory, 'move-effects.json')
const playerJourneyReportPath = resolve(temporaryDirectory, 'player-journey.json')
const playerJourneyTestFile = 'src/game/simulation/openingJourney.test.ts'
const specializedRomGateVariables = new Set([
  'RUN_FULL_ROM_AUDIT',
  'RUN_MOVE_EFFECT_AUDIT',
  'RUN_WORLD_AUDIT',
])
let failed = false

async function runVitest(testFiles, arguments_ = [], environment = {}) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      './node_modules/vitest/vitest.mjs',
      'run',
      ...testFiles,
      '--reporter=verbose',
      ...arguments_,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...environment,
      },
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  if (exitCode !== 0) failed = true
  return exitCode
}

async function runShard(shard, romEnvironment) {
  return runVitest(['src/fieldScriptProbe.test.ts'], ['-t', 'audits every decoded'], {
    ...romEnvironment,
    RUN_FULL_ROM_AUDIT: '1',
    WRITE_ROM_PROBE_REPORTS: '1',
    ROM_AUDIT_SHARDS: String(shards),
    ROM_AUDIT_SHARD: String(shard),
    ROM_AUDIT_REPORT_PATH: resolve(temporaryDirectory, `shard-${shard}.json`),
  })
}

async function resolveRomPath() {
  const configuredPath = resolve(process.env.ROM_AUDIT_PATH?.trim() || canonicalRomPath)
  try {
    return await realpath(configuredPath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`ROM d'audit introuvable : ${configuredPath}. Définissez ROM_AUDIT_PATH.`, { cause: error })
    }
    throw error
  }
}

/**
 * Les probes historiques ouvrent encore le nom canonique à la racine. Quand
 * ROM_AUDIT_PATH pointe ailleurs, un lien temporaire leur présente le même
 * fichier sans recopier ses 128 Mio. Un fichier canonique différent n'est
 * jamais remplacé silencieusement.
 */
async function exposeRomAtCanonicalPath(romPath) {
  try {
    const existingPath = await realpath(canonicalRomPath)
    if (existingPath !== romPath) {
      throw new Error(`La ROM canonique ${canonicalRomPath} diffère de ROM_AUDIT_PATH (${romPath}).`)
    }
    return async () => undefined
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  await symlink(romPath, canonicalRomPath, 'file')
  return async () => {
    try {
      if (await realpath(canonicalRomPath) === romPath) await unlink(canonicalRomPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

async function listTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return listTestFiles(path)
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : []
  }))
  return nested.flat()
}

async function discoverRomGates() {
  const candidates = await listTestFiles(resolve('src'))
  const matches = await Promise.all(candidates.map(async (path) => {
    const source = await readFile(path, 'utf8')
    const testFile = relative(process.cwd(), path).split(sep).join('/')
    const environmentVariables = [...source.matchAll(/\bprocess\.env\.(RUN_[A-Z0-9_]+)\b/g)]
      .map((match) => match[1])
      .filter(Boolean)
    return [...new Set(environmentVariables)].map((environmentVariable) => ({ environmentVariable, testFile }))
  }))
  return matches.flat().sort((left, right) => (
    left.environmentVariable.localeCompare(right.environmentVariable)
      || left.testFile.localeCompare(right.testFile)
  ))
}

function romGateKey(environmentVariable, testFile) {
  return `${environmentVariable}:${testFile}`
}

function summarizeRomGates(gates, results) {
  const environmentVariables = [...new Set(gates.map(({ environmentVariable }) => environmentVariable))].sort()
  return Object.fromEntries(environmentVariables.map((environmentVariable) => {
    const files = gates
      .filter((gate) => gate.environmentVariable === environmentVariable)
      .map(({ testFile }) => testFile)
    return [environmentVariable, {
      checkedFiles: files.length,
      failedFiles: files.filter((testFile) => results.get(romGateKey(environmentVariable, testFile)) !== 0),
    }]
  }))
}

function formatRomGateList(gates) {
  const grouped = summarizeRomGates(gates, new Map())
  const lines = [`${gates.length} gates ROM découverts :`]
  for (const [environmentVariable, { checkedFiles }] of Object.entries(grouped)) {
    lines.push(`${environmentVariable} (${checkedFiles})`)
    lines.push(...gates
      .filter((gate) => gate.environmentVariable === environmentVariable)
      .map(({ testFile }) => `  ${testFile}`))
  }
  return `${lines.join('\n')}\n`
}

async function runConditionalRomGates(gates, romEnvironment) {
  const results = new Map()
  for (const { environmentVariable, testFile } of gates) {
    process.stdout.write(`\nGate ROM conditionnel (${environmentVariable}) : ${testFile}\n`)
    const gateEnvironment = {
      ...romEnvironment,
      [environmentVariable]: '1',
    }
    if (testFile === playerJourneyTestFile) gateEnvironment.PLAYER_JOURNEY_REPORT_PATH = playerJourneyReportPath
    results.set(romGateKey(environmentVariable, testFile), await runVitest([testFile], [], gateEnvironment))
  }
  return results
}

function aggregateOpcodeCounts(reports) {
  const counts = new Map()
  for (const report of reports) {
    for (const { opcode, count } of report.unsupportedByOpcode ?? []) {
      counts.set(opcode, (counts.get(opcode) ?? 0) + count)
    }
  }
  return [...counts]
    .sort(([left], [right]) => left - right)
    .map(([opcode, count]) => ({ opcode, count }))
}

async function consolidateShardReports() {
  const reports = await Promise.all(Array.from({ length: shards }, async (_, shard) => (
    JSON.parse(await readFile(resolve(temporaryDirectory, `shard-${shard}.json`), 'utf8'))
  )))
  const first = reports[0]
  if (!first) throw new Error('Aucun rapport de shard ROM n’a été produit.')
  const expectedIndexes = Array.from({ length: shards }, (_, index) => index)
  const actualIndexes = reports.map((report) => report.shard?.index).sort((left, right) => left - right)
  const consistent = reports.every((report) => report.startMapId === first.startMapId
    && report.decodedMaps === first.decodedMaps
    && report.shard?.count === shards
    && report.shard?.totalScriptEndpoints === first.shard?.totalScriptEndpoints)
  if (!consistent || JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
    throw new Error(`Rapports de shards ROM incohérents : ${JSON.stringify(actualIndexes)}.`)
  }
  const checkedScriptEndpoints = reports.reduce((sum, report) => sum + report.checkedScriptEndpoints, 0)
  if (checkedScriptEndpoints !== first.shard.totalScriptEndpoints) {
    throw new Error(`Couverture ROM incomplète : ${checkedScriptEndpoints}/${first.shard.totalScriptEndpoints} scripts.`)
  }
  const report = {
    format: 'pokemaster-rom-audit',
    revision: 9,
    generatedAt: new Date().toISOString(),
    startMapId: first.startMapId,
    decodedMaps: first.decodedMaps,
    shard: { count: shards, totalScriptEndpoints: first.shard.totalScriptEndpoints },
    checkedScriptEndpoints,
    checkedChoicePaths: reports.reduce((sum, current) => sum + current.checkedChoicePaths, 0),
    completedChoicePaths: reports.reduce((sum, current) => sum + current.completedChoicePaths, 0),
    unsupportedByOpcode: aggregateOpcodeCounts(reports),
    failureCount: reports.reduce((sum, current) => sum + current.failureCount, 0),
    failureExamples: reports.flatMap((current) => current.failureExamples ?? []).slice(0, 80),
    unsupported: reports.flatMap((current) => current.unsupported ?? []),
    terrainCoverage: first.terrainCoverage,
  }
  await writeFile(consolidatedReportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`Rapport ROM consolidé : ${checkedScriptEndpoints} scripts, ${report.completedChoicePaths}/${report.checkedChoicePaths} chemins terminés.\n`)
  return report
}

async function main() {
  const discoveredRomGates = await discoverRomGates()
  const conditionalRomGates = discoveredRomGates
    .filter(({ environmentVariable }) => !specializedRomGateVariables.has(environmentVariable))
  if (listProbesOnly) {
    process.stdout.write(formatRomGateList(discoveredRomGates))
    return
  }

  const romPath = await resolveRomPath()
  const removeCanonicalRomLink = await exposeRomAtCanonicalPath(romPath)
  const romEnvironment = {
    ...Object.fromEntries(discoveredRomGates.map(({ environmentVariable }) => [environmentVariable, '0'])),
    ROM_AUDIT_PATH: romPath,
    ROM_JOURNEY_PATH: romPath,
  }
  try {
    await rm(temporaryDirectory, { recursive: true, force: true })
    await mkdir(temporaryDirectory, { recursive: true })

    for (let shard = 0; shard < shards; shard += concurrency) {
      await Promise.all(Array.from(
        { length: Math.min(concurrency, shards - shard) },
        (_, index) => runShard(shard + index, romEnvironment),
      ))
    }

    if (!failed) {
      try {
        const report = await consolidateShardReports()
        const romGateResults = await runConditionalRomGates(conditionalRomGates, romEnvironment)
        const romGateSummary = summarizeRomGates(conditionalRomGates, romGateResults)
        const failedRomGates = conditionalRomGates.filter(({ environmentVariable, testFile }) => (
          romGateResults.get(romGateKey(environmentVariable, testFile)) !== 0
        ))
        const fieldRegressions = romGateResults.get(romGateKey('RUN_ROM_PROBES', 'src/fieldScriptProbe.test.ts')) === 0
        const storyProgression = await runVitest(
          ['src/fieldScriptProbe.test.ts'],
          ['-t', 'couvre les seize badges'],
          { ...romEnvironment, RUN_FULL_ROM_AUDIT: '1' },
        )
        const playerJourneyExitCode = romGateResults.get(romGateKey('RUN_ROM_JOURNEY', playerJourneyTestFile)) ?? 1
        const playerJourney = playerJourneyExitCode === 0
          ? JSON.parse(await readFile(playerJourneyReportPath, 'utf8'))
          : undefined
        const worldGeometryAndWarps = await runVitest(
          ['src/game/world/worldAuditProbe.test.ts'],
          [],
          { ...romEnvironment, RUN_WORLD_AUDIT: '1' },
        )
        const worldMechanisms = [
          'src/game/world/icePathMechanismProbe.test.ts',
          'src/game/world/hgssWorldEnvironmentProbe.test.ts',
        ].every((path) => romGateResults.get(romGateKey('RUN_ROM_PROBES', path)) === 0)
        const battleMoveInventory = await runVitest(
          ['src/rom/battle/moveEffectsInventoryProbe.test.ts'],
          [],
          {
            ...romEnvironment,
            RUN_MOVE_EFFECT_AUDIT: '1',
            MOVE_EFFECT_AUDIT_REPORT_PATH: moveEffectReportPath,
          },
        )
        const battleMoves = battleMoveInventory === 0
          ? JSON.parse(await readFile(moveEffectReportPath, 'utf8'))
          : undefined
        const certifications = {
          allConditionalRomProbes: romGateSummary.RUN_ROM_PROBES?.failedFiles.length === 0,
          allDiscoveredRomGates: failedRomGates.length === 0
            && report.failureCount === 0
            && storyProgression === 0
            && worldGeometryAndWarps === 0
            && battleMoveInventory === 0,
          allRomJourneyProbes: romGateSummary.RUN_ROM_JOURNEY?.failedFiles.length === 0,
          followerParameters: romGateSummary.RUN_FOLLOWER_AUDIT?.failedFiles.length === 0,
          gymAudit: romGateSummary.RUN_GYM_AUDIT?.failedFiles.length === 0,
          itemCatalog: romGateSummary.RUN_ITEM_CATALOG_AUDIT?.failedFiles.length === 0,
          uiAssets: romGateSummary.RUN_UI_ROM_PROBE?.failedFiles.length === 0,
          fieldRegressions,
          storyProgression: storyProgression === 0,
          playerJourney: playerJourneyExitCode === 0,
          worldGeometryAndWarps: worldGeometryAndWarps === 0,
          worldMechanisms,
          battleMoveInventory: battleMoveInventory === 0,
          battleMoveSemanticsComplete: battleMoves?.semanticCoverage?.complete === true,
          trainerBattleMoveSemanticsComplete: battleMoves?.semanticCoverage?.trainerUsage?.incompleteMoves?.length === 0,
          doubleBattleMoveSemanticsComplete: battleMoves?.doubleBattleCoverage?.complete === true,
          doubleTrainerBattleMoveSemanticsComplete: battleMoves?.doubleBattleCoverage?.trainerUsage?.incompleteMoves?.length === 0,
        }
        const certificationFailures = listFailedRomCertifications(certifications)
        const certifiedReport = {
          ...report,
          romProbes: romGateSummary.RUN_ROM_PROBES,
          romGates: {
            discoveredGates: discoveredRomGates.length,
            conditionalGates: conditionalRomGates.length,
            specializedVariables: [...specializedRomGateVariables].sort(),
            failedGates: failedRomGates,
            byEnvironment: romGateSummary,
          },
          playerJourney,
          battleMoves,
          certifications,
          certificationFailures,
        }
        await writeFile(consolidatedReportPath, `${JSON.stringify(certifiedReport, null, 2)}\n`)
        if (certificationFailures.length > 0) {
          failed = true
          process.stderr.write(`Certifications ROM en échec : ${certificationFailures.join(', ')}.\n`)
        }
      } catch (error) {
        failed = true
        process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
    await removeCanonicalRomLink()
  }

  if (failed) process.exitCode = 1
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
