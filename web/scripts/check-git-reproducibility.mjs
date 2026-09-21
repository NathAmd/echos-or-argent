import { execFile } from 'node:child_process'
import console from 'node:console'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const requiredTrackedProjectPaths = Object.freeze([
  '.github/dependabot.yml',
  '.github/pull_request_template.md',
  '.github/workflows/deploy-client-pages.yml',
  '.github/workflows/publish-server-image.yml',
  '.github/workflows/validate-pull-request.yml',
  '.gitignore',
  '.gitattributes',
  '.node-version',
  '.nvmrc',
  'ARCHITECTURE_EXTENSIBLE_NG_PLUS_MULTIJOUER.md',
  'AUDIT_COMBATS_100_PERCENT.md',
  'AUDIT_PROJET_100_PERCENT.md',
  'CONTRIBUTING.md',
  'FRONTIERE_DONNEES_RESEAU.md',
  'LAN_DEVELOPMENT.md',
  'PLAN_REPRODUCTIBILITE_GIT.md',
  'README.md',
  'PUBLICATION.md',
  'LEGAL_REVIEW.md',
  'RIGHTS.md',
  'deployment/styloxis/echos-or-argent/index.html',
  'deployment/styloxis/echos-or-argent/legal.html',
  'SECURITY.md',
  'server/.dockerignore',
  'server/.env.example',
  'server/.gitignore',
  'server/.node-version',
  'server/.nvmrc',
  'server/Dockerfile',
  'server/README.md',
  'server/compose.npm.yaml',
  'server/compose.tunnel.yaml',
  'server/compose.vps.yaml',
  'server/compose.yaml',
  'server/package-lock.json',
  'server/package.json',
  'server/src/index.ts',
  'server/test/project-boundary.test.ts',
  'server/tsconfig.build.json',
  'server/tsconfig.json',
  'web/.env.example',
  'web/.gitignore',
  'web/.node-version',
  'web/.nvmrc',
  'web/BUILD_SECURITY.md',
  'web/README.md',
  'web/debug-tests/batterie-principale.txt',
  'web/eslint.config.js',
  'web/index.html',
  'web/public/NOTICE.txt',
  'web/package-lock.json',
  'web/package.json',
  'web/scripts/check-git-reproducibility.mjs',
  'web/scripts/check-git-reproducibility.test.mjs',
  'web/scripts/check-repository-artifacts.mjs',
  'web/scripts/protect-build.mjs',
  'web/scripts/run-rom-audit.mjs',
  'web/src/main.ts',
  'web/tsconfig.json',
  'web/vite.config.ts',
])

function hasRenameOrCopy(status) {
  return status.includes('R') || status.includes('C')
}

export function parseGitPorcelainV1Zero(output) {
  const fields = output.split('\0')
  const entries = []
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (!field) continue
    if (field.length < 4 || field[2] !== ' ') {
      throw new Error(`Entrée Git porcelain invalide à l’index ${index}.`)
    }
    const status = field.slice(0, 2)
    const path = field.slice(3)
    let originalPath
    if (hasRenameOrCopy(status)) {
      originalPath = fields[index + 1]
      if (!originalPath) throw new Error(`Origine Git absente pour ${path}.`)
      index += 1
    }
    entries.push(Object.freeze({ status, path, originalPath }))
  }
  return entries
}

export function classifyGitStatus(status) {
  if (status === '??') return 'untracked'
  if (status === '!!') return 'ignored'
  if (status.includes('U') || status === 'AA' || status === 'DD') return 'conflicted'
  if (status.includes('D')) return 'deleted'
  if (status.includes('A')) return 'added'
  if (status.includes('R')) return 'renamed'
  if (status.includes('C')) return 'copied'
  return 'modified'
}

export function summarizeGitStatus(entries) {
  const summary = {
    modified: 0,
    deleted: 0,
    untracked: 0,
    added: 0,
    renamed: 0,
    copied: 0,
    conflicted: 0,
    ignored: 0,
    total: entries.length,
  }
  for (const entry of entries) summary[classifyGitStatus(entry.status)] += 1
  return Object.freeze(summary)
}

export function listMissingTrackedProjectPaths(trackedPaths, requiredPaths = requiredTrackedProjectPaths) {
  const tracked = trackedPaths instanceof Set ? trackedPaths : new Set(trackedPaths)
  return requiredPaths.filter((path) => !tracked.has(path))
}

async function readGit(repositoryDirectory, arguments_) {
  const { stdout } = await execFileAsync('git', arguments_, {
    cwd: repositoryDirectory,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout
}

export async function inspectGitReproducibility(repositoryDirectory) {
  const [statusOutput, trackedOutput] = await Promise.all([
    readGit(repositoryDirectory, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    readGit(repositoryDirectory, ['ls-files', '-z']),
  ])
  const entries = parseGitPorcelainV1Zero(statusOutput)
  const trackedPaths = trackedOutput.split('\0').filter(Boolean)
  const missingTrackedPaths = listMissingTrackedProjectPaths(trackedPaths)
  return Object.freeze({
    clean: entries.length === 0,
    reproducible: entries.length === 0 && missingTrackedPaths.length === 0,
    entries,
    summary: summarizeGitStatus(entries),
    trackedFileCount: trackedPaths.length,
    missingTrackedPaths,
  })
}

function printHumanReport(report) {
  if (report.reproducible) {
    console.log(`Reproductibilité Git valide : ${report.trackedFileCount} fichiers suivis et arbre propre.`)
    return
  }

  console.error('Reproductibilité Git bloquée.')
  console.error(`État : ${report.summary.modified} modifiés, ${report.summary.added} ajoutés, ${report.summary.deleted} supprimés, ${report.summary.renamed} renommés, ${report.summary.copied} copiés, ${report.summary.untracked} non suivis, ${report.summary.conflicted} en conflit.`)
  if (report.missingTrackedPaths.length > 0) {
    console.error(`Ancres projet absentes de l’index (${report.missingTrackedPaths.length}) :`)
    for (const path of report.missingTrackedPaths) console.error(`- ${path}`)
  }
  if (report.entries.length > 0) {
    console.error(`Premiers changements locaux (${Math.min(20, report.entries.length)}/${report.entries.length}) :`)
    for (const entry of report.entries.slice(0, 20)) console.error(`- ${entry.status} ${entry.path}`)
  }
  console.error('Versionner les fichiers voulus, puis rejouer ce gate depuis un clone propre.')
}

async function main() {
  const repositoryDirectory = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const report = await inspectGitReproducibility(repositoryDirectory)
  if (process.argv.slice(2).includes('--json')) console.log(JSON.stringify(report, null, 2))
  else printHumanReport(report)
  if (!report.reproducible) process.exitCode = 1
}

async function isInvokedAsMainModule() {
  if (!process.argv[1]) return false
  const [invokedPath, modulePath] = await Promise.all([
    realpath(resolve(process.argv[1])),
    realpath(fileURLToPath(import.meta.url)),
  ])
  return invokedPath === modulePath
}

if (await isInvokedAsMainModule()) await main()
