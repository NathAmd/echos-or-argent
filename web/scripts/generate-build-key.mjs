import console from 'node:console'
import { generateKeyPairSync } from 'node:crypto'
import { access, mkdir, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const repositoryDirectory = resolve(process.cwd(), '..')
const requestedDirectory = process.argv[2]

if (!requestedDirectory || !isAbsolute(requestedDirectory)) {
  throw new Error('Indique un dossier absolu hors du dépôt: npm run generate:build-key -- /chemin/securise')
}

const outputDirectory = resolve(requestedDirectory)
const repositoryRelativePath = relative(repositoryDirectory, outputDirectory)
if (repositoryRelativePath === '' || (repositoryRelativePath !== '..' && !repositoryRelativePath.startsWith(`..${sep}`))) {
  throw new Error('Le dossier des clés doit rester hors du dépôt PokeMaster.')
}

async function assertAbsent(path) {
  try {
    await access(path)
  } catch {
    return
  }
  throw new Error(`Le fichier existe déjà et ne sera pas remplacé: ${path}`)
}

await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
const [canonicalOutputDirectory, canonicalRepositoryDirectory] = await Promise.all([
  realpath(outputDirectory),
  realpath(repositoryDirectory),
])
const canonicalRepositoryRelativePath = relative(canonicalRepositoryDirectory, canonicalOutputDirectory)
if (canonicalRepositoryRelativePath === '' || (canonicalRepositoryRelativePath !== '..' && !canonicalRepositoryRelativePath.startsWith(`..${sep}`))) {
  throw new Error('Le dossier des clés résout vers le dépôt PokeMaster et est refusé.')
}
const privateKeyPath = resolve(canonicalOutputDirectory, 'pokemaster-build-private.pem')
const publicKeyPath = resolve(canonicalOutputDirectory, 'pokemaster-build-public.pem')
await Promise.all([assertAbsent(privateKeyPath), assertAbsent(publicKeyPath)])

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 })
await writeFile(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx', mode: 0o644 })

console.log(`Paire Ed25519 créée. Clé privée: ${privateKeyPath} · clé publique: ${publicKeyPath}`)
