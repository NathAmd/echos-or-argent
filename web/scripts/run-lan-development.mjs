import { execFile, spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import console from 'node:console'
import { randomBytes, X509Certificate } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { hostname, networkInterfaces, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  createCertificateMetadata,
  createLanClientPublicEnvironment,
  createLanIdentity,
  createLanOnboardingOrigin,
  createOpenSslCertificateConfiguration,
  lanDevelopmentPorts,
  normalizeMdnsHostname,
  parseDefaultRouteInterface,
  resolveLanOnboardingResponse,
  selectPrivateIpv4,
} from './lan-development.mjs'
import {
  inspectLanHealthProbeResponse,
  lanHealthProbeContracts,
  startLanHealthWatchdog,
} from './lan-health-watchdog.mjs'

const execFileAsync = promisify(execFile)
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const webDirectory = resolve(scriptDirectory, '..')
const repositoryDirectory = resolve(webDirectory, '..')
const serverDirectory = resolve(repositoryDirectory, 'server')
const certificateDirectory = resolve(webDirectory, '.lan')
const certificatePaths = Object.freeze({
  caCertificate: join(certificateDirectory, 'pokemaster-lan-ca.crt'),
  caPrivateKey: join(certificateDirectory, 'pokemaster-lan-ca-key.pem'),
  configuration: join(certificateDirectory, 'pokemaster-lan-openssl.cnf'),
  metadata: join(certificateDirectory, 'pokemaster-lan-certificate.json'),
  serverCertificate: join(certificateDirectory, 'pokemaster-lan-server.crt'),
  serverPrivateKey: join(certificateDirectory, 'pokemaster-lan-server-key.pem'),
})
const viteCliPath = resolve(webDirectory, 'node_modules/vite/bin/vite.js')
const tsxCliPath = resolve(serverDirectory, 'node_modules/tsx/dist/cli.mjs')
const spawnedProcesses = new Map()
let onboardingServer
let healthWatchdog
let shutdownPromise
let resolveLauncherCompletion

function fileExists(path) {
  return access(path).then(() => true, () => false)
}

async function runCommand(command, arguments_, options = {}) {
  try {
    return await execFileAsync(command, arguments_, {
      ...options,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    })
  } catch (error) {
    const detail = error?.stderr?.trim() || error?.stdout?.trim() || error?.message || String(error)
    throw new Error(`${command} ${arguments_.join(' ')} a échoué : ${detail}`, { cause: error })
  }
}

async function optionalCommand(command, arguments_) {
  try {
    return (await runCommand(command, arguments_)).stdout.trim()
  } catch {
    return undefined
  }
}

async function detectDefaultInterface() {
  const attempts = platform() === 'darwin'
    ? [['/sbin/route', ['-n', 'get', 'default']]]
    : platform() === 'linux'
      ? [['ip', ['route', 'show', 'default']]]
      : []
  for (const [command, arguments_] of attempts) {
    const output = await optionalCommand(command, arguments_)
    const parsed = parseDefaultRouteInterface(output)
    if (parsed) return parsed
  }
  return undefined
}

async function detectMdnsHostname(privateIpv4) {
  const override = process.env.POKEMASTER_LAN_HOSTNAME
  if (override !== undefined) {
    const normalized = normalizeMdnsHostname(override)
    if (!normalized) {
      throw new Error('POKEMASTER_LAN_HOSTNAME doit être un label mDNS canonique, avec ou sans suffixe .local.')
    }
    return normalized
  }

  if (platform() === 'darwin') {
    const localHostName = await optionalCommand('/usr/sbin/scutil', ['--get', 'LocalHostName'])
    const normalized = normalizeMdnsHostname(localHostName)
    if (normalized) return normalized
  }

  const systemHostname = hostname()
  if (systemHostname.toLowerCase().endsWith('.local')) {
    const normalized = normalizeMdnsHostname(systemHostname)
    if (normalized) return normalized
  }

  const candidate = normalizeMdnsHostname(systemHostname)
  if (!candidate) return undefined
  try {
    const addresses = await lookup(candidate, { all: true, verbatim: true })
    return addresses.some((address) => address.address === privateIpv4) ? candidate : undefined
  } catch {
    return undefined
  }
}

async function detectIdentity() {
  const preferredInterface = await detectDefaultInterface()
  const privateIpv4 = selectPrivateIpv4(networkInterfaces(), preferredInterface)
  if (!privateIpv4) {
    throw new Error(
      'Aucune IPv4 privée RFC1918 active détectée. Connectez la machine au Wi-Fi/Ethernet du réseau de jeu.',
    )
  }
  return createLanIdentity(privateIpv4, await detectMdnsHostname(privateIpv4))
}

async function isCertificateAuthorityUsable() {
  if (
    !await fileExists(certificatePaths.caCertificate)
    || !await fileExists(certificatePaths.caPrivateKey)
  ) return false
  try {
    await runCommand('openssl', [
      'x509', '-checkend', String(30 * 24 * 60 * 60), '-noout', '-in', certificatePaths.caCertificate,
    ])
    await runCommand('openssl', ['pkey', '-noout', '-in', certificatePaths.caPrivateKey])
    const certificatePublicKey = (await runCommand('openssl', [
      'x509', '-pubkey', '-noout', '-in', certificatePaths.caCertificate,
    ])).stdout.trim()
    const privatePublicKey = (await runCommand('openssl', [
      'pkey', '-pubout', '-in', certificatePaths.caPrivateKey,
    ])).stdout.trim()
    return certificatePublicKey === privatePublicKey
  } catch {
    return false
  }
}

async function readCertificateMetadata() {
  try {
    return JSON.parse(await readFile(certificatePaths.metadata, 'utf8'))
  } catch {
    return undefined
  }
}

async function isServerCertificateUsable(expectedMetadata) {
  if (
    !await fileExists(certificatePaths.serverCertificate)
    || !await fileExists(certificatePaths.serverPrivateKey)
    || JSON.stringify(await readCertificateMetadata()) !== JSON.stringify(expectedMetadata)
  ) return false
  try {
    await runCommand('openssl', [
      'x509', '-checkend', String(7 * 24 * 60 * 60), '-noout', '-in', certificatePaths.serverCertificate,
    ])
    await runCommand('openssl', [
      'verify', '-CAfile', certificatePaths.caCertificate, certificatePaths.serverCertificate,
    ])
    const certificatePublicKey = (await runCommand('openssl', [
      'x509', '-pubkey', '-noout', '-in', certificatePaths.serverCertificate,
    ])).stdout.trim()
    const privatePublicKey = (await runCommand('openssl', [
      'pkey', '-pubout', '-in', certificatePaths.serverPrivateKey,
    ])).stdout.trim()
    if (certificatePublicKey !== privatePublicKey) return false

    const alternatives = (await runCommand('openssl', [
      'x509', '-noout', '-ext', 'subjectAltName', '-in', certificatePaths.serverCertificate,
    ])).stdout
    return expectedMetadata.dnsNames.every((name) => alternatives.includes(`DNS:${name}`))
      && expectedMetadata.ipAddresses.every((address) => alternatives.includes(`IP Address:${address}`))
  } catch {
    return false
  }
}

async function generateCertificates(identity) {
  await runCommand('openssl', ['version'])
  await mkdir(certificateDirectory, { recursive: true, mode: 0o700 })
  await chmod(certificateDirectory, 0o700)

  const expectedMetadata = createCertificateMetadata(identity)
  const replaceCertificateAuthority = !await isCertificateAuthorityUsable()
  const replaceServerCertificate = replaceCertificateAuthority
    || !await isServerCertificateUsable(expectedMetadata)
  if (!replaceCertificateAuthority && !replaceServerCertificate) {
    await chmod(certificatePaths.caCertificate, 0o644)
    await chmod(certificatePaths.serverCertificate, 0o644)
    await chmod(certificatePaths.caPrivateKey, 0o600)
    await chmod(certificatePaths.serverPrivateKey, 0o600)
    return certificatePaths
  }

  const temporaryDirectory = await mkdtemp(join(certificateDirectory, '.generation-'))
  try {
    let signingCertificate = certificatePaths.caCertificate
    let signingPrivateKey = certificatePaths.caPrivateKey
    if (replaceCertificateAuthority) {
      signingCertificate = join(temporaryDirectory, 'ca.crt')
      signingPrivateKey = join(temporaryDirectory, 'ca-key.pem')
      await runCommand('openssl', [
        'req', '-x509', '-newkey', 'rsa:3072', '-sha256', '-nodes', '-days', '3650',
        '-keyout', signingPrivateKey,
        '-out', signingCertificate,
        '-subj', '/CN=PokeMaster LAN Development CA',
        '-addext', 'basicConstraints=critical,CA:TRUE',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
      ])
    }

    const configuration = createOpenSslCertificateConfiguration(identity)
    const temporaryConfiguration = join(temporaryDirectory, 'openssl.cnf')
    const temporaryRequest = join(temporaryDirectory, 'server.csr')
    const temporaryServerCertificate = join(temporaryDirectory, 'server.crt')
    const temporaryServerPrivateKey = join(temporaryDirectory, 'server-key.pem')
    await writeFile(temporaryConfiguration, configuration, { mode: 0o600 })
    await runCommand('openssl', [
      'req', '-new', '-newkey', 'rsa:2048', '-sha256', '-nodes',
      '-keyout', temporaryServerPrivateKey,
      '-out', temporaryRequest,
      '-config', temporaryConfiguration,
    ])
    await runCommand('openssl', [
      'x509', '-req', '-sha256', '-days', '825',
      '-in', temporaryRequest,
      '-CA', signingCertificate,
      '-CAkey', signingPrivateKey,
      '-set_serial', `0x${randomBytes(16).toString('hex')}`,
      '-out', temporaryServerCertificate,
      '-extfile', temporaryConfiguration,
      '-extensions', 'server_extensions',
    ])

    if (replaceCertificateAuthority) {
      await copyFile(signingCertificate, certificatePaths.caCertificate)
      await copyFile(signingPrivateKey, certificatePaths.caPrivateKey)
    }
    await copyFile(temporaryServerCertificate, certificatePaths.serverCertificate)
    await copyFile(temporaryServerPrivateKey, certificatePaths.serverPrivateKey)
    await writeFile(certificatePaths.configuration, configuration, { mode: 0o600 })
    await writeFile(certificatePaths.metadata, `${JSON.stringify(expectedMetadata, null, 2)}\n`, { mode: 0o600 })
    await chmod(certificatePaths.caCertificate, 0o644)
    await chmod(certificatePaths.serverCertificate, 0o644)
    await chmod(certificatePaths.caPrivateKey, 0o600)
    await chmod(certificatePaths.serverPrivateKey, 0o600)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
  return certificatePaths
}

async function assertPortAvailable(host, port, label) {
  await new Promise((resolvePromise, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (error) => {
      reject(new Error(`${label} ne peut pas écouter sur ${host}:${port} : ${error.message}`))
    })
    server.listen({ exclusive: true, host, port }, () => {
      server.close((error) => error ? reject(error) : resolvePromise())
    })
  })
}

function createOnboardingServer(identity, caCertificate, certificateFingerprint) {
  const assets = Object.freeze({ caCertificate, certificateFingerprint, identity })
  const server = http.createServer({ maxHeaderSize: 8 * 1024 }, (request, response) => {
    try {
      const result = resolveLanOnboardingResponse(request, assets)
      response.statusCode = result.status
      for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
      if (result.contentLength !== undefined) response.setHeader('Content-Length', result.contentLength)
      response.end(result.body)
    } catch (error) {
      response.statusCode = 500
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Content-Type', 'text/plain;charset=utf-8')
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.end(error instanceof Error ? error.message : 'Portail LAN indisponible.')
    }
  })
  server.headersTimeout = 5_000
  server.requestTimeout = 5_000
  server.keepAliveTimeout = 2_000
  server.maxHeadersCount = 20
  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  })
  server.on('upgrade', (_request, socket) => {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
  })
  return server
}

