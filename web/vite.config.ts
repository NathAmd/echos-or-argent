import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const maximumReportBytes = 32 * 1024 * 1024
const publicEnvironmentPrefix = 'POKEMASTER_PUBLIC_'
const sensitivePublicEnvironmentName = /(?:^|_)(?:API_?KEY|CREDENTIALS?|PASSWORD|PRIVATE|SECRET|TOKEN)(?:_|$)/i
const githubPagesBasePath = /^\/[A-Za-z0-9._~-]+\/$/
const forbiddenPublicSourceExtensions = new Set([
  '.cjs', '.css', '.cts', '.htm', '.html', '.js', '.jsx', '.less', '.map', '.mjs', '.mts', '.sass', '.scss', '.svelte', '.ts', '.tsx', '.vue', '.wasm', '.xhtml',
])

function assertNoPublicExecutableSources(directory: string): void {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) assertNoPublicExecutableSources(path)
    else if (!entry.isFile()) throw new Error(`Type de fichier non autorisé sous public/: ${path}`)
    else if (forbiddenPublicSourceExtensions.has(extname(entry.name).toLowerCase())) {
      throw new Error(`Source ou exécutable brut interdit sous public/: ${path}`)
    }
  }
}

function resolvePublicBasePath(value: string | undefined): string {
  if (!value) return '/'
  if (value === '/' || githubPagesBasePath.test(value)) return value
  throw new Error(`POKEMASTER_PUBLIC_BASE_PATH invalide: ${value}. Utilisez / ou /nom-du-depot/.`)
}

function resolveLanProxyTarget(value: string | undefined): string {
  const candidate = value?.trim() || 'http://127.0.0.1:8787'
  if (candidate !== value && value !== undefined) {
    throw new Error('POKEMASTER_LAN_SERVER_URL ne doit contenir aucun espace superflu.')
  }
  const url = new URL(candidate)
  if (
    url.protocol !== 'http:'
    || (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '[::1]')
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new Error('POKEMASTER_LAN_SERVER_URL doit être une origine HTTP de boucle locale exacte.')
  }
  return url.origin
}

function isPrivateIpv4Hostname(hostname: string): boolean {
  const octets = hostname.split('.')
  if (octets.length !== 4 || octets.some((octet) => !/^(?:0|[1-9]\d{0,2})$/.test(octet))) return false
  const values = octets.map(Number)
  if (values.some((octet) => octet > 255)) return false
  const [first = -1, second = -1] = values
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}

function resolveLanFacade(value: string | undefined): 'local' | 'network' {
  if (value === 'local' || value === 'network') return value
  throw new Error('POKEMASTER_LAN_FACADE doit valoir local ou network. Utilisez npm run dev:lan.')
}

function resolveLanCanonicalHost(value: string | undefined): string {
  const candidate = value?.trim()
  if (
    !candidate
    || candidate !== value
    || (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/.test(candidate) && !isPrivateIpv4Hostname(candidate))
  ) {
    throw new Error('POKEMASTER_LAN_CANONICAL_HOST doit être un nom mDNS canonique ou une IPv4 privée.')
  }
  return candidate
}

