import { Buffer } from 'node:buffer'
import console from 'node:console'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto'
import { access, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'
import { parse, serialize } from 'parse5'

const distributionDirectory = resolve(process.cwd(), 'dist')
const repositoryDirectory = resolve(process.cwd(), '..')
const manifestName = 'integrity-manifest.json'
const signatureName = 'integrity-manifest.sig.json'
const forbiddenExtensions = new Set([
  '.dsv',
  '.7z',
  '.bz2',
  '.cjs',
  '.der',
  '.env',
  '.cts',
  '.gz',
  '.jsx',
  '.jwk',
  '.key',
  '.less',
  '.map',
  '.mjs',
  '.mts',
  '.nds',
  '.p12',
  '.p8',
  '.pem',
  '.pfx',
  '.rar',
  '.sass',
  '.sav',
  '.scss',
  '.svelte',
  '.tar',
  '.tgz',
  '.ts',
  '.tsx',
  '.vue',
  '.xz',
  '.zip',
  '.zst',
])
const forbiddenFileName = /(?:^|\/)\.env(?:\.|$)/i
const forbiddenSourceDirectory = /(?:^|\/)(?:sources?|src)(?:\/|$)/i
const sourceReference = /(?:\/\/[#@]|\/\*[#@])\s*source(?:Mapping)?URL\s*=/i
const privateKeyHeader = /-----BEGIN (?:(?:DSA |ENCRYPTED |EC |OPENSSH |RSA )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/
const highConfidenceSecretPatterns = [
  { name: 'clé d’accès AWS', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'jeton GitHub', pattern: /\b(?:gh[opusr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{80,})\b/ },
  { name: 'jeton Slack', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
]
const forbiddenProductionMarker = /\b(?:debugMap|debugPhase)\b|bot-demo|bot-controls|toggle-bot|bot-status|\/__pokemaster\/report|pokemaster-debug-tape-v1|test-tape:|realtime-test-(?:mode|panel)|data-realtime-(?:test|debug)|\b(?:godmode|instant-kill|suicide)\b/i
const sensitivePublicEnvironmentName = /(?:^|_)(?:API_?KEY|CREDENTIALS?|PASSWORD|PRIVATE|SECRET|TOKEN)(?:_|$)/i
const publicEnvironmentPrefix = 'POKEMASTER_PUBLIC_'
const publicBasePathPattern = /^\/[A-Za-z0-9._~-]+\/$/

function parsePublicBasePath(value) {
  if (value === undefined || value === '') return '/'
  if (value === '/' || publicBasePathPattern.test(value)) return value
  throw new Error(`POKEMASTER_PUBLIC_BASE_PATH invalide: ${value}. Utilisez / ou /nom-du-depot/.`)
}

function resolveOnlineConnectSources(value = process.env.POKEMASTER_PUBLIC_ONLINE_SERVER_URL) {
  if (!value) return []
  if (value.trim() !== value || value.length > 2_048) throw new Error('POKEMASTER_PUBLIC_ONLINE_SERVER_URL est invalide.')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('POKEMASTER_PUBLIC_ONLINE_SERVER_URL doit être une URL HTTPS publique sans identifiant ni paramètres.')
  }
  return [url.origin, `wss://${url.host}`]
}

function createContentSecurityPolicy(onlineConnectSources = resolveOnlineConnectSources()) {
  return [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https://api.open-meteo.com${onlineConnectSources.length > 0 ? ` ${onlineConnectSources.join(' ')}` : ''}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "form-action 'self'",
  ].join('; ')
}

const contentSecurityPolicy = createContentSecurityPolicy()
const generatedJavaScriptBundleName = /^assets\/(?:app|chunk)-[0-9a-f]{16}\.js$/

function toPosixPath(path) {
  return path.split(sep).join('/')
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`Type de fichier non autorisé dans le build: ${path}`)
  }
  return files.sort()
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function assertInsideDistribution(path) {
  const relativePath = relative(distributionDirectory, path)
  if (relativePath === '' || relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Chemin de build invalide: ${path}`)
  }
}

function isInside(directory, path) {
  const relativePath = relative(directory, path)
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
}

function sha384(content) {
  return `sha384-${createHash('sha384').update(content).digest('base64')}`
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

async function hashFile(path) {
  return sha384(await readFile(path))
}

function assertNoSensitivePublicEnvironmentVariables() {
  const suspiciousNames = Object.keys(process.env)
    .filter((name) => name.startsWith(publicEnvironmentPrefix) && sensitivePublicEnvironmentName.test(name))
  if (suspiciousNames.length > 0) {
    throw new Error(
      `Variables publiques potentiellement sensibles refusées: ${suspiciousNames.join(', ')}. `
      + `Leurs valeurs seraient récupérables dans le navigateur.`,
    )
  }
}

async function assertNoPublishedSources() {
  for (const path of await listFiles(distributionDirectory)) {
    const name = toPosixPath(relative(distributionDirectory, path))
    const extension = extname(path).toLowerCase()
    if (forbiddenFileName.test(name) || forbiddenSourceDirectory.test(name) || forbiddenExtensions.has(extension)) {
      throw new Error(`Fichier sensible ou source interdit dans le build: ${name}`)
    }
    if (['.htm', '.html', '.xhtml'].includes(extension) && name !== 'index.html') {
      throw new Error(`Page HTML secondaire non protégée interdite dans le build: ${name}`)
    }
    if (extension === '.js' && !generatedJavaScriptBundleName.test(name)) {
      throw new Error(`JavaScript public non minifié ou non versionné interdit dans le build: ${name}`)
    }
    const bytes = await readFile(path)
    const content = bytes.toString('utf8')
    if (privateKeyHeader.test(content)) throw new Error(`Clé privée interdite dans le build: ${name}`)
    if (looksLikeNintendoDsRom(bytes)) throw new Error(`ROM Nintendo DS probable interdite dans le build: ${name}`)
    if (sourceReference.test(content)) throw new Error(`Référence vers une source interdite dans le build: ${name}`)
    if (content.includes(process.cwd())) throw new Error(`Chemin local absolu publié dans le build: ${name}`)
    const leakedSecret = highConfidenceSecretPatterns.find(({ pattern }) => pattern.test(content))
    if (leakedSecret) throw new Error(`${leakedSecret.name} probable publié dans le build: ${name}`)
    if (forbiddenProductionMarker.test(content)) {
      throw new Error(`Fonction de développement publiée dans le build: ${name}`)
    }
  }
  const webManifestPath = resolve(distributionDirectory, 'site.webmanifest')
  if (await exists(webManifestPath)) {
    let manifest
    try {
      manifest = JSON.parse(await readFile(webManifestPath, 'utf8'))
    } catch {
      throw new Error('Le manifeste web distribué contient un JSON invalide.')
    }
    if (
      manifest?.start_url !== './'
      || manifest?.scope !== './'
      || !Array.isArray(manifest?.icons)
      || manifest.icons.length < 1
      || manifest.icons.length > 16
    ) {
      throw new Error('Le manifeste web doit utiliser un start_url et un scope relatifs au déploiement Pages.')
    }
    for (const icon of manifest.icons) {
      const source = icon?.src
      if (typeof source !== 'string' || !/^[A-Za-z0-9._-]+$/.test(source)) {
        throw new Error('Le manifeste web contient un chemin d’icône non relatif ou ambigu.')
      }
      const iconPath = resolve(distributionDirectory, source)
      assertInsideDistribution(iconPath)
      if (!await exists(iconPath)) throw new Error(`Icône du manifeste web absente du build: ${source}`)
    }
  }
}

async function resolveDistributionUrl(url, publicBasePath) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) {
    throw new Error(`Ressource exécutable externe interdite dans le build: ${url}`)
  }
  const encodedPathname = url.split(/[?#]/, 1)[0] ?? ''
  if (encodedPathname.includes('\\') || /%(?:00|2f|5c)/i.test(encodedPathname)) {
    throw new Error(`Chemin de ressource HTML ambigu interdit: ${url}`)
  }
  const decodedPathname = decodeURIComponent(encodedPathname)
  if (!/^\/?[A-Za-z0-9._/-]+$/.test(decodedPathname)) {
    throw new Error(`Chemin de ressource HTML non canonique interdit: ${url}`)
  }
  let pathname = decodedPathname
  if (pathname.startsWith('/')) {
    if (!pathname.startsWith(publicBasePath)) {
      throw new Error(`Ressource HTML hors du chemin public ${publicBasePath}: ${url}`)
    }
    pathname = pathname.slice(publicBasePath.length)
  }
  pathname = pathname.replace(/^\.\//, '')
  if (!pathname) return undefined

  const directPath = resolve(distributionDirectory, pathname)
  assertInsideDistribution(directPath)
  if (await exists(directPath)) return directPath
  throw new Error(`Ressource HTML absente du build: ${url}`)
}

function parseHtmlDocument(html) {
  const parseErrors = []
  const document = parse(html, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      parseErrors.push(error)
    },
  })
  if (parseErrors.length > 0) {
    const firstError = parseErrors[0]
    throw new Error(`HTML de build invalide (${firstError.code}, ligne ${firstError.startLine}, colonne ${firstError.startCol}).`)
  }
  return document
}

function collectElements(root) {
  const elements = []
  const visit = (node) => {
    if (typeof node?.tagName === 'string') elements.push(node)
    for (const child of node?.childNodes ?? []) visit(child)
    if (node?.tagName === 'template' && node.content) visit(node.content)
  }
  visit(root)
  return elements
}

function attribute(element, name) {
  return element.attrs.find((candidate) => candidate.name === name)?.value
}

function setAttribute(element, name, value) {
  element.attrs = element.attrs.filter((candidate) => candidate.name !== name)
  element.attrs.push({ name, value })
}

function detachElement(element) {
  const parent = element.parentNode
  if (!parent?.childNodes) throw new Error(`Élément HTML ${element.tagName} sans parent valide.`)
  parent.childNodes = parent.childNodes.filter((child) => child !== element)
  element.parentNode = null
}

function createHtmlElement(parent, tagName, attributes) {
  return {
    nodeName: tagName,
    tagName,
    attrs: Object.entries(attributes).map(([name, value]) => ({ name, value })),
    namespaceURI: parent.namespaceURI,
    childNodes: [],
    parentNode: parent,
  }
}

function findDocumentHead(document) {
  const heads = collectElements(document).filter((element) => element.tagName === 'head')
  if (heads.length !== 1 || !heads[0].sourceCodeLocation) {
    throw new Error('Une unique balise head explicite est requise dans dist/index.html.')
  }
  return heads[0]
}

function isContentSecurityPolicyMeta(element) {
  return element.tagName === 'meta'
    && attribute(element, 'http-equiv')?.trim().toLowerCase() === 'content-security-policy'
}

function isReferrerMeta(element) {
  return element.tagName === 'meta'
    && attribute(element, 'name')?.trim().toLowerCase() === 'referrer'
}

function getProtectedResourceSource(element) {
  if (element.tagName === 'script') {
    if (!element.sourceCodeLocation) throw new Error('Script HTML implicite ou déplacé refusé dans dist/index.html.')
    const source = attribute(element, 'src')
    if (!source) throw new Error('Les scripts inline sont interdits dans le build de production.')
    return source
  }
  if (element.tagName !== 'link') return undefined

  const relations = (attribute(element, 'rel') ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const preloadType = (attribute(element, 'as') ?? '').trim().toLowerCase()
  const protectedRelation = relations.includes('stylesheet')
    || relations.includes('modulepreload')
    || (relations.includes('preload') && ['script', 'style'].includes(preloadType))
  if (!protectedRelation) return undefined
  const source = attribute(element, 'href')
  if (!source) throw new Error('Une ressource link exécutable ou de style doit avoir un attribut href.')
  return source
}

async function addSubresourceIntegrity(document, publicBasePath) {
  for (const element of collectElements(document)) {
    const source = getProtectedResourceSource(element)
    if (!source) continue
    const assetPath = await resolveDistributionUrl(source, publicBasePath)
    setAttribute(element, 'integrity', await hashFile(assetPath))
    setAttribute(element, 'crossorigin', 'anonymous')
  }
}

async function assertHtmlProtection(html, publicBasePath) {
  const document = parseHtmlDocument(html)
  const elements = collectElements(document)
  const head = findDocumentHead(document)
  const headElements = head.childNodes.filter((node) => typeof node?.tagName === 'string')
  const cspTags = elements.filter(isContentSecurityPolicyMeta)
  const referrerTags = elements.filter(isReferrerMeta)
  const embeddedPolicy = cspTags.length === 1 ? attribute(cspTags[0], 'content') : undefined
  const expectedPolicy = process.argv.includes('--verify') && resolveOnlineConnectSources().length === 0
    ? embeddedPolicy && (() => {
        const connectDirective = embeddedPolicy.split('; ').find((directive) => directive.startsWith('connect-src '))
        const sources = connectDirective?.split(' ').slice(3) ?? []
        if (sources.length === 0) return createContentSecurityPolicy()
        if (sources.length !== 2) return undefined
        try {
          const [httpsSource, webSocketSource] = sources
          const httpsUrl = new URL(httpsSource)
          const webSocketUrl = new URL(webSocketSource)
          if (httpsUrl.protocol !== 'https:' || webSocketUrl.protocol !== 'wss:' || httpsUrl.host !== webSocketUrl.host) return undefined
          if (httpsUrl.origin !== httpsSource || `${webSocketUrl.protocol}//${webSocketUrl.host}` !== webSocketSource) return undefined
          return createContentSecurityPolicy(sources)
        } catch {
          return undefined
        }
      })()
    : contentSecurityPolicy
  if (cspTags.length !== 1 || embeddedPolicy !== expectedPolicy || headElements[1] !== cspTags[0]) {
    throw new Error('La politique CSP canonique est absente, tardive ou a été modifiée dans dist/index.html.')
  }
  if (referrerTags.length !== 1 || attribute(referrerTags[0], 'content')?.toLowerCase() !== 'no-referrer' || headElements[2] !== referrerTags[0]) {
    throw new Error('La politique referrer no-referrer est absente, tardive ou a été modifiée dans dist/index.html.')
  }
  if (headElements[0]?.tagName !== 'meta' || attribute(headElements[0], 'charset')?.toLowerCase() !== 'utf-8') {
    throw new Error('La balise charset UTF-8 doit précéder la CSP dans dist/index.html.')
  }

  let protectedResources = 0
  for (const element of elements) {
    const source = getProtectedResourceSource(element)
    if (!source) continue
    protectedResources += 1
    if (attribute(element, 'crossorigin')?.toLowerCase() !== 'anonymous') {
      throw new Error(`Protection SRI incomplète pour ${source}.`)
    }
    const assetPath = await resolveDistributionUrl(source, publicBasePath)
    if (attribute(element, 'integrity') !== await hashFile(assetPath)) throw new Error(`Empreinte SRI invalide pour ${source}.`)
  }
  if (protectedResources === 0) throw new Error('Aucune ressource exécutable ou feuille de style protégée par SRI.')
}

function addSecurityMetadata(document) {
  const elements = collectElements(document)
  const head = findDocumentHead(document)
  const charsets = elements.filter((element) => element.tagName === 'meta' && attribute(element, 'charset') !== undefined)
  if (charsets.length !== 1 || attribute(charsets[0], 'charset')?.trim().toLowerCase() !== 'utf-8') {
    throw new Error('Une unique balise meta charset UTF-8 est requise dans dist/index.html.')
  }
  for (const element of elements.filter((candidate) => isContentSecurityPolicyMeta(candidate) || isReferrerMeta(candidate))) {
    detachElement(element)
  }
  const charset = charsets[0]
  detachElement(charset)
  charset.parentNode = head
  const csp = createHtmlElement(head, 'meta', {
    'http-equiv': 'Content-Security-Policy',
    content: contentSecurityPolicy,
  })
  const referrer = createHtmlElement(head, 'meta', { name: 'referrer', content: 'no-referrer' })
  head.childNodes = [charset, csp, referrer, ...head.childNodes]
}

async function protectHtml(html, publicBasePath) {
  const document = parseHtmlDocument(html)
  addSecurityMetadata(document)
  await addSubresourceIntegrity(document, publicBasePath)
  return `${serialize(document)}\n`
}

async function createManifest(publicBasePath) {
  const files = (await listFiles(distributionDirectory))
    .filter((path) => ![manifestName, signatureName].includes(toPosixPath(relative(distributionDirectory, path))))
  const hashes = {}
  for (const path of files) hashes[toPosixPath(relative(distributionDirectory, path))] = await hashFile(path)
  return `${JSON.stringify({ version: 1, algorithm: 'SHA-384', publicBasePath, files: hashes }, null, 2)}\n`
}

async function signManifest(manifest) {
  const signingKeyPath = process.env.POKEMASTER_BUILD_SIGNING_KEY_FILE
  if (!signingKeyPath) {
    if (process.env.POKEMASTER_REQUIRE_BUILD_SIGNATURE === '1') {
      throw new Error('Signature de build obligatoire, mais POKEMASTER_BUILD_SIGNING_KEY_FILE est absent.')
    }
    return undefined
  }

  const [resolvedSigningKeyPath, resolvedRepositoryDirectory] = await Promise.all([
    realpath(resolve(signingKeyPath)),
    realpath(repositoryDirectory),
  ])
  if (isInside(resolvedRepositoryDirectory, resolvedSigningKeyPath)) {
    throw new Error('La clé privée de signature doit rester hors du dépôt.')
  }
  const privateKey = createPrivateKey({
    key: await readFile(resolvedSigningKeyPath),
    passphrase: process.env.POKEMASTER_BUILD_SIGNING_KEY_PASSPHRASE,
  })
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('POKEMASTER_BUILD_SIGNING_KEY_FILE doit contenir une clé privée Ed25519.')
  }
  const signature = sign(null, Buffer.from(manifest), privateKey).toString('base64')
  const signatureDocument = {
    version: 1,
    algorithm: 'Ed25519',
    signature,
  }
  await writeFile(resolve(distributionDirectory, signatureName), `${JSON.stringify(signatureDocument, null, 2)}\n`, { flag: 'wx' })

  const publicKey = createPublicKey(privateKey)
  if (!verify(null, Buffer.from(manifest), publicKey, Buffer.from(signature, 'base64'))) {
    throw new Error('La signature du manifeste généré est invalide.')
  }
  return publicKey
}

async function verifyManifest(generatedPublicKey) {
  const manifestPath = resolve(distributionDirectory, manifestName)
  const manifestContent = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(manifestContent)
  if (manifest.version !== 1 || manifest.algorithm !== 'SHA-384' || typeof manifest.files !== 'object' || !manifest.files) {
    throw new Error('Format du manifeste d’intégrité invalide.')
  }
  const publicBasePath = parsePublicBasePath(manifest.publicBasePath)
  if (
    process.env.POKEMASTER_PUBLIC_BASE_PATH
    && parsePublicBasePath(process.env.POKEMASTER_PUBLIC_BASE_PATH) !== publicBasePath
  ) {
    throw new Error('Le chemin public du build ne correspond pas à POKEMASTER_PUBLIC_BASE_PATH.')
  }

  const actualFiles = (await listFiles(distributionDirectory))
    .map((path) => toPosixPath(relative(distributionDirectory, path)))
    .filter((name) => ![manifestName, signatureName].includes(name))
  const expectedFiles = Object.keys(manifest.files).sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('La liste des fichiers du build ne correspond pas au manifeste d’intégrité.')
  }

  for (const name of expectedFiles) {
    const path = resolve(distributionDirectory, name)
    assertInsideDistribution(path)
    if (await hashFile(path) !== manifest.files[name]) throw new Error(`Fichier de build modifié: ${name}`)
  }
  await assertNoPublishedSources()
  await assertHtmlProtection(await readFile(resolve(distributionDirectory, 'index.html'), 'utf8'), publicBasePath)

  const signaturePath = resolve(distributionDirectory, signatureName)
  const verificationKeyPath = process.env.POKEMASTER_BUILD_VERIFY_KEY_FILE
  const signaturePresent = await exists(signaturePath)
  const signatureRequired = process.env.POKEMASTER_REQUIRE_BUILD_SIGNATURE === '1' || Boolean(verificationKeyPath)
  if (signatureRequired && !signaturePresent) {
    throw new Error('La signature Ed25519 obligatoire est absente du build.')
  }
  if (signatureRequired && !generatedPublicKey && !verificationKeyPath) {
    throw new Error('POKEMASTER_BUILD_VERIFY_KEY_FILE est requis pour authentifier ce build signé.')
  }

  let signatureVerified = false
  if (signaturePresent && (generatedPublicKey || verificationKeyPath)) {
    const signatureDocument = JSON.parse(await readFile(signaturePath, 'utf8'))
    if (signatureDocument.version !== 1 || signatureDocument.algorithm !== 'Ed25519' || typeof signatureDocument.signature !== 'string') {
      throw new Error('Format de signature invalide.')
    }
    const publicKey = generatedPublicKey ?? createPublicKey(await readFile(resolve(verificationKeyPath)))
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('POKEMASTER_BUILD_VERIFY_KEY_FILE doit contenir une clé publique Ed25519.')
    }
    if (!verify(null, Buffer.from(manifestContent), publicKey, Buffer.from(signatureDocument.signature, 'base64'))) {
      throw new Error('Signature Ed25519 du build invalide.')
    }
    signatureVerified = true
  }
  return { files: expectedFiles.length, signaturePresent, signatureVerified }
}

async function finalizeBuild() {
  assertNoSensitivePublicEnvironmentVariables()
  await assertNoPublishedSources()
  const publicBasePath = parsePublicBasePath(process.env.POKEMASTER_PUBLIC_BASE_PATH)
  const indexPath = resolve(distributionDirectory, 'index.html')
  const originalHtml = await readFile(indexPath, 'utf8')
  const protectedHtml = await protectHtml(originalHtml, publicBasePath)
  await writeFile(indexPath, protectedHtml)
  await assertHtmlProtection(protectedHtml, publicBasePath)
  const manifest = await createManifest(publicBasePath)
  await writeFile(resolve(distributionDirectory, manifestName), manifest, { flag: 'wx' })
  const generatedPublicKey = await signManifest(manifest)
  return verifyManifest(generatedPublicKey)
}

const result = process.argv.includes('--verify') ? await verifyManifest() : await finalizeBuild()
const signatureStatus = result.signatureVerified
  ? 'présente et vérifiée'
  : result.signaturePresent
    ? 'présente, mais non authentifiée sans clé publique'
    : 'non configurée'
console.log(`Build protégé vérifié: ${result.files} fichiers, signature Ed25519 ${signatureStatus}.`)