async function startOnboardingServer(identity, caCertificate, certificateFingerprint) {
  const server = createOnboardingServer(identity, caCertificate, certificateFingerprint)
  onboardingServer = server
  await new Promise((resolvePromise, reject) => {
    const handleStartupError = (error) => reject(error)
    server.once('error', handleStartupError)
    server.listen({ exclusive: true, host: identity.privateIpv4, port: lanDevelopmentPorts.onboarding }, () => {
      server.off('error', handleStartupError)
      server.on('error', (error) => {
        if (!shutdownPromise) void shutdown(1, `Le portail d’installation LAN s’est arrêté : ${error.message}`)
      })
      resolvePromise()
    })
  })
}

function closeOnboardingServer() {
  const server = onboardingServer
  if (!server?.listening) return Promise.resolve()
  return new Promise((resolvePromise) => {
    server.close(() => resolvePromise())
  })
}

function terminateProcess(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  try {
    if (platform() === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') console.error(`Arrêt du processus ${child.pid} impossible : ${error.message}`)
  }
}

function startProcess(label, command, arguments_, options) {
  const child = spawn(command, arguments_, {
    ...options,
    detached: platform() !== 'win32',
    stdio: 'inherit',
  })
  spawnedProcesses.set(label, child)
  child.once('error', (error) => {
    if (!shutdownPromise) void shutdown(1, `${label} n’a pas pu démarrer : ${error.message}`)
  })
  child.once('exit', (code, signal) => {
    if (!shutdownPromise) {
      const outcome = signal ? `signal ${signal}` : `code ${code ?? 1}`
      void shutdown(1, `${label} s’est arrêté (${outcome}).`)
    }
  })
  return child
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolvePromise) => child.once('exit', resolvePromise))
}

