import { parseOnlineClientConfig } from '../../online/onlineClientConfig'

export type TitleSaveCampaignLeaseScope =
  | Readonly<{ kind: 'local', gameCode: string }>
  | Readonly<{
      kind: 'online'
      serverUrl: string
      accountId: string
      gameCode: string
    }>

export type TitleSaveCampaignLease = Readonly<{
  key: string
  release: () => void
}>

export type TitleSaveCampaignLeaseManager = Readonly<{
  acquire: (
    scope: TitleSaveCampaignLeaseScope,
    signal: AbortSignal,
  ) => Promise<TitleSaveCampaignLease | undefined>
}>

type LockManagerPort = Readonly<{
  request: <T>(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<T>,
  ) => Promise<T>
}>

const leasePrefix = 'pokemaster:campaign-lease:v1'

export class TitleSaveCampaignBusyError extends Error {
  constructor() {
    super('Cette campagne est déjà ouverte dans un autre onglet.')
    this.name = 'TitleSaveCampaignBusyError'
  }
}

function requireGameCode(value: string): string {
  if (!/^[A-Z0-9]{4}$/.test(value)) {
    throw new TypeError('Le code ROM du verrou de sauvegarde est invalide.')
  }
  return value
}

function requireAccountId(value: string): string {
  if (!/^[a-z0-9](?:[a-z0-9._-]{2,31})$/.test(value)) {
    throw new TypeError("L’identité du verrou de sauvegarde est invalide.")
  }
  return value
}

export function titleSaveCampaignLeaseKey(scope: TitleSaveCampaignLeaseScope): string {
  const gameCode = requireGameCode(scope.gameCode)
  if (scope.kind === 'local') return `${leasePrefix}:local:${gameCode}`
  const serverUrl = parseOnlineClientConfig(scope.serverUrl)?.httpBaseUrl
  if (!serverUrl) throw new TypeError("L’URL du verrou de sauvegarde est invalide.")
  return [
    leasePrefix,
    'online',
    encodeURIComponent(serverUrl),
    requireAccountId(scope.accountId),
    gameCode,
  ].join(':')
}

function abortError(): DOMException {
  return new DOMException('Ouverture des sauvegardes annulée.', 'AbortError')
}

/**
 * Garde le verrou exclusif pendant toute la campagne. Les primitives Storage
 * restent synchrones, mais aucune autre page coopérante du même origin ne peut
 * alors intercaler une sauvegarde, une suppression ou une réconciliation.
 */
export function createTitleSaveCampaignLeaseManager(
  lockManager: LockManagerPort | undefined = globalThis.navigator?.locks as LockManagerPort | undefined,
): TitleSaveCampaignLeaseManager {
  return Object.freeze({
    acquire(scope, signal) {
      if (signal.aborted) return Promise.reject(abortError())
      const key = titleSaveCampaignLeaseKey(scope)
      if (!lockManager) {
        // Les WebView mono-document (notamment certaines consoles) ne proposent
        // pas toujours Web Locks. Il n'y a alors aucun second contexte à
        // sérialiser ; la même frontière reste active dans le document courant.
        return Promise.resolve(Object.freeze({ key, release: () => undefined }))
      }

      return new Promise<TitleSaveCampaignLease | undefined>((resolve, reject) => {
        let settled = false
        let released = false
        let releaseLock = (): void => undefined
        const hold = new Promise<void>((release) => { releaseLock = release })
        const finishAbort = (): void => {
          if (!settled) {
            settled = true
            reject(abortError())
          }
          if (!released) {
            released = true
            releaseLock()
          }
        }
        signal.addEventListener('abort', finishAbort, { once: true })

        void lockManager.request(
          key,
          { mode: 'exclusive', ifAvailable: true },
          async (lock) => {
            if (!lock || signal.aborted) {
              signal.removeEventListener('abort', finishAbort)
              if (!settled) {
                settled = true
                resolve(undefined)
              }
              return
            }
            const release = (): void => {
              if (released) return
              released = true
              signal.removeEventListener('abort', finishAbort)
              releaseLock()
            }
            if (!settled) {
              settled = true
              signal.removeEventListener('abort', finishAbort)
              resolve(Object.freeze({ key, release }))
            }
            await hold
          },
        ).catch((error: unknown) => {
          signal.removeEventListener('abort', finishAbort)
          if (settled) return
          settled = true
          reject(error)
        })
      })
    },
  })
}
