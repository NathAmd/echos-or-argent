import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserTitleSaveBackupFilePort } from './browserTitleSaveBackupFiles'

function file(name: string, contents: string): File {
  return {
    name,
    size: new TextEncoder().encode(contents).byteLength,
    text: async () => contents,
  } as File
}

describe('fichiers de backup dans le navigateur', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('utilise File System Access pour lire et écrire lorsque le navigateur le fournit', async () => {
    const selected = file('partie.json', '{"ok":true}')
    const write = vi.fn(async (contents: string) => { void contents })
    const close = vi.fn(async () => undefined)
    const browserWindow = {
      showOpenFilePicker: vi.fn(async () => [{ getFile: async () => selected }]),
      showSaveFilePicker: vi.fn(async () => ({
        getFile: async () => selected,
        createWritable: async () => ({ write, close }),
      })),
    }
    const port = createBrowserTitleSaveBackupFilePort({
      readWindow: () => browserWindow as unknown as Window,
    })

    const picked = await port.pickJson()
    expect(picked).toMatchObject({ name: 'partie.json', size: 11 })
    await expect(picked?.readText()).resolves.toBe('{"ok":true}')
    await expect(port.saveJson('copie.json', '{"save":1}')).resolves.toBe(true)
    expect(browserWindow.showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'copie.json',
    }))
    expect(write).toHaveBeenCalledWith('{"save":1}')
    expect(close).toHaveBeenCalledOnce()
  })

  it('traite l’annulation native comme un résultat sans erreur', async () => {
    const abort = new DOMException('annulé', 'AbortError')
    const browserWindow = {
      showOpenFilePicker: vi.fn(async () => { throw abort }),
      showSaveFilePicker: vi.fn(async () => { throw abort }),
    }
    const port = createBrowserTitleSaveBackupFilePort({
      readWindow: () => browserWindow as unknown as Window,
    })

    await expect(port.pickJson()).resolves.toBeUndefined()
    await expect(port.saveJson('copie.json', '{}')).resolves.toBe(false)
  })

  it('replie lecture et téléchargement sur les contrôles HTML standards', async () => {
    const selected = file('partie.json', '{"slot":1}')
    let change: (() => void) | undefined
    const input = {
      type: '', accept: '', files: [selected],
      addEventListener: vi.fn((name: string, listener: () => void) => {
        if (name === 'change') change = listener
      }),
      click: vi.fn(() => change?.()),
    }
    const anchor = { href: '', download: '', click: vi.fn() }
    const documentValue = {
      createElement: vi.fn((tag: string) => tag === 'input' ? input : anchor),
    }
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:backup'), revokeObjectURL })
    const browserWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      clearTimeout: vi.fn(),
      setTimeout: vi.fn((callback: () => void) => { callback(); return 1 }),
    }
    const port = createBrowserTitleSaveBackupFilePort({
      readDocument: () => documentValue as unknown as Document,
      readWindow: () => browserWindow as unknown as Window,
    })

    await expect((await port.pickJson())?.readText()).resolves.toBe('{"slot":1}')
    await expect(port.saveJson('copie.json', '{}')).resolves.toBe(true)
    expect(anchor).toMatchObject({ href: 'blob:backup', download: 'copie.json' })
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup')
  })

  it('résout le fallback annulé au retour de focus même sans événement cancel', async () => {
    let focus: (() => void) | undefined
    const input = {
      type: '', accept: '', files: [],
      addEventListener: vi.fn(),
      click: vi.fn(() => focus?.()),
    }
    const documentValue = { createElement: vi.fn(() => input) }
    const browserWindow = {
      addEventListener: vi.fn((name: string, listener: () => void) => {
        if (name === 'focus') focus = listener
      }),
      removeEventListener: vi.fn(),
      clearTimeout: vi.fn(),
      setTimeout: vi.fn((callback: () => void) => { callback(); return 1 }),
    }
    const port = createBrowserTitleSaveBackupFilePort({
      readDocument: () => documentValue as unknown as Document,
      readWindow: () => browserWindow as unknown as Window,
    })

    await expect(port.pickJson()).resolves.toBeUndefined()
    expect(browserWindow.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function))
  })
})
