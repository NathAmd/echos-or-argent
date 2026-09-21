import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyGitStatus,
  inspectGitReproducibility,
  listMissingTrackedProjectPaths,
  parseGitPorcelainV1Zero,
  requiredTrackedProjectPaths,
  summarizeGitStatus,
} from './check-git-reproducibility.mjs'

const execFileAsync = promisify(execFile)
const checkerPath = fileURLToPath(new URL('./check-git-reproducibility.mjs', import.meta.url))
const temporaryRepositories = []

async function runGit(repositoryDirectory, arguments_) {
  return execFileAsync('git', arguments_, { cwd: repositoryDirectory, encoding: 'utf8' })
}

async function createTemporaryRepository({ omittedPath } = {}) {
  const repositoryDirectory = await mkdtemp(join(tmpdir(), 'pokemaster-reproducibility-test-'))
  temporaryRepositories.push(repositoryDirectory)
  const checkerSource = await readFile(checkerPath, 'utf8')

  for (const path of requiredTrackedProjectPaths) {
    if (path === omittedPath) continue
    const absolutePath = join(repositoryDirectory, path)
    await mkdir(dirname(absolutePath), { recursive: true })
    let contents = `${path}\n`
    if (path.endsWith('.gitignore')) contents = ''
    if (path === 'web/scripts/check-git-reproducibility.mjs') contents = checkerSource
    await writeFile(absolutePath, contents)
  }

  await runGit(repositoryDirectory, ['init', '--quiet'])
  await runGit(repositoryDirectory, ['add', '--all'])
  await runGit(repositoryDirectory, [
    '-c', 'user.name=PokeMaster tests',
    '-c', 'user.email=pokemaster-tests@example.invalid',
    'commit', '--quiet', '--no-gpg-sign', '--no-verify', '-m', 'test snapshot',
  ])
  return repositoryDirectory
}

afterEach(async () => {
  await Promise.all(temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('gate de reproductibilité Git', () => {
  it('parse les chemins, espaces et renommages du format porcelain nul', () => {
    const entries = parseGitPorcelainV1Zero([
      ' M README.md',
      '?? server/src/index.ts',
      'R  nouveau nom.ts',
      'ancien nom.ts',
      '',
    ].join('\0'))

    expect(entries).toEqual([
      { status: ' M', path: 'README.md', originalPath: undefined },
      { status: '??', path: 'server/src/index.ts', originalPath: undefined },
      { status: 'R ', path: 'nouveau nom.ts', originalPath: 'ancien nom.ts' },
    ])
  })

  it('classe et compte chaque état bloquant sans masquer les conflits', () => {
    const entries = [
      { status: ' M', path: 'modified' },
      { status: 'D ', path: 'deleted' },
      { status: '??', path: 'untracked' },
      { status: 'A ', path: 'added' },
      { status: 'R ', path: 'renamed' },
      { status: 'C ', path: 'copied' },
      { status: 'UU', path: 'conflicted' },
    ]

    expect(entries.map(({ status }) => classifyGitStatus(status))).toEqual([
      'modified',
      'deleted',
      'untracked',
      'added',
      'renamed',
      'copied',
      'conflicted',
    ])
    expect(summarizeGitStatus(entries)).toMatchObject({
      modified: 1,
      deleted: 1,
      untracked: 1,
      added: 1,
      renamed: 1,
      copied: 1,
      conflicted: 1,
      total: 7,
    })
  })

  it('énumère toutes les ancres absentes de l’index', () => {
    expect(listMissingTrackedProjectPaths(
      new Set(['web/package.json']),
      ['web/package.json', 'server/package.json', '.github/workflows/validate-pull-request.yml'],
    )).toEqual(['server/package.json', '.github/workflows/validate-pull-request.yml'])
  })

  it('rejette une entrée porcelain tronquée', () => {
    expect(() => parseGitPorcelainV1Zero('M\0')).toThrow(/porcelain invalide/)
  })

  it('inspecte un vrai dépôt propre puis détecte une modification locale', async () => {
    const repositoryDirectory = await createTemporaryRepository()

    await expect(inspectGitReproducibility(repositoryDirectory)).resolves.toMatchObject({
      clean: true,
      reproducible: true,
      missingTrackedPaths: [],
    })

    await writeFile(join(repositoryDirectory, 'README.md'), 'modification locale\n')
    await expect(inspectGitReproducibility(repositoryDirectory)).resolves.toMatchObject({
      clean: false,
      reproducible: false,
      summary: { modified: 1, total: 1 },
    })
  })

  it('détecte une ancre absente dans un vrai dépôt pourtant propre', async () => {
    const repositoryDirectory = await createTemporaryRepository({ omittedPath: 'web/.node-version' })

    await expect(inspectGitReproducibility(repositoryDirectory)).resolves.toMatchObject({
      clean: true,
      reproducible: false,
      missingTrackedPaths: ['web/.node-version'],
    })
  })

  it('expose le rapport JSON et un code de sortie fail-closed via la CLI', async () => {
    const repositoryDirectory = await createTemporaryRepository()
    const temporaryCheckerPath = join(repositoryDirectory, 'web/scripts/check-git-reproducibility.mjs')
    const cleanResult = await execFileAsync(process.execPath, [temporaryCheckerPath, '--json'], {
      cwd: repositoryDirectory,
      encoding: 'utf8',
    })
    expect(JSON.parse(cleanResult.stdout)).toMatchObject({ clean: true, reproducible: true })

    await writeFile(join(repositoryDirectory, 'README.md'), 'sale\n')
    let dirtyError
    try {
      await execFileAsync(process.execPath, [temporaryCheckerPath, '--json'], {
        cwd: repositoryDirectory,
        encoding: 'utf8',
      })
    } catch (error) {
      dirtyError = error
    }
    expect(dirtyError).toMatchObject({ code: 1 })
    expect(JSON.parse(dirtyError.stdout)).toMatchObject({ clean: false, reproducible: false })
  })
})
