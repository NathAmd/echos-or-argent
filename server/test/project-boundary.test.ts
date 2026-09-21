import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const serverRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const sourceRoot = resolve(serverRoot, 'src')
const forbiddenDomainWords = /\b(?:pokemon|pokémon|hgss|heartgold|soulsilver|nintendo|pokemaster|rom|battle|campaign|creature|gameplay|inventory|species)\b/iu
const forbiddenBinaryExtensions = new Set([
  '.7z',
  '.3ds',
  '.aac',
  '.avi',
  '.bin',
  '.bmp',
  '.bps',
  '.cia',
  '.dat',
  '.dll',
  '.bz2',
  '.carc',
  '.dsv',
  '.dylib',
  '.exe',
  '.flac',
  '.gif',
  '.gb',
  '.gba',
  '.gbc',
  '.gz',
  '.ips',
  '.ips32',
  '.ico',
  '.jks',
  '.jpeg',
  '.jpg',
  '.kdbx',
  '.key',
  '.keys',
  '.keystore',
  '.narc',
  '.ncgr',
  '.nclr',
  '.ncer',
  '.nsbca',
  '.nsbmd',
  '.nsbta',
  '.nsbtp',
  '.nsbtx',
  '.nds',
  '.nsp',
  '.m4a',
  '.mov',
  '.mp3',
  '.mp4',
  '.oga',
  '.ogg',
  '.ogv',
  '.otf',
  '.p12',
  '.pem',
  '.pfx',
  '.pkcs8',
  '.png',
  '.ppf',
  '.rar',
  '.rom',
  '.sav',
  '.sdat',
  '.so',
  '.srl',
  '.svg',
  '.tar',
  '.tgz',
  '.ttf',
  '.ups',
  '.vcdiff',
  '.wasm',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xci',
  '.xdelta',
  '.xdelta3',
  '.xz',
  '.zip',
  '.zst',
])
const forbiddenSensitiveFileNames = new Set([
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
])

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  }))
  return nested.flat()
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate)
  return pathFromParent !== '..' && !pathFromParent.startsWith(`..${sep}`)
}

function isForbiddenProjectArtifact(filePath: string): boolean {
  const fileName = filePath.slice(filePath.lastIndexOf(sep) + 1).toLowerCase()
  return forbiddenBinaryExtensions.has(extname(fileName))
    || forbiddenSensitiveFileNames.has(fileName)
}

test('server source stays generic and cannot import client code', async () => {
  const sourceFiles = (await listFiles(sourceRoot)).filter((filePath) => filePath.endsWith('.ts'))
  assert.ok(sourceFiles.length > 0)

  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, 'utf8')
    assert.doesNotMatch(source, forbiddenDomainWords, relative(serverRoot, filePath))

    for (const match of source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)) {
      const specifier = match[2]
      assert.doesNotMatch(
        specifier ?? '',
        /(?:^|\/)(?:client|web)(?:\/|$)/iu,
        `${relative(serverRoot, filePath)} imports a client namespace`,
      )
      if (!specifier?.startsWith('.')) continue
      const importedPath = resolve(dirname(filePath), specifier)
      assert.equal(
        isInside(sourceRoot, importedPath),
        true,
        `${relative(serverRoot, filePath)} escapes server/src via ${specifier}`,
      )
    }
  }
})

test('server project contains no ROM, save, media, binary patch, archive, or private key', async () => {
  const projectFiles = await listFiles(serverRoot)
  const forbidden = projectFiles
    .filter((filePath) => !filePath.includes(`${sep}node_modules${sep}`))
    .filter((filePath) => !filePath.includes(`${sep}dist${sep}`))
    .filter(isForbiddenProjectArtifact)
    .map((filePath) => relative(serverRoot, filePath))

  assert.deepEqual(forbidden, [])
})

test('artifact boundary is case-insensitive without rejecting source patches', () => {
  for (const fileName of ['release.ZIP', 'game.BPS', 'local.NDS', 'asset.PNG', 'payload.BIN', 'private.PEM', 'id_ed25519']) {
    assert.equal(isForbiddenProjectArtifact(fileName), true, fileName)
  }

  for (const fileName of ['feature.patch', 'review.diff', 'archive-reader.ts', 'keys.ts']) {
    assert.equal(isForbiddenProjectArtifact(fileName), false, fileName)
  }
})

test('server image copies only manifests, TypeScript configuration and server source', async () => {
  const dockerfile = await readFile(resolve(serverRoot, 'Dockerfile'), 'utf8')
  const localCopies = dockerfile
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('COPY ') && !line.includes('--from='))

  assert.deepEqual(localCopies, [
    'COPY package.json package-lock.json ./',
    'COPY tsconfig.json tsconfig.build.json ./',
    'COPY src ./src',
    'COPY package.json package-lock.json ./',
  ])
  assert.doesNotMatch(dockerfile, /^\s*ADD\s/imu)
})