async function shutdown(exitCode, reason) {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    if (reason) console.log(`\n${reason}`)
    healthWatchdog?.stop()
    const children = [...spawnedProcesses.values()]
    for (const child of children) terminateProcess(child, 'SIGTERM')
    await Promise.race([
      Promise.all([...children.map(waitForExit), closeOnboardingServer()]),
      delay(5_000),
    ])
    for (const child of children) terminateProcess(child, 'SIGKILL')
    onboardingServer?.closeAllConnections()
    process.exitCode = exitCode
    resolveLauncherCompletion?.()
  })()
  return shutdownPromise
}

function probeLanHealthTarget(target) {
  return new Promise((resolvePromise, reject) => {
    const client = target.url.startsWith('https:') ? https : http
    const request = client.get(target.url, {
      ...(target.ca ? { ca: target.ca } : {}),
      timeout: 1_500,
    }, (response) => {
      const inspect = (body) => {
        const rawContentType = response.headers['content-type']
        const violation = inspectLanHealthProbeResponse(target.contract, {
          body,
          contentType: typeof rawContentType === 'string' ? rawContentType : undefined,
          statusCode: response.statusCode,
        })
        if (violation) reject(new Error(violation))
        else resolvePromise()
      }
      response.once('error', reject)
      if (target.contract === lanHealthProbeContracts.page) {
        response.resume()
        response.once('end', () => inspect(undefined))
        return
      }
      const chunks = []
      let receivedBytes = 0
      response.on('data', (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        receivedBytes += buffer.byteLength
        if (receivedBytes > 1_024) {
          response.destroy(new Error('corps de santé trop volumineux'))
          return
        }
        chunks.push(buffer)
      })
      response.once('end', () => inspect(Buffer.concat(chunks).toString('utf8')))
    })
    request.once('timeout', () => request.destroy(new Error('délai dépassé')))
    request.once('error', reject)
  })
}

