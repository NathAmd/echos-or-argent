import { Buffer } from 'node:buffer'

const mdnsLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const interfaceNamePattern = /^[A-Za-z0-9_.:-]{1,64}$/

export const lanDevelopmentPorts = Object.freeze({
  backend: 8787,
  localClient: 5173,
  networkClient: 5174,
  onboarding: 5175,
})

const sha256FingerprintPattern = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/

function parseIpv4(value) {
  if (typeof value !== 'string') return undefined
  const octets = value.split('.')
  if (
    octets.length !== 4
    || octets.some((octet) => !/^(?:0|[1-9]\d{0,2})$/.test(octet))
  ) return undefined
  const values = octets.map(Number)
  if (values.some((octet) => octet > 255)) return undefined
  return values
}

export function isPrivateIpv4(value) {
  const values = parseIpv4(value)
  if (!values) return false
  const [first = -1, second = -1] = values
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}

function interfacePriority(name, preferredInterface) {
  if (name === preferredInterface) return -100
  if (/^(?:en\d+|wl|wlan|wifi)/i.test(name)) return 0
  if (/^(?:eth|eno|ens|enp)/i.test(name)) return 1
  if (/^(?:utun|tun|tap|docker|br-|bridge|vbox|vmnet|zt|tailscale)/i.test(name)) return 20
  return 5
}

