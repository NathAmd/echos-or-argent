import type { OnlineAccount } from './onlineAccountSession'
import { parseOnlineClientConfig } from './onlineClientConfig'
import { exportOpaqueVaultKey, importOpaqueVaultKey } from './opaqueJsonVault'

const textEncoder = new TextEncoder()
const derivedKeyBytes = 32
const maximumPasswordBytes = 256
const storageNamespace = 'pokemaster:online-vault-key:v1:'
const stableStorageNamespace = 'pokemaster:online-vault-key:v2:'
const vaultKeyIdPattern = /^[A-Za-z0-9_-]{43}$/

/**
 * Version cryptographique persistée dans le namespace et dans le sel. Modifier
 * un paramètre exige une nouvelle version afin de ne jamais réinterpréter une
 * ancienne clé avec une politique différente.
 */
export const ONLINE_VAULT_KEY_DERIVATION = Object.freeze({
  protocol: 'pokemaster-online-vault-key.v1',
  kdf: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 600_000,
  keyAlgorithm: 'AES-GCM',
  keyLength: 256,
} as const)

export type OnlineVaultKeyringStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type OnlineVaultKeyringOptions = Readonly<{
  serverUrl: string
  storage: OnlineVaultKeyringStorage
  crypto?: Crypto
}>

export type OnlineVaultKeyringAccount = Pick<OnlineAccount, 'id' | 'vaultKeyId'>

export type OnlineVaultKeyring = Readonly<{
  unlock: (
    account: OnlineVaultKeyringAccount,
    password: string,
    signal?: AbortSignal,
  ) => Promise<CryptoKey>
  restore: (account: OnlineVaultKeyringAccount) => Promise<CryptoKey | undefined>
  /** Oublie seulement les CryptoKey en mémoire; la copie exportée reste persistée. */
  clearMemory: () => void
}>

function resolveCrypto(candidate: Crypto | undefined): Crypto {
  const value = candidate ?? globalThis.crypto
  if (!value?.subtle) throw new Error('Web Crypto est indisponible pour le coffre en ligne.')
  return value
}

function requireNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Dérivation de clé annulée.', 'AbortError')
}

function canonicalServerUrl(value: string): string {
  const config = parseOnlineClientConfig(value)
  if (!config) throw new TypeError("L'URL du serveur du coffre est requise.")
  return config.httpBaseUrl
}

function requireAccountId(account: OnlineVaultKeyringAccount): string {
  const id = account?.id
  if (typeof id !== 'string' || !/^[a-z0-9](?:[a-z0-9._-]{2,31})$/.test(id)) {
    throw new TypeError("L'identité du compte du coffre est invalide.")
  }
  return id
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}

function passwordBytes(password: string): Uint8Array<ArrayBuffer> {
  if (typeof password !== 'string' || password.length === 0 || !isWellFormedUtf16(password)) {
    throw new TypeError('Le mot de passe du coffre est invalide.')
  }
  const bytes = textEncoder.encode(password)
  if (bytes.byteLength > maximumPasswordBytes) {
    bytes.fill(0)
    throw new TypeError(`Le mot de passe du coffre ne doit pas dépasser ${maximumPasswordBytes} octets.`)
  }
  return bytes
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeExportedKey(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined
  try {
    const standard = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(`${standard}=`)
    if (binary.length !== derivedKeyBytes) return undefined
    const bytes = new Uint8Array(derivedKeyBytes)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    if (encodeBase64Url(bytes) !== value) {
      bytes.fill(0)
      return undefined
    }
    return bytes
  } catch {
    return undefined
  }
}

function encodeContext(
  purpose: 'salt' | 'storage',
  protocol: string,
  identity: string,
  accountId: string,
): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(JSON.stringify([
    protocol,
    purpose,
    identity,
    accountId,
  ]))
}

async function digestContext(
  cryptoApi: Crypto,
  purpose: 'salt' | 'storage',
  protocol: string,
  identity: string,
  accountId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const context = encodeContext(purpose, protocol, identity, accountId)
  try {
    return new Uint8Array(await cryptoApi.subtle.digest('SHA-256', context))
  } finally {
    context.fill(0)
  }
}

async function deriveVaultKey(
  cryptoApi: Crypto,
  protocol: string,
  identity: string,
  accountId: string,
  password: string,
): Promise<CryptoKey> {
  const passwordData = passwordBytes(password)
  const salt = await digestContext(cryptoApi, 'salt', protocol, identity, accountId)
  try {
    const material = await cryptoApi.subtle.importKey('raw', passwordData, 'PBKDF2', false, ['deriveKey'])
    return await cryptoApi.subtle.deriveKey(
      {
        name: ONLINE_VAULT_KEY_DERIVATION.kdf,
        hash: ONLINE_VAULT_KEY_DERIVATION.hash,
        iterations: ONLINE_VAULT_KEY_DERIVATION.iterations,
        salt,
      },
      material,
      {
        name: ONLINE_VAULT_KEY_DERIVATION.keyAlgorithm,
        length: ONLINE_VAULT_KEY_DERIVATION.keyLength,
      },
      true,
      ['encrypt', 'decrypt'],
    )
  } finally {
    passwordData.fill(0)
    salt.fill(0)
  }
}

