import type { RomAudioRuntime } from './romAudioRuntime'

type RomAudioPresentationGuard = {
  signal?: AbortSignal
  isCurrent?: () => boolean
}

function isPresentationCurrent(guard: RomAudioPresentationGuard): boolean {
  return !guard.signal?.aborted && (guard.isCurrent?.() ?? true)
}

/**
 * Demarre une tache audio sans donner a sa duree la propriete du flux visuel.
 *
 * Les effets sonores exposent une promesse de fin afin d'implementer WaitSE.
 * Une porte ou un controle `play-sound` doit cependant demarrer le son et
 * continuer immediatement; seule une instruction d'attente explicite bloque.
 */
export function startRomAudioPresentation(
  start: (() => void | Promise<unknown>) | undefined,
  onError: (error: unknown) => void = () => undefined,
): void {
  if (!start) return
  try {
    const playback = start()
    if (playback) void playback.catch(onError)
  } catch (error) {
    onError(error)
  }
}

export function startRomSoundEffect(
  audio: Pick<RomAudioRuntime, 'playSoundEffect'> | undefined,
  sequenceId: number,
  onError?: (error: unknown) => void,
): void {
  startRomAudioPresentation(audio ? () => audio.playSoundEffect(sequenceId) : undefined, onError)
}

export function startRomCry(
  audio: Pick<RomAudioRuntime, 'playCry'> | undefined,
  speciesId: number,
  pattern = 0,
  pan?: number,
  volume?: number,
  onError?: (error: unknown) => void,
): void {
  startRomAudioPresentation(
    audio ? () => audio.playCry(speciesId, pattern, pan, volume) : undefined,
    onError,
  )
}

export type RomCryPresentation = {
  speciesId: number
  pattern?: number
  pan?: number
  volume?: number
}

/** Joue tous les cris d'une entrée double sans que le second coupe le premier. */
export async function playRomCrySequence(
  audio: Pick<RomAudioRuntime, 'playCryAndWait'> | undefined,
  cries: readonly RomCryPresentation[],
  guard: RomAudioPresentationGuard = {},
): Promise<boolean> {
  if (!audio || !isPresentationCurrent(guard)) return false
  for (const cry of cries) {
    await audio.playCryAndWait(cry.speciesId, cry.pattern ?? 0, cry.pan, cry.volume)
    if (!isPresentationCurrent(guard)) return false
  }
  return true
}

/**
 * Lance le son et rend la main uniquement quand la presentation visuelle est
 * terminee. Passer une fabrique garantit l'ordre SE puis animation.
 */
export async function playRomPresentationWithSoundEffect<T>(
  presentation: PromiseLike<T> | (() => PromiseLike<T>),
  audio: Pick<RomAudioRuntime, 'playSoundEffect'> | undefined,
  sequenceId?: number,
  onAudioError?: (error: unknown) => void,
): Promise<T> {
  if (sequenceId !== undefined) startRomSoundEffect(audio, sequenceId, onAudioError)
  return await (typeof presentation === 'function' ? presentation() : presentation)
}

/**
 * Reproduit la sequence native cri -> fin du cri -> fanfare.
 * `playCryAndWait()` suit exactement la lecture qu'il a demarree, meme si un
 * autre cri remplace ensuite le canal global.
 */
export async function playRomCryThenFanfare(
  audio: Pick<RomAudioRuntime, 'playCryAndWait' | 'playFanfare'>,
  cry: { speciesId: number, pattern: number, pan?: number, volume?: number },
  fanfareSequenceId: number,
  guard: RomAudioPresentationGuard = {},
): Promise<boolean> {
  if (!isPresentationCurrent(guard)) return false
  await audio.playCryAndWait(cry.speciesId, cry.pattern, cry.pan, cry.volume)
  if (!isPresentationCurrent(guard)) return false
  await audio.playFanfare(fanfareSequenceId)
  return isPresentationCurrent(guard)
}
