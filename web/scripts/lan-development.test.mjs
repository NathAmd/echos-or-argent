import { describe, expect, it } from 'vitest'
import {
  createCertificateMetadata,
  createLanClientPublicEnvironment,
  createLanIdentity,
  createLanOnboardingOrigin,
  createOpenSslCertificateConfiguration,
  isPrivateIpv4,
  normalizeSha256Fingerprint,
  normalizeMdnsHostname,
  parseDefaultRouteInterface,
  resolveLanOnboardingResponse,
  selectPrivateIpv4,
} from './lan-development.mjs'

const certificateFingerprint = Array.from({ length: 32 }, (_, index) => (
  index.toString(16).padStart(2, '0')
)).join(':').toUpperCase()

describe('lanceur de développement LAN', () => {
  it.each([
    ['10.0.0.1', true],
    ['172.16.0.1', true],
    ['172.31.255.254', true],
    ['192.168.0.109', true],
    ['172.32.0.1', false],
    ['169.254.1.2', false],
    ['127.0.0.1', false],
    ['192.168.001.2', false],
  ])('classe correctement %s', (address, expected) => {
    expect(isPrivateIpv4(address)).toBe(expected)
  })

  it('préfère l’interface de la route par défaut et ignore loopback/public', () => {
    const networks = {
      docker0: [{ address: '172.20.0.1', family: 'IPv4', internal: false }],
      en0: [{ address: '192.168.0.109', family: 'IPv4', internal: false }],
      en5: [{ address: '10.0.0.14', family: 4, internal: false }],
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      public0: [{ address: '203.0.113.8', family: 'IPv4', internal: false }],
    }
    expect(selectPrivateIpv4(networks)).toBe('192.168.0.109')
    expect(selectPrivateIpv4(networks, 'en5')).toBe('10.0.0.14')
  })

  it('extrait l’interface des routes macOS et Linux sans accepter de métacaractères', () => {
    expect(parseDefaultRouteInterface('gateway: 192.168.0.1\ninterface: en0\n')).toBe('en0')
    expect(parseDefaultRouteInterface('default via 192.168.0.1 dev wlan0 proto dhcp')).toBe('wlan0')
    expect(parseDefaultRouteInterface('interface: en0;touch /tmp/pwned')).toBeUndefined()
  })

  it('normalise strictement le LocalHostName Bonjour', () => {
    expect(normalizeMdnsHostname('MacBook-Air-de-Exhibition')).toBe('macbook-air-de-exhibition.local')
    expect(normalizeMdnsHostname('POKEMASTER.local.')).toBe('pokemaster.local')
    expect(normalizeMdnsHostname('machine.lan.example')).toBeUndefined()
    expect(normalizeMdnsHostname('-machine')).toBeUndefined()
  })

  it('emploie le mDNS comme autorité canonique et garde l’IP comme secours', () => {
    expect(createLanIdentity('192.168.0.109', 'PokeMaster.local')).toEqual({
      canonicalHost: 'pokemaster.local',
      canonicalOrigin: 'https://pokemaster.local:5174',
      ipFallbackOrigin: 'https://192.168.0.109:5174',
      localOrigin: 'http://localhost:5173',
      mdnsHostname: 'pokemaster.local',
      namespaceStable: true,
      privateIpv4: '192.168.0.109',
    })
  })

  it('sépare l’identité canonique du transport résolu par chaque client', () => {
    const identity = createLanIdentity('192.168.0.109', 'PokeMaster.local')
    expect(createLanClientPublicEnvironment(identity)).toEqual({
      POKEMASTER_PUBLIC_LAN_DEVELOPMENT_MODE: 'true',
      POKEMASTER_PUBLIC_ONLINE_SERVER_IDENTITY_URL: 'https://pokemaster.local:5174',
      POKEMASTER_PUBLIC_ONLINE_SERVER_URL: '',
    })
  })

  it('expose un portail d’installation HTTP distinct du jeu HTTPS', () => {
    const identity = createLanIdentity('192.168.0.109', 'PokeMaster.local')
    expect(createLanOnboardingOrigin(identity)).toBe('http://192.168.0.109:5175')
    expect(normalizeSha256Fingerprint(`  ${certificateFingerprint.toLowerCase()}  `)).toBe(certificateFingerprint)
    expect(normalizeSha256Fingerprint(`${certificateFingerprint}<script>`)).toBeUndefined()

    const response = resolveLanOnboardingResponse(
      { method: 'GET', url: '/' },
      { caCertificate: new Uint8Array([1, 2, 3]), certificateFingerprint, identity },
    )
    expect(response.status).toBe(200)
    expect(response.headers['Content-Type']).toBe('text/html;charset=utf-8')
    expect(response.headers['Content-Security-Policy']).toContain("default-src 'none'")
    expect(response.body).toContain(certificateFingerprint)
    expect(response.body).toContain('href="/pokemaster-lan-ca.crt"')
    expect(response.body).toContain('href="https://192.168.0.109:5174"')
    expect(response.body).not.toContain('/v1')
  })

  it('ne sert que la CA publique et refuse API, jeu, requêtes mutantes et upgrades', () => {
    const assets = {
      caCertificate: new Uint8Array([1, 2, 3]),
      certificateFingerprint,
      identity: createLanIdentity('192.168.0.109', 'PokeMaster.local'),
    }
    const certificate = resolveLanOnboardingResponse(
      { method: 'GET', url: '/pokemaster-lan-ca.crt' },
      assets,
    )
    expect(certificate).toMatchObject({
      body: assets.caCertificate,
      contentLength: 3,
      status: 200,
    })
    expect(certificate.headers).toMatchObject({
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="pokemaster-lan-ca.crt"',
      'Content-Type': 'application/x-x509-ca-cert',
      'X-Content-Type-Options': 'nosniff',
    })

    expect(resolveLanOnboardingResponse(
      { method: 'HEAD', url: '/pokemaster-lan-ca.crt' },
      assets,
    )).toMatchObject({ body: undefined, contentLength: 3, status: 200 })
    expect(resolveLanOnboardingResponse({ method: 'GET', url: '/v1/accounts/me' }, assets).status).toBe(404)
    expect(resolveLanOnboardingResponse({ method: 'GET', url: '/assets/app.js' }, assets).status).toBe(404)
    expect(resolveLanOnboardingResponse({ method: 'GET', url: '/?proxy=/v1' }, assets).status).toBe(404)
    expect(resolveLanOnboardingResponse({ method: 'POST', url: '/' }, assets)).toMatchObject({
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    })
    expect(resolveLanOnboardingResponse({ method: undefined, url: undefined }, assets).status).toBe(405)
  })

  it('produit un certificat SAN exact pour mDNS, IP et localhost', () => {
    const identity = createLanIdentity('192.168.0.109', 'pokemaster.local')
    const configuration = createOpenSslCertificateConfiguration(identity)
    expect(configuration).toContain('commonName = pokemaster.local')
    expect(configuration).toContain('DNS.1 = pokemaster.local')
    expect(configuration).toContain('DNS.2 = localhost')
    expect(configuration).toContain('IP.1 = 192.168.0.109')
    expect(configuration).toContain('IP.2 = 127.0.0.1')
    expect(createCertificateMetadata(identity)).toEqual({
      canonicalHost: 'pokemaster.local',
      dnsNames: ['pokemaster.local', 'localhost'],
      ipAddresses: ['192.168.0.109', '127.0.0.1'],
      version: 1,
    })
  })
})