async function waitForLanHealthTarget(target) {
  const deadline = Date.now() + 20_000
  let lastError
  while (Date.now() < deadline && !shutdownPromise) {
    try {
      await probeLanHealthTarget(target)
      return
    } catch (error) {
      lastError = error
      await delay(200)
    }
  }
  throw new Error(`${target.label} n’est pas prêt après 20 s : ${lastError?.message ?? 'raison inconnue'}`)
}

function createLanHealthTargets(identity, caCertificate) {
  return Object.freeze([
    Object.freeze({
      contract: lanHealthProbeContracts.health,
      label: 'Le serveur persistant',
      url: `http://127.0.0.1:${lanDevelopmentPorts.backend}/healthz`,
    }),
    Object.freeze({
      contract: lanHealthProbeContracts.page,
      label: 'Le client localhost',
      url: identity.localOrigin,
    }),
    Object.freeze({
      ca: caCertificate,
      contract: lanHealthProbeContracts.health,
      label: 'La façade HTTPS LAN',
      url: `${identity.ipFallbackOrigin}/healthz`,
    }),
    Object.freeze({
      ca: caCertificate,
      contract: lanHealthProbeContracts.page,
      label: 'Le client réseau HTTPS',
      url: identity.ipFallbackOrigin,
    }),
    Object.freeze({
      contract: lanHealthProbeContracts.page,
      label: 'Le portail d’installation LAN',
      url: createLanOnboardingOrigin(identity),
    }),
  ])
}

