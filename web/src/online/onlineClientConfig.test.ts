import { describe, expect, it } from 'vitest'
import {
  parseLanDevelopmentMode,
  parseOnlineClientConfig,
  parseOnlineRtcIceServers,
  resolveOnlineClientConfig,
} from './onlineClientConfig'

describe('configuration publique du client en ligne', () => {
  it('reste optionnelle pour préserver le jeu local hors ligne', () => {
    expect(parseOnlineClientConfig(undefined)).toBeUndefined()
    expect(parseOnlineClientConfig('')).toBeUndefined()
  })

  it('dérive les origines HTTPS et WSS sans secret', () => {
    expect(parseOnlineClientConfig('https://online.example.com/api')).toEqual({
      httpBaseUrl: 'https://online.example.com/api',
      identityBaseUrl: 'https://online.example.com/api',
      webSocketBaseUrl: 'wss://online.example.com/api',
    })
  })

  it('autorise HTTP uniquement sur la machine de développement', () => {
    expect(parseOnlineClientConfig('http://127.0.0.1:8080')).toEqual({
      httpBaseUrl: 'http://127.0.0.1:8080',
      identityBaseUrl: 'http://127.0.0.1:8080',
      webSocketBaseUrl: 'ws://127.0.0.1:8080',
    })
    expect(() => parseOnlineClientConfig('http://online.example.com')).toThrow('HTTPS')
    expect(() => parseOnlineClientConfig('http://192.168.1.42:8787')).toThrow('HTTPS')
  })

  it('autorise une adresse HTTP privée uniquement avec l’opt-in LAN', () => {
    expect(parseOnlineClientConfig('http://192.168.1.42:8787', true)).toEqual({
      httpBaseUrl: 'http://192.168.1.42:8787',
      identityBaseUrl: 'http://192.168.1.42:8787',
      webSocketBaseUrl: 'ws://192.168.1.42:8787',
    })
    expect(parseOnlineClientConfig('http://[fd12:3456::8]:8787', true)).toEqual({
      httpBaseUrl: 'http://[fd12:3456::8]:8787',
      identityBaseUrl: 'http://[fd12:3456::8]:8787',
      webSocketBaseUrl: 'ws://[fd12:3456::8]:8787',
    })
    expect(() => parseOnlineClientConfig('http://8.8.8.8:8787', true)).toThrow('HTTPS')
    expect(() => parseOnlineClientConfig('http://console.example:8787', true)).toThrow('HTTPS')
  })

  it('utilise le service local 8787 uniquement pour une page de développement locale', () => {
    expect(resolveOnlineClientConfig(undefined, { protocol: 'http:', hostname: 'localhost' })).toEqual({
      httpBaseUrl: 'http://localhost:8787',
      identityBaseUrl: 'http://localhost:8787',
      webSocketBaseUrl: 'ws://localhost:8787',
    })
    expect(resolveOnlineClientConfig(undefined, { protocol: 'https:', hostname: 'example.com' })).toBeUndefined()
    expect(resolveOnlineClientConfig('https://online.example.com', { protocol: 'http:', hostname: 'localhost' })?.httpBaseUrl)
      .toBe('https://online.example.com')
  })

  it('refuse le LAN HTTP non sécurisé même avec l’opt-in', () => {
    const page = { protocol: 'http:', hostname: '192.168.1.42', port: '5173' }
    expect(resolveOnlineClientConfig(undefined, page)).toBeUndefined()
    expect(resolveOnlineClientConfig(undefined, page, true)).toBeUndefined()
    expect(() => resolveOnlineClientConfig('http://192.168.1.10:8787', page, true)).toThrow('HTTPS')
    expect(resolveOnlineClientConfig(undefined, { protocol: 'http:', hostname: '8.8.8.8' }, true))
      .toBeUndefined()
  })

  it('utilise chaque proxy HTTPS LAN tout en conservant une identité de coffre stable', () => {
    expect(resolveOnlineClientConfig(undefined, {
      protocol: 'https:',
      hostname: '192.168.1.42',
      port: '5173',
    }, true, 'https://pokemaster-studio.local:5174')).toEqual({
      httpBaseUrl: 'https://192.168.1.42:5173',
      identityBaseUrl: 'https://pokemaster-studio.local:5174',
      webSocketBaseUrl: 'wss://192.168.1.42:5173',
    })
    expect(resolveOnlineClientConfig(undefined, {
      protocol: 'https:',
      hostname: 'pokemaster-studio.local',
      port: '5174',
    }, true)).toEqual({
      httpBaseUrl: 'https://pokemaster-studio.local:5174',
      identityBaseUrl: 'https://pokemaster-studio.local:5174',
      webSocketBaseUrl: 'wss://pokemaster-studio.local:5174',
    })
    expect(resolveOnlineClientConfig(undefined, {
      protocol: 'http:',
      hostname: 'pokemaster-studio.local',
      port: '5174',
    }, true)).toBeUndefined()
    expect(resolveOnlineClientConfig(undefined, {
      protocol: 'https:',
      hostname: 'nested.pokemaster.local',
      port: '5174',
    }, true)).toBeUndefined()
  })

  it('garde localhost sans CA et migre l’ancienne URL LAN vers l’identité seulement', () => {
    expect(resolveOnlineClientConfig(
      'https://pokemaster-studio.local:5174',
      { protocol: 'http:', hostname: 'localhost', port: '5173' },
      true,
    )).toEqual({
      httpBaseUrl: 'http://localhost:5173',
      identityBaseUrl: 'https://pokemaster-studio.local:5174',
      webSocketBaseUrl: 'ws://localhost:5173',
    })
    expect(resolveOnlineClientConfig(
      'https://pokemaster-studio.local:5174',
      { protocol: 'https:', hostname: '192.168.1.42', port: '5174' },
      true,
    )).toEqual({
      httpBaseUrl: 'https://192.168.1.42:5174',
      identityBaseUrl: 'https://pokemaster-studio.local:5174',
      webSocketBaseUrl: 'wss://192.168.1.42:5174',
    })
  })

  it('sépare explicitement le transport de l’identité logique', () => {
    expect(parseOnlineClientConfig(
      'https://192.168.1.42:5174',
      false,
      'https://pokemaster-studio.local:5174',
    )).toEqual({
      httpBaseUrl: 'https://192.168.1.42:5174',
      identityBaseUrl: 'https://pokemaster-studio.local:5174',
      webSocketBaseUrl: 'wss://192.168.1.42:5174',
    })
    expect(() => parseOnlineClientConfig(
      'https://192.168.1.42:5174',
      false,
      'https://pokemaster-studio.local:5174?vault=other',
    )).toThrow('paramètres')
  })

  it('valide strictement l’opt-in LAN public', () => {
    expect(parseLanDevelopmentMode(undefined)).toBe(false)
    expect(parseLanDevelopmentMode('')).toBe(false)
    expect(parseLanDevelopmentMode('false')).toBe(false)
    expect(parseLanDevelopmentMode('true')).toBe(true)
    expect(() => parseLanDevelopmentMode('1')).toThrow('doit valoir true ou false')
  })

  it.each([
    ['localhost', 'http:'],
    ['127.0.0.1', 'http:'],
    ['[::1]', 'http:'],
  ])('laisse le client %s local joindre uniquement le serveur tunnel HTTPS explicite', (hostname, protocol) => {
    expect(resolveOnlineClientConfig(
      'https://signal.example.trycloudflare.com',
      { protocol, hostname },
    )).toEqual({
      httpBaseUrl: 'https://signal.example.trycloudflare.com',
      identityBaseUrl: 'https://signal.example.trycloudflare.com',
      webSocketBaseUrl: 'wss://signal.example.trycloudflare.com',
    })
  })

  it.each([
    'https://user:password@online.example.com',
    'https://online.example.com?token=secret',
    'https://online.example.com/#secret',
  ])('refuse les secrets ou paramètres dans %s', (url) => {
    expect(() => parseOnlineClientConfig(url)).toThrow()
  })

  it('valide et fige une configuration ICE STUN/TURN publique bornée', () => {
    const configuration = parseOnlineRtcIceServers(JSON.stringify([
      { urls: 'stun:stun.example.com:3478' },
      {
        urls: [
          'turn:turn.example.com:3478?transport=udp',
          'turns:turn.example.com:5349?transport=tcp',
        ],
        username: '1712345678:scoped-user',
        credential: 'short-lived-credential',
      },
    ]))

    expect(configuration).toEqual({
      iceServers: [
        { urls: ['stun:stun.example.com:3478'] },
        {
          urls: [
            'turn:turn.example.com:3478?transport=udp',
            'turns:turn.example.com:5349?transport=tcp',
          ],
          username: '1712345678:scoped-user',
          credential: 'short-lived-credential',
        },
      ],
    })
    expect(Object.isFrozen(configuration)).toBe(true)
    expect(Object.isFrozen(configuration?.iceServers)).toBe(true)
    expect(Object.isFrozen(configuration?.iceServers?.[1]?.urls)).toBe(true)
  })

  it('laisse ICE optionnel quand aucune valeur publique n’est fournie', () => {
    expect(parseOnlineRtcIceServers(undefined)).toBeUndefined()
    expect(parseOnlineRtcIceServers('')).toBeUndefined()
  })

  it.each([
    ['racine objet', JSON.stringify({ urls: 'stun:stun.example.com:3478' })],
    ['liste vide', '[]'],
    ['trop de serveurs', JSON.stringify(Array.from(
      { length: 9 },
      (_, index) => ({ urls: `stun:stun${index}.example.com:3478` }),
    ))],
    ['propriété inconnue', JSON.stringify([{ urls: 'stun:stun.example.com:3478', secret: 'x' }])],
    ['schéma HTTP', JSON.stringify([{ urls: 'https://stun.example.com' }])],
    ['identifiants dans URL', JSON.stringify([{ urls: 'turn:user@turn.example.com:3478', username: 'u', credential: 'c' }])],
    ['port invalide', JSON.stringify([{ urls: 'stun:stun.example.com:65536' }])],
    ['transport sur STUN', JSON.stringify([{ urls: 'stun:stun.example.com:3478?transport=udp' }])],
    ['TURN sans credentials', JSON.stringify([{ urls: 'turn:turn.example.com:3478' }])],
    ['credentials sur STUN', JSON.stringify([{ urls: 'stun:stun.example.com:3478', username: 'u', credential: 'c' }])],
    ['JSON mal formé', '[{"urls":'],
  ])('refuse une configuration ICE ambiguë ou dangereuse : %s', (_label, value) => {
    expect(() => parseOnlineRtcIceServers(value)).toThrow('Configuration ICE publique invalide')
  })
})
