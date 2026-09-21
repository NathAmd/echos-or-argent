import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectRepositoryArtifactViolations,
  inspectRepositoryArtifact,
} from './check-repository-artifacts.mjs'

const execFileAsync = promisify(execFile)
const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

function createNintendoDsRomCanary() {
  const bytes = Buffer.alloc(0x1000)
  bytes.write('ROM CANARY', 0, 'ascii')
  bytes.write('IPKF', 12, 'ascii')
  bytes.write('01', 16, 'ascii')
  bytes[18] = 0
  bytes.writeUInt32LE(0x200, 0x20)
  bytes.writeUInt32LE(0x100, 0x2c)
  bytes.writeUInt32LE(0x400, 0x30)
  bytes.writeUInt32LE(0x100, 0x3c)
  return bytes
}

describe('frontière des artefacts Git', () => {
  it.each([
    'rom.nds',
    'save.dsv',
    'extract/field.narc',
    'patches/game.bps',
    'backup.zip',
    '.env.production',
    'keys/id_ed25519',
    'web/.field-script-probe.json',
    'REPPORT/rom-audit.txt',
    'Reference visuel moderne/CombatMenu.png',
    'web/node_modules/cache.json',
    'web/dist/index.html',
    'private/note.txt',
  ])('refuse %s avant son entrée dans le dépôt', (path) => {
    expect(inspectRepositoryArtifact(path)).not.toEqual([])
  })

  it('détecte un jeton GitHub dans un fichier texte', () => {
    const token = ['ghp', 'A'.repeat(36)].join('_')
    expect(inspectRepositoryArtifact('notes.txt', Buffer.from(token)))
      .toContain('notes.txt: jeton ou clé d’accès probable')
  })

  it('détecte une ROM NDS masquée derrière une extension neutre', () => {
    expect(inspectRepositoryArtifact('fixtures/payload.dat', createNintendoDsRomCanary()))
      .toContain('fixtures/payload.dat: en-tête de ROM Nintendo DS probable')
  })

  it('détecte un bloc de clé privée masqué dans un fichier texte', () => {
    const content = Buffer.from([
      '-----BEGIN PRIVATE KEY-----',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      '-----END PRIVATE KEY-----',
    ].join('\n'))

    expect(inspectRepositoryArtifact('notes.txt', content))
      .toContain('notes.txt: bloc de clé privée probable')
  })

  it.each([
    '.env.example',
    'web/src/game/save/hgssSaveState.ts',
    'web/public/ui/menu-button.svg',
    'web/scripts/run-field-script-probe.ps1',
  ])('autorise le source ou la référence non extraite %s', (path) => {
    expect(inspectRepositoryArtifact(path, Buffer.from('source autorisée'))).toEqual([])
  })

  it('ignore la ROM locale ignorée mais refuse la même ROM forcée dans l’index Git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pokemaster-repository-boundary-'))
    temporaryDirectories.push(root)
    await execFileAsync('git', ['init', '--quiet'], { cwd: root })
    await writeFile(join(root, '.gitignore'), '*.nds\n')
    await writeFile(join(root, 'README.md'), 'fixture sûre\n')
    await writeFile(join(root, 'local.nds'), createNintendoDsRomCanary())
    await execFileAsync('git', ['add', '.gitignore', 'README.md'], { cwd: root })

    await expect(collectRepositoryArtifactViolations(root)).resolves.toEqual([])

    await execFileAsync('git', ['add', '--force', 'local.nds'], { cwd: root })
    const violations = await collectRepositoryArtifactViolations(root)
    expect(violations).toContain('local.nds: extension ou nom d’artefact local interdit')
    expect(violations).toContain('local.nds: en-tête de ROM Nintendo DS probable')
  })
})