function displayConnectionDetails(identity, paths, certificateFingerprint, onboardingReady) {
  console.log('\n=== PokeMaster — réseau de développement ===')
  console.log(`Cette machine (sauvegarde navigateur existante) : ${identity.localOrigin}`)
  console.log(`Tous les autres appareils :                    ${identity.canonicalOrigin}`)
  console.log(`Serveur canonique commun du coffre :           ${identity.canonicalOrigin}`)
  console.log(`CA publique à installer sur les appareils :    ${paths.caCertificate}`)
  console.log(`Empreinte SHA-256 de la CA :                    ${certificateFingerprint}`)
  if (onboardingReady) {
    console.log(`Portail d’installation (CA publique seulement) : ${createLanOnboardingOrigin(identity)}`)
  }
  console.log(`Données persistantes des comptes/coffres :     ${resolve(serverDirectory, 'data')}`)
  if (identity.namespaceStable) {
    console.log(`Adresse IP de secours/certificat :              ${identity.ipFallbackOrigin}`)
    console.log('Le secours IP conserve en interne l’identité mDNS ci-dessus et le même espace de clés de coffre.')
  } else {
    console.warn('ATTENTION : mDNS indisponible, l’IP est l’autorité canonique. Un changement DHCP créera un autre espace de clés de coffre.')
  }
  console.log('Comparez l’empreinte avant installation. Ne partagez jamais les fichiers *-key.pem.')
  if (onboardingReady) console.log('Le portail HTTP ne sert ni jeu, ni API, ni WebSocket : le jeu reste exclusivement en HTTPS.')
  console.log('Ctrl+C arrête ensemble le portail, les deux clients et le serveur.\n')
}

function displayHelp() {
  console.log([
    'Usage : npm run dev:lan [-- --prepare-only]',
    '',
    '  sans option       lance serveur persistant + localhost HTTP + façade LAN HTTPS',
    '  --prepare-only    détecte le LAN et prépare la CA sans démarrer de processus',
    '  --managed         réservé au LaunchAgent macOS supervisé',
    '',
    `Le port HTTP ${lanDevelopmentPorts.onboarding} sert uniquement la CA publique et l’URL HTTPS.`,
    '',
    'Variable optionnelle :',
    '  POKEMASTER_LAN_HOSTNAME=machine.local  force un nom mDNS stable résolu par vos appareils',
  ].join('\n'))
}

