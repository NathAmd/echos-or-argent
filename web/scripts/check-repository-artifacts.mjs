import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import console from 'node:console'
import { lstat, readFile } from 'node:fs/promises'
import { basename, extname, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const forbiddenArtifactExtensions = new Set([
  '.3ds',
  '.7z',
  '.bps',
  '.bz2',
  '.carc',
  '.cia',
  '.dsv',
  '.duc',
  '.gb',
  '.gba',
  '.gbc',
  '.gz',
  '.ips',
  '.ips32',
  '.jks',
  '.kdbx',
  '.key',
  '.keys',
  '.keystore',
  '.narc',
  '.ncgr',
  '.nclr',
  '.ncer',
  '.nds',
  '.nsbca',
  '.nsbmd',
  '.nsbta',
  '.nsbtp',
  '.nsbtx',
  '.nscr',
  '.nsp',
  '.p12',
  '.pem',
  '.pfx',
  '.pkcs8',
  '.ppf',
  '.rar',
  '.rom',
  '.sav',
  '.sdat',
  '.srl',
  '.tar',
  '.tgz',
  '.ups',
  '.vcdiff',
  '.xci',
  '.xdelta',
  '.xdelta3',
  '.xz',
  '.zip',
  '.zst',
])

const forbiddenPrivateKeyNames = new Set([
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
])

const forbiddenGeneratedArtifactPath = /(?:^|\/)(?:REPPORT|Reference visuel moderne|private|extracted|backups|node_modules|dist|coverage|\.tmp-rom-audit|steps)(?:\/|$)|(?:^|\/)\.field-script-probe[^/]*\.json$|(?:^|\/)\.tmp-land-inspect\.txt$|(?:^|\/)\.tmp-secret-table\.test\.ts$/i
const secretPatterns = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:gh[opusr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{80,})\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
]
const privateKeyBlock = /-----BEGIN (?:(?:DSA |ENCRYPTED |EC |OPENSSH |RSA )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----\r?\n(?:[A-Za-z0-9+/=]{32,}\r?\n){2}/

function toPosixPath(path) {
  return path.split(sep).join('/')
}

function looksLikeNintendoDsRom(bytes) {
  if (bytes.length < 0x200) return false
  const title = bytes.subarray(0, 12)
  const printableTitle = [...title].some((value) => value >= 0x21 && value <= 0x7e)
    && [...title].every((value) => value === 0 || (value >= 0x20 && value <= 0x7e))
  const gameCode = bytes.subarray(12, 16).toString('ascii')
  const makerCode = bytes.subarray(16, 18).toString('ascii')
  if (!printableTitle || !/^[A-Z0-9]{4}$/.test(gameCode) || !/^[A-Z0-9]{2}$/.test(makerCode) || bytes[18] > 3) return false

  const arm9Offset = bytes.readUInt32LE(0x20)
  const arm9Size = bytes.readUInt32LE(0x2c)
  const arm7Offset = bytes.readUInt32LE(0x30)
  const arm7Size = bytes.readUInt32LE(0x3c)
  return arm9Offset >= 0x200 && arm7Offset >= 0x200
    && arm9Size > 0 && arm7Size > 0
    && arm9Offset + arm9Size <= bytes.length
    && arm7Offset + arm7Size <= bytes.length
}

/** Pure inspection used by both CI and the regression tests. */
export function inspectRepositoryArtifact(relativePath, content = Buffer.alloc(0)) {
  const name = toPosixPath(relativePath)
  const extension = extname(name).toLowerCase()
  const fileName = basename(name).toLowerCase()
  const violations = []

  if (/^(?:\.env)(?:\.|$)/i.test(fileName) && fileName !== '.env.example') {
    violations.push(`${name}: fichier d’environnement privé`)
  }
  if (forbiddenPrivateKeyNames.has(fileName) || forbiddenArtifactExtensions.has(extension)) {
    violations.push(`${name}: extension ou nom d’artefact local interdit`)
  }
  if (forbiddenGeneratedArtifactPath.test(name)) {
    violations.push(`${name}: référence privée ou artefact généré interdit`)
  }
  if (looksLikeNintendoDsRom(content)) {
    violations.push(`${name}: en-tête de ROM Nintendo DS probable`)
  }
  if (privateKeyBlock.test(content.toString('utf8'))) {
    violations.push(`${name}: bloc de clé privée probable`)
  }

  if (secretPatterns.some((pattern) => pattern.test(content.toString('utf8')))) {
    violations.push(`${name}: jeton ou clé d’accès probable`)
  }

  return violations
}

async function listRepositoryCandidates(repositoryDirectory) {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repositoryDirectory, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  return stdout.split('\0').filter(Boolean).sort()
}

function isInside(directory, candidate) {
  const pathFromDirectory = relative(directory, candidate)
  return pathFromDirectory !== '..' && !pathFromDirectory.startsWith(`..${sep}`)
}

export async function collectRepositoryArtifactViolations(repositoryDirectory) {
  const root = resolve(repositoryDirectory)
  const violations = []
  for (const relativePath of await listRepositoryCandidates(root)) {
    const pathViolations = inspectRepositoryArtifact(relativePath)
    violations.push(...pathViolations)
    const absolutePath = resolve(root, relativePath)
    if (!isInside(root, absolutePath)) {
      violations.push(`${relativePath}: chemin hors du dépôt`)
      continue
    }

    let metadata
    try {
      metadata = await lstat(absolutePath)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (metadata.isSymbolicLink()) {
      violations.push(`${relativePath}: lien symbolique non inspectable interdit`)
      continue
    }
    if (!metadata.isFile()) {
      violations.push(`${relativePath}: type de fichier Git non régulier interdit`)
      continue
    }
    for (const violation of inspectRepositoryArtifact(relativePath, await readFile(absolutePath))) {
      if (!pathViolations.includes(violation)) violations.push(violation)
    }
  }
  return violations
}

async function main() {
  const repositoryDirectory = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const violations = await collectRepositoryArtifactViolations(repositoryDirectory)
  if (violations.length > 0) {
    console.error('Artefacts locaux interdits dans la frontière Git :')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exitCode = 1
    return
  }
  console.log('Frontière Git valide : aucun artefact interdit ni secret reconnu détecté (contrôle non exhaustif).')
}

const invokedPath = process.argv[1] && resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) await main()
