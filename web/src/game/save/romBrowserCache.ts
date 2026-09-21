const databaseName = 'pokemaster-local-rom'
const databaseVersion = 1
const storeName = 'roms'
const activeRomKey = 'active'

type CachedRomRecord = {
  key: typeof activeRomKey
  name: string
  type: string
  lastModified: number
  size: number
  blob: Blob
  cachedAt: string
}

function getIndexedDb(): IDBFactory {
  if (!globalThis.indexedDB) throw new Error('IndexedDB est indisponible dans ce navigateur.')
  return globalThis.indexedDB
}

function openRomDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = getIndexedDb().open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('La base locale de ROM ne peut pas être ouverte.'))
    request.onblocked = () => reject(new Error('La base locale de ROM est utilisée par un autre onglet.'))
  })
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('La transaction de ROM locale a échoué.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('La transaction de ROM locale a été annulée.'))
  })
}

export async function cacheRomFile(file: File): Promise<void> {
  const database = await openRomDatabase()
  try {
    const transaction = database.transaction(storeName, 'readwrite')
    const record: CachedRomRecord = {
      key: activeRomKey,
      name: file.name,
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
      size: file.size,
      blob: file,
      cachedAt: new Date().toISOString(),
    }
    transaction.objectStore(storeName).put(record)
    await waitForTransaction(transaction)
    await navigator.storage?.persist?.().catch(() => false)
  } finally {
    database.close()
  }
}

export async function readCachedRomFile(): Promise<File | undefined> {
  const database = await openRomDatabase()
  try {
    const transaction = database.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).get(activeRomKey)
    const record = await new Promise<CachedRomRecord | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as CachedRomRecord | undefined)
      request.onerror = () => reject(request.error ?? new Error('La ROM locale ne peut pas être relue.'))
    })
    await waitForTransaction(transaction)
    if (!record) return undefined
    if (!(record.blob instanceof Blob) || record.blob.size !== record.size || !record.name.toLowerCase().endsWith('.nds')) {
      throw new Error('La copie locale de la ROM est incomplète ou invalide.')
    }
    return new File([record.blob], record.name, {
      type: record.type,
      lastModified: record.lastModified,
    })
  } finally {
    database.close()
  }
}

export async function deleteCachedRomFile(): Promise<void> {
  const database = await openRomDatabase()
  try {
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).delete(activeRomKey)
    await waitForTransaction(transaction)
  } finally {
    database.close()
  }
}