async function exportWithCrypto(cryptoApi: Crypto, key: CryptoKey): Promise<string> {
  let raw: Uint8Array<ArrayBuffer> | undefined
  try {
    raw = new Uint8Array(await cryptoApi.subtle.exportKey('raw', key))
    if (raw.byteLength !== derivedKeyBytes) throw new Error('La clé dérivée du coffre est invalide.')
    return encodeBase64Url(raw)
  } finally {
    raw?.fill(0)
  }
}

async function importWithCrypto(cryptoApi: Crypto, value: string): Promise<CryptoKey> {
  const raw = decodeExportedKey(value)
  if (!raw) throw new Error('La clé persistée du coffre est invalide.')
  try {
    return await cryptoApi.subtle.importKey(
      'raw',
      raw,
      { name: ONLINE_VAULT_KEY_DERIVATION.keyAlgorithm },
      true,
      ['encrypt', 'decrypt'],
    )
  } finally {
    raw.fill(0)
  }
}

/**
 * Keyring local lié à une origine serveur. La valeur Storage est exclusivement
 * la clé AES exportée en base64url; le mot de passe n'est ni conservé ni inclus
 * dans le nom de stockage.
 */
export function createOnlineVaultKeyring(options: OnlineVaultKeyringOptions): OnlineVaultKeyring {
  const cryptoApi = resolveCrypto(options.crypto)
  const serverUrl = canonicalServerUrl(options.serverUrl)
  const memory = new Map<string, CryptoKey>()
  const useSharedVaultCodec = options.crypto === undefined

  const derivation = (account: OnlineVaultKeyringAccount): Readonly<{
    identity: string
    namespace: string
    protocol: string
  }> => {
    const vaultKeyId = account.vaultKeyId
    if (vaultKeyId !== undefined && !vaultKeyIdPattern.test(vaultKeyId)) {
      throw new TypeError("L'identifiant stable du coffre est invalide.")
    }
    return vaultKeyId === undefined
      ? { identity: serverUrl, namespace: storageNamespace, protocol: ONLINE_VAULT_KEY_DERIVATION.protocol }
      : { identity: vaultKeyId, namespace: stableStorageNamespace, protocol: 'pokemaster-online-vault-key.v2' }
  }

  const binding = async (account: OnlineVaultKeyringAccount): Promise<string> => {
    const accountId = requireAccountId(account)
    const parameters = derivation(account)
    const digest = await digestContext(
      cryptoApi,
      'storage',
      parameters.protocol,
      parameters.identity,
      accountId,
    )
    try {
      return `${parameters.namespace}${encodeBase64Url(digest)}`
    } finally {
      digest.fill(0)
    }
  }

  const exportKey = (key: CryptoKey): Promise<string> => useSharedVaultCodec
    ? exportOpaqueVaultKey(key)
    : exportWithCrypto(cryptoApi, key)

  const importKey = (value: string): Promise<CryptoKey> => useSharedVaultCodec
    ? importOpaqueVaultKey(value)
    : importWithCrypto(cryptoApi, value)

  return Object.freeze({
    async unlock(account, password, signal) {
      requireNotAborted(signal)
      const accountId = requireAccountId(account)
      const storageKey = await binding(account)
      const parameters = derivation(account)
      requireNotAborted(signal)
      const key = await deriveVaultKey(
        cryptoApi,
        parameters.protocol,
        parameters.identity,
        accountId,
        password,
      )
      requireNotAborted(signal)
      const exported = await exportKey(key)
      requireNotAborted(signal)
      options.storage.setItem(storageKey, exported)
      memory.set(storageKey, key)
      return key
    },
    async restore(account) {
      const storageKey = await binding(account)
      const cached = memory.get(storageKey)
      if (cached) return cached
      let exported: string | null
      try {
        exported = options.storage.getItem(storageKey)
      } catch {
        return undefined
      }
      if (exported === null) return undefined
      try {
        const key = await importKey(exported)
        memory.set(storageKey, key)
        return key
      } catch {
        try { options.storage.removeItem(storageKey) } catch { /* Nettoyage best-effort. */ }
        return undefined
      }
    },
    clearMemory() {
      memory.clear()
    },
  })
}