function readLanHttpsOptions(environment: Record<string, string>): Readonly<{ cert: Buffer, key: Buffer }> {
  const certificatePath = environment.POKEMASTER_LAN_HTTPS_CERT_PATH?.trim()
  const keyPath = environment.POKEMASTER_LAN_HTTPS_KEY_PATH?.trim()
  if (!certificatePath || !keyPath) {
    throw new Error(
      'Le mode LAN exige POKEMASTER_LAN_HTTPS_CERT_PATH et POKEMASTER_LAN_HTTPS_KEY_PATH '
      + 'pour conserver WebCrypto sur les autres appareils.',
    )
  }
  return {
    cert: readFileSync(resolve(process.cwd(), certificatePath)),
    key: readFileSync(resolve(process.cwd(), keyPath)),
  }
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > maximumReportBytes) {
        reject(new Error('Le rapport dépasse la limite de 32 Mio.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolveBody(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function installReportMiddleware(middlewares: { use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void }): void {
  middlewares.use((request, response, next) => {
    if (request.url !== '/__pokemaster/report' || request.method !== 'POST') {
      next()
      return
    }
    void (async () => {
      const rawName = request.headers['x-pokemaster-report-name']
      const fileName = Array.isArray(rawName) ? rawName[0] : rawName
      if (!fileName || !/^pokemaster-bug-[a-zA-Z0-9_-]+\.html$/.test(fileName)) {
        response.statusCode = 400
        response.end('Nom de rapport invalide.')
        return
      }
      const upperCaseDirectory = resolve(process.cwd(), '../REPPORT')
      const lowerCaseDirectory = resolve(process.cwd(), '../repport')
      const reportDirectory = existsSync(upperCaseDirectory) ? upperCaseDirectory : lowerCaseDirectory
      const body = await readRequestBody(request)
      await mkdir(reportDirectory, { recursive: true })
      await writeFile(resolve(reportDirectory, fileName), body, { flag: 'wx' })
      response.statusCode = 201
      response.setHeader('Content-Type', 'application/json;charset=utf-8')
      response.end(JSON.stringify({ fileName, destination: `REPPORT/${fileName}` }))
    })().catch((error: unknown) => {
      response.statusCode = (error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 409 : 500
      response.end(error instanceof Error ? error.message : 'Écriture du rapport impossible.')
    })
  })
}

function localBugReportWriter(): Plugin {
  return {
    name: 'pokemaster-local-bug-report-writer',
    configureServer(server) {
      installReportMiddleware(server.middlewares)
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  const publicEnvironment = loadEnv(mode, process.cwd(), publicEnvironmentPrefix)
  const lanDevelopmentMode = command === 'serve' && mode === 'lan'
  if (command === 'build') {
    assertNoPublicExecutableSources(resolve(process.cwd(), 'public'))
    const suspiciousNames = Object.keys(publicEnvironment).filter((name) => sensitivePublicEnvironmentName.test(name))
    if (suspiciousNames.length > 0) {
      throw new Error(
        `Variables publiques potentiellement sensibles refusées: ${suspiciousNames.join(', ')}. `
        + `Toute variable ${publicEnvironmentPrefix} est intégrée au JavaScript distribué.`,
      )
    }
    if (publicEnvironment.POKEMASTER_PUBLIC_LAN_DEVELOPMENT_MODE) {
      throw new Error('POKEMASTER_PUBLIC_LAN_DEVELOPMENT_MODE est réservé au serveur Vite de développement.')
    }
    if (publicEnvironment.POKEMASTER_PUBLIC_ONLINE_SERVER_IDENTITY_URL) {
      throw new Error('POKEMASTER_PUBLIC_ONLINE_SERVER_IDENTITY_URL est réservé au serveur LAN de développement.')
    }
  }

  const lanProxyTarget = lanDevelopmentMode
    ? resolveLanProxyTarget(environment.POKEMASTER_LAN_SERVER_URL)
    : 'http://127.0.0.1:8787'
  const lanFacade = lanDevelopmentMode
    ? resolveLanFacade(environment.POKEMASTER_LAN_FACADE)
    : 'local'
  const lanCanonicalHost = lanDevelopmentMode
    ? resolveLanCanonicalHost(environment.POKEMASTER_LAN_CANONICAL_HOST)
    : 'localhost'
  const lanProxy = lanDevelopmentMode ? {
    '/healthz': { target: lanProxyTarget },
    '/v1': { target: lanProxyTarget, ws: true },
  } : undefined

  return {
    base: resolvePublicBasePath(publicEnvironment.POKEMASTER_PUBLIC_BASE_PATH),
    envPrefix: publicEnvironmentPrefix,
    plugins: [localBugReportWriter()],
    ...(lanDevelopmentMode ? {
      server: {
        host: lanFacade === 'network' ? '0.0.0.0' : '127.0.0.1',
        ...(lanFacade === 'network' ? {
          allowedHosts: [lanCanonicalHost],
          // Les preflights /v1 doivent atteindre l'unique politique CORS du
          // serveur, comme en production, au lieu d'être élargis par Vite.
          cors: false,
          https: readLanHttpsOptions(environment),
        } : {}),
        port: lanFacade === 'network' ? 5174 : 5173,
        proxy: lanProxy,
        strictPort: true,
      },
    } : {}),
    build: {
      chunkSizeWarningLimit: 550,
      cssMinify: 'lightningcss',
      license: { fileName: 'THIRD_PARTY_LICENSES.md' },
      minify: 'oxc',
      sourcemap: false,
      rolldownOptions: {
        output: {
          assetFileNames: 'assets/asset-[hash:16].[ext]',
          chunkFileNames: 'assets/chunk-[hash:16].js',
          comments: false,
          entryFileNames: 'assets/app-[hash:16].js',
          hashCharacters: 'hex',
          minify: {
            codegen: {
              legalComments: 'none',
              removeWhitespace: true,
            },
            compress: {
              dropConsole: true,
              dropDebugger: true,
              joinVars: true,
              sequences: true,
              unused: true,
            },
            mangle: {
              keepNames: false,
              toplevel: true,
            },
          },
          codeSplitting: {
            groups: [
              {
                name: 'three-vendor',
                test: /node_modules[\\/]three/,
              },
              {
                name: 'battle-domain',
                test: /src[\\/]game[\\/]battle/,
              },
              {
                name: 'field-script-domain',
                test: /src[\\/]game[\\/]scripts/,
              },
              {
                name: 'world-rendering-domain',
                test: /src[\\/](?:game[\\/]world|rendering)/,
              },
            ],
          },
        },
      },
    },
  }
})