function compareIpv4(left, right) {
  const leftValues = parseIpv4(left) ?? []
  const rightValues = parseIpv4(right) ?? []
  for (let index = 0; index < 4; index += 1) {
    const difference = (leftValues[index] ?? 0) - (rightValues[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** Sélection pure et déterministe de l'adresse qui représente le vrai LAN. */
export function selectPrivateIpv4(networks, preferredInterface) {
  const candidates = []
  for (const [name, addresses] of Object.entries(networks ?? {})) {
    for (const address of addresses ?? []) {
      if (
        address
        && (address.family === 'IPv4' || address.family === 4)
        && address.internal !== true
        && isPrivateIpv4(address.address)
      ) {
        candidates.push({
          address: address.address,
          name,
          priority: interfacePriority(name, preferredInterface),
        })
      }
    }
  }
  candidates.sort((left, right) => (
    left.priority - right.priority
    || left.name.localeCompare(right.name)
    || compareIpv4(left.address, right.address)
  ))
  return candidates[0]?.address
}

export function parseDefaultRouteInterface(output) {
  if (typeof output !== 'string') return undefined
  const macOsMatch = /^\s*interface:\s*(\S+)\s*$/m.exec(output)
  const linuxMatch = /^default(?:\s+via\s+\S+)?\s+dev\s+(\S+)(?:\s|$)/m.exec(output)
  const candidate = macOsMatch?.[1] ?? linuxMatch?.[1]
  return candidate && interfaceNamePattern.test(candidate) ? candidate : undefined
}

/** Normalise un LocalHostName Bonjour en nom DNS stable et sûr. */
export function normalizeMdnsHostname(value) {
  if (typeof value !== 'string') return undefined
  let candidate = value.trim().toLowerCase()
  candidate = candidate.replace(/\.$/, '').replace(/\.local$/, '')
  if (!mdnsLabelPattern.test(candidate)) return undefined
  return `${candidate}.local`
}

export function createLanIdentity(privateIpv4, mdnsHostname) {
  if (!isPrivateIpv4(privateIpv4)) {
    throw new Error(`Adresse IPv4 privée LAN invalide : ${privateIpv4 ?? 'absente'}.`)
  }
  const normalizedMdnsHostname = mdnsHostname === undefined
    ? undefined
    : normalizeMdnsHostname(mdnsHostname)
  if (mdnsHostname !== undefined && !normalizedMdnsHostname) {
    throw new Error(`Nom mDNS LAN invalide : ${mdnsHostname}.`)
  }
  const canonicalHost = normalizedMdnsHostname ?? privateIpv4
  const canonicalOrigin = `https://${canonicalHost}:${lanDevelopmentPorts.networkClient}`
  return Object.freeze({
    canonicalHost,
    canonicalOrigin,
    ipFallbackOrigin: `https://${privateIpv4}:${lanDevelopmentPorts.networkClient}`,
    localOrigin: `http://localhost:${lanDevelopmentPorts.localClient}`,
    mdnsHostname: normalizedMdnsHostname,
    namespaceStable: normalizedMdnsHostname !== undefined,
    privateIpv4,
  })
}

/** Portail HTTP isolé : il distribue uniquement la CA publique avant HTTPS. */
export function createLanOnboardingOrigin(identity) {
  const checked = createLanIdentity(identity.privateIpv4, identity.mdnsHostname)
  return `http://${checked.privateIpv4}:${lanDevelopmentPorts.onboarding}`
}

export function normalizeSha256Fingerprint(value) {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim().toUpperCase()
  return sha256FingerprintPattern.test(candidate) ? candidate : undefined
}

function createLanOnboardingPage(identity, certificateFingerprint) {
  const checked = createLanIdentity(identity.privateIpv4, identity.mdnsHostname)
  const fingerprint = normalizeSha256Fingerprint(certificateFingerprint)
  if (!fingerprint) throw new Error('Empreinte SHA-256 de la CA LAN invalide.')
  return `<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>PokeMaster LAN</title>
<style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08172b;color:#f8fbff;font:17px/1.45 system-ui,sans-serif;padding:20px}main{width:min(620px,100%);background:#102746;border:2px solid #70cfff;border-radius:22px;padding:24px;box-shadow:0 18px 60px #0008}h1{margin:0 0 18px;color:#ffe36b}ol{padding-left:24px}a{display:block;margin-top:14px;padding:14px 18px;border-radius:999px;background:#2d83d8;color:white;text-align:center;font-weight:700;text-decoration:none}a:last-of-type{background:#efc52e;color:#14233a}code{display:block;overflow-wrap:anywhere;background:#071426;border-radius:10px;padding:12px;font-size:13px}small{display:block;margin-top:16px;color:#b9d2e8}
</style>
<main>
  <h1>PokeMaster LAN</h1>
  <ol>
    <li>Téléchargez la CA publique.</li>
    <li>Comparez son empreinte au terminal de la machine hôte.</li>
    <li>Installez-la comme CA de confiance, puis ouvrez le jeu HTTPS.</li>
  </ol>
  <a href="/pokemaster-lan-ca.crt" download>Télécharger la CA publique</a>
  <p>SHA-256</p><code>${fingerprint}</code>
  <a href="${checked.ipFallbackOrigin}">Ouvrir le jeu en HTTPS</a>
  <small>N’installez rien si l’empreinte diffère. Ce portail ne sert ni le jeu ni le serveur.</small>
</main>
</html>`
}

const onboardingSecurityHeaders = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
})

/**
 * Résolution pure des deux seules ressources du portail d’amorçage. Aucun
 * chemin `/v1`, upgrade WebSocket ou contenu du jeu n’est routé ici.
 */
export function resolveLanOnboardingResponse(request, assets) {
  const method = request?.method
  const url = request?.url
  if (method !== 'GET' && method !== 'HEAD') {
    return Object.freeze({
      body: 'Méthode refusée.',
      headers: Object.freeze({ ...onboardingSecurityHeaders, Allow: 'GET, HEAD', 'Content-Type': 'text/plain;charset=utf-8' }),
      status: 405,
    })
  }

  let body
  let headers
  if (url === '/') {
    body = createLanOnboardingPage(assets.identity, assets.certificateFingerprint)
    headers = { ...onboardingSecurityHeaders, 'Content-Type': 'text/html;charset=utf-8' }
  } else if (url === '/pokemaster-lan-ca.crt') {
    if (!(assets.caCertificate instanceof Uint8Array) || assets.caCertificate.byteLength === 0) {
      throw new Error('Certificat public de CA LAN absent.')
    }
    body = assets.caCertificate
    headers = {
      ...onboardingSecurityHeaders,
      'Content-Disposition': 'attachment; filename="pokemaster-lan-ca.crt"',
      'Content-Type': 'application/x-x509-ca-cert',
    }
  } else {
    body = 'Introuvable.'
    headers = { ...onboardingSecurityHeaders, 'Content-Type': 'text/plain;charset=utf-8' }
    return Object.freeze({ body: method === 'HEAD' ? undefined : body, headers: Object.freeze(headers), status: 404 })
  }

  return Object.freeze({
    body: method === 'HEAD' ? undefined : body,
    contentLength: typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength,
    headers: Object.freeze(headers),
    status: 200,
  })
}

/**
 * Le transport est volontairement vide : le client LAN le déduit de l'origine
 * ouverte (localhost, mDNS ou IP). Seule l'identité du coffre reste canonique.
 */
export function createLanClientPublicEnvironment(identity) {
  const checked = createLanIdentity(identity.privateIpv4, identity.mdnsHostname)
  return Object.freeze({
    POKEMASTER_PUBLIC_LAN_DEVELOPMENT_MODE: 'true',
    POKEMASTER_PUBLIC_ONLINE_SERVER_IDENTITY_URL: checked.canonicalOrigin,
    POKEMASTER_PUBLIC_ONLINE_SERVER_URL: '',
  })
}

export function createOpenSslCertificateConfiguration(identity) {
  const checked = createLanIdentity(identity.privateIpv4, identity.mdnsHostname)
  const dnsNames = [...new Set([
    ...(checked.mdnsHostname ? [checked.mdnsHostname] : []),
    'localhost',
  ])]
  const ipAddresses = [...new Set([checked.privateIpv4, '127.0.0.1'])]
  const alternatives = [
    ...dnsNames.map((name, index) => `DNS.${index + 1} = ${name}`),
    ...ipAddresses.map((address, index) => `IP.${index + 1} = ${address}`),
  ]
  return [
    '[req]',
    'distinguished_name = distinguished_name',
    'prompt = no',
    'req_extensions = server_extensions',
    '',
    '[distinguished_name]',
    `commonName = ${checked.canonicalHost}`,
    '',
    '[server_extensions]',
    'basicConstraints = critical,CA:FALSE',
    'extendedKeyUsage = serverAuth',
    'keyUsage = critical,digitalSignature,keyEncipherment',
    'subjectAltName = @alternative_names',
    '',
    '[alternative_names]',
    ...alternatives,
    '',
  ].join('\n')
}

export function createCertificateMetadata(identity) {
  const checked = createLanIdentity(identity.privateIpv4, identity.mdnsHostname)
  return Object.freeze({
    canonicalHost: checked.canonicalHost,
    dnsNames: Object.freeze([
      ...(checked.mdnsHostname ? [checked.mdnsHostname] : []),
      'localhost',
    ]),
    ipAddresses: Object.freeze([checked.privateIpv4, '127.0.0.1']),
    version: 1,
  })
}