async function main() {
  const arguments_ = process.argv.slice(2)
  if (arguments_.includes('--help') || arguments_.includes('-h')) {
    displayHelp()
    return
  }
  const unknownArguments = arguments_.filter((argument) => argument !== '--prepare-only' && argument !== '--managed')
  if (unknownArguments.length > 0) throw new Error(`Option inconnue : ${unknownArguments.join(', ')}`)
  if (arguments_.includes('--prepare-only') && arguments_.includes('--managed')) {
    throw new Error('--prepare-only et --managed ne peuvent pas être combinés.')
  }

  const identity = await detectIdentity()
  const paths = await generateCertificates(identity)
  const caCertificate = await readFile(paths.caCertificate)
  const certificateFingerprint = new X509Certificate(caCertificate).fingerprint256
  if (arguments_.includes('--prepare-only')) {
    displayConnectionDetails(identity, paths, certificateFingerprint, false)
    console.log('Préparation terminée ; aucun serveur n’a été démarré.')
    return
  }

  if (!await fileExists(viteCliPath)) throw new Error('Dépendances client absentes : lancez npm install dans web/.')
  if (!await fileExists(tsxCliPath)) throw new Error('Dépendances serveur absentes : lancez npm install dans server/.')
  await assertPortAvailable('127.0.0.1', lanDevelopmentPorts.backend, 'Le serveur persistant')
  await assertPortAvailable('127.0.0.1', lanDevelopmentPorts.localClient, 'Le client localhost principal')
  await assertPortAvailable('0.0.0.0', lanDevelopmentPorts.networkClient, 'La façade HTTPS LAN')
  await assertPortAvailable(identity.privateIpv4, lanDevelopmentPorts.onboarding, 'Le portail d’installation LAN')

  const backendEnvironment = {
    ...process.env,
    ACCOUNT_STORE_PATH: resolve(serverDirectory, 'data/accounts.json'),
    FRIEND_STORE_PATH: resolve(serverDirectory, 'data/friends.json'),
    HOST: '127.0.0.1',
    LAN_DEVELOPMENT_MODE: 'true',
    OBJECT_STORE_PATH: resolve(serverDirectory, 'data/objects'),
    PORT: String(lanDevelopmentPorts.backend),
    SHARED_SESSION_STORE_PATH: resolve(serverDirectory, 'data/shared-sessions.json'),
  }
  const commonClientEnvironment = {
    ...process.env,
    ...createLanClientPublicEnvironment(identity),
    POKEMASTER_LAN_CANONICAL_HOST: identity.canonicalHost,
    POKEMASTER_LAN_HTTPS_CERT_PATH: paths.serverCertificate,
    POKEMASTER_LAN_HTTPS_KEY_PATH: paths.serverPrivateKey,
    POKEMASTER_LAN_SERVER_URL: `http://127.0.0.1:${lanDevelopmentPorts.backend}`,
  }

  startProcess('serveur persistant', process.execPath, [tsxCliPath, 'watch', 'src/index.ts'], {
    cwd: serverDirectory,
    env: backendEnvironment,
  })
  const healthTargets = createLanHealthTargets(identity, caCertificate)
  await waitForLanHealthTarget(healthTargets[0])
  await startOnboardingServer(identity, caCertificate, certificateFingerprint)

  startProcess('client localhost', process.execPath, [viteCliPath, '--mode', 'lan'], {
    cwd: webDirectory,
    env: { ...commonClientEnvironment, POKEMASTER_LAN_FACADE: 'local' },
  })
  startProcess('façade HTTPS LAN', process.execPath, [viteCliPath, '--mode', 'lan'], {
    cwd: webDirectory,
    env: { ...commonClientEnvironment, POKEMASTER_LAN_FACADE: 'network' },
  })

  await Promise.all(healthTargets.slice(1).map(waitForLanHealthTarget))
  const launcherCompletion = new Promise((resolvePromise) => { resolveLauncherCompletion = resolvePromise })
  healthWatchdog = startLanHealthWatchdog({
    intervalMs: 5_000,
    maximumConsecutiveFailures: 3,
    targets: healthTargets,
    probe: probeLanHealthTarget,
    onUnhealthy: async (failures) => {
      const detail = failures.map(({ label, detail: reason }) => `${label} : ${reason}`).join(' ; ')
      await shutdown(1, `Watchdog LAN : services indisponibles trois fois de suite. ${detail}`)
    },
  })
  displayConnectionDetails(identity, paths, certificateFingerprint, true)
  if (arguments_.includes('--managed')) {
    console.log('Mode LaunchAgent : le watchdog provoquera une relance launchd après une panne durable.\n')
  }
  await launcherCompletion
}

process.once('SIGINT', () => void shutdown(0, 'Arrêt demandé (SIGINT).'))
process.once('SIGTERM', () => void shutdown(0, 'Arrêt demandé (SIGTERM).'))

try {
  await main()
} catch (error) {
  console.error(`\nÉchec du lanceur LAN : ${error instanceof Error ? error.message : String(error)}`)
  await shutdown(1)
}
