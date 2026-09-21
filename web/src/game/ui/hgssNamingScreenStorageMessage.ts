import type { GameDigitalAction } from '../../gameInput'
import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import { startRomSoundEffect } from '../../audio/romAudioPresentation'
import { hgssVBlankDurationMs, hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import { hgssBattleAudioSequences } from '../battle/hgssBattleAudio'
import { createHgssBattleMessagePrinterPages, playHgssBattleMessagePrinterPage, type HgssBattleMessagePrinterControl, type HgssBattleMessagePrinterPlayback } from '../battle/hgssBattleMessagePrinter'

export type HgssNamingScreenStorageMessageElements = {
  root: HTMLElement
  label: HTMLElement
  input: HTMLInputElement
  count: HTMLElement
  submit: HTMLButtonElement
  cancel: HTMLButtonElement
}

export type HgssNamingScreenStorageMessageController = {
  present: (template: string, values: readonly string[]) => Promise<void>
  handle: (action: GameDigitalAction) => boolean
  isActive: () => boolean
  close: () => void
}

/**
 * Reproduit la branche `NamingScreen_PrepareBattleMessage`: le message de
 * Boîte vit dans l'overlay de nom, puis SEQ_SE_DP_PIRORIRO et 31 ticks
 * précèdent son fade. Le contrôleur reste générique pour les quatre messages
 * 1174–1177 et leurs coupures 25BC/25BD issues de la ROM.
 */
export function createHgssNamingScreenStorageMessageController(
  elements: HgssNamingScreenStorageMessageElements,
  getAudio: () => RomAudioRuntime | undefined,
): HgssNamingScreenStorageMessageController {
  let pages: ReturnType<typeof createHgssBattleMessagePrinterPages> = []
  let pageIndex = 0
  let inputReady = false
  let timer: number | undefined
  let printer: HgssBattleMessagePrinterPlayback | undefined
  let revision = 0
  let resolvePresentation: (() => void) | undefined

  const clearTimer = (): void => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
  }

  const restoreInputElements = (): void => {
    delete elements.root.dataset.phase
    elements.input.hidden = false
    elements.count.hidden = false
    elements.submit.hidden = false
    elements.cancel.hidden = false
  }

  const close = (): void => {
    revision += 1
    clearTimer()
    printer?.close()
    printer = undefined
    pages = []
    pageIndex = 0
    inputReady = false
    restoreInputElements()
    elements.root.hidden = true
    const resolve = resolvePresentation
    resolvePresentation = undefined
    resolve?.()
  }

  const runControl = async (control: HgssBattleMessagePrinterControl): Promise<void> => {
    const audio = getAudio()
    if (control.kind === 'play-fanfare') await audio?.playFanfare(control.sequenceId)
    else if (control.kind === 'play-sound') startRomSoundEffect(audio, control.sequenceId)
    else {
      const playing = control.kind === 'wait-fanfare'
        ? () => getAudio()?.isFanfarePlaying() ?? false
        : () => getAudio()?.isAnySoundEffectPlaying() ?? false
      while (playing()) await new Promise((resolve) => window.setTimeout(resolve, hgssVBlankDurationMs))
    }
  }

  const finish = (activeRevision: number): void => {
    if (activeRevision !== revision || !resolvePresentation) return
    inputReady = false
    elements.submit.hidden = true
    void getAudio()?.playSoundEffect(hgssBattleAudioSequences.namingScreenCompleteSound).catch(() => undefined)
    timer = window.setTimeout(() => {
      if (activeRevision === revision) close()
    }, hgssVBlanksToMilliseconds(31))
  }

  const showPage = (activeRevision: number): void => {
    const page = pages[pageIndex]
    if (!page || activeRevision !== revision) return
    inputReady = false
    elements.submit.hidden = true
    printer?.close()
    printer = playHgssBattleMessagePrinterPage(page, {
      delayFrames: 1,
      onText: (text) => { if (activeRevision === revision) elements.label.textContent = text },
      onControl: runControl,
      onComplete: () => {
        if (activeRevision !== revision) return
        printer = undefined
        if (page.waitForInput) { inputReady = true; elements.submit.hidden = false }
        else if (pageIndex + 1 < pages.length) { pageIndex += 1; showPage(activeRevision) }
        else finish(activeRevision)
      },
    })
  }

  return {
    present(template, values) {
      if (resolvePresentation) throw new Error('Un message de stockage du Naming Screen HGSS est déjà actif.')
      pages = createHgssBattleMessagePrinterPages(template, values)
      pageIndex = 0
      inputReady = false
      const activeRevision = ++revision
      elements.root.dataset.phase = 'storage-message'
      elements.input.hidden = true
      elements.count.hidden = true
      elements.cancel.hidden = true
      elements.root.hidden = false
      return new Promise<void>((resolve) => { resolvePresentation = resolve; showPage(activeRevision) })
    },
    handle(action) {
      if (!resolvePresentation) return false
      if (printer?.isPrinting() && (action === 'confirm' || action === 'cancel')) { printer.setFastForward(true); return true }
      if (!inputReady || (action !== 'confirm' && action !== 'cancel')) return true
      inputReady = false
      clearTimer()
      void getAudio()?.playSoundEffect(hgssBattleAudioSequences.printerContinueSound).catch(() => undefined)
      if (pageIndex + 1 < pages.length) {
        pageIndex += 1
        showPage(revision)
      } else finish(revision)
      return true
    },
    isActive: () => resolvePresentation !== undefined,
    close,
  }
}
