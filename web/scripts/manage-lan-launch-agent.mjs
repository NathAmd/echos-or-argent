import { execFile } from 'node:child_process'
import console from 'node:console'
import { randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptPath = fileURLToPath(import.meta.url)
const scriptDirectory = dirname(scriptPath)
const defaultWebDirectory = resolve(scriptDirectory, '..')

export const lanLaunchAgentLabel = 'com.pokemaster.private-lan'
export const lanLaunchAgentFileName = `${lanLaunchAgentLabel}.plist`

function requireAbsolutePath(name, value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || !isAbsolute(value)
    || normalize(value) !== value
  ) throw new TypeError(`${name} doit être un chemin absolu canonique.`)
  return value
}

function isInside(directory, candidate) {
  const pathFromDirectory = relative(directory, candidate)
  return pathFromDirectory !== '..'
    && !pathFromDirectory.startsWith(`..${sep}`)
    && !isAbsolute(pathFromDirectory)
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function resolveLanLaunchAgentPaths(options) {
  const homeDirectory = requireAbsolutePath('Le dossier utilisateur', options?.homeDirectory)
  const webDirectory = requireAbsolutePath('Le dossier web', options?.webDirectory)
  const nodeExecutable = requireAbsolutePath('L’exécutable Node', options?.nodeExecutable)
  const launchAgentsDirectory = join(homeDirectory, 'Library', 'LaunchAgents')
  const logDirectory = join(webDirectory, '.lan', 'logs')
  return Object.freeze({
    errorLog: join(logDirectory, 'launch-agent-error.log'),
    launchAgentsDirectory,
    logDirectory,
    nodeExecutable,
    outputLog: join(logDirectory, 'launch-agent-output.log'),
    plist: join(launchAgentsDirectory, lanLaunchAgentFileName),
    runnerScript: join(webDirectory, 'scripts', 'run-lan-development.mjs'),
    webDirectory,
  })
}

/** Génère l'unique plist admise, sans shell, environnement, secret ou clé TLS. */
export function createLanLaunchAgentPlist(paths) {
  const webDirectory = requireAbsolutePath('WorkingDirectory', paths?.webDirectory)
  const nodeExecutable = requireAbsolutePath('ProgramArguments[0]', paths?.nodeExecutable)
  const runnerScript = requireAbsolutePath('ProgramArguments[1]', paths?.runnerScript)
  const outputLog = requireAbsolutePath('StandardOutPath', paths?.outputLog)
  const errorLog = requireAbsolutePath('StandardErrorPath', paths?.errorLog)
  if (
    !isInside(webDirectory, runnerScript)
    || !isInside(webDirectory, outputLog)
    || !isInside(webDirectory, errorLog)
    || runnerScript !== join(webDirectory, 'scripts', 'run-lan-development.mjs')
    || outputLog !== join(webDirectory, '.lan', 'logs', 'launch-agent-output.log')
    || errorLog !== join(webDirectory, '.lan', 'logs', 'launch-agent-error.log')
  ) {
    throw new TypeError('Le script ou les journaux LaunchAgent ne correspondent pas aux chemins LAN réservés.')
  }
  const values = [nodeExecutable, runnerScript, webDirectory, outputLog, errorLog].map(escapeXml)
  const [node, runner, workingDirectory, stdout, stderr] = values
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${lanLaunchAgentLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${runner}</string>
    <string>--managed</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${workingDirectory}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>NetworkState</key>
    <true/>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ExitTimeOut</key>
  <integer>15</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>AbandonProcessGroup</key>
  <false/>
  <key>Umask</key>
  <integer>63</integer>
  <key>StandardOutPath</key>
  <string>${stdout}</string>
  <key>StandardErrorPath</key>
  <string>${stderr}</string>
</dict>
</plist>
`
  if (/EnvironmentVariables|\.pem(?:<|$)|(?:token|password|secret)|PRIVATE KEY/i.test(plist)) {
    throw new Error('Le plist LaunchAgent contient une valeur sensible.')
  }
  return plist
}

async function metadataOrUndefined(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function ensureRegularDirectory(path, mode) {
  await mkdir(path, { mode, recursive: true })
  const metadata = await lstat(path)
  const canonicalPath = await realpath(path)
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || canonicalPath !== path) {
    throw new Error(`Dossier LaunchAgent non sûr : ${path}`)
  }
}

/** Écrit dans le même dossier, synchronise, valide, puis renomme atomiquement. */
export async function writeLaunchAgentPlistAtomically(path, contents, options = {}) {
  const target = requireAbsolutePath('Le plist LaunchAgent', path)
  if (basename(target) !== lanLaunchAgentFileName || basename(dirname(target)) !== 'LaunchAgents') {
    throw new TypeError('La cible ne correspond pas au plist LaunchAgent PokeMaster réservé.')
  }
  if (typeof contents !== 'string' || contents.length === 0 || contents.length > 32 * 1024) {
    throw new TypeError('Le plist LaunchAgent est vide ou trop volumineux.')
  }
  const directory = dirname(target)
  await ensureRegularDirectory(directory, 0o700)
  const targetMetadata = await metadataOrUndefined(target)
  if (targetMetadata?.isSymbolicLink() || (targetMetadata && !targetMetadata.isFile())) {
    throw new Error('La cible du plist LaunchAgent doit être un fichier régulier non symbolique.')
  }
  const temporaryPath = join(directory, `.${lanLaunchAgentFileName}.${process.pid}.${randomUUID()}.tmp`)
  let handle
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await options.validate?.(temporaryPath)
    await rename(temporaryPath, target)
    await chmod(target, 0o600)
    const directoryHandle = await open(directory, 'r')
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function validatePlist(path) {
  await execFileAsync('/usr/bin/plutil', ['-lint', '--', path], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
  })
}

async function resolveContext() {
  if (platform() !== 'darwin') throw new Error('Le gestionnaire LaunchAgent est réservé à macOS.')
  const webDirectory = await realpath(defaultWebDirectory)
  const nodeExecutable = await realpath(process.execPath)
  const homeDirectory = await realpath(homedir())
  const paths = resolveLanLaunchAgentPaths({ homeDirectory, nodeExecutable, webDirectory })
  const runnerMetadata = await lstat(paths.runnerScript)
  const nodeMetadata = await lstat(paths.nodeExecutable)
  if (!runnerMetadata.isFile() || !nodeMetadata.isFile()) {
    throw new Error('Node ou le lanceur LAN n’est pas un fichier régulier.')
  }
  const uid = process.getuid?.()
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error('UID macOS indisponible.')
  return Object.freeze({
    domain: `gui/${uid}`,
    paths,
    plist: createLanLaunchAgentPlist(paths),
    serviceTarget: `gui/${uid}/${lanLaunchAgentLabel}`,
  })
}

async function launchctl(arguments_, allowFailure = false) {
  try {
    const result = await execFileAsync('/bin/launchctl', arguments_, {
      encoding: 'utf8',
      maxBuffer: 512 * 1024,
    })
    return Object.freeze({ ...result, ok: true })
  } catch (error) {
    if (allowFailure) return Object.freeze({
      ok: false,
      stderr: error?.stderr ?? '',
      stdout: error?.stdout ?? '',
    })
    const detail = error?.stderr?.trim() || error?.stdout?.trim() || error?.message || String(error)
    throw new Error(`launchctl ${arguments_.join(' ')} a échoué : ${detail}`, { cause: error })
  }
}

async function isLoaded(context) {
  return (await launchctl(['print', context.serviceTarget], true)).ok
}

async function requireInstalledDefinition(context) {
  const metadata = await metadataOrUndefined(context.paths.plist)
  if (!metadata) throw new Error('LaunchAgent absent. Lancez d’abord npm run lan:service:install.')
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('Plist LaunchAgent non sûr.')
  const installed = await readFile(context.paths.plist, 'utf8')
  if (installed !== context.plist) {
    throw new Error('LaunchAgent obsolète. Arrêtez-le puis relancez npm run lan:service:install.')
  }
}

async function install(context) {
  if (await isLoaded(context)) {
    throw new Error('Le LaunchAgent est chargé. Arrêtez-le avant de remplacer sa définition.')
  }
  await ensureRegularDirectory(context.paths.logDirectory, 0o700)
  await writeLaunchAgentPlistAtomically(context.paths.plist, context.plist, { validate: validatePlist })
  console.log(`LaunchAgent installé sans être chargé : ${context.paths.plist}`)
  console.log('Lancez npm run lan:service:start lorsque l’instance LAN manuelle est arrêtée.')
}

async function start(context) {
  await requireInstalledDefinition(context)
  await launchctl(['enable', context.serviceTarget])
  if (await isLoaded(context)) {
    await launchctl(['kickstart', '-k', context.serviceTarget])
  } else {
    await launchctl(['bootstrap', context.domain, context.paths.plist])
  }
  console.log(`LaunchAgent chargé : ${context.serviceTarget}`)
}

async function stop(context) {
  if (!await isLoaded(context)) {
    console.log('LaunchAgent déjà arrêté.')
    return
  }
  await launchctl(['bootout', context.serviceTarget])
  console.log('LaunchAgent arrêté ; son plist reste installé.')
}

async function status(context) {
  const installed = await metadataOrUndefined(context.paths.plist)
  console.log(`Plist : ${installed ? context.paths.plist : 'non installé'}`)
  const state = await launchctl(['print', context.serviceTarget], true)
  if (!state.ok) {
    console.log('État : arrêté/non chargé')
    return
  }
  console.log('État : chargé')
  if (state.stdout.trim()) console.log(state.stdout.trim())
}

async function uninstall(context) {
  if (await isLoaded(context)) await launchctl(['bootout', context.serviceTarget])
  const metadata = await metadataOrUndefined(context.paths.plist)
  if (metadata?.isSymbolicLink() || (metadata && !metadata.isFile())) {
    throw new Error('Refus de supprimer une cible LaunchAgent non régulière.')
  }
  await rm(context.paths.plist, { force: true })
  console.log('LaunchAgent arrêté et plist supprimé. Les certificats, journaux et données restent intacts.')
}

function displayHelp() {
  console.log([
    'Usage : npm run lan:service:<commande>',
    '',
    '  install    écrit atomiquement le plist utilisateur, sans le charger',
    '  start      charge ou relance le LaunchAgent installé',
    '  stop       décharge le LaunchAgent sans supprimer son plist',
    '  status     affiche son état launchd',
    '  uninstall  décharge puis supprime seulement son plist',
    '',
    'Le service démarre à l’ouverture de session macOS et relance la pile si son watchdog échoue.',
  ].join('\n'))
}

async function main() {
  const [command, ...extra] = process.argv.slice(2)
  if (extra.length > 0) throw new Error(`Options inconnues : ${extra.join(', ')}`)
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    displayHelp()
    return
  }
  if (!['install', 'start', 'stop', 'status', 'uninstall'].includes(command)) {
    throw new Error(`Commande LaunchAgent inconnue : ${command}`)
  }
  const context = await resolveContext()
  if (command === 'install') await install(context)
  else if (command === 'start') await start(context)
  else if (command === 'stop') await stop(context)
  else if (command === 'status') await status(context)
  else await uninstall(context)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  try {
    await main()
  } catch (error) {
    console.error(`Gestion LaunchAgent impossible : ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
