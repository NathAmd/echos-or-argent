export type OnlineClientConfig = Readonly<{
  httpBaseUrl: string
  /** Identité logique stable utilisée pour les sessions, caches et clés du coffre. */
  identityBaseUrl: string
  webSocketBaseUrl: string
}>

const allowedIceServerKeys = new Set(['credential', 'urls', 'username'])
const maximumIceConfigurationLength = 16_384
const maximumIceServers = 8
const maximumIceUrlsPerServer = 4

function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function isPrivateIpv4Host(hostname: string): boolean {
  const octets = hostname.split('.')
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) return false
  const values = octets.map(Number)
  if (values.some((octet) => octet > 255)) return false
  const [first = -1, second = -1] = values
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254)
}

function isPrivateIpv6Host(hostname: string): boolean {
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  return /^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(unwrapped)
}

function isPrivateLanHost(hostname: string): boolean {
  return isPrivateIpv4Host(hostname) || isPrivateIpv6Host(hostname)
}

function isCanonicalMdnsHost(hostname: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/.test(hostname)
}

export function parseLanDevelopmentMode(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === 'false') return false
  if (value === 'true') return true
  throw new Error('POKEMASTER_PUBLIC_LAN_DEVELOPMENT_MODE doit valoir true ou false.')
}

function invalidIceConfiguration(reason: string): never {
  throw new Error(`Configuration ICE publique invalide : ${reason}.`)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function isValidIceHost(host: string): boolean {
  if (host.startsWith('[')) {
    if (!host.endsWith(']') || host.includes('%')) return false
    try {
      const parsed = new URL(`http://${host}`)
      return parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
    } catch {
      return false
    }
  }
  if (host.length === 0 || host.length > 253 || host.endsWith('.')) return false
  const labels = host.split('.')
  if (labels.every((label) => /^\d+$/.test(label))) {
    return labels.length === 4 && labels.every((label) => {
      if (label.length > 1 && label.startsWith('0')) return false
      const octet = Number(label)
      return Number.isInteger(octet) && octet >= 0 && octet <= 255
    })
  }
  return labels.every((label) =>
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
}

function isValidIceAuthority(authority: string): boolean {
  let host: string
  let port: string | undefined
  if (authority.startsWith('[')) {
    const match = /^(\[[^\]]+\])(?::(\d+))?$/.exec(authority)
    if (!match) return false
    host = match[1] ?? ''
    port = match[2]
  } else {
    const match = /^([^:]+)(?::(\d+))?$/.exec(authority)
    if (!match) return false
    host = match[1] ?? ''
    port = match[2]
  }
  if (!isValidIceHost(host)) return false
  if (port === undefined) return true
  if ((port.length > 1 && port.startsWith('0')) || port.length > 5) return false
  const parsedPort = Number(port)
  return Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535
}

function validateIceUrl(value: string): 'stun' | 'turn' {
  if (value.length === 0 || value.length > 512 || value.trim() !== value) {
    return invalidIceConfiguration('URL STUN/TURN vide, trop longue ou non canonique')
  }
  const match = /^(stun|stuns|turn|turns):([^/?#@]+)(?:\?transport=(udp|tcp))?$/.exec(value)
  if (!match || !isValidIceAuthority(match[2] ?? '')) {
    return invalidIceConfiguration('seules les URL STUN/TURN canoniques sans identifiants sont admises')
  }
  const scheme = match[1] ?? ''
  if ((scheme === 'stun' || scheme === 'stuns') && match[3] !== undefined) {
    return invalidIceConfiguration('le paramètre transport est réservé aux URL TURN')
  }
  return scheme === 'turn' || scheme === 'turns' ? 'turn' : 'stun'
}

function validateIceCredential(value: unknown, field: 'credential' | 'username'): string | undefined {
  if (value === undefined) return undefined
  const containsControlCharacter = typeof value === 'string'
    && [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 512
    || value.trim() !== value
    || containsControlCharacter
  ) {
    return invalidIceConfiguration(`${field} TURN invalide`)
  }
  return value
}

/**
 * Parse la liste publique de serveurs ICE. Les secrets TURN durables ne doivent
 * jamais être placés dans cette variable intégrée au JavaScript distribué.
 */
export function parseOnlineRtcIceServers(value: string | undefined): RTCConfiguration | undefined {
  if (value === undefined || value.trim() === '') return undefined
  if (value.trim() !== value || value.length > maximumIceConfigurationLength) {
    return invalidIceConfiguration('document vide, trop long ou non canonique')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    return invalidIceConfiguration('JSON mal formé')
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > maximumIceServers) {
    return invalidIceConfiguration(`la racine doit contenir de 1 à ${maximumIceServers} serveurs`)
  }

  const iceServers: RTCIceServer[] = parsed.map((entry) => {
    if (!isPlainRecord(entry) || Object.keys(entry).some((key) => !allowedIceServerKeys.has(key))) {
      return invalidIceConfiguration('chaque serveur doit contenir seulement urls, username et credential')
    }
    const rawUrls = entry.urls
    const urls = typeof rawUrls === 'string'
      ? [rawUrls]
      : Array.isArray(rawUrls) && rawUrls.every((url) => typeof url === 'string')
        ? [...rawUrls]
        : invalidIceConfiguration('urls doit être une chaîne ou un tableau de chaînes')
    if (urls.length === 0 || urls.length > maximumIceUrlsPerServer || new Set(urls).size !== urls.length) {
      return invalidIceConfiguration(`chaque serveur doit fournir de 1 à ${maximumIceUrlsPerServer} URL distinctes`)
    }
    const kinds = urls.map(validateIceUrl)
    const username = validateIceCredential(entry.username, 'username')
    const credential = validateIceCredential(entry.credential, 'credential')
    const hasTurn = kinds.includes('turn')
    if (hasTurn && (username === undefined || credential === undefined)) {
      return invalidIceConfiguration('chaque entrée TURN exige username et credential')
    }
    if (!hasTurn && (username !== undefined || credential !== undefined)) {
      return invalidIceConfiguration('une entrée STUN ne reçoit pas de credentials TURN')
    }
    Object.freeze(urls)
    const server: RTCIceServer = {
      urls,
      ...(username === undefined ? {} : { username }),
      ...(credential === undefined ? {} : { credential }),
    }
    return Object.freeze(server)
  })
  Object.freeze(iceServers)
  const configuration: RTCConfiguration = { iceServers }
  return Object.freeze(configuration)
}

function parseOnlineBaseUrl(
  value: string | undefined,
  allowLanHttp = false,
): Readonly<{ httpBaseUrl: string, webSocketBaseUrl: string }> | undefined {
  if (value === undefined || value.trim() === '') return undefined
  if (value.trim() !== value || value.length > 2_048) throw new Error('URL du serveur en ligne invalide.')
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("L'URL publique du serveur ne doit contenir ni identifiant, ni secret, ni paramètres.")
  }
  const isAllowedDevelopmentHttp = url.protocol === 'http:'
    && (isLocalDevelopmentHost(url.hostname) || (allowLanHttp && isPrivateLanHost(url.hostname)))
  if (url.protocol !== 'https:' && !isAllowedDevelopmentHttp) {
    throw new Error('Le serveur en ligne exige HTTPS hors développement local.')
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  const webSocket = new URL(url)
  webSocket.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return Object.freeze({
    httpBaseUrl: url.toString().replace(/\/$/, ''),
    webSocketBaseUrl: webSocket.toString().replace(/\/$/, ''),
  })
}

/**
 * Valide le transport public et, lorsqu'elle est distincte, l'identité stable
 * du serveur. L'identité ne sert jamais de destination réseau.
 */
export function parseOnlineClientConfig(
  value: string | undefined,
  allowLanHttp = false,
  identityValue?: string,
): OnlineClientConfig | undefined {
  const transport = parseOnlineBaseUrl(value, allowLanHttp)
  if (!transport) return undefined
  const identity = parseOnlineBaseUrl(identityValue, false)
  return Object.freeze({
    httpBaseUrl: transport.httpBaseUrl,
    identityBaseUrl: identity?.httpBaseUrl ?? transport.httpBaseUrl,
    webSocketBaseUrl: transport.webSocketBaseUrl,
  })
}

export function resolveOnlineClientConfig(
  value: string | undefined,
  developmentPage?: Readonly<{ protocol: string, hostname: string, port?: string }>,
  lanDevelopmentMode = false,
  identityValue?: string,
): OnlineClientConfig | undefined {
  if (!developmentPage) return parseOnlineClientConfig(value, false, identityValue)
  if (developmentPage.protocol !== 'http:' && developmentPage.protocol !== 'https:') return undefined
  const isLocalPage = isLocalDevelopmentHost(developmentPage.hostname)
  const isSecureLanPage = developmentPage.protocol === 'https:'
    && (isPrivateLanHost(developmentPage.hostname) || isCanonicalMdnsHost(developmentPage.hostname))
  const hostname = developmentPage.hostname === '[::1]' ? '[::1]' : developmentPage.hostname

  // En LAN, chaque navigateur parle à l'origine qu'il a effectivement ouverte.
  // L'ancienne URL de transport reste acceptée comme identité de migration afin
  // qu'un serveur déjà lancé adopte le correctif sans redémarrage ni coffre neuf.
  if (lanDevelopmentMode && (isLocalPage || isSecureLanPage)) {
    const port = developmentPage.port ? `:${developmentPage.port}` : ''
    const stableIdentity = identityValue === undefined || identityValue === ''
      ? value
      : identityValue
    return parseOnlineClientConfig(
      `${developmentPage.protocol}//${hostname}${port}`,
      false,
      stableIdentity,
    )
  }

  const configured = parseOnlineClientConfig(value, false, identityValue)
  if (configured) return configured
  if (!isLocalPage) return undefined
  return parseOnlineClientConfig(`http://${hostname}:8787`, false, identityValue)
}

export function readOnlineClientConfig(): OnlineClientConfig | undefined {
  const requestedLanDevelopmentMode = import.meta.env.DEV
    && parseLanDevelopmentMode(import.meta.env.POKEMASTER_PUBLIC_LAN_DEVELOPMENT_MODE)
  const developmentPage = import.meta.env.DEV && typeof window !== 'undefined'
    ? window.location
    : undefined
  // Une boucle locale HTTP est un contexte sécurisé sans CA. Tous les autres
  // appareils exigent HTTPS ; chaque façade relaie /v1 vers le serveur local.
  const lanDevelopmentMode = requestedLanDevelopmentMode
    && typeof window !== 'undefined'
    && window.isSecureContext
    && (
      developmentPage?.protocol === 'https:'
      || (developmentPage !== undefined && isLocalDevelopmentHost(developmentPage.hostname))
    )
  return resolveOnlineClientConfig(
    import.meta.env.POKEMASTER_PUBLIC_ONLINE_SERVER_URL,
    developmentPage,
    lanDevelopmentMode,
    import.meta.env.POKEMASTER_PUBLIC_ONLINE_SERVER_IDENTITY_URL,
  )
}

export function readOnlineRtcConfiguration(): RTCConfiguration | undefined {
  return parseOnlineRtcIceServers(import.meta.env.POKEMASTER_PUBLIC_RTC_ICE_SERVERS)
}
