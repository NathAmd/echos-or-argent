export type TitleSaveBackupPickedFile = Readonly<{
  name: string
  size: number
  readText: () => Promise<string>
}>

export type TitleSaveBackupFilePort = Readonly<{
  pickJson: () => Promise<TitleSaveBackupPickedFile | undefined>
  saveJson: (fileName: string, contents: string) => Promise<boolean>
}>

type WritableFileStream = Readonly<{
  write: (contents: string) => Promise<void>
  close: () => Promise<void>
  abort?: () => Promise<void>
}>

type BrowserFileHandle = Readonly<{
  getFile: () => Promise<File>
  createWritable: () => Promise<WritableFileStream>
}>

type FilePickerWindow = Window & Readonly<{
  showOpenFilePicker?: (options: unknown) => Promise<readonly BrowserFileHandle[]>
  showSaveFilePicker?: (options: unknown) => Promise<BrowserFileHandle>
}>

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function pickedFile(file: File): TitleSaveBackupPickedFile {
  return Object.freeze({
    name: file.name,
    size: file.size,
    readText: () => file.text(),
  })
}

function pickWithInput(
  documentValue: Document,
  windowValue: Window,
): Promise<TitleSaveBackupPickedFile | undefined> {
  return new Promise((resolve) => {
    const input = documentValue.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    let settled = false
    let focusTimer: number | undefined
    const onWindowFocus = (): void => {
      focusTimer = windowValue.setTimeout(() => finish(input.files?.[0]), 100)
    }
    const finish = (file?: File): void => {
      if (settled) return
      settled = true
      if (focusTimer !== undefined) windowValue.clearTimeout(focusTimer)
      windowValue.removeEventListener('focus', onWindowFocus)
      resolve(file ? pickedFile(file) : undefined)
    }
    input.addEventListener('change', () => finish(input.files?.[0]))
    input.addEventListener('cancel', () => finish())
    windowValue.addEventListener('focus', onWindowFocus, { once: true })
    input.click()
  })
}

function downloadWithAnchor(
  documentValue: Document,
  windowValue: Window,
  fileName: string,
  contents: string,
): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json;charset=utf-8' }))
  const anchor = documentValue.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  windowValue.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** File System Access si disponible, sinon sélecteur/téléchargement navigateur. */
export function createBrowserTitleSaveBackupFilePort(dependencies: Readonly<{
  readDocument?: () => Document
  readWindow?: () => FilePickerWindow
}> = {}): TitleSaveBackupFilePort {
  const readDocument = dependencies.readDocument ?? (() => document)
  const readWindow = dependencies.readWindow ?? (() => window as FilePickerWindow)
  return Object.freeze({
    async pickJson() {
      const browserWindow = readWindow()
      if (!browserWindow.showOpenFilePicker) return pickWithInput(readDocument(), browserWindow)
      try {
        const handles = await browserWindow.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'Backup PokeMaster JSON', accept: { 'application/json': ['.json'] } }],
        })
        const file = await handles[0]?.getFile()
        return file ? pickedFile(file) : undefined
      } catch (error) {
        if (isAbortError(error)) return undefined
        throw error
      }
    },
    async saveJson(fileName, contents) {
      const browserWindow = readWindow()
      if (!browserWindow.showSaveFilePicker) {
        downloadWithAnchor(readDocument(), browserWindow, fileName, contents)
        return true
      }
      try {
        const handle = await browserWindow.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'Backup PokeMaster JSON', accept: { 'application/json': ['.json'] } }],
        })
        const writable = await handle.createWritable()
        try {
          await writable.write(contents)
          await writable.close()
        } catch (error) {
          await writable.abort?.().catch(() => undefined)
          throw error
        }
        return true
      } catch (error) {
        if (isAbortError(error)) return false
        throw error
      }
    },
  })
}
