const STRICT_MODE = process.argv.includes('--strict')
const MIN_NPM = [10, 8, 0]
const RECOMMENDED_NODE = '22.13.0+'
const SUPPORTED_NODE_RANGE = '>=20.19.0 <21 || >=22.13.0 <23 || >=24'

function parseVersion(value) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return undefined
  return match.slice(1).map((part) => Number(part))
}

function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

function isSupportedNode(version) {
  const [major, minor, patch] = version
  if (major === 20) return compareVersions(version, [20, 19, 0]) >= 0
  if (major === 22) return compareVersions(version, [22, 13, 0]) >= 0
  if (major >= 24) return true
  return false
}

function formatVersion(version) {
  return version.join('.')
}

const nodeVersion = parseVersion(process.versions.node)
if (!nodeVersion) {
  console.error(`Impossible de lire la version Node courante: ${process.versions.node}`)
  process.exit(1)
}

const npmMatch = process.env.npm_config_user_agent?.match(/\bnpm\/(\d+\.\d+\.\d+)/)
const npmVersion = npmMatch ? parseVersion(npmMatch[1]) : undefined
const nodeSupported = isSupportedNode(nodeVersion)
const npmSupported = npmVersion ? compareVersions(npmVersion, MIN_NPM) >= 0 : true
const issues = []

if (!nodeSupported) {
  issues.push(`Node ${formatVersion(nodeVersion)} n'est pas supporte par Vite 8 / ESLint 10 dans ce projet.`)
}

if (npmVersion && !npmSupported) {
  issues.push(`npm ${formatVersion(npmVersion)} est trop ancien; npm ${formatVersion(MIN_NPM)}+ est recommande.`)
}

if (issues.length === 0) {
  const npmLabel = npmVersion ? ` et npm ${formatVersion(npmVersion)}` : ''
  console.log(`Environnement valide: Node ${formatVersion(nodeVersion)}${npmLabel}. Recommande: Node ${RECOMMENDED_NODE} sur la branche 22.x LTS.`)
  process.exit(0)
}

for (const issue of issues) console.warn(issue)
console.warn(`Versions supportees: Node ${SUPPORTED_NODE_RANGE}. Recommande: Node ${RECOMMENDED_NODE} avec npm ${formatVersion(MIN_NPM)}+.`)
console.warn('Apres un changement de version Node, supprimez node_modules puis relancez npm install.')
console.warn('Si les bindings rolldown restent absents, supprimez aussi package-lock.json avant la reinstallation.')

if (STRICT_MODE) process.exit(1)
